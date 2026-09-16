"""ComfyCarry — 隧道切换编排 (蓝绿)

隧道配置变更时, 先建好新资源并确认新地址健康, 再退役旧进程/旧资源;
切换失败时回收新资源, 旧配置/旧进程/旧资源原样保留。

状态: 进程内单例 + 持久化到 config ``tunnel_switch_state`` (仅用于状态查询,
后端重启会中断切换, 启动时清为 idle)。同一时刻只允许一个切换进行中。
"""

import json
import logging
import re
import shlex
import subprocess
import threading
import time
import uuid
from urllib.parse import urlparse

import requests

from ..config import get_config, set_config
from .cf_runtime import active_cf_name, cf_metrics_port, next_cf_name
from .public_tunnel import PublicTunnelClient, PublicTunnelError
from .tunnel_manager import CFAPIError, TunnelManager, get_default_services

log = logging.getLogger(__name__)

# 新地址公网健康探测: 单次超时 5s, 间隔 2s, 总超时 120s
_HEALTH_TIMEOUT = 120
_HEALTH_INTERVAL = 2
_HEALTH_REQUEST_TIMEOUT = 5

_PUBLIC_SUBDOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")

_lock = threading.RLock()


class SwitchError(Exception):
    """切换请求校验/预留失败 (路由按 ``tunnel.err.<key>`` 回传)。"""

    def __init__(self, key: str, status: int = 400, **params):
        super().__init__(key)
        self.key = key
        self.status = status
        self.params = params


def _idle() -> dict:
    return {
        "phase": "idle",
        "switch_id": "",
        "mode": "",
        "new_url": "",
        "old_url": "",
        "same_host": False,
        "error_key": "",
        "error_params": {},
        "services": {},
        "new_name": "",
        "old_name": "",
        "new_random_id": "",
        "old_random_id": "",
        "old_mode": None,
        "old_cf": None,
        "same_target": False,
    }


_state = _idle()


# ═══════════════════════════════════════════════════════════════
# 状态读写
# ═══════════════════════════════════════════════════════════════

def _persist_locked():
    set_config("tunnel_switch_state", {
        "phase": _state["phase"],
        "switch_id": _state["switch_id"],
        "mode": _state["mode"],
        "new_url": _state["new_url"],
        "old_url": _state["old_url"],
        "same_host": _state["same_host"],
        "error_key": _state["error_key"],
        "services": _state["services"],
    })

def _apply(sw: dict):
    with _lock:
        _state.clear()
        _state.update(_idle())
        _state.update(sw)
        _persist_locked()


def _set_phase(phase: str):
    with _lock:
        _state["phase"] = phase
        _persist_locked()


def _finish(phase: str, error_key: str = "", error_params: dict | None = None):
    with _lock:
        _state["phase"] = phase
        _state["error_key"] = error_key
        _state["error_params"] = error_params or {}
        _persist_locked()


def _snapshot() -> dict:
    with _lock:
        return dict(_state)


def get_state() -> dict:
    """切换状态 (供 GET /api/tunnel/switch/status)。"""
    with _lock:
        return {
            "phase": _state["phase"],
            "switch_id": _state["switch_id"],
            "mode": _state["mode"],
            "new_url": _state["new_url"],
            "old_url": _state["old_url"],
            "same_host": _state["same_host"],
            "error_key": _state["error_key"],
            "error_params": _state["error_params"],
            "services": _state["services"],
        }


def reset_on_startup():
    """应用启动时把切换状态清为 idle, 并清理中断遗留的非活跃进程。"""
    with _lock:
        _state.clear()
        _state.update(_idle())
        set_config("tunnel_switch_state", "")
    # 上次切换若在收尾前被重启中断, 会遗留一个非活跃名的 cloudflared;
    # 正常运行时该名不存在, 删除为无害的幂等操作。
    try:
        _pm2_delete(next_cf_name())
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════
# 请求入口
# ═══════════════════════════════════════════════════════════════

def start_switch(payload: dict) -> dict:
    """校验并启动切换, 返回 202 响应体。失败抛 SwitchError (不启动切换)。"""
    mode = str(payload.get("mode") or "").strip().lower()
    with _lock:
        if _state["phase"] not in ("idle", "done", "failed"):
            raise SwitchError("switch_in_progress", 409)
        if mode == "custom":
            return _begin_custom(payload)
        if mode == "public":
            return _begin_public(payload)
        raise SwitchError("invalid_mode", 400)


