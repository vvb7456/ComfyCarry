"""ComfyCarry — Tunnel Manager

通过 Cloudflare API 全自动管理 Tunnel 生命周期。
无本地状态文件 — 每次从 config + CF API 推导当前状态。
"""

import base64
import json
import logging
import re
import secrets
import shlex
import subprocess
from typing import Dict, List, Optional, Tuple

import requests

log = logging.getLogger(__name__)

CF_API_BASE = "https://api.cloudflare.com/client/v4"
TUNNEL_NAME_PREFIX = "comfycarry"

# 默认服务映射
# protocol 默认 "http", SSH 使用 "ssh"
DEFAULT_SERVICES = [
    {"name": "ComfyCarry", "port": 5000, "suffix": "",      "protocol": "http"},
    {"name": "ComfyUI",    "port": 8188, "suffix": "comfy", "protocol": "http"},
    {"name": "JupyterLab", "port": 8888, "suffix": "jp",    "protocol": "http"},
    {"name": "SSH",        "port": 22,   "suffix": "ssh",   "protocol": "ssh"},
]


class CFAPIError(Exception):
    """Cloudflare API 错误"""
    def __init__(self, message: str, code: int = 0):
        super().__init__(message)
        self.code = code


class TunnelManager:
    """
    Cloudflare Tunnel 全生命周期管理。
    无状态 — 每次实例化时从 CF API 推导当前状态。
    """

    def __init__(self, api_token: str, domain: str, subdomain: str = ""):
        self.api_token = api_token
        self.domain = domain
        self.subdomain = subdomain or self._generate_subdomain()
        self.tunnel_name = f"{TUNNEL_NAME_PREFIX}-{self.subdomain}"

    # ═══════════════════════════════════════════════════
    # 公共接口
    # ═══════════════════════════════════════════════════

    def validate_token(self) -> Tuple[bool, dict]:
        """
        验证 Token 权限。
        Returns: (ok, info_dict)
        """
        try:
            # 1. Account 访问 (同时验证 token 有效性)
            account_id, account_name = self._get_account()

            # 2. Zone 权限
            zone_id, zone_status = self._get_zone()

            # 3. Tunnel 权限 (尝试列出)
            self._cf_get(f"/accounts/{account_id}/cfd_tunnel",
                         params={"per_page": 1})

            return True, {
                "message": "Token 验证通过",
                "account_name": account_name,
                "zone_status": zone_status,
            }

        except CFAPIError as e:
            return False, {"message": str(e)}
        except requests.RequestException as e:
            return False, {"message": f"网络错误: {e}"}

    def ensure(self, services: Optional[List[dict]] = None) -> dict:
        """
        幂等操作: 确保 Tunnel 存在、Ingress 正确、DNS 就绪。

        Returns: {
            "tunnel_id": "...",
            "tunnel_token": "...",
            "urls": {"ComfyCarry": "https://...", ...}
        }
        """
        if services is None:
            services = DEFAULT_SERVICES

        account_id, _ = self._get_account()
        zone_id, _ = self._get_zone()

        # 1. 查找同名 tunnel
        tunnel = self._find_tunnel(account_id, self.tunnel_name)

        if tunnel:
            tunnel_id = tunnel["id"]
            tunnel_token = self._get_tunnel_token(account_id, tunnel_id)
            log.info(f"复用已有 Tunnel: {self.tunnel_name} ({tunnel_id})")
        else:
            # 2. 创建新 tunnel
            tunnel_id, tunnel_token = self._create_tunnel(account_id)
            log.info(f"创建 Tunnel: {self.tunnel_name} ({tunnel_id})")

        # 3. 配置 Ingress (总是覆盖, 确保最新)
        ingress = self._build_ingress(services)
        self._set_tunnel_config(account_id, tunnel_id, ingress)

        # 4. 确保 DNS 记录
        urls = {}
        for svc in services:
            hostname = self._hostname_for(svc)
            self._ensure_dns_cname(zone_id, hostname, tunnel_id)
            urls[svc["name"]] = f"https://{hostname}"

        return {
            "tunnel_id": tunnel_id,
            "tunnel_token": tunnel_token,
            "urls": urls,
        }

    def teardown(self) -> bool:
        """删除 Tunnel + 所有关联 DNS 记录"""
        try:
            account_id, _ = self._get_account()
            zone_id, _ = self._get_zone()
            tunnel = self._find_tunnel(account_id, self.tunnel_name)

            if not tunnel:
                log.info("Tunnel 不存在, 无需清理")
                return True

            tunnel_id = tunnel["id"]

            # 1. 停止 cloudflared
            subprocess.run("pm2 delete cf-tunnel 2>/dev/null", shell=True)

            # 2. 删除 DNS 记录 (查找所有指向该 tunnel 的 CNAME)
            tunnel_cname = f"{tunnel_id}.cfargotunnel.com"
            records = self._cf_get(
                f"/zones/{zone_id}/dns_records",
                params={"type": "CNAME", "content": tunnel_cname, "per_page": 50}
            )
            for rec in records:
                self._cf_delete(f"/zones/{zone_id}/dns_records/{rec['id']}")
                log.info(f"删除 DNS: {rec['name']}")

            # 3. 清除 Tunnel 连接
            self._cf_delete(
                f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/connections"
            )

            # 4. 删除 Tunnel
            self._cf_delete(
                f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}"
            )
            log.info(f"Tunnel 已删除: {self.tunnel_name}")
            return True

        except Exception as e:
            log.error(f"Teardown 失败: {e}")
            return False

    def get_service_urls(self) -> Dict[str, str]:
        """
        从 CF API 查询当前 Tunnel 的 Ingress 配置, 返回服务 URL 映射。

        Returns: {"ComfyCarry": "https://...", "ComfyUI": "https://...", ...}
        """
        try:
            account_id, _ = self._get_account()
            tunnel = self._find_tunnel(account_id, self.tunnel_name)
            if not tunnel:
                return {}

            tunnel_id = tunnel["id"]
            config = self._cf_get(
                f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations"
            )
            ingress = config.get("config", {}).get("ingress", [])

            urls = {}
            for entry in ingress:
                hostname = entry.get("hostname", "")
                service = entry.get("service", "")
                if not hostname or "http_status:" in service:
                    continue

                # 反查服务名
                port_match = re.search(r':(\d+)', service)
                port = int(port_match.group(1)) if port_match else 0
                svc_name = self._port_to_service_name(port)
                urls[svc_name] = f"https://{hostname}"

            return urls

        except Exception:
            return {}

    def get_tunnel_status(self) -> dict:
        """
        查询 Tunnel 连接状态。

        Returns: {
            "exists": bool,
            "tunnel_id": str,
            "status": "healthy" | "degraded" | "down" | "inactive",
            "connections": [...]
        }
        """
        try:
            account_id, _ = self._get_account()
            tunnel = self._find_tunnel(account_id, self.tunnel_name)
            if not tunnel:
                return {"exists": False, "status": "inactive"}

            tunnel_id = tunnel["id"]
            status = tunnel.get("status", "inactive")

            # 查询连接详情
            connections = tunnel.get("connections", [])

            return {
                "exists": True,
                "tunnel_id": tunnel_id,
                "status": status,
                "connections": connections or [],
            }

        except Exception:
            return {"exists": False, "status": "unknown"}

    def start_cloudflared(self, tunnel_token: str) -> bool:
        """通过 PM2 启动 cloudflared (使用 cf-tunnel 避免与旧进程冲突)"""
        subprocess.run("pm2 delete cf-tunnel 2>/dev/null", shell=True)
        r = subprocess.run(
            f'pm2 start cloudflared --name cf-tunnel '
            f'--interpreter none --log /workspace/tunnel.log --time '
            f'-- tunnel run --token {shlex.quote(tunnel_token)}',
            shell=True, capture_output=True, text=True
        )
        subprocess.run("pm2 save 2>/dev/null", shell=True)
        return r.returncode == 0

    # ═══════════════════════════════════════════════════
    # 内部方法
    # ═══════════════════════════════════════════════════

    def _generate_subdomain(self) -> str:
        """生成随机子域名前缀"""
        return f"cc-{secrets.token_hex(4)}"

    def _hostname_for(self, svc: dict) -> str:
        """生成服务的完整域名"""
        suffix = svc.get("suffix", "")
        if suffix:
            return f"{self.subdomain}-{suffix}.{self.domain}"
        return f"{self.subdomain}.{self.domain}"

    def _port_to_service_name(self, port: int) -> str:
        """端口 → 服务名映射"""
        for svc in DEFAULT_SERVICES:
            if svc["port"] == port:
                return svc["name"]
        return f"Service:{port}"

    # ── CF API 操作 ──

    def _get_account(self) -> Tuple[str, str]:
        """获取 account_id 和 account_name"""
        accounts = self._cf_get("/accounts", params={"per_page": 5})
        if not accounts:
            raise CFAPIError("无法获取 CF 账户信息")
        # 返回第一个有 tunnel 权限的账户
        return accounts[0]["id"], accounts[0]["name"]

    def _get_zone(self) -> Tuple[str, str]:
        """获取 zone_id 和 zone_status"""
        zones = self._cf_get("/zones", params={"name": self.domain, "per_page": 1})
        if not zones:
            raise CFAPIError(f"域名 {self.domain} 不在此账户中")
        return zones[0]["id"], zones[0]["status"]

    def _find_tunnel(self, account_id: str, name: str) -> Optional[dict]:
        """按名称查找 tunnel (返回 None 或 tunnel dict)"""
        tunnels = self._cf_get(
            f"/accounts/{account_id}/cfd_tunnel",
            params={"name": name, "is_deleted": "false", "per_page": 1}
        )
        return tunnels[0] if tunnels else None

    def _create_tunnel(self, account_id: str) -> Tuple[str, str]:
        """创建 tunnel, 返回 (tunnel_id, tunnel_token)"""
        tunnel_secret = base64.b64encode(secrets.token_bytes(32)).decode()
        result = self._cf_post(
            f"/accounts/{account_id}/cfd_tunnel",
            json={
                "name": self.tunnel_name,
                "tunnel_secret": tunnel_secret,
                "config_src": "cloudflare",
            }
        )
        return result["id"], result["token"]

    def _get_tunnel_token(self, account_id: str, tunnel_id: str) -> str:
        """
        获取已有 tunnel 的 token。
        CF API: GET /accounts/{id}/cfd_tunnel/{id}/token
        """
        result = self._cf_get(
            f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token"
        )
        return result if isinstance(result, str) else result.get("token", "")

    def _set_tunnel_config(self, account_id: str, tunnel_id: str,
                           ingress: List[dict]):
        """设置 tunnel ingress 配置"""
        self._cf_put(
            f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations",
            json={"config": {"ingress": ingress}}
        )

    def _build_ingress(self, services: List[dict]) -> List[dict]:
        """构建 ingress 规则列表"""
        ingress = []
        for svc in services:
            protocol = svc.get("protocol", "http")
            # 使用 127.0.0.1 而非 localhost，避免 cloudflared 解析到 IPv6
            service_url = f"{protocol}://127.0.0.1:{svc['port']}"
            entry = {
                "hostname": self._hostname_for(svc),
                "service": service_url,
                "originRequest": {},
            }
            ingress.append(entry)
        ingress.append({"service": "http_status:404"})
        return ingress

    def _ensure_dns_cname(self, zone_id: str, hostname: str, tunnel_id: str):
        """确保 DNS CNAME 记录存在且指向正确 (幂等)"""
        tunnel_cname = f"{tunnel_id}.cfargotunnel.com"
        name_part = hostname.replace(f".{self.domain}", "")

        existing = self._cf_get(
            f"/zones/{zone_id}/dns_records",
            params={"type": "CNAME", "name": hostname, "per_page": 1}
        )

        if existing:
            rec = existing[0]
            if rec["content"] == tunnel_cname:
                return  # 已正确
            # 更新
            self._cf_put(
                f"/zones/{zone_id}/dns_records/{rec['id']}",
                json={"type": "CNAME", "name": name_part,
                      "content": tunnel_cname, "proxied": True}
            )
            log.info(f"更新 DNS: {hostname}")
        else:
            self._cf_post(
                f"/zones/{zone_id}/dns_records",
                json={"type": "CNAME", "name": name_part,
                      "content": tunnel_cname, "proxied": True}
            )
            log.info(f"创建 DNS: {hostname}")

    # ── HTTP 封装 ──

    def _cf_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

    def _cf_get(self, path: str, params: dict = None):
        r = requests.get(f"{CF_API_BASE}{path}",
                         headers=self._cf_headers(), params=params, timeout=15)
        return self._parse(r)

    def _cf_post(self, path: str, json: dict = None):
        r = requests.post(f"{CF_API_BASE}{path}",
                          headers=self._cf_headers(), json=json, timeout=15)
        return self._parse(r)

    def _cf_put(self, path: str, json: dict = None):
        r = requests.put(f"{CF_API_BASE}{path}",
                         headers=self._cf_headers(), json=json, timeout=15)
        return self._parse(r)

    def _cf_delete(self, path: str):
        r = requests.delete(f"{CF_API_BASE}{path}",
                            headers=self._cf_headers(), timeout=15)
        return self._parse(r)

    def _parse(self, resp: requests.Response):
        data = resp.json()
        if not data.get("success", True):
            errors = data.get("errors", [])
            msg = errors[0]["message"] if errors else f"HTTP {resp.status_code}"
            code = errors[0].get("code", 0) if errors else 0
            raise CFAPIError(msg, code)
        return data.get("result", data)
