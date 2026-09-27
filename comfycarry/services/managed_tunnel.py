"""Consume platform-owned entry bindings without invoking the public Tunnel lifecycle."""

import json
import os
from urllib.parse import urlsplit
from uuid import UUID

from ..config import get_config, set_config

_ENV = ("PROVISIONING_INSTANCE_ID", "PROVISIONING_TOKEN", "MANAGEMENT_API_URL",
        "MANAGED_TUNNEL_TOKEN", "MANAGED_TUNNEL_URLS")
_KEY = "_managed_provisioning"


def _valid_binding(values):
    if not isinstance(values, dict) or not all(isinstance(values.get(key), str) and values[key].strip() for key in _ENV):
        return None
    try:
        identity = str(UUID(values["PROVISIONING_INSTANCE_ID"]))
        urls = json.loads(values["MANAGED_TUNNEL_URLS"])
        if not isinstance(urls, dict) or set(urls) != {"dashboard", "comfyui", "jupyter", "ssh"}:
            return None
        for url in [values["MANAGEMENT_API_URL"], *urls.values()]:
            if not isinstance(url, str):
                return None
            parsed = urlsplit(url)
            if parsed.scheme not in {"http", "https", "ssh", "tcp"} or not parsed.hostname or parsed.username or parsed.password:
                return None
        if urlsplit(values["MANAGEMENT_API_URL"]).scheme not in {"http", "https"}:
            return None
        return {**values, "PROVISIONING_INSTANCE_ID": identity}
    except (ValueError, TypeError):
        return None


def binding():
    injected = {key: os.environ.get(key, "").strip() for key in _ENV}
    if any(injected.values()):
        # Partial injection can belong to a new attempt; never revive an old identity under it.
        return _valid_binding(injected)
    return _valid_binding(get_config(_KEY, None))


def is_managed():
    return binding() is not None


def public_view():
    values = binding()
    if values is None:
        return {"managed": False, "urls": {}}
    return {"managed": True, "instance_id": values["PROVISIONING_INSTANCE_ID"],
            "urls": json.loads(values["MANAGED_TUNNEL_URLS"])}


def ensure_connected():
    from .public_tunnel import PublicTunnelClient, PublicTunnelError

    values = binding()
    if values is None:
        raise PublicTunnelError("托管入口配置不完整", key="public_no_state")
    set_config(_KEY, values)
    client = PublicTunnelClient()
    same = get_config("_managed_tunnel_instance_id", "") == values["PROVISIONING_INSTANCE_ID"]
    if not same or not client._is_cloudflared_running():
        if not client._start_cloudflared(values["MANAGED_TUNNEL_TOKEN"]):
            raise PublicTunnelError("托管入口连接失败", key="public_start_failed")
        set_config("_managed_tunnel_instance_id", values["PROVISIONING_INSTANCE_ID"])
    set_config("tunnel_mode", "public")
    return {"ok": True, **public_view()}