def _response() -> dict:
    with _lock:
        return {
            "ok": True,
            "switch_id": _state["switch_id"],
            "old_url": _state["old_url"],
            "new_url": _state["new_url"],
            "same_host": _state["same_host"],
            "services": _state["services"],
        }


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _begin_custom(payload: dict) -> dict:
    api_token = str(payload.get("api_token") or "").strip()
    domain = str(payload.get("domain") or "").strip()
    subdomain = str(payload.get("subdomain") or "").strip()

    if not api_token or not domain:
        raise SwitchError("missing_token_or_domain", 400)
    if not subdomain:
        raise SwitchError("subdomain_required", 400)

    services = _effective_services()
    # 构造管理器兼做子域名必填校验 (不做网络调用)
    mgr = TunnelManager(api_token, domain, subdomain)
    svc_urls = {svc["name"]: f"https://{mgr._hostname_for(svc)}" for svc in services}
    # 面板地址: dashboard 服务后缀为空且不可被 cf_suffix_overrides 覆盖
    # (PUT 路由的 <suffix> 段不匹配空串), 故恒为 {子域名}.{根域名};
    # 若未来放开根服务后缀, 须改用 dashboard 服务的 _hostname_for 计算
    new_url = f"https://{subdomain}.{domain}"

    cur = _current_info()
    # 新旧 CF 资源同一性只由 域名+子域名 决定 (tunnel 名/DNS 均由此派生):
    # 仅换 token 时 ensure 会复用同一条 Tunnel, 旧资源 teardown 会误删正在
    # 服务的新隧道, 故 target 相同即跳过旧资源清理 (跨账号同目标极罕见,
    # 遗留一条无 DNS 引用的旧 Tunnel 可手动清理, 可接受)
    same_target = (
        cur["mode"] == "custom"
        and cur.get("domain") == domain
        and cur.get("subdomain") == subdomain
    )
    new_name = next_cf_name()
    old_name = active_cf_name()
    old_cf = cur if cur["mode"] == "custom" else None
    old_random_id = cur.get("random_id", "") or ""

    _apply({
        "switch_id": uuid.uuid4().hex,
        "mode": "custom",
        "new_url": new_url,
        "old_url": cur["url"],
        "same_host": bool(cur["url"]) and _host(new_url) == _host(cur["url"]),
        "services": svc_urls,
        "new_name": new_name,
        "old_name": old_name,
        "old_random_id": old_random_id,
        "old_mode": cur["mode"],
        "old_cf": old_cf,
        "same_target": same_target,
        "phase": "preparing",
    })

    threading.Thread(
        target=_run_custom,
        args=(api_token, domain, subdomain, services, new_name, old_name,
              cur["mode"], old_cf, same_target, old_random_id),
        daemon=True,
    ).start()
    return _response()


def _begin_public(payload: dict) -> dict:
    subdomain = str(payload.get("subdomain") or "").strip().lower()
    if subdomain and not _PUBLIC_SUBDOMAIN_RE.match(subdomain):
        raise SwitchError("invalid_subdomain", 400)

    cur = _current_info()
    client = PublicTunnelClient()
    try:
        data = client.reserve(subdomain or None)
    except PublicTunnelError as e:
        raise SwitchError(e.key or "reserve_failed", 400, **(e.params or {}))

    new_random_id = data.get("random_id", "") or ""
    urls = data.get("urls") or {}
    new_url = urls.get("dashboard", "")
    if not new_url:
        client.release_id(new_random_id)
        raise SwitchError("reserve_failed", 502, detail="reserve 未返回地址")

    new_name = next_cf_name()
    old_name = active_cf_name()
    old_cf = cur if cur["mode"] == "custom" else None
    old_random_id = cur.get("random_id", "") or ""

    _apply({
        "switch_id": uuid.uuid4().hex,
        "mode": "public",
        "new_url": new_url,
        "old_url": cur["url"],
        "same_host": bool(cur["url"]) and _host(new_url) == _host(cur["url"]),
        "services": urls,
        "new_name": new_name,
        "old_name": old_name,
        "new_random_id": new_random_id,
        "old_random_id": old_random_id,
        "old_mode": cur["mode"],
        "old_cf": old_cf,
        "same_target": False,
        "phase": "preparing",
    })

    threading.Thread(
        target=_run_public,
        args=(new_random_id, subdomain, new_name, old_name, cur["mode"],
              old_cf, old_random_id),
        daemon=True,
    ).start()
    return _response()


