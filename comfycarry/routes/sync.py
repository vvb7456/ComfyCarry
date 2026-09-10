"""
ComfyCarry — Cloud Sync v2 路由

- /api/sync/status           — Worker 状态 & 规则 & 模板 & 日志
- /api/sync/remotes          — rclone remote 列表
- /api/sync/remote/create|delete|browse — Remote 管理
- /api/sync/remote/oauth/*   — OAuth authorize 中继 (start/status/paste/cancel)
- /api/sync/remote/types     — Remote 类型定义
- /api/sync/storage          — 容量查询
- /api/sync/rules/save|run   — 规则保存/执行
- /api/sync/worker/start|stop — Worker 控制
- /api/sync/settings         — 全局设置
"""

import json
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import requests
from flask import Blueprint, jsonify, request, Response

from ..config import (
    SYNC_RULE_TEMPLATES, REMOTE_TYPE_DEFS,
    resolve_workspace_path, workspace_relative,
    _RCLONE_TOKEN_RE,
)
from ..services.sync_engine import (
    _load_sync_rules, _save_sync_rules, _parse_rclone_conf,
    _load_sync_settings, _save_sync_settings,
    _run_sync_rule, get_sync_log_buffer, run_rules_as_job,
    get_current_job_id,
    is_worker_running, start_sync_worker, stop_sync_worker,
)

bp = Blueprint("sync", __name__)

# rclone remote 名 / 类型 / 配置键的合法字符集 (_RCLONE_TOKEN_RE, config.py)。
# 校验的意义不只是转义 —— list 参数下 "--config=x" 这种 key 仍会被 rclone
# 当选项解析。


# ====================================================================
# 响应文案 —— 一律 key + params, 由前端翻译 (i18n/locales/*/sync.json)
#
# /api/sync/* 的唯一消费方是面板前端, 所以这里不再回传中文成品文案:
# 回传中文的话英文 locale 下 toast 里会直接冒出中文。契约与 _sync_log
# 的 key+params 完全一致, 前端 apiErrorText() / t() 负责渲染。
# 前端缺条目时会原样显示 key, 开发期一眼可见。
# ====================================================================
def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `sync.err.<key>` 翻译; _extra 是响应体的附加顶层字段。

    形参位置化 (`/`): 插值参数里有 key / name / status 这种名字, 不然会和
    函数自己的形参撞车。
    `_extra` 反过来只能用关键字传 (`*` 右边): 它要是位置化, 关键字写法会被
    `**params` 静默吞掉, 顶层字段丢失。
    """
    body = {"error_key": f"sync.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


def _soft_err(key: str, /, **params):
    """browse 类端点的错误: HTTP 200 + ok:false, 由弹窗就地呈现 (见 browse docstring)。"""
    return jsonify({"ok": False, "error_key": f"sync.err.{key}",
                    "error_params": params})


def _ok(key: str, /, **extra):
    """成功响应。前端按 `sync.msg.<key>` 翻译 message_key。"""
    body = {"ok": True, "message_key": f"sync.msg.{key}"}
    params = extra.pop("params", None)
    if params:
        body["message_params"] = params
    body.update(extra)
    return jsonify(body)


# ====================================================================
# Worker 状态 & 日志
# ====================================================================
@bp.route("/api/sync/status")
def api_sync_status():
    worker_running = is_worker_running()
    pm2_status = "stopped"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout or "[]"):
                if p.get("name") == "sync":
                    pm2_status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    log_lines = get_sync_log_buffer()
    rules = _load_sync_rules()
    settings = _load_sync_settings()
    return jsonify({
        "worker_running": worker_running,
        "pm2_status": pm2_status,
        "log_lines": log_lines,
        "rules": rules,
        "templates": SYNC_RULE_TEMPLATES,
        "settings": settings,
        "current_job_id": get_current_job_id(),
    })


# ====================================================================
# Sync 日志 (读 /workspace/sync.log JSONL, 复用 log_service)
# ====================================================================
@bp.route("/api/sync/logs")
def api_sync_logs():
    """获取 sync 日志 history (行号游标分页, 读 /workspace/sync.log JSONL)"""
    from ..services.log_service import read_history
    try:
        lines = int(request.args.get("lines", "200"))
    except (ValueError, TypeError):
        lines = 200
    before = request.args.get("before")
    before = int(before) if before and before.isdigit() else None
    return jsonify(read_history("/workspace/sync.log", before=before, lines=lines))


@bp.route("/api/sync/logs/stream")
def api_sync_logs_stream():
    """SSE: sync 日志实时流 (tail -f /workspace/sync.log JSONL)"""
    from ..services.log_service import stream_tail
    return Response(stream_tail("/workspace/sync.log"), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ====================================================================
# OAuth relay — 面板代跑 `rclone authorize`
#
# rclone authorize 会在本机 127.0.0.1:53682 起一个一次性 webserver 等回调,
# 但用户浏览器根本够不到容器里的这个端口, 所以由后端中转:
#   1. start:   Popen 拉起 rclone authorize (--auth-no-open-browser);
#   2. rclone 往 stderr 打 /auth 链接 → 后端 GET 一次, 307 的 Location
#      就是供应商真实授权页, 经 status 交给前端展示;
#   3. 用户授权后被 302 到 127.0.0.1:53682/?code=..&state=.. (浏览器打不开,
#      复制地址栏粘回面板) → paste 把 query 原样转发给 rclone;
#   4. rclone 校验 state、换 token, stdout 打印 ---> {json} <---End paste
#      后退出。token 只存内存会话、建远程时并入 argv, 绝不进任何 HTTP 响应。
# ====================================================================
_OAUTH_AUTH_URL_RE = re.compile(r'http://127\.0\.0\.1:53682/auth\?state=\S+')
# paste 的转发目标硬编码 —— 用户粘贴 URL 里的 host/port 一律不采信, 否则
# code/state 会被塞给任意内网端点 (SSRF)
_OAUTH_CALLBACK_TARGET = "http://127.0.0.1:53682/"
_OAUTH_SESSION_TIMEOUT = 600  # 秒。懒超时: 只在 status/paste 处理时顺手检查
_OAUTH_ACTIVE_PHASES = ("starting", "url_ready", "exchanging")


class _OAuthNoRedirect(urllib.request.HTTPRedirectHandler):
    """禁跟随重定向: redirect_request 返回 None 时 3xx 会以 HTTPError 抛出,
    Location 头就挂在异常对象上。"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OAUTH_OPENER = urllib.request.build_opener(_OAuthNoRedirect)

