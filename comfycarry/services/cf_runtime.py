"""ComfyCarry — cloudflared 进程运行时约定

蓝绿切换期间可能存在两个 cloudflared 进程:

- 当前活跃进程 (``cf_tunnel_pm2_name``, 默认 ``cf-tunnel``)
- 即将接管的新进程 (另一个名字, 首次为 ``cf-tunnel-next``)

pm2 名与 metrics 端口一一绑定, 集中在此推导, 避免各处硬编码。
"""

from ..config import get_config

CF_PM2_NAME = "cf-tunnel"
CF_NEXT_PM2_NAME = "cf-tunnel-next"

_METRICS_PORTS = {CF_PM2_NAME: 20241, CF_NEXT_PM2_NAME: 20242}
_DEFAULT_METRICS_PORT = 20241


def active_cf_name() -> str:
    """当前活跃的 cloudflared pm2 进程名 (默认 cf-tunnel)。"""
    name = get_config("cf_tunnel_pm2_name", "")
    return name if isinstance(name, str) and name.strip() else CF_PM2_NAME


def next_cf_name() -> str:
    """蓝绿切换时新进程使用的 pm2 名 — 与活跃名互斥交替。

    初次切换 (活跃 cf-tunnel) 返回 cf-tunnel-next; 之后每次切换在两名间
    轮换, 保证新进程名与旧进程名不同, 两者可并存。
    """
    return CF_NEXT_PM2_NAME if active_cf_name() != CF_NEXT_PM2_NAME else CF_PM2_NAME


def cf_metrics_port(name: str | None = None) -> int:
    """pm2 名 → cloudflared metrics 端口。"""
    return _METRICS_PORTS.get(name or active_cf_name(), _DEFAULT_METRICS_PORT)


def cf_metrics_url(name: str | None = None) -> str:
    """pm2 名 → cloudflared metrics 端点 URL。"""
    return f"http://localhost:{cf_metrics_port(name)}"
