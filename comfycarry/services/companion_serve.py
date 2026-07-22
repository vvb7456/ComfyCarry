"""
ComfyCarry — Companion WebDAV serve 管理 (SHOULD 项 6)

管理常驻 `rclone serve webdav` 进程, 绑定 127.0.0.1, 经 Flask 反代
(/api/companion/dav) 暴露给客户端。数据面走主域名, 自定义/公共 Tunnel +
直连全通, 不再依赖 cloudflared /dav ingress。
方案 A (spec §2.1): 不加 --read-only, rclone move 拉完自动删源。

命令:
    rclone serve webdav <COMPANION_SERVE_ROOT>
        --addr 127.0.0.1:<COMPANION_DAV_PORT>
        --baseurl /dav
        --user comfy --pass <DASHBOARD_PASSWORD>

用 subprocess.Popen 托管, 提供 start/stop/status。
随 dashboard 生命周期起停 (由 app.main() 调用 start())。

rclone serve 绑 127.0.0.1, 对外不可直连; 由 comfycarry/services/dav_proxy.py
(DavProxyMiddleware) 在 WSGI 层反向代理 /api/companion/dav/* → 127.0.0.1:{port}/dav。
"""

import logging
import os
import subprocess
import threading

from ..config import (
    COMPANION_DAV_PORT,
    COMPANION_SERVE_ROOT,
    DASHBOARD_PASSWORD,
)

log = logging.getLogger(__name__)

_proc = None
_lock = threading.Lock()


def _build_cmd():
    """构建 rclone serve webdav 命令列表 (避免 shell 注入)。"""
    return [
        "rclone", "serve", "webdav",
        str(COMPANION_SERVE_ROOT),
        "--addr", f"127.0.0.1:{COMPANION_DAV_PORT}",
        "--baseurl", "/api/companion/dav",
        "--user", "comfy",
        "--pass", str(DASHBOARD_PASSWORD),
        # ComfyUI 持续产出新文件; 默认 dir-cache-time 5m 会让新产物长时间
        # 不出现在 WebDAV 列目录里 (直连路径的 GET/DELETE 不受影响, 但 watch
        # 自动拉取靠列目录发现新文件)。缩短到 5s 让新产物快速可见。
        "--dir-cache-time", "5s",
    ]


def start():
    """启动 rclone serve webdav (幂等: 已在跑则不重启)。

    返回 True 表示已启动/已在运行, False 表示失败。
    """
    global _proc
    with _lock:
        if _proc and _proc.poll() is None:
            # 已在运行
            return True
        if not os.path.isdir(COMPANION_SERVE_ROOT):
            try:
                os.makedirs(COMPANION_SERVE_ROOT, exist_ok=True)
            except Exception as e:
                log.warning("[companion_serve] 创建 serve root 失败: %s", e)
        if not str(DASHBOARD_PASSWORD):
            log.warning("[companion_serve] DASHBOARD_PASSWORD 为空, 不启动 serve")
            return False
        cmd = _build_cmd()
        try:
            _proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            log.info("[companion_serve] rclone serve webdav 已启动 (pid=%s, port=%s, root=%s)",
                     _proc.pid, COMPANION_DAV_PORT, COMPANION_SERVE_ROOT)
            return True
        except FileNotFoundError:
            log.warning("[companion_serve] rclone 未安装, serve 未启动")
            return False
        except Exception as e:
            log.warning("[companion_serve] 启动失败: %s", e)
            _proc = None
            return False


def stop():
    """停止 rclone serve webdav 进程 (幂等)。"""
    global _proc
    with _lock:
        if not _proc:
            return True
        if _proc.poll() is None:
            try:
                _proc.terminate()
                _proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    _proc.kill()
                except OSError:
                    pass
            except OSError:
                pass
        log.info("[companion_serve] rclone serve webdav 已停止")
        _proc = None
        return True


def status():
    """返回 serve 进程状态 dict。"""
    with _lock:
        if _proc and _proc.poll() is None:
            return {
                "running": True,
                "pid": _proc.pid,
                "addr": f"127.0.0.1:{COMPANION_DAV_PORT}",
                "baseurl": "/api/companion/dav",
                "serve_root": str(COMPANION_SERVE_ROOT),
            }
        return {
            "running": False,
            "addr": f"127.0.0.1:{COMPANION_DAV_PORT}",
            "baseurl": "/api/companion/dav",
            "serve_root": str(COMPANION_SERVE_ROOT),
        }
