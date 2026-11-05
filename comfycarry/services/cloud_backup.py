"""Managed instance cloud configuration backup proxy and 60s auto-sync worker."""

import configparser
from datetime import datetime
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import tomllib

import requests

from .. import config as cfg
from ..config import COMFYUI_DIR, DEFAULT_PLUGINS, _get_config, _load_setup_state, _save_setup_state, _set_config
from .managed_tunnel import binding, is_managed

log = logging.getLogger(__name__)

AUTO_SYNC_INTERVAL_SECONDS = 60
_worker_thread: threading.Thread | None = None
_worker_lock = threading.Lock()
_last_synced_hash: str | None = None
_hash_lock = threading.Lock()
_cloning_plugin_urls: set[str] = set()
_cloning_lock = threading.Lock()


def normalize_git_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    ssh_match = re.match(r"^git@([^:]+):(.+)$", raw)
    if ssh_match:
        raw = f"https://{ssh_match.group(1)}/{ssh_match.group(2)}"
    raw = raw.rstrip("/")
    if raw.endswith(".git"):
        raw = raw[:-4]
    return raw


def record_plugin_repo(plugin_id: str = "", repo_url: str = "", files: list | None = None) -> None:
    candidate = (repo_url or "").strip()
    if not candidate and isinstance(files, list):
        for item in files:
            if isinstance(item, str) and (item.startswith(("http://", "https://", "git@"))):
                candidate = item.strip()
                break
    norm = normalize_git_url(candidate)
    if not norm:
        return
    repo_map = _get_config("plugin_repo_map", {})
    if not isinstance(repo_map, dict):
        repo_map = {}
    else:
        repo_map = dict(repo_map)
    if plugin_id and plugin_id.strip():
        key = plugin_id.strip()
        repo_map[key] = norm
        repo_map[key.casefold()] = norm
    dir_name = norm.rstrip("/").split("/")[-1]
    if dir_name:
        repo_map[dir_name] = norm
        repo_map[dir_name.casefold()] = norm
    _set_config("plugin_repo_map", repo_map)


def remove_plugin_record(plugin_id: str = "", files: list | None = None) -> None:
    keys_to_remove: set[str] = set()
    urls_to_remove_folded: set[str] = set()
    if plugin_id and plugin_id.strip():
        pid = plugin_id.strip()
        keys_to_remove.add(pid.casefold())
        norm_pid = normalize_git_url(pid)
        if norm_pid.startswith(("http://", "https://")):
            urls_to_remove_folded.add(norm_pid.casefold())
            keys_to_remove.add(norm_pid.rstrip("/").split("/")[-1].casefold())
    if isinstance(files, list):
        for item in files:
            if not isinstance(item, str) or not item.strip():
                continue
            raw = item.strip()
            if raw.startswith(("http://", "https://", "git@")):
                norm = normalize_git_url(raw)
                if norm:
                    urls_to_remove_folded.add(norm.casefold())
                    keys_to_remove.add(norm.rstrip("/").split("/")[-1].casefold())
            else:
                first_part = raw.strip("/").split("/")[0]
                if first_part:
                    keys_to_remove.add(first_part.casefold())

    repo_map = _get_config("plugin_repo_map", {})
    if isinstance(repo_map, dict) and repo_map:
        new_map = {}
        for k, v in repo_map.items():
            k_fold = str(k).casefold()
            v_norm = normalize_git_url(str(v))
            v_fold = v_norm.casefold()
            v_dir = v_norm.rstrip("/").split("/")[-1].casefold() if v_norm else ""
            if k_fold in keys_to_remove or v_fold in urls_to_remove_folded or (v_dir and v_dir in keys_to_remove):
                if v_fold:
                    urls_to_remove_folded.add(v_fold)
                continue
            new_map[k] = v
        if len(new_map) != len(repo_map):
            _set_config("plugin_repo_map", new_map)

    if cfg.SETUP_STATE_FILE.exists():
        try:
            state = _load_setup_state()
            plugins = state.get("plugins")
            if isinstance(plugins, list):
                filtered = []
                for u in plugins:
                    if not isinstance(u, str):
                        continue
                    norm_u = normalize_git_url(u)
                    u_fold = norm_u.casefold()
                    u_dir = norm_u.rstrip("/").split("/")[-1].casefold() if norm_u else ""
                    if u_fold in urls_to_remove_folded or (u_dir and u_dir in keys_to_remove):
                        continue
                    filtered.append(u)
                if len(filtered) != len(plugins):
                    state["plugins"] = filtered
                    _save_setup_state(state)
        except Exception:
            pass