# ═══════════════════════════════════════════════════════════════
# 后台执行
# ═══════════════════════════════════════════════════════════════

def _run_custom(api_token: str, domain: str, subdomain: str, services: list,
                new_name: str, old_name: str, old_mode, old_cf, same_target: bool,
                old_random_id: str):
    mgr = None
    healthy = False
    try:
        _set_phase("starting")
        mgr = TunnelManager(api_token, domain, subdomain)
        result = mgr.ensure(services)
        token = result["tunnel_token"]
        if not mgr.start_cloudflared(token, name=new_name,
                                     metrics_port=cf_metrics_port(new_name)):
            raise SwitchError("start_failed", 500)

        _set_phase("ready")
        if not _wait_healthy(_snapshot()["new_url"]):
            raise SwitchError("health_timeout", 504)

        # 新地址已健康 — 落盘新配置并退役旧进程/旧资源
        healthy = True
        _set_phase("finalizing")
        set_config("cf_api_token", api_token)
        set_config("cf_domain", domain)
        set_config("cf_subdomain", subdomain)
        set_config("tunnel_mode", "custom")
        set_config("public_tunnel_state", "")
        set_config("cf_tunnel_pm2_name", new_name)
        _pm2_delete(old_name)
        _cleanup_old(old_mode, old_cf, old_name, same_target, old_random_id,
                     clear_public_state=True)
        _finish("done")
    except SwitchError as e:
        if not healthy:
            _cleanup_new_custom(mgr, new_name, same_target)
        _finish("failed", e.key, e.params)
    except CFAPIError as e:
        log.error(f"自定义隧道切换失败 (CF): {e}")
        if not healthy:
            _cleanup_new_custom(mgr, new_name, same_target)
        _finish("failed", e.key or "switch_failed", e.params)
    except Exception as e:
        log.exception(f"自定义隧道切换失败: {e}")
        if not healthy:
            _cleanup_new_custom(mgr, new_name, same_target)
        _finish("failed", "switch_failed")


def _run_public(new_random_id: str, subdomain: str, new_name: str, old_name: str,
                old_mode, old_cf, old_random_id: str):
    client = None
    healthy = False
    try:
        _set_phase("starting")
        client = PublicTunnelClient()
        data = client.activate(new_random_id)
        token = data.get("tunnel_token") or ""
        urls = data.get("urls") or {}
        if not token:
            raise SwitchError("activate_failed", 502)
        if not client._start_cloudflared(token, name=new_name,
                                         metrics_port=cf_metrics_port(new_name)):
            raise SwitchError("start_failed", 500)

        _set_phase("ready")
        new_url = urls.get("dashboard") or _snapshot()["new_url"]
        if not _wait_healthy(new_url):
            raise SwitchError("health_timeout", 504)

        healthy = True
        _set_phase("finalizing")
        set_config("tunnel_mode", "public")
        set_config("cf_api_token", "")
        set_config("cf_domain", "")
        set_config("cf_subdomain", "")
        # 写回用户选择的子域名 (随机切换清空), 保证设置弹窗重开时显示与实际一致
        set_config("public_tunnel_subdomain", subdomain or "")
        client.apply_state(new_random_id, token, urls,
                           subdomain=data.get("subdomain") or "")
        set_config("cf_tunnel_pm2_name", new_name)
        _pm2_delete(old_name)
        _cleanup_old(old_mode, old_cf, old_name, False, old_random_id,
                     clear_public_state=False)
        _finish("done")
    except SwitchError as e:
        if not healthy:
            _cleanup_new_public(client, new_name, new_random_id)
        _finish("failed", e.key, e.params)
    except Exception as e:
        log.exception(f"公共隧道切换失败: {e}")
        if not healthy:
            _cleanup_new_public(client, new_name, new_random_id)
        _finish("failed", "switch_failed")


# ═══════════════════════════════════════════════════════════════
# 辅助
# ═══════════════════════════════════════════════════════════════