# 单活动会话: 一个 dict + 一把锁, 不做状态机类。start/cancel 时整个换新
# dict —— 旧会话的读线程还攥着旧对象引用, 写它不影响新会话。
_oauth_lock = threading.Lock()
_oauth_session: dict = {"phase": "idle"}


def _oauth_fetch_provider_url(auth_url: str) -> str | None:
    """GET rclone 的 /auth 链接, 取 307 的 Location = 供应商真实授权 URL。"""
    try:
        _OAUTH_OPENER.open(auth_url, timeout=15)
    except urllib.error.HTTPError as e:
        if 300 <= e.code < 400:
            return e.headers.get("Location")
    except Exception:
        pass
    return None


def _oauth_maybe_capture_url(sess: dict, line: str):
    """输出行里出现 /auth 链接就换成供应商授权 URL 存会话。
    NOTICE 在 stderr, 个别版本走 stdout, 两个读线程都调这里兜底。"""
    m = _OAUTH_AUTH_URL_RE.search(line)
    if not m or sess.get("provider_url"):
        return
    provider = _oauth_fetch_provider_url(m.group(0))
    with _oauth_lock:
        if provider:
            sess["provider_url"] = provider
            if sess.get("phase") == "starting":
                sess["phase"] = "url_ready"


def _oauth_pick_error(err_lines: list[str]) -> str:
    """从 rclone 输出里挑一行像样的错误 (端口占用要原样透传)。"""
    lines = [l for l in err_lines if l.strip()]
    in_use = [l for l in lines if "address already in use" in l.lower()]
    if in_use:
        return in_use[-1]
    lines = [l for l in lines if "DEBUG" not in l] or lines
    return lines[-1] if lines else ""


