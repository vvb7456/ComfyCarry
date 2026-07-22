"""
ComfyCarry — Companion WebDAV serve 管理 (SHOULD 项 6)

管理常驻 `rclone serve webdav` 进程, 经 cloudflared /dav 路径暴露给客户端。
方案 A (spec §2.1): 不加 --read-only, rclone move 拉完自动删源。

命令:
    rclone serve webdav <COMPANION_SERVE_ROOT>
        --addr 127.0.0.1:<COMPANION_DAV_PORT>
        --baseurl /dav
        --user comfy --pass <DASHBOARD_PASSWORD>

用 subprocess.Popen 托管, 提供 start/stop/status。
随 dashboard 生命周期起停 (由 app.main() 调用 start())。

TODO (公共 Tunnel 模式限制):
    自定义 Tunnel 模式下, /dav 路径 ingress 已在
    tunnel_manager.TunnelManager._build_ingress 中注入。
    但**公共 Tunnel 模式** (PublicTunnelClient) 的 ingress 由远程 worker
    配置, 本仓库无法注入 /dav path 规则。公共模式下 Companion 的
    WebDAV 拉取不可用, 需用户切换到自定义 Tunnel 模式。二期可考虑在
    公共 worker 侧统一加入 /dav path 规则。
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
        "--baseurl", "/dav",
        "--user", "comfy",
        "--pass", str(DASHBOARD_PASSWORD),
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
                "baseurl": "/dav",
                "serve_root": str(COMPANION_SERVE_ROOT),
            }
        return {
            "running": False,
            "addr": f"127.0.0.1:{COMPANION_DAV_PORT}",
            "baseurl": "/dav",
            "serve_root": str(COMPANION_SERVE_ROOT),
        }
