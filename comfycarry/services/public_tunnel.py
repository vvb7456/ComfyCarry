"""ComfyCarry — Public Tunnel Client

与 ComfyCarry Tunnel Worker (CF Workers) 通信，管理公共 Tunnel 生命周期。
运行时数据 (random_id, tunnel_token, urls) 持久化到 .dashboard_env 的
public_tunnel_state 字段，重启后可通过 restore() 恢复。
"""

import hmac
import hashlib
import json
import logging
import os
import socket
import subprocess
import threading
import time
from typing import Optional

import requests

from ..config import get_config, set_config

log = logging.getLogger(__name__)

WORKER_URL = "https://comfycarry-tunnel-worker.razorback-chorus9.workers.dev"
WORKER_AUTH_KEY = "ca8d5865f3ccfc1b305145fd4f4a3c17398e8f5dd7ac493428a3a8f44769ae5f"

# 心跳间隔 (秒)
HEARTBEAT_INTERVAL = 600  # 10 分钟
# 心跳连续失败次数阈值
HEARTBEAT_FAIL_THRESHOLD = 3


class PublicTunnelClient:
    """公共 Tunnel 客户端 — 单例"""

    _instance: Optional["PublicTunnelClient"] = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        # 运行时状态
        self.random_id: Optional[str] = None
        self.tunnel_token: Optional[str] = None
        self.urls: Optional[dict] = None
        self.instance_id: str = self._detect_instance_id()

        # 从持久化配置恢复运行时状态
        self._load_persisted_state()

        # 心跳线程
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._heartbeat_stop = threading.Event()
        self._heartbeat_failures = 0
        self._degraded = False

    # ═══════════════════════════════════════════════════
    # 持久化
    # ═══════════════════════════════════════════════════

    def _save_persisted_state(self):
        """将运行时状态保存到 .dashboard_env"""
        state = {}
        if self.random_id:
            state["random_id"] = self.random_id
        if self.tunnel_token:
            state["tunnel_token"] = self.tunnel_token
        if self.urls:
            state["urls"] = self.urls
        set_config("public_tunnel_state", state if state else "")

    def _load_persisted_state(self):
        """从 .dashboard_env 恢复运行时状态"""
        state = get_config("public_tunnel_state", "")
        if isinstance(state, dict):
            self.random_id = state.get("random_id")
            self.tunnel_token = state.get("tunnel_token")
            self.urls = state.get("urls")
            if self.random_id:
                log.info(f"从配置恢复公共 Tunnel 状态: {self.random_id}")

    def _clear_persisted_state(self):
        """清除持久化状态"""
        set_config("public_tunnel_state", "")

    # ═══════════════════════════════════════════════════
    # 公共接口
    # ═══════════════════════════════════════════════════

    def register(self) -> dict:
        """
        注册公共 Tunnel。
        1. 调用 Worker POST /api/v1/register
        2. 获取 tunnel_token + urls
        3. 启动 cloudflared (PM2)
        4. 启动心跳线程
        5. 持久化 tunnel_mode=public + 运行时状态

        Returns: { "ok": True, "urls": {...}, "random_id": "..." }
        Raises: PublicTunnelError
        """
        # 如果已经注册，先释放
        if self.random_id:
            try:
                self.release()
            except Exception:
                pass

        sig, ts = self._compute_hmac(self.instance_id)

        services = self._get_services()

        try:
            resp = requests.post(
                f"{WORKER_URL}/api/v1/register",
                json={
                    "instance_id": self.instance_id,
                    "services": services,
                },
                headers={
                    "Content-Type": "application/json",
                    "X-ComfyCarry-Auth": sig,
                    "X-Timestamp": ts,
                },
                timeout=30,
            )
            data = resp.json()
        except requests.RequestException as e:
            raise PublicTunnelError(f"无法连接 Worker: {e}")

        if not data.get("ok"):
            raise PublicTunnelError(data.get("error", "注册失败"))

        self.random_id = data["random_id"]
        self.tunnel_token = data["tunnel_token"]
        self.urls = data.get("urls", {})

        log.info(f"公共 Tunnel 注册成功: {self.random_id}")

        # 启动 cloudflared
        self._start_cloudflared(self.tunnel_token)

        # 启动心跳
        self._start_heartbeat()

        # 持久化
        set_config("tunnel_mode", "public")
        self._save_persisted_state()

        return {
            "ok": True,
            "urls": self.urls,
            "random_id": self.random_id,
        }

    def release(self) -> dict:
        """
        释放公共 Tunnel。
        1. 停止心跳线程
        2. 停止 cloudflared (PM2)
        3. 调用 Worker POST /api/v1/release
        4. 清除状态

        Returns: { "ok": True }
        """
        # 停止心跳
        self._stop_heartbeat()

        # 停止 cloudflared
        self._stop_cloudflared()

        # 调用 Worker 释放
        if self.random_id:
            try:
                sig, ts = self._compute_hmac(self.instance_id)
                resp = requests.post(
                    f"{WORKER_URL}/api/v1/release",
                    json={
                        "instance_id": self.instance_id,
                        "random_id": self.random_id,
                    },
                    headers={
                        "Content-Type": "application/json",
                        "X-ComfyCarry-Auth": sig,
                        "X-Timestamp": ts,
                    },
                    timeout=15,
                )
                data = resp.json()
                if not data.get("ok"):
                    log.warning(f"Worker release 返回错误: {data}")
            except Exception as e:
                log.warning(f"Worker release 请求失败: {e}")

        # 清除运行时状态
        self.random_id = None
        self.tunnel_token = None
        self.urls = None
        self._heartbeat_failures = 0
        self._degraded = False

        # 清除持久化
        set_config("tunnel_mode", "")
        self._clear_persisted_state()

        log.info("公共 Tunnel 已释放")
        return {"ok": True}

    def restore(self) -> dict:
        """
        从持久化状态恢复 (重启后调用)。
        不重新注册，只恢复内存状态 + 确保 cloudflared 运行 + 启动心跳。

        Returns: { "ok": True, "random_id": "..." } 或 {"ok": False, "error": "..."}
        """
        if not self.random_id or not self.tunnel_token:
            return {"ok": False, "error": "无持久化状态可恢复"}

        # 确保 cloudflared 在运行
        if not self._is_cloudflared_running():
            self._start_cloudflared(self.tunnel_token)

        # 启动心跳
        self._start_heartbeat()

        # 发送一次心跳验证注册是否仍有效
        if self.heartbeat():
            log.info(f"公共 Tunnel 恢复成功: {self.random_id}")
            return {"ok": True, "random_id": self.random_id}
        else:
            # 注册已过期，需要重新注册
            log.warning("公共 Tunnel 心跳失败，尝试重新注册")
            self._stop_heartbeat()
            try:
                return self.register()
            except PublicTunnelError as e:
                return {"ok": False, "error": str(e)}

    def heartbeat(self) -> bool:
        """
        发送心跳检查。

        Returns: True 如果注册仍有效
        """
        if not self.random_id:
            return False

        try:
            sig, ts = self._compute_hmac(self.instance_id)
            resp = requests.post(
                f"{WORKER_URL}/api/v1/heartbeat",
                json={
                    "instance_id": self.instance_id,
                    "random_id": self.random_id,
                },
                headers={
                    "Content-Type": "application/json",
                    "X-ComfyCarry-Auth": sig,
                    "X-Timestamp": ts,
                },
                timeout=10,
            )
            data = resp.json()
            return data.get("ok", False) and data.get("status") == "active"
        except Exception as e:
            log.warning(f"心跳请求失败: {e}")
            return False

    def get_status(self) -> dict:
        """
        返回本地状态。

        Returns: {
            "mode": "public" | "custom" | null,
            "random_id": "...",
            "urls": {...},
            "cloudflared_running": bool,
            "degraded": bool,
            "heartbeat_failures": int
        }
        """
        mode = get_config("tunnel_mode", "")
        cf_token = get_config("cf_api_token", "")

        if mode == "public":
            current_mode = "public"
        elif cf_token:
            current_mode = "custom"
        else:
            current_mode = None

        return {
            "mode": current_mode,
            "random_id": self.random_id,
            "urls": self.urls,
            "cloudflared_running": self._is_cloudflared_running(),
            "degraded": self._degraded,
            "heartbeat_failures": self._heartbeat_failures,
        }

    @staticmethod
    def get_capacity() -> dict:
        """
        获取 Worker 容量 (无需认证)。

        Returns: { "active_tunnels": N, "max_tunnels": 200, "available": bool }
        """
        try:
            resp = requests.get(f"{WORKER_URL}/api/v1/status", timeout=10)
            data = resp.json()
            return {
                "active_tunnels": data.get("active_tunnels", 0),
                "max_tunnels": data.get("max_tunnels", 200),
                "available": data.get("available", False),
            }
        except Exception as e:
            log.warning(f"获取 Worker 容量失败: {e}")
            return {"active_tunnels": -1, "max_tunnels": 200, "available": False}

    # ═══════════════════════════════════════════════════
    # 内部方法
    # ═══════════════════════════════════════════════════

    def _compute_hmac(self, instance_id: str) -> tuple:
        """
        计算 HMAC-SHA256 签名。

        Returns: (signature_hex, timestamp_str)
        """
        ts = str(int(time.time()))
        msg = f"{instance_id}:{ts}"
        sig = hmac.new(
            WORKER_AUTH_KEY.encode(),
            msg.encode(),
            hashlib.sha256,
        ).hexdigest()
        return sig, ts

    def _detect_instance_id(self) -> str:
        """
        检测 instance_id。
        优先: VAST_CONTAINERLABEL > RUNPOD_POD_ID > hostname
        """
        vast = os.environ.get("VAST_CONTAINERLABEL", "")
        if vast:
            return f"vast-{vast}"

        runpod = os.environ.get("RUNPOD_POD_ID", "")
        if runpod:
            return f"runpod-{runpod}"

        return f"local-{socket.gethostname()}"

    def _get_services(self) -> list:
        """构建服务定义列表"""
        comfyui_port = 8188
        try:
            from ..config import COMFYUI_URL
            import re
            m = re.search(r":(\d+)", COMFYUI_URL)
            if m:
                comfyui_port = int(m.group(1))
        except Exception:
            pass

        dashboard_port = int(os.environ.get("MANAGER_PORT", 5000))

        services = [
            {"name": "dashboard", "port": dashboard_port, "protocol": "http"},
            {"name": "comfyui", "port": comfyui_port, "protocol": "http"},
            {"name": "jupyter", "port": 8888, "protocol": "http"},
            {"name": "ssh", "port": 22, "protocol": "tcp"},
        ]
        return services

    def _start_cloudflared(self, token: str):
        """通过 PM2 启动 cloudflared"""
        # 先确保没有旧进程
        self._stop_cloudflared()

        protocol = get_config("cf_protocol", "auto")
        try:
            subprocess.run(
                f'pm2 start cloudflared --name cf-tunnel '
                f'--interpreter none --log /workspace/tunnel.log --time '
                f'-- tunnel --protocol {shlex.quote(protocol)} '
                f'--metrics localhost:20241 run --token {shlex.quote(token)}',
                shell=True, capture_output=True, text=True, timeout=15,
            )
            log.info(f"cloudflared (cf-tunnel) 已通过 PM2 启动 (protocol={protocol})")
        except Exception as e:
            log.error(f"启动 cloudflared 失败: {e}")

    def _stop_cloudflared(self):
        """通过 PM2 停止 cloudflared"""
        try:
            subprocess.run(
                "pm2 stop cf-tunnel 2>/dev/null; pm2 delete cf-tunnel 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=10,
            )
        except Exception:
            pass

    def _is_cloudflared_running(self) -> bool:
        """检查 cloudflared PM2 进程是否在运行"""
        try:
            r = subprocess.run(
                "pm2 jlist 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                for p in json.loads(r.stdout):
                    if p.get("name") == "cf-tunnel":
                        return p.get("pm2_env", {}).get("status") == "online"
        except Exception:
            pass
        return False

    def _start_heartbeat(self):
        """启动后台心跳线程"""
        self._stop_heartbeat()
        self._heartbeat_stop.clear()
        self._heartbeat_failures = 0
        self._degraded = False

        def _worker():
            while not self._heartbeat_stop.is_set():
                self._heartbeat_stop.wait(HEARTBEAT_INTERVAL)
                if self._heartbeat_stop.is_set():
                    break
                ok = self.heartbeat()
                if ok:
                    self._heartbeat_failures = 0
                    self._degraded = False
                else:
                    self._heartbeat_failures += 1
                    if self._heartbeat_failures >= HEARTBEAT_FAIL_THRESHOLD:
                        self._degraded = True
                        log.warning(
                            f"心跳连续失败 {self._heartbeat_failures} 次, "
                            "标记为 degraded"
                        )

        t = threading.Thread(target=_worker, daemon=True, name="public-tunnel-heartbeat")
        t.start()
        self._heartbeat_thread = t
        log.info("心跳线程已启动")

    def _stop_heartbeat(self):
        """停止心跳线程"""
        self._heartbeat_stop.set()
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            self._heartbeat_thread.join(timeout=5)
        self._heartbeat_thread = None


class PublicTunnelError(Exception):
    """公共 Tunnel 操作错误"""
    pass
