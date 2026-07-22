"""
ComfyCarry — Companion WebDAV 反向代理 WSGI 中间件

在 Flask 路由/鉴权之前拦截 /api/companion/dav/* 请求, 流式转发到本机
rclone serve webdav (127.0.0.1:8688, --baseurl /dav)。数据面走主域名,
自定义/公共 Tunnel + 直连全通, 不再依赖 cloudflared /dav ingress。

设计要点:
  - **不是 Flask 路由**: WSGI 中间件层, 先于 Flask dispatch, 支持非标准
    WebDAV 方法 (PROPFIND/PROPPATCH/MKCOL/MOVE/COPY/LOCK/UNLOCK)。
  - **流式**: 用 stdlib http.client; 请求体按 CONTENT_LENGTH 读取转发,
    响应体分块 yield, 不整体读进内存 (大文件下载)。
  - **hop-by-hop 头剥离**: 两方向均剥 Connection/Keep-Alive/TE 等。
  - **鉴权**: 不做面板鉴权; Authorization 头透传给 rclone serve basic-auth。
"""

import http.client
import logging
from urllib.parse import quote, urlsplit, urlunsplit

log = logging.getLogger(__name__)

# RFC 2616 hop-by-hop 头 (两个方向都要剥离)
_HOP_BY_HOP = frozenset((
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
))


class DavProxyMiddleware:
    """WSGI 中间件: 反向代理 /api/companion/dav/* → 本机 rclone serve。

    用法:
        app.wsgi_app = DavProxyMiddleware(app.wsgi_app, COMPANION_DAV_PORT)
    """

    def __init__(self, app, port, prefix="/api/companion/dav"):
        self.app = app
        self.port = int(port)
        self.prefix = prefix.rstrip("/")

    # ═══════════════════════════════════════════════════════════════
    # WSGI 入口
    # ═══════════════════════════════════════════════════════════════

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")

        # 只拦截 /api/companion/dav 前缀; 其余原样放行 (零副作用)
        if not (path == self.prefix or path.startswith(self.prefix + "/")):
            return self.app(environ, start_response)

        return self._proxy(environ, start_response)

    # ═══════════════════════════════════════════════════════════════
    # 代理逻辑
    # ═══════════════════════════════════════════════════════════════

    def _build_target_path(self, path):
        """路径原样透传 (rclone serve 的 --baseurl 已设为本前缀 /api/companion/dav)。

        baseurl 与外部前缀对齐是关键: 否则 rclone serve 的 PROPFIND 响应里
        自引用 href 用的是它自己的 baseurl, 与客户端请求路径不符, 客户端会
        把目录项当作"不在此集合下"而丢弃 → 列目录为空 (GET 单文件仍可)。

        /api/companion/dav           → /api/companion/dav/
        /api/companion/dav/sub/a.png → /api/companion/dav/sub/a.png
        """
        if path == self.prefix:
            return self.prefix + "/"
        return path

    def _environ_to_headers(self, environ):
        """从 WSGI environ 还原请求头 (HTTP_XXX → Xxx-Yyy + CONTENT_TYPE/LENGTH)。"""
        headers = {}
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                name = key[5:].replace("_", "-").title()
                if name.lower() in _HOP_BY_HOP:
                    continue
                # WebDAV MOVE/COPY 的 Destination(/Source) 是绝对 URL, host 是
                # 外部域名。重写 scheme+host 指向本机 rclone serve (path 不变,
                # baseurl 已对齐), 否则 host 不符会被拒。
                if name in ("Destination", "Source") and "://" in value:
                    p = urlsplit(value)
                    value = urlunsplit((
                        "http", f"127.0.0.1:{self.port}", p.path, p.query, p.fragment,
                    ))
                headers[name] = value
            elif key == "CONTENT_TYPE":
                if value:
                    headers["Content-Type"] = value
            elif key == "CONTENT_LENGTH":
                if value:
                    headers["Content-Length"] = value
        return headers

    @staticmethod
    def _read_request_body(environ, content_length):
        """按 CONTENT_LENGTH 流式读请求体 (PROPFIND/PUT 有 body)。

        返回生成器, yield bytes; WSGI input 一般完整可读。
        """
        if content_length <= 0:
            return
        wsgi_input = environ.get("wsgi.input")
        if wsgi_input is None:
            return
        remaining = content_length
        while remaining > 0:
            chunk = wsgi_input.read(min(remaining, 65536))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk

    def _proxy(self, environ, start_response):
        method = environ["REQUEST_METHOD"]
        path_info = environ.get("PATH_INFO", "")
        query = environ.get("QUERY_STRING", "")

        target_path = self._build_target_path(path_info)
        # WSGI 的 PATH_INFO 是把原始字节按 latin-1 解码后的 str (PEP 3333)。
        # 非 ASCII 路径 (如全角括号 / CJK 目录名) 直接透传给 http.client 会在
        # request.encode('ascii') 处抛 UnicodeEncodeError → 500。这里先还原
        # 原始字节 (encode latin-1) 再百分号编码回纯 ASCII, rclone serve 会解回。
        target_path = quote(target_path.encode("latin-1"), safe="/")
        if query:
            # QUERY_STRING 同样是 latin-1 str; 还原字节再编码, 保留查询分隔符
            # 与已有的 %XX (safe 含 & = % 等), 避免非 ASCII query 触发 500。
            target_path += "?" + quote(query.encode("latin-1"),
                                       safe="=&;:@$,/?+*'()!~-_.%")

        content_length = 0
        try:
            content_length = int(environ.get("CONTENT_LENGTH") or 0)
        except (ValueError, TypeError):
            content_length = 0

        request_headers = self._environ_to_headers(environ)

        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=300)
            conn.putrequest(method, target_path, skip_host=True,
                            skip_accept_encoding=True)
            for name, value in request_headers.items():
                conn.putheader(name, value)
            conn.endheaders()

            # 流式发送请求体 (PROPFIND/PUT 等)
            if content_length > 0:
                for chunk in self._read_request_body(environ, content_length):
                    if chunk:
                        conn.send(chunk)

            resp = conn.getresponse()

        except (ConnectionError, OSError, UnicodeError) as e:
            log.warning("[dav_proxy] rclone serve 不可达/请求异常: %s", e)
            body = b'{"error":"companion dav backend unavailable"}'
            start_response(
                "502 Bad Gateway",
                [("Content-Type", "application/json"),
                 ("Content-Length", str(len(body)))],
            )
            return [body]

        # ── 回传响应 (流式) ─────────────────────────────────
        status_line = f"{resp.status} {resp.reason}"

        response_headers = []
        for name, value in resp.getheaders():
            if name.lower() in _HOP_BY_HOP:
                continue
            response_headers.append((name, value))

        start_response(status_line, response_headers)

        def _stream():
            try:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    yield chunk
            finally:
                try:
                    conn.close()
                except Exception:
                    pass

        return _stream()