def _oauth_read_stderr(proc, sess: dict, err_lines: list):
    """读 stderr: 收诊断行 + 侦测 /auth 链接。进程退出后 readline 到 EOF,
    线程自然结束。"""
    for line in iter(proc.stderr.readline, ""):
        line = line.rstrip("\n")
        err_lines.append(line)
        _oauth_maybe_capture_url(sess, line)


def _oauth_read_stdout(proc, sess: dict, err_lines: list, t_err: threading.Thread):
    """读 stdout: 截 ---> / <---End paste 之间的 token JSON 存会话 (永不外发);
    进程退出后按退出码 + token 解析结果定夺 done / error。"""
    token_lines: list[str] | None = None
    for line in iter(proc.stdout.readline, ""):
        line = line.rstrip("\n")
        if token_lines is not None:
            if "<---End paste" in line:
                token = "\n".join(token_lines).strip()
                try:
                    json.loads(token)
                except ValueError:
                    token = ""
                if token:
                    with _oauth_lock:
                        sess["token"] = token
                token_lines = None
            elif line.strip():
                token_lines.append(line)
            continue
        if re.search(r'--->\s*$', line):
            token_lines = []
            continue
        _oauth_maybe_capture_url(sess, line)

    code = proc.wait()
    t_err.join(timeout=10)  # 等诊断输出收完再定夺
    with _oauth_lock:
        if sess.get("phase") == "error":  # timeout/cancel 已标记, 不覆盖
            return
        if sess.get("token"):
            sess["phase"] = "done"
            return
        sess["phase"] = "error"
        sess["error"] = _oauth_pick_error(err_lines) or f"rclone exit code {code}"


def _oauth_check_timeout():
    """懒超时: 会话太老且进程还吊着就杀掉。调用方需持有 _oauth_lock。"""
    sess = _oauth_session
    proc = sess.get("proc")
    if (sess.get("phase") in _OAUTH_ACTIVE_PHASES and proc
            and proc.poll() is None
            and time.time() - sess.get("created", 0) > _OAUTH_SESSION_TIMEOUT):
        proc.kill()
        sess["phase"] = "error"
        sess["error"] = "timeout"


def _oauth_spawn(remote_type: str, client_id: str, client_secret: str) -> dict:
    """拉起 rclone authorize + 两个读线程。调用方需持有 _oauth_lock。"""
    global _oauth_session
    cmd = ["rclone", "authorize", remote_type]
    if remote_type == "drive" and client_id and client_secret:
        cmd += [client_id, client_secret]
    cmd.append("--auth-no-open-browser")
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, errors="replace")
    sess = {
        "phase": "starting",
        "proc": proc,
        "remote_type": remote_type,
        "client_id": client_id,
        "client_secret": client_secret,
        "provider_url": None,
        "token": None,
        "error": None,
        "created": time.time(),
    }
    _oauth_session = sess
    err_lines: list[str] = []
    t_err = threading.Thread(target=_oauth_read_stderr,
                             args=(proc, sess, err_lines), daemon=True)
    t_err.start()
    threading.Thread(target=_oauth_read_stdout,
                     args=(proc, sess, err_lines, t_err), daemon=True).start()
    return sess


@bp.route("/api/sync/remote/oauth/start", methods=["POST"])
def api_sync_oauth_start():
    """开始 OAuth 授权: 拉起 rclone authorize, 之后轮询 status 拿授权页 URL。"""
    data = request.get_json(force=True)
    rtype = (data.get("type") or "").strip()
    tdef = REMOTE_TYPE_DEFS.get(rtype)
    if not tdef or not tdef.get("oauth"):
        return _err("invalid_type")
    client_id = (data.get("client_id") or "").strip()
    client_secret = (data.get("client_secret") or "").strip()
    with _oauth_lock:
        sess = _oauth_session
        proc = sess.get("proc")
        if (sess.get("phase") in _OAUTH_ACTIVE_PHASES
                and proc and proc.poll() is None):
            return _err("session_active", 409)
        # 起新会话前清场: 本会话残留进程 + 上次没杀干净的孤儿 authorize
        if proc and proc.poll() is None:
            proc.kill()
        try:
            subprocess.run(["pkill", "-f", "rclone authorize"],
                           capture_output=True, timeout=5)
        except Exception:
            pass
        try:
            _oauth_spawn(rtype, client_id, client_secret)
        except Exception as e:
            return _err("oauth_start_failed", 500, detail=str(e))
    return jsonify({"ok": True, "phase": "starting"})


