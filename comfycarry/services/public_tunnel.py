"""ComfyCarry — Public Tunnel Client

与 ComfyCarry API (自建后端) 通信，管理公共 Tunnel 生命周期。
运行时数据 (random_id, tunnel_token, urls) 持久化到 .dashboard_env 的
public_tunnel_state 字段，重启后可通过 restore() 恢复。
"""

import hmac
import hashlib
import json
import logging
import os
import shlex
import socket
import subprocess
import threading
import time
from typing import Optional
from urllib.parse import urlparse

import requests

from ..config import get_config, set_config
from .cf_runtime import active_cf_name, cf_metrics_port

log = logging.getLogger(__name__)

API_URL = "https://api.erocraft.org"
WORKER_AUTH_KEY = "ca8d5865f3ccfc1b305145fd4f4a3c17398e8f5dd7ac493428a3a8f44769ae5f"
API_HEADERS_BASE = {"User-Agent": "ComfyCarry-Client/1.0"}


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
        self.subdomain: Optional[str] = None
        self.instance_id: str = self._detect_instance_id()

        # 从持久化配置恢复运行时状态
        self._load_persisted_state()

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
        if self.subdomain:
            state["subdomain"] = self.subdomain
        set_config("public_tunnel_state", state if state else "")

    def _load_persisted_state(self):
        """从 .dashboard_env 恢复运行时状态"""
        state = get_config("public_tunnel_state", "")
        if isinstance(state, dict):
            self.random_id = state.get("random_id")
            self.tunnel_token = state.get("tunnel_token")
            self.urls = state.get("urls")
            self.subdomain = state.get("subdomain")
            if self.random_id:
                log.info(f"从配置恢复公共 Tunnel 状态: {self.random_id}")

    def _clear_persisted_state(self):
        """清除持久化状态"""
        set_config("public_tunnel_state", "")

    # ═══════════════════════════════════════════════════
    # 公共接口
    # ═══════════════════════════════════════════════════

    def register(self, subdomain_override: str = "") -> dict:
        """
        注册公共 Tunnel。
        1. 调用 API POST /api/v1/tunnel/register
        2. 获取 tunnel_token + urls
        3. 启动 cloudflared (PM2)
        4. 持久化 tunnel_mode=public + 运行时状态

        subdomain_override: 重注册时复用旧地址 (优先于用户自定义配置)。
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

        # 读取自定义子域名配置 (重注册场景由 override 优先, 保持地址不变)
        subdomain = (subdomain_override or "").strip() \
            or get_config("public_tunnel_subdomain", "")

        body = {
            "instance_id": self.instance_id,
            "services": services,
        }
        if subdomain:
            body["subdomain"] = subdomain

        try:
            resp = requests.post(
                f"{API_URL}/api/v1/tunnel/register",
                json=body,
                headers={
                    **API_HEADERS_BASE,
                    "Content-Type": "application/json",
                    "X-ComfyCarry-Auth": sig,
                    "X-Timestamp": ts,
                },
                timeout=30,
            )
        except requests.RequestException as e:
            raise PublicTunnelError(f"无法连接 API: {e}",
                                    key="public_api_unreachable",
                                    params={"detail": str(e)})

        # JSON 解析与请求异常分开: 后端 500 等非 JSON 响应不能被误报成
        # "无法连接", 否则排障方向被带偏 (requests 的 JSONDecodeError
        # 也是 RequestException 子类, 混在同一个 try 里会被吞掉)。
        data = self._parse_json_response(resp)

        if not data.get("ok"):
            detail = self._extract_error(data)
            # 409 (子域名占用) 等按状态码映射为可翻译 key, 前端不再依赖原文
            raise PublicTunnelError(
                detail or "register failed",
                key=self._error_key(resp.status_code, "public_register_failed"),
                params={"detail": detail} if detail else {},
            )

        self.random_id = data["random_id"]
        self.tunnel_token = data["tunnel_token"]
        self.urls = data.get("urls", {})
        self.subdomain = data.get("subdomain", "")

        log.info(f"公共 Tunnel 注册成功: {self.random_id}")

        # 先落盘再启动: 远程注册已经成功, 本地状态必须先持久化 —— 否则
        # cloudflared 启动失败时进程内状态丢失, 该隧道在 Worker 侧会变成
        # 无人认领的残留 (再也没法 release)。落盘后 restore() 或重试
        # register() 都能把它接回来。
        set_config("tunnel_mode", "public")
        self._save_persisted_state()

        # 启动 cloudflared。失败必须上报: 调用方 (路由 → 前端) 依赖 ok 判断
        # 是否提示成功, 忽略返回值会把「隧道没起来」显示成「已生效」。
        if not self._start_cloudflared(self.tunnel_token):
            raise PublicTunnelError("cloudflared 启动失败", key="public_start_failed")

        return {
            "ok": True,
            "urls": self.urls,
            "random_id": self.random_id,
        }

    def release(self) -> dict:
        """
        释放公共 Tunnel。
        1. 停止 cloudflared (PM2)
        2. 调用 API POST /api/v1/tunnel/release
        3. 清除状态

        Returns: { "ok": True }
        """
        # 停止 cloudflared
        self._stop_cloudflared()

        # 调用 API 释放
        if self.random_id:
            try:
                sig, ts = self._compute_hmac(self.instance_id)
                resp = requests.post(
                    f"{API_URL}/api/v1/tunnel/release",
                    json={
                        "instance_id": self.instance_id,
                        "random_id": self.random_id,
                    },
                    headers={
                        **API_HEADERS_BASE,
                        "Content-Type": "application/json",
                        "X-ComfyCarry-Auth": sig,
                        "X-Timestamp": ts,
                    },
                    timeout=15,
                )
                data = self._parse_json_response(resp)
                if not data.get("ok"):
                    log.warning(f"API release 返回错误: {data}")
            except Exception as e:
                log.warning(f"API release 请求失败: {e}")

        # 清除运行时状态
        self.random_id = None
        self.tunnel_token = None
        self.urls = None
        self.subdomain = None

        # 清除持久化
        set_config("tunnel_mode", "")
        self._clear_persisted_state()

        log.info("公共 Tunnel 已释放")
        return {"ok": True}

    def reserve(self, subdomain: Optional[str] = None) -> dict:
        """预留公共 Tunnel (不启动 cloudflared, 不删除现有资源)。

        Returns: {"ok": True, "random_id", "subdomain", "urls", "expires_at"}
        Raises: PublicTunnelError
        """
        body = {
            "instance_id": self.instance_id,
            "services": self._get_services(),
        }
        if subdomain:
            body["subdomain"] = subdomain

        try:
            resp = requests.post(
                f"{API_URL}/api/v1/tunnel/reserve",
                json=body,
                headers=self._auth_headers(),
                timeout=30,
            )
        except requests.RequestException as e:
            raise PublicTunnelError(f"无法连接 API: {e}",
                                    key="public_api_unreachable",
                                    params={"detail": str(e)})

        data = self._parse_json_response(resp)
        if not data.get("ok"):
            detail = self._extract_error(data)
            raise PublicTunnelError(
                detail or "reserve failed",
                key=self._error_key(resp.status_code, "reserve_failed"),
                params={"detail": detail} if detail else {},
            )
        return data

    def activate(self, random_id: str) -> dict:
        """激活已预留的公共 Tunnel, 返回 tunnel_token 与 urls。

        Returns: {"ok": True, "tunnel_id", "tunnel_token", "random_id",
                  "subdomain", "urls"}
        Raises: PublicTunnelError
        """
        try:
            resp = requests.post(
                f"{API_URL}/api/v1/tunnel/activate",
                json={"instance_id": self.instance_id, "random_id": random_id},
                headers=self._auth_headers(),
                timeout=60,
            )
        except requests.RequestException as e:
            raise PublicTunnelError(f"无法连接 API: {e}",
                                    key="public_api_unreachable",
                                    params={"detail": str(e)})

        data = self._parse_json_response(resp)
        if not data.get("ok"):
            detail = self._extract_error(data)
            # activate 阶段的 409 是预留行状态冲突 (并发处理/已被回收),
            # 不是子域名占用, 不能沿用 reserve 的 subdomain_in_use 映射
            key = ("activate_failed" if resp.status_code == 409
                   else self._error_key(resp.status_code, "activate_failed"))
            raise PublicTunnelError(
                detail or "activate failed",
                key=key,
                params={"detail": detail} if detail else {},
            )
        return data

    def apply_state(self, random_id: str, tunnel_token: str, urls: dict,
                    subdomain: str = ""):
        """把切换后的新状态写入内存并持久化 (不启动进程)。"""
        self.random_id = random_id
        self.tunnel_token = tunnel_token
        self.urls = urls
        self.subdomain = subdomain
        self._save_persisted_state()

    def release_id(self, random_id: Optional[str]) -> bool:
        """按 random_id 释放任意 Tunnel, 不触碰本地状态 / 不停止进程。

        用于切换编排中回收"旧"或"新预留"隧道。
        Returns: 是否成功 (失败仅记日志, 由 API cleanup 兜底)。
        """
        if not random_id:
            return True
        try:
            resp = requests.post(
                f"{API_URL}/api/v1/tunnel/release",
                json={"instance_id": self.instance_id, "random_id": random_id},
                headers=self._auth_headers(),
                timeout=15,
            )
            data = self._parse_json_response(resp)
            if not data.get("ok"):
                log.warning(f"API release({random_id}) 返回错误: {data}")
                return False
            return True
        except Exception as e:
            log.warning(f"API release({random_id}) 请求失败: {e}")
            return False

    def verify(self) -> bool:
        """
        向后端确认持久化的隧道是否仍存活。

        容器长时间停机时, 后台清理任务可能已回收隧道 (宽限期默认 30 分钟);
        此时旧 tunnel_token 无效, cloudflared 会无限重试
        "Unauthorized: Tunnel not found" 且不退出 —— 进程在线 ≠ 隧道可用。

        任何失败 (网络 / 后端异常) 一律视为已失效, 由调用方重新注册;
        注册失败会如实报错, 不存在"看起来恢复了实际不可用"的中间态。
        """
        if not self.random_id:
            return False
        try:
            resp = requests.post(
                f"{API_URL}/api/v1/tunnel/verify",
                json={"instance_id": self.instance_id, "random_id": self.random_id},
                headers=self._auth_headers(),
                timeout=15,
            )
            data = self._parse_json_response(resp)
        except (requests.RequestException, PublicTunnelError) as e:
            log.warning(f"verify 失败 (视为已失效): {e}")
            return False
        return bool(data.get("ok") and data.get("alive"))

    def _persisted_subdomain(self) -> str:
        """从持久化状态推导旧子域名 (重注册时复用, 保持地址不变)。

        新状态直接存有 subdomain; 存量状态 (无该字段) 从 dashboard URL
        推导 — 其主机名首段即子域名。
        """
        if (self.subdomain or "").strip():
            return self.subdomain.strip()
        if self.urls:
            host = urlparse(self.urls.get("dashboard", "")).hostname or ""
            if host:
                return host.split(".")[0]
        return ""

    def _reregister(self) -> dict:
        """隧道被后端回收后的重注册: 复用旧子域名保持地址不变。

        撞名 (409) 不重试 — register 开头已 release, 本地状态即"关闭",
        用户需换子域名手动重新开启。其余失败同样如实上抛由调用方展示。
        """
        old_random_id = self.random_id
        old_subdomain = self._persisted_subdomain()
        log.info(f"隧道 {old_random_id} 已被后端回收, 重新注册 "
                 f"(subdomain={old_subdomain or '<随机>'})")
        try:
            result = self.register(subdomain_override=old_subdomain)
        except PublicTunnelError as e:
            # release 已在 register 内完成, 本地即"关闭"状态
            log.warning(f"重新注册失败: {e}")
            return {"ok": False,
                    "error_key": f"tunnel.err.{e.key}" if e.key
                    else "tunnel.err.internal",
                    "error": str(e)}
        return {"ok": True, "random_id": result.get("random_id"),
                "recovered": True}

    def restore(self) -> dict:
        """
        从持久化状态恢复 (重启后调用)。
        先向后端确认隧道仍存活 — 已失效 (被后台清理回收或无法确认)
        时带旧子域名重新注册。

        Returns: {"ok": True, "random_id": "...", "recovered": bool}
                 或 {"ok": False, "error_key": "..."}
        """
        if not self.random_id or not self.tunnel_token:
            return {"ok": False, "error_key": "tunnel.err.public_no_state"}

        if not self.verify():
            return self._reregister()

        # 存活: 沿用旧 token
        # 确保 cloudflared 在运行; 起不来同样不能回 ok:true
        if not self._is_cloudflared_running():
            if not self._start_cloudflared(self.tunnel_token):
                return {"ok": False, "error_key": "tunnel.err.public_start_failed"}

        log.info(f"公共 Tunnel 恢复成功: {self.random_id}")
        return {"ok": True, "random_id": self.random_id}

    def get_status(self) -> dict:
        """
        返回本地状态。

        Returns: {
            "mode": "public" | "custom" | null,
            "random_id": "...",
            "urls": {...},
            "cloudflared_running": bool
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
        }

    @staticmethod
    def get_capacity() -> dict:
        """
        获取 API 容量 (无需认证)。

        Returns: { "active_tunnels": N, "max_tunnels": 200, "available": bool }
        """
        try:
            resp = requests.get(f"{API_URL}/api/v1/tunnel/status", headers=API_HEADERS_BASE, timeout=10)
            data = resp.json()
            return {
                "active_tunnels": data.get("active_tunnels", 0),
                "max_tunnels": data.get("max_tunnels", 200),
                "available": data.get("available", False),
            }
        except Exception as e:
            log.warning(f"获取 API 容量失败: {e}")
            return {"active_tunnels": -1, "max_tunnels": 200, "available": False}

    # ═══════════════════════════════════════════════════
    # 内部方法
    # ═══════════════════════════════════════════════════

    @staticmethod
    def _parse_json_response(resp: requests.Response) -> dict:
        """解析 API JSON 响应; 非 JSON / 非对象 → PublicTunnelError。

        与请求异常严格区分: 后端 500 的纯文本 "Internal Server Error"
        属于「服务端异常响应」, 不是「网络不可达」。
        """
        try:
            data = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:200]
            raise PublicTunnelError(
                f"API 返回非 JSON 响应 (HTTP {resp.status_code}): {snippet}",
                key="",
            ) from e
        if not isinstance(data, dict):
            raise PublicTunnelError(
                f"API 返回异常数据格式 (HTTP {resp.status_code})", key="")
        return data

    @staticmethod
    def _extract_error(data: dict) -> str:
        """提取错误原文: 协议字段 error > FastAPI detail > 空字符串。

        FastAPI 校验错误 (422) 的 detail 是对象数组, 取首条 msg 保证可读。
        """
        detail = data.get("error") or data.get("detail")
        if isinstance(detail, list) and detail and isinstance(detail[0], dict):
            detail = detail[0].get("msg") or detail[0]
        return str(detail) if detail else ""

    def _auth_headers(self) -> dict:
        """带 HMAC 签名的请求头 (reserve/activate/release 共用)。"""
        sig, ts = self._compute_hmac(self.instance_id)
        return {
            **API_HEADERS_BASE,
            "Content-Type": "application/json",
            "X-ComfyCarry-Auth": sig,
            "X-Timestamp": ts,
        }

    @staticmethod
    def _error_key(status: int, fallback: str) -> str:
        """HTTP 状态 → 可翻译 error_key。"""
        return {
            409: "subdomain_in_use",
            410: "reserve_expired",
            429: "rate_limited",
            503: "service_unavailable",
        }.get(status, fallback)

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

    def _start_cloudflared(self, token: str, name: str | None = None,
                           metrics_port: int | None = None) -> bool:
        """通过 PM2 启动 cloudflared。返回是否启动成功。

        name / metrics_port: 蓝绿切换时启动新进程 (如 cf-tunnel-next / 20242);
        默认使用当前活跃进程名及其对应 metrics 端口。
        """
        name = name or active_cf_name()
        port = metrics_port or cf_metrics_port(name)
        # 先确保没有同名旧进程 (不影响另一个名字的活跃进程)
        self._stop_cloudflared(name)

        protocol = get_config("cf_protocol", "auto")
        from .log_service import clean_pm2_env
        env = clean_pm2_env()
        try:
            r = subprocess.run(
                f'pm2 start cloudflared --name {shlex.quote(name)} '
                f'--interpreter none --log /workspace/tunnel.log --merge-logs --time '
                f'-- tunnel --protocol {shlex.quote(protocol)} '
                f'--metrics localhost:{port} run --token {shlex.quote(token)}',
                shell=True, capture_output=True, text=True, timeout=15, env=env,
            )
            if r.returncode != 0:
                log.error(f"启动 cloudflared 失败 (rc={r.returncode}): {r.stderr}")
                return False
            # 与 ComfyUI / 自定义隧道路径一致: 入 dump, 容器重启可被 pm2 resurrect
            subprocess.run("pm2 save 2>/dev/null", shell=True, timeout=5, env=env)
            log.info(f"cloudflared ({name}) 已通过 PM2 启动 (protocol={protocol})")
            return True
        except Exception as e:
            log.error(f"启动 cloudflared 失败: {e}")
            return False

    def _stop_cloudflared(self, name: str | None = None):
        """通过 PM2 停止 cloudflared (默认当前活跃进程)"""
        name = name or active_cf_name()
        try:
            subprocess.run(
                f"pm2 stop {shlex.quote(name)} 2>/dev/null; "
                f"pm2 delete {shlex.quote(name)} 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=10,
            )
        except Exception:
            pass

    def _is_cloudflared_running(self, name: str | None = None) -> bool:
        """检查指定 (默认活跃) cloudflared PM2 进程是否在运行"""
        name = name or active_cf_name()
        try:
            r = subprocess.run(
                "pm2 jlist 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                for p in json.loads(r.stdout):
                    if p.get("name") == name:
                        return p.get("pm2_env", {}).get("status") == "online"
        except Exception:
            pass
        return False



class PublicTunnelError(Exception):
    """公共 Tunnel 操作错误。

    key/params: 我们自己判定的错误带 i18n key (路由按 `tunnel.err.<key>` 回传);
    公共 Tunnel API 回的报错不带 key —— 那是上游原文, 当 {detail} 透出。
    """
    def __init__(self, message: str, *, key: str = "", params: dict | None = None):
        super().__init__(message)
        self.key = key
        self.params = params or {}