def _wait_healthy(url: str) -> bool:
    """轮询 https://{host}/api/version 直到 200 或总超时。"""
    target = url.rstrip("/") + "/api/version"
    deadline = time.time() + _HEALTH_TIMEOUT
    while time.time() < deadline:
        try:
            r = requests.get(target, timeout=_HEALTH_REQUEST_TIMEOUT)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(_HEALTH_INTERVAL)
    return False


def _pm2_delete(name: str):
    if not name:
        return
    try:
        subprocess.run(f"pm2 delete {shlex.quote(name)} 2>/dev/null", shell=True,
                       capture_output=True, text=True, timeout=10)
        # 同步 dump: 否则已删进程名残留在 dump 里, 容器重启 resurrect 会把
        # 旧 cloudflared 一并拉起 (虽然 reset_on_startup 会兜底, 但不依赖巧合)
        subprocess.run("pm2 save 2>/dev/null", shell=True,
                       capture_output=True, text=True, timeout=10)
    except Exception:
        pass


def _cleanup_new_custom(mgr, new_name: str, same_target: bool = False):
    """失败回收: 删新进程; 目标不同才删新 Tunnel/DNS。旧资源一律不动。

    same_target (仅换 token 等): 新旧共用同一条 Tunnel/DNS (teardown 按
    tunnel 名删除, 与创建者无关), 删资源会误删旧地址正依赖的隧道。
    """
    _pm2_delete(new_name)
    if mgr is not None and not same_target:
        try:
            mgr.teardown(new_name)
        except Exception as e:
            log.warning(f"回收新自定义隧道失败 (仅记录): {e}")


def _cleanup_new_public(client, new_name: str, new_random_id: str):
    """失败回收: 删新进程 + release 新预留/新激活记录。旧资源不动。"""
    _pm2_delete(new_name)
    try:
        if client is None:
            client = PublicTunnelClient()
        if new_random_id:
            client.release_id(new_random_id)
    except Exception as e:
        log.warning(f"回收新公共隧道失败 (仅记录): {e}")


def _cleanup_old(old_mode, old_cf, old_name: str, same_target: bool,
                 old_random_id: str, clear_public_state: bool):
    """切换成功后退役旧资源; 失败仅记日志 (API cleanup 兜底)。

    clear_public_state: 新隧道不是公共模式时, 旧公共状态需从 singleton 清除;
    公共→公共切换时新状态已在 singleton 中, 不能清除。
    """
    if old_mode == "public":
        try:
            client = PublicTunnelClient()
            if old_random_id:
                client.release_id(old_random_id)
            if clear_public_state:
                client.random_id = None
                client.tunnel_token = None
                client.urls = None
                client._clear_persisted_state()
        except Exception as e:
            log.warning(f"释放旧公共隧道失败 (仅记录): {e}")
    elif old_mode == "custom" and old_cf and not same_target:
        try:
            TunnelManager(old_cf["token"], old_cf["domain"],
                          old_cf["subdomain"]).teardown(old_name)
        except Exception as e:
            log.warning(f"清理旧自定义隧道失败 (仅记录): {e}")


def _current_info() -> dict:
    """当前隧道信息 (旧地址 + 旧 random_id / 旧自定义配置)。"""
    mode = get_config("tunnel_mode", "")
    if mode == "public":
        client = PublicTunnelClient()
        urls = client.urls or {}
        return {"mode": "public", "url": urls.get("dashboard", ""),
                "random_id": client.random_id}
    token = get_config("cf_api_token", "")
    domain = get_config("cf_domain", "")
    subdomain = get_config("cf_subdomain", "")
    if token and domain and subdomain:
        return {"mode": "custom", "url": f"https://{subdomain}.{domain}",
                "token": token, "domain": domain, "subdomain": subdomain}
    return {"mode": None, "url": ""}


def _effective_services() -> list:
    """默认服务 (应用后缀覆盖) + 自定义服务。"""
    overrides = {}
    custom = []
    try:
        raw = get_config("cf_suffix_overrides", "")
        if raw:
            overrides = json.loads(raw)
    except Exception:
        overrides = {}
    try:
        raw = get_config("cf_custom_services", "")
        if raw:
            custom = json.loads(raw)
    except Exception:
        custom = []

    services = []
    for svc in get_default_services():
        s = dict(svc)
        orig = s.get("suffix", "")
        if orig in overrides:
            s["suffix"] = overrides[orig]
        services.append(s)
    services.extend(custom)
    return services