@bp.route("/api/sync/remote/oauth/status")
def api_sync_oauth_status():
    """轮询授权进度。phase:
    idle → starting → url_ready → (paste) exchanging → done / error"""
    with _oauth_lock:
        _oauth_check_timeout()
        sess = _oauth_session
        out = {"phase": sess.get("phase", "idle")}
        for k in ("remote_type", "provider_url", "error"):
            if sess.get(k):
                out[k] = sess[k]
    return jsonify(out)


@bp.route("/api/sync/remote/oauth/paste", methods=["POST"])
def api_sync_oauth_paste():
    """用户把回调 URL (浏览器打不开的那条) 粘回面板, 后端替浏览器 GET 一次。
    转发成功只是进入 exchanging, 最终成败由 status 轮询 (退出码 + token)。"""
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    except ValueError:
        return _err("invalid_callback")
    # 只认回调该有的四个键, 其余参数一律丢弃
    pick = {k: qs[k][0] for k in ("code", "state", "error", "error_description")
            if qs.get(k)}
    if not pick.get("code") or not pick.get("state"):
        return _err("invalid_callback")
    with _oauth_lock:
        _oauth_check_timeout()
        if _oauth_session.get("phase") != "url_ready":
            return _err("oauth_paste_not_ready", 409)
        # 目标是常量, 用户 URL 解析出的 host/port 绝不参与
        target = f"{_OAUTH_CALLBACK_TARGET}?{urllib.parse.urlencode(pick)}"
    try:
        _OAUTH_OPENER.open(target, timeout=30)
    except urllib.error.HTTPError as e:
        # 3xx 是我们故意不跟随的结果, 同样算 "rclone 已收到回调"
        if not 200 <= e.code < 400:
            return _err("oauth_callback_rejected", 400, detail=f"HTTP {e.code}")
    except Exception as e:
        return _err("oauth_relay_unreachable", 502, detail=str(e))
    with _oauth_lock:
        if _oauth_session.get("phase") == "url_ready":
            _oauth_session["phase"] = "exchanging"
            return jsonify({"ok": True, "phase": "exchanging"})
    return _err("oauth_paste_not_ready", 409)


@bp.route("/api/sync/remote/oauth/cancel", methods=["POST"])
def api_sync_oauth_cancel():
    """放弃当前授权会话, 杀进程回 idle。"""
    global _oauth_session
    with _oauth_lock:
        proc = _oauth_session.get("proc")
        if proc and proc.poll() is None:
            proc.kill()
        _oauth_session = {"phase": "idle"}
    return jsonify({"ok": True, "phase": "idle"})


# ====================================================================
# Remote 管理
# ====================================================================
# rclone.conf 里可以下发给前端的配置项白名单。其余一律不出后端 ——
# pass / password / key_file / user 这些在 params 里对 UI 毫无用处,
# 只会让密码 (rclone obscure 可逆) 和密钥路径随 API 响应外流。
_REMOTE_PUBLIC_PARAMS = ("provider", "vendor", "endpoint", "url", "host", "port", "region", "acl")


@bp.route("/api/sync/remotes")
def api_sync_remotes():
    out = []
    for r in _parse_rclone_conf():
        t = r["type"]
        type_def = REMOTE_TYPE_DEFS.get(t, {})
        params = r.get("params", {})
        out.append({
            "name": r["name"],
            "type": t,
            "display_name": type_def.get("label", t),
            "has_auth": bool(r.get("_has_token") or r.get("_has_keys")
                             or r.get("_has_pass")),
            "params": {k: v for k, v in params.items()
                       if k in _REMOTE_PUBLIC_PARAMS},
        })
    return jsonify({"remotes": out})