def _extract_git_origin(plugin_dir: Path) -> str:
    git_entry = plugin_dir / ".git"
    if not git_entry.exists():
        return ""
    git_config = git_entry / "config" if git_entry.is_dir() else None
    if git_config and git_config.is_file():
        try:
            parser = configparser.ConfigParser()
            parser.read(git_config, encoding="utf-8")
            if parser.has_section('remote "origin"'):
                url = parser.get('remote "origin"', "url", fallback="").strip()
                if url:
                    return url
        except Exception:
            pass
    try:
        res = subprocess.run(
            ["git", "-C", str(plugin_dir), "config", "--get", "remote.origin.url"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass
    return ""


def _extract_pyproject_repo(plugin_dir: Path) -> str:
    toml_file = plugin_dir / "pyproject.toml"
    if not toml_file.is_file():
        return ""
    try:
        data = tomllib.loads(toml_file.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return ""
    if not isinstance(data, dict):
        return ""

    urls = (data.get("project") or {}).get("urls")
    if isinstance(urls, dict):
        for key in ("Repository", "repository", "Homepage", "homepage", "Source", "source"):
            val = urls.get(key)
            if isinstance(val, str) and val.strip().startswith(("http://", "https://", "git@")):
                return val.strip()
        for val in urls.values():
            if isinstance(val, str) and val.strip().startswith(("http://", "https://", "git@")):
                return val.strip()

    comfy_tool = (data.get("tool") or {}).get("comfy")
    if isinstance(comfy_tool, dict):
        for key in ("Repository", "repository", "url"):
            val = comfy_tool.get(key)
            if isinstance(val, str) and val.strip().startswith(("http://", "https://", "git@")):
                return val.strip()
    return ""


def scan_installed_plugins() -> tuple[list[str], list[str]]:
    nodes_dir = Path(cfg.COMFYUI_DIR) / "custom_nodes"
    default_urls = [p["url"] for p in DEFAULT_PLUGINS]
    default_url_set = set(default_urls)

    if not nodes_dir.is_dir():
        state = _load_setup_state()
        all_plugins = state.get("plugins", [])
        extra = [u for u in all_plugins if u not in default_url_set]
        disabled = [u for u in default_urls if u not in all_plugins]
        return extra, disabled

    extra_plugins: list[str] = []
    disabled_default_plugins: list[str] = []
    default_dir_names_folded: set[str] = {"comfycarry_ws_broadcast"}
    norm_default_urls = {
        normalize_git_url(u).casefold()
        for u in default_urls
        if u != "comfycarry_ws_broadcast"
    }

    for p in DEFAULT_PLUGINS:
        url = p["url"]
        if url == "comfycarry_ws_broadcast":
            continue
        dir_name = url.rstrip("/").split("/")[-1].removesuffix(".git")
        default_dir_names_folded.add(dir_name.casefold())
        if not (nodes_dir / dir_name).is_dir() or (nodes_dir / f"{dir_name}.disabled").exists():
            disabled_default_plugins.append(url)

    repo_map = _get_config("plugin_repo_map", {})
    if not isinstance(repo_map, dict):
        repo_map = {}
    folded_repo_map = {str(k).casefold(): str(v) for k, v in repo_map.items() if k and v}

    seen_norm: set[str] = set()
    for child in sorted(nodes_dir.iterdir(), key=lambda x: x.name):
        if not child.is_dir():
            continue
        name = child.name
        if name.startswith(".") or name in {"__pycache__", "comfycarry_ws_broadcast"}:
            continue
        if name.endswith(".disabled"):
            continue
        if name.casefold() in default_dir_names_folded:
            continue

        repo_url = _extract_git_origin(child)
        if not repo_url:
            repo_url = _extract_pyproject_repo(child)
        if not repo_url:
            repo_url = str(repo_map.get(name) or folded_repo_map.get(name.casefold()) or "")

        norm = normalize_git_url(repo_url)
        if norm:
            folded = norm.casefold()
            if folded not in norm_default_urls and folded not in seen_norm:
                seen_norm.add(folded)
                extra_plugins.append(norm)

    pending_extra_urls: list[str] = []
    if not cfg._is_setup_complete() and cfg.SETUP_STATE_FILE.exists():
        state = _load_setup_state()
        if isinstance(state.get("plugins"), list):
            pending_extra_urls.extend(u for u in state["plugins"] if isinstance(u, str))
    with _cloning_lock:
        pending_extra_urls.extend(sorted(_cloning_plugin_urls))

    for u in pending_extra_urls:
        if not isinstance(u, str) or u == "comfycarry_ws_broadcast" or u in default_url_set:
            continue
        norm = normalize_git_url(u)
        if not norm:
            continue
        folded = norm.casefold()
        if folded in norm_default_urls or folded in seen_norm:
            continue
        dir_name = norm.rstrip("/").split("/")[-1]
        if (nodes_dir / f"{dir_name}.disabled").exists():
            continue
        seen_norm.add(folded)
        extra_plugins.append(norm)

    return extra_plugins, disabled_default_plugins


def apply_imported_plugins_on_disk(
    extra_plugins: list[str] | None,
    disabled_default_plugins: list[str] | None,
) -> None:
    nodes_dir = Path(cfg.COMFYUI_DIR) / "custom_nodes"
    if not nodes_dir.is_dir():
        return
    disabled_set = set(disabled_default_plugins or [])
    for dp in DEFAULT_PLUGINS:
        d_url = dp["url"]
        if d_url == "comfycarry_ws_broadcast" or dp.get("required"):
            continue
        d_name = d_url.rstrip("/").split("/")[-1].removesuffix(".git")
        active_dir = nodes_dir / d_name
        disabled_dir = nodes_dir / f"{d_name}.disabled"
        if d_url in disabled_set:
            if active_dir.is_dir() and not disabled_dir.exists():
                active_dir.rename(disabled_dir)
        else:
            if disabled_dir.is_dir() and not active_dir.exists():
                disabled_dir.rename(active_dir)

    missing_urls: list[tuple[str, Path]] = []
    for raw_url in extra_plugins or []:
        norm = normalize_git_url(str(raw_url or ""))
        if not norm or norm == "comfycarry_ws_broadcast":
            continue
        dir_name = norm.rstrip("/").split("/")[-1]
        if not dir_name:
            continue
        target_dir = nodes_dir / dir_name
        disabled_dir = nodes_dir / f"{dir_name}.disabled"
        if disabled_dir.is_dir() and not target_dir.exists():
            disabled_dir.rename(target_dir)
        elif not target_dir.exists():
            record_plugin_repo(plugin_id=dir_name, repo_url=norm)
            missing_urls.append((norm, target_dir))

    if missing_urls:
        with _cloning_lock:
            for url, _ in missing_urls:
                _cloning_plugin_urls.add(url)

        def _bg_clone():
            for url, target_dir in missing_urls:
                try:
                    subprocess.run(
                        ["git", "clone", "--recursive", url, str(target_dir)],
                        cwd=str(nodes_dir),
                        capture_output=True,
                        timeout=180,
                    )
                    req_file = target_dir / "requirements.txt"
                    if req_file.is_file():
                        from .deploy_engine import _detect_python
                        py = _detect_python()
                        subprocess.run(
                            [py, "-m", "pip", "install", "--no-cache-dir", "-r", str(req_file)],
                            capture_output=True,
                            timeout=300,
                        )
                except Exception as exc:
                    log.warning("[cloud_backup] 导入后后台安装插件 %s 失败: %s", url, exc)
                finally:
                    with _cloning_lock:
                        _cloning_plugin_urls.discard(url)

        threading.Thread(target=_bg_clone, daemon=True, name="import-plugin-clone").start()


def short_gpu_name() -> str:
    try:
        from . import system_monitor
        snap = system_monitor.get_snapshot()
        gpus = (snap or {}).get("gpu") or []
        if gpus and gpus[0].get("name"):
            raw = str(gpus[0]["name"]).strip()
            return re.sub(r"^(?:NVIDIA\s+)?(?:GeForce\s+|Tesla\s+|Quadro\s+)?", "", raw, flags=re.I).strip()
    except Exception:
        pass
    try:
        from .deploy_engine import _detect_gpu_info
        raw = str(_detect_gpu_info().get("name") or "").strip()
        if raw:
            return re.sub(r"^(?:NVIDIA\s+)?(?:GeForce\s+|Tesla\s+|Quadro\s+)?", "", raw, flags=re.I).strip()
    except Exception:
        pass
    return ""


def compute_config_hash(config_data: dict) -> str:
    comparable = {k: v for k, v in config_data.items() if k != "_exported_at"}
    canonical = json.dumps(comparable, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def set_last_synced_hash(digest: str | None) -> None:
    global _last_synced_hash
    with _hash_lock:
        _last_synced_hash = digest
    try:
        _set_config("last_synced_config_hash", digest or "")
    except Exception:
        pass


def get_last_synced_hash() -> str | None:
    global _last_synced_hash
    with _hash_lock:
        if _last_synced_hash is not None:
            return _last_synced_hash
        stored = _get_config("last_synced_config_hash", "")
        if isinstance(stored, str) and stored.strip():
            _last_synced_hash = stored.strip()
        return _last_synced_hash


def _agent_credentials() -> tuple[str, str] | None:
    values = binding()
    if values:
        return values["MANAGEMENT_API_URL"].rstrip("/"), values["PROVISIONING_TOKEN"]
    api_url = (os.environ.get("MANAGEMENT_API_URL") or "").strip().rstrip("/")
    token = (os.environ.get("PROVISIONING_TOKEN") or "").strip()
    if api_url and token:
        return api_url, token
    return None


def platform_request(method: str, path: str, *, json_body: dict | None = None, timeout: float = 10.0) -> tuple[int, dict]:
    creds = _agent_credentials()
    if not creds:
        return 400, {"error_key": "settings.err.not_managed"}
    base_url, token = creds
    url = f"{base_url}/api/v1/agent{path}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = requests.request(
            method=method.upper(),
            url=url,
            headers=headers,
            json=json_body,
            timeout=timeout,
            allow_redirects=False,
        )
        try:
            body = resp.json()
        except ValueError:
            body = {}
        return resp.status_code, body if isinstance(body, dict) else {}
    except requests.RequestException as exc:
        log.warning("[cloud_backup] 请求平台云端存档接口失败 (%s %s): %s", method, path, exc)
        return 502, {"error_key": "settings.err.cloud_unreachable"}


def sync_once() -> bool:
    if not is_managed() or not cfg._is_setup_complete():
        return False

    from ..routes.settings import build_export_config_dict

    config_data = build_export_config_dict(include_timestamp=False)
    current_hash = compute_config_hash(config_data)
    if current_hash == get_last_synced_hash():
        return False

    payload = {**config_data, "_exported_at": datetime.now().isoformat()}
    status, _ = platform_request(
        "PUT",
        "/backups/auto",
        json_body={"gpu_name": short_gpu_name(), "payload": payload},
    )
    if status == 200:
        set_last_synced_hash(current_hash)
        return True
    return False


def _auto_sync_loop() -> None:
    while True:
        time.sleep(AUTO_SYNC_INTERVAL_SECONDS)
        try:
            sync_once()
        except Exception as exc:
            log.warning("[cloud_backup] 自动同步检查异常: %s", exc)


def start_auto_sync_worker() -> None:
    global _worker_thread
    with _worker_lock:
        if _worker_thread and _worker_thread.is_alive():
            return
        _worker_thread = threading.Thread(target=_auto_sync_loop, daemon=True, name="cloud-config-sync")
        _worker_thread.start()