@bp.route("/api/sync/remote/create", methods=["POST"])
def api_sync_remote_create():
    global _oauth_session
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    rtype = data.get("type", "").strip()
    params = data.get("params", {})
    oauth_used = bool(data.get("oauth"))

    # OAuth 中继建远程: token 从 authorize 会话取 (前端只有 URL/状态,
    # token 永不经前端回传)。会话须已 done 且类型一致; 失败路径保留会话,
    # 修好参数 (如改名) 可直接重试, 不必重新授权。
    if oauth_used:
        with _oauth_lock:
            sess = _oauth_session
            if (sess.get("phase") != "done" or sess.get("remote_type") != rtype
                    or not sess.get("token")):
                return _err("oauth_not_ready", 409)
            params = dict(params)
            params["token"] = sess["token"]
            if sess.get("client_id"):
                params["client_id"] = sess["client_id"]
            if sess.get("client_secret"):
                params["client_secret"] = sess["client_secret"]

    if not name or not rtype:
        return _err("name_type_required")
    if not _RCLONE_TOKEN_RE.match(name):
        return _err("remote_name_invalid")
    if not _RCLONE_TOKEN_RE.match(rtype):
        return _err("remote_type_invalid")

    existing = [r["name"] for r in _parse_rclone_conf()]
    if name in existing:
        return _err("remote_exists", 409, name=name)

    # Step 1: Create the remote config (non-interactive to skip OAuth web server)
    # 一律 list 参数 —— 配置值里的引号/分号在 shell 拼接下会逃逸成命令注入
    cmd = ["rclone", "config", "create", name, rtype, "--non-interactive"]
    for k, v in params.items():
        if not v:
            continue
        # key 作为独立 argv 元素仍可能是 "--config=x" 这种选项形态
        if not _RCLONE_TOKEN_RE.match(str(k)):
            return _err("param_name_invalid", 400, key=k)
        cmd.append(f"{k}={v}")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            # rclone 原始输出不做翻译, 作为 detail 插进模板
            return _err("create_failed", 500,
                        detail=r.stderr.strip() or r.stdout.strip())
    except Exception as e:
        return _err("create_failed", 500, detail=str(e))

    # Step 2: Test connectivity — list root to verify credentials/endpoint
    try:
        test = subprocess.run(
            ["rclone", "lsf", f"{name}:", "--max-depth", "1", "--dirs-only"],
            capture_output=True, text=True, timeout=20
        )
        if test.returncode != 0:
            # Rollback: delete the broken remote
            subprocess.run(["rclone", "config", "delete", name],
                           capture_output=True, text=True, timeout=10)
            err_msg = test.stderr.strip() or test.stdout.strip()
            if err_msg:
                return _err("conn_test_failed", 400, detail=err_msg)
            return _err("conn_test_failed_plain", 400)
    except subprocess.TimeoutExpired:
        subprocess.run(["rclone", "config", "delete", name],
                       capture_output=True, text=True, timeout=10)
        return _err("conn_test_timeout", 400)
    except Exception as e:
        subprocess.run(["rclone", "config", "delete", name],
                       capture_output=True, text=True, timeout=10)
        return _err("conn_test_failed", 400, detail=str(e))

    if oauth_used:
        # 成功后清会话, token 不在内存多留
        with _oauth_lock:
            if _oauth_session.get("phase") == "done":
                _oauth_session = {"phase": "idle"}
    return _ok("remote_created", params={"name": name})


@bp.route("/api/sync/remote/delete", methods=["POST"])
def api_sync_remote_delete():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return _err("remote_name_required")
    if not _RCLONE_TOKEN_RE.match(name):
        return _err("remote_name_invalid")
    try:
        r = subprocess.run(["rclone", "config", "delete", name],
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return _err("delete_failed", 500, detail=r.stderr.strip())
    except Exception as e:
        return _err("delete_failed", 500, detail=str(e))

    # 删除 remote 后清理引用它的规则 —— 否则规则列表里会残留指向已删除
    # remote 的条目, UI 仍显示但再次执行时 rclone 会因 remote 不存在而失败。
    rules = _load_sync_rules()
    remaining = [r for r in rules if r.get("remote") != name]
    rules_removed = len(rules) - len(remaining)
    if rules_removed:
        _save_sync_rules(remaining)
        # 与 rules/save 一致: 剩下的 watch 规则若已全部清空, 停掉 worker,
        # 避免空转; 否则保留运行状态。
        watch_rules = [r for r in remaining
                       if r.get("trigger") == "watch" and r.get("enabled", True)]
        if not watch_rules:
            stop_sync_worker()

    return _ok("remote_deleted",
               params={"name": name},
               rules_removed=rules_removed)


@bp.route("/api/sync/remote/browse", methods=["POST"])
def api_sync_remote_browse():
    """列出 remote 上某层目录。

    path 原样交给 rclone —— 前导 "/" 的含义由后端类型决定 (s3 / webdav /
    drive / dropbox / onedrive 都会 Trim 掉; sftp 则区分 home 相对与
    服务器绝对), 面板不做规范化以免改变用户意图。

    失败一律 HTTP 200 + {ok: false, error} —— 浏览器组件要在弹窗内就地
    呈现错误 (可重试), 不走 useApiFetch 的全局 toast。
    """
    data = request.get_json(force=True)
    remote = (data.get("remote") or "").strip()
    path = data.get("path") or ""
    if not remote:
        return _soft_err("browse_no_remote")
    if not _RCLONE_TOKEN_RE.match(remote):
        return _soft_err("remote_name_invalid")
    try:
        r = subprocess.run(
            ["rclone", "lsjson", f"{remote}:{path}", "--dirs-only", "--max-depth", "1"],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            err = (r.stderr or "").strip().splitlines()
            if err:
                return _soft_err("browse_rclone_failed", detail=err[-1])
            return _soft_err("browse_rclone_failed_plain")
        items = json.loads(r.stdout or "[]")
        dirs = sorted(i["Path"] for i in items if i.get("IsDir"))
        return jsonify({"ok": True, "dirs": dirs})
    except subprocess.TimeoutExpired:
        return _soft_err("browse_timeout")
    except Exception as e:
        return _soft_err("browse_rclone_failed", detail=str(e))


@bp.route("/api/sync/local/browse", methods=["POST"])
def api_sync_local_browse():
    """列出本地目录。path 为 workspace 根相对路径 ("/" 即 WORKSPACE_DIR)。

    失败一律 HTTP 200 + {ok: false, error}, 理由同 remote/browse。
    """
    data = request.get_json(force=True)
    path = data.get("path") or "/"
    target, err = resolve_workspace_path(path)
    if err:
        return _soft_err(err[0], **err[1])
    if not target.is_dir():
        return _soft_err("dir_missing", path=workspace_relative(target))
    try:
        dirs = sorted(
            d.name for d in target.iterdir()
            if d.is_dir() and not d.name.startswith('.')
        )
        return jsonify({"ok": True, "dirs": dirs})
    except PermissionError:
        return _soft_err("dir_denied")
    except Exception as e:
        return _soft_err("dir_failed", detail=str(e))


@bp.route("/api/sync/remote/types")
def api_sync_remote_types():
    return jsonify({"types": REMOTE_TYPE_DEFS})


def _storage_err(key: str, /, **params):
    """storage 是"每个 remote 各自一份状态", 错误内嵌在该 remote 的对象里
    (整个请求并没有失败), 所以不走 _err 的 HTTP 状态码路径。"""
    return {"error_key": f"sync.err.{key}", "error_params": params}


@bp.route("/api/sync/storage")
def api_sync_storage():
    remotes = _parse_rclone_conf()
    results = {}
    for r in remotes:
        name = r["name"]
        try:
            proc = subprocess.run(
                ["rclone", "about", f"{name}:", "--json"],
                capture_output=True, text=True, timeout=30
            )
            if proc.returncode == 0 and proc.stdout.strip():
                about = json.loads(proc.stdout)
                if about.get("total") or about.get("used") or about.get("free"):
                    results[name] = {
                        "total": about.get("total"),
                        "used": about.get("used"),
                        "free": about.get("free"),
                        "trashed": about.get("trashed"),
                    }
                else:
                    results[name] = _storage_err("storage_unsupported")
            else:
                # 解析 rclone 的真实错误信息
                stderr = (proc.stderr or "").strip()
                if "token" in stderr.lower() or "oauth" in stderr.lower() or "expired" in stderr.lower() or "invalid_grant" in stderr.lower():
                    results[name] = _storage_err("storage_auth_expired")
                elif "not found" in stderr.lower() or "doesn't exist" in stderr.lower():
                    results[name] = _storage_err("storage_not_found")
                elif "doesn't support about" in stderr.lower() or "not supported" in stderr.lower():
                    results[name] = _storage_err("storage_unsupported")
                elif stderr:
                    # 提取最后一行有意义的错误 —— rclone 原文, 不翻译
                    lines = [l for l in stderr.split('\n') if l.strip() and 'DEBUG' not in l]
                    results[name] = {"error": lines[-1] if lines else stderr[:200]}
                else:
                    results[name] = _storage_err("storage_unsupported")
        except subprocess.TimeoutExpired:
            results[name] = _storage_err("storage_timeout")
        except Exception as e:
            results[name] = {"error": str(e)}
    return jsonify({"storage": results})


# ====================================================================
# 同步规则
# ====================================================================
_RULE_DIRECTIONS = ("pull", "push")
_RULE_METHODS = ("copy", "sync", "move")
_RULE_TRIGGERS = ("manual", "deploy", "watch")


def _normalize_rule(r: dict) -> tuple[dict | None, tuple[str, dict] | None]:
    """校验并规范化一条规则。返回 (规则, None) 或 (None, (i18n key, params))。

    这些字段最终会进 rclone 的 argv / 决定往哪个方向删文件, 不能信任前端:
    method 落在 argv[1] (子命令位), direction 决定 src/dst 谁是远端,
    filters 若是字符串会被逐字符当成多个 --filter。
    """
    if not isinstance(r, dict):
        return None, ("rule_bad_shape", {})
    label = r.get("name") or r.get("id") or "?"
    if not r.get("id") or not r.get("remote") or not r.get("local_path"):
        return None, ("rule_missing_fields", {})

    # local_path 必须是 workspace 根相对路径, 且不得越界 ——
    # sync / move 会删目标端多余文件, 指到 workspace 外风险过大
    target, err = resolve_workspace_path(r["local_path"], allow_root=False)
    if err:
        # 路径类错误带上规则名: 一次保存可能有多条规则, 用户要知道是哪条
        return None, (f"rule_{err[0]}", {"label": label, **err[1]})
    r["local_path"] = workspace_relative(target)

    if not _RCLONE_TOKEN_RE.match(str(r["remote"])):
        return None, ("rule_remote_invalid", {"label": label})

    # 每个字段各自一个 key —— 字段名要出现在用户可见文案里, 用后端英文
    # 字段名当插值参数就会在 UI 上冒出 "direction" 这种行话
    direction = r.get("direction", "pull")
    if direction not in _RULE_DIRECTIONS:
        return None, ("rule_direction_invalid", {"label": label, "value": direction})
    method = r.get("method", "copy")
    if method not in _RULE_METHODS:
        return None, ("rule_method_invalid", {"label": label, "value": method})
    trigger = r.get("trigger", "manual")
    if trigger not in _RULE_TRIGGERS:
        return None, ("rule_trigger_invalid", {"label": label, "value": trigger})
    r["direction"], r["method"], r["trigger"] = direction, method, trigger

    filters = r.get("filters", [])
    if isinstance(filters, str):
        filters = [ln for ln in filters.splitlines() if ln.strip()]
    if not isinstance(filters, list) or any(not isinstance(f, str) for f in filters):
        return None, ("rule_filters_invalid", {"label": label})
    r["filters"] = filters

    enabled = r.get("enabled", True)
    if not isinstance(enabled, bool):
        # bool("false") 是 True —— 与其静默把"关闭"当成"开启", 不如直接拒绝
        return None, ("rule_enabled_invalid", {"label": label})
    r["enabled"] = enabled
    return r, None


@bp.route("/api/sync/rules/save", methods=["POST"])
def api_sync_rules_save():
    data = request.get_json(force=True)
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        return _err("rules_not_array")
    normalized = []
    for r in rules:
        rule, err = _normalize_rule(r)
        if err:
            return _err(err[0], 400, **err[1])
        normalized.append(rule)
    rules = normalized
    _save_sync_rules(rules)

    watch_rules = [r for r in rules if r["trigger"] == "watch" and r["enabled"]]
    if watch_rules and not is_worker_running():
        start_sync_worker()
    elif not watch_rules:
        stop_sync_worker()

    return _ok("rules_saved", params={"count": len(rules)}, rules=rules)


@bp.route("/api/sync/rules/run", methods=["POST"])
def api_sync_rules_run():
    data = request.get_json(force=True)
    rule_id = data.get("rule_id")
    rules = _load_sync_rules()

    if rule_id:
        targets = [r for r in rules if r.get("id") == rule_id and r.get("enabled", True)]
        trigger_type = "manual"
    else:
        targets = [r for r in rules
                   if r.get("trigger") == "deploy" and r.get("enabled", True)]
        trigger_type = "deploy"

    if not targets:
        return _err("rules_none_matched", 404)

    # 已有 job 在跑就不再起新的 —— 单条 rclone 执行本就被 _sync_exec_lock
    # 串行化, 再堆线程只会让它们排队等锁, 前端也无法表达"两个 job 同时跑"
    running = get_current_job_id()
    if running:
        # job_id 一并回传 —— 前端据此跳到正在跑的那个 job 详情
        return _err("job_running", 409, _extra={"job_id": running})

    def _run_targets():
        run_rules_as_job(targets, trigger_type=trigger_type,
                         trigger_ref=rule_id or "")

    threading.Thread(target=_run_targets, daemon=True).start()
    return _ok("run_started", params={"count": len(targets)})


# ====================================================================
# Worker 控制
# ====================================================================
@bp.route("/api/sync/worker/start", methods=["POST"])
def api_sync_worker_start():
    start_sync_worker()
    return _ok("worker_started")


@bp.route("/api/sync/worker/stop", methods=["POST"])
def api_sync_worker_stop_route():
    stop_sync_worker()
    return _ok("worker_stopped")


# ====================================================================
# 全局设置
# ====================================================================
@bp.route("/api/sync/settings", methods=["GET"])
def api_sync_settings_get():
    return jsonify(_load_sync_settings())


@bp.route("/api/sync/settings", methods=["POST"])
def api_sync_settings_save():
    data = request.get_json(force=True)
    settings = _load_sync_settings()
    try:
        if "min_age" in data:
            settings["min_age"] = max(int(data["min_age"]), 0)
        if "watch_interval" in data:
            settings["watch_interval"] = max(int(data["watch_interval"]), 5)
    except (ValueError, TypeError):
        return _err("settings_numbers")
    _save_sync_settings(settings)
    return jsonify({"ok": True, "settings": settings})


# ====================================================================
# Sync Job 查询
# ====================================================================


@bp.route("/api/sync/jobs", methods=["GET"])
def api_sync_jobs():
    """
    查询最近 sync job 列表。
    Query: ?limit=30
    返回: {"jobs": [...], "current_job_id": "sync-xxx" | null}
    """
    from ..services import sync_store as store

    limit = request.args.get("limit", 30, type=int)
    limit = min(max(limit, 1), 200)
    jobs = store.get_recent_jobs(limit=limit)
    current = get_current_job_id()
    return jsonify({"jobs": jobs, "current_job_id": current})


@bp.route("/api/sync/jobs/<job_id>", methods=["GET"])
def api_sync_job_detail(job_id: str):
    """
    查询单个 job 详情 + 事件列表。
    Query: ?after_id=0&limit=500
    返回: {"job": {...}, "events": [...]}
    """
    from ..services import sync_store as store

    job = store.get_job(job_id)
    if not job:
        return _err("job_not_found", 404)

    after_id = request.args.get("after_id", 0, type=int)
    limit = request.args.get("limit", 500, type=int)
    limit = min(max(limit, 1), 2000)
    events = store.get_events(job_id, limit=limit, after_id=after_id)
    return jsonify({"job": job, "events": events})
