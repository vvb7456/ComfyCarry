"""
ComfyCarry — 设置路由

- /api/settings           — 设置概览
- /api/settings/password  — 修改密码
- /api/settings/restart   — 重启 Dashboard
- /api/settings/debug     — Debug 模式 (POST 切换, GET 已合入 /api/settings)
- /api/settings/api-key   — 重新生成 API Key
- /api/settings/export-config  — 配置导出
- /api/settings/import-config  — 配置导入
- /api/settings/reinitialize   — 重新初始化
"""

import json
import logging
import shutil
import subprocess
import threading
import time

from flask import Blueprint, Response, jsonify, request
from pathlib import Path

from .. import config as cfg
from ..config import (
    CONFIG_FILE, DEFAULT_PLUGINS,
    SYNC_RULES_FILE, SYNC_SETTINGS_FILE,
    _load_config, _get_config, _set_config,
    _load_setup_state, _save_setup_state, SETUP_STATE_FILE,
    COMFYUI_DIR, WORKSPACE_ROOT,
)
from ..utils import _get_api_key
from ..services.comfyui_params import parse_comfyui_args
from ..services.sync_engine import (
    stop_sync_worker, _save_sync_settings,
)

log = logging.getLogger(__name__)

bp = Blueprint("settings", __name__)


def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `settings.err.<key>` 翻译 error_key。"""
    body = {"error_key": f"settings.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


def _err_item(key: str, /, **params) -> dict:
    """内嵌在 200 响应里的单条错误 (每步各自成败, 请求本身没失败)。
    形状与 _err 的响应体一致, 前端同样用 apiErrorText 渲染。"""
    return {"error_key": f"settings.err.{key}", "error_params": params}


def _ok(key: str, /, **extra):
    """成功响应。前端按 `settings.msg.<key>` 翻译 message_key。"""
    body = {"ok": True, "message_key": f"settings.msg.{key}"}
    params = extra.pop("params", None)
    if params:
        body["message_params"] = params
    body.update(extra)
    return jsonify(body)


@bp.route("/api/settings", methods=["GET"])
def api_settings_get():
    civitai_key = _get_api_key()
    return jsonify({
        "password_set": bool(cfg.DASHBOARD_PASSWORD),
        "password_masked": (cfg.DASHBOARD_PASSWORD[:2] + "***"
                            if cfg.DASHBOARD_PASSWORD and len(cfg.DASHBOARD_PASSWORD) > 2
                            else "***"),
        "civitai_key": civitai_key,
        "civitai_key_set": bool(civitai_key),
        "civitai_nsfw_level": _get_config("civitai_nsfw_level", 7),
        "civitai_nsfw_blur": _get_config("civitai_nsfw_blur", True),
        "api_key": cfg.API_KEY,
        "comfyui_dir": cfg.COMFYUI_DIR,
        "comfyui_url": cfg.COMFYUI_URL,
    })


@bp.route("/api/settings/password", methods=["POST"])
def api_settings_password():
    data = request.get_json(force=True) or {}
    current = data.get("current", "")
    new_pw = data.get("new", "").strip()

    if not new_pw:
        return _err("password_empty")
    if len(new_pw) < 4:
        return _err("password_too_short", min=4)
    if current != cfg.DASHBOARD_PASSWORD:
        return _err("password_wrong_current", 403)

    cfg.DASHBOARD_PASSWORD = new_pw
    cfg._save_dashboard_password(new_pw)

    # SSH 密码跟随钩子 (v2, spec §5.1): 跟随开启时 root 密码即时同步新面板
    # 密码。chpasswd 即时生效, 无需重启 sshd。
    # 函数内导入 ssh.py, 杜绝 ssh ↔ settings 循环导入 (ssh.py 恢复逻辑将来
    # 若反向引用 settings 的配置, 模块级 import 就会成环)。
    # 失败不阻断改密响应 (容器无 sshd 时 chpasswd 通常仍可用, 稳妥容错),
    # 仅记 warning —— 下次改密或容器重启时会再次同步。
    if _get_config("ssh_pw_follow", False):
        from .ssh import chpasswd_root
        if not chpasswd_root(new_pw):
            log.warning("SSH 密码跟随: chpasswd 同步新面板密码失败")

    return _ok("password_updated")


@bp.route("/api/settings/restart", methods=["POST"])
def api_settings_restart():
    def _do_restart():
        time.sleep(1)
        subprocess.run("pm2 restart dashboard", shell=True, timeout=15)
    threading.Thread(target=_do_restart, daemon=True).start()
    return _ok("restarting")


@bp.route("/api/settings/api-key", methods=["POST"])
def api_settings_api_key():
    """重新生成 API Key"""
    import secrets as _sec
    new_key = f"cc-{_sec.token_hex(24)}"
    cfg._save_api_key(new_key)
    cfg.API_KEY = new_key
    return jsonify({"ok": True, "api_key": new_key})


@bp.route("/api/settings/civitai-key", methods=["POST"])
def api_settings_civitai_key():
    """保存或清除 CivitAI API Key"""
    data = request.get_json(force=True) or {}
    key = data.get("api_key", "").strip()
    CONFIG_FILE.write_text(json.dumps({"api_key": key}))
    return jsonify({"ok": True, "civitai_key_set": bool(key)})


@bp.route("/api/settings/civitai-nsfw", methods=["POST"])
def api_settings_civitai_nsfw():
    """CivitAI NSFW 浏览设置 (两级, 对齐 civitai.com 语义):
    - browsing_level: 浏览级别 bitmask (1=PG, 2=PG13, 4=R, 8=X, 16=XXX),
      决定各级内容是否出现
    - blur: 已出现内容中 NSFW 图是否前端模糊
    Civitai API 不提供服务端 blur (CDN 只有原图), 过滤/模糊全部由前端执行。"""
    data = request.get_json(force=True) or {}
    level = data.get("browsing_level")
    blur = data.get("blur")
    if level is not None:
        try:
            level = int(level)
        except (TypeError, ValueError):
            return _err("invalid_config")
        if not (1 <= level <= 31):
            return _err("invalid_config")
        _set_config("civitai_nsfw_level", level)
    if blur is not None:
        _set_config("civitai_nsfw_blur", bool(blur))
    return jsonify({
        "ok": True,
        "browsing_level": _get_config("civitai_nsfw_level", 7),
        "blur": _get_config("civitai_nsfw_blur", True),
    })


@bp.route("/api/settings/export-config")
def api_settings_export_config():
    import base64 as _b64
    config = {"_version": 1, "_exported_at": __import__("datetime").datetime.now().isoformat()}

    config["password"] = cfg.DASHBOARD_PASSWORD

    try:
        if CONFIG_FILE.exists():
            config["civitai_token"] = json.loads(CONFIG_FILE.read_text()).get("api_key", "")
    except Exception:
        pass

    state = _load_setup_state()
    config["install_fa2"] = state.get("install_fa2", False)
    config["install_sa2"] = state.get("install_sa2", False)


    rclone_conf = Path.home() / ".config" / "rclone" / "rclone.conf"
    if rclone_conf.exists():
        try:
            config["rclone_config_base64"] = _b64.b64encode(
                rclone_conf.read_bytes()
            ).decode("ascii")
        except Exception:
            pass

    default_urls = {p["url"] for p in DEFAULT_PLUGINS}
    all_plugins = state.get("plugins", [])
    config["extra_plugins"] = [u for u in all_plugins if u not in default_urls]
    config["disabled_default_plugins"] = [u for u in default_urls if u not in all_plugins]

    if SYNC_RULES_FILE.exists():
        try:
            config["sync_rules"] = json.loads(SYNC_RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    if SYNC_SETTINGS_FILE.exists():
        try:
            config["sync_settings"] = json.loads(SYNC_SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        procs = json.loads(r.stdout or "[]")
        comfy = next((p for p in procs if p.get("name") == "comfy"), None)
        if comfy:
            raw_args = comfy.get("pm2_env", {}).get("args", [])
            if isinstance(raw_args, str):
                raw_args = raw_args.split()
            config["comfyui_params"] = parse_comfyui_args(raw_args)
    except Exception:
        pass

    # Tunnel v2 配置
    config["cf_api_token"] = _get_config("cf_api_token", "")
    config["cf_domain"] = _get_config("cf_domain", "")
    config["cf_subdomain"] = _get_config("cf_subdomain", "")
    raw_custom = _get_config("cf_custom_services", "")
    if raw_custom:
        try:
            config["cf_custom_services"] = json.loads(raw_custom)
        except Exception:
            pass
    raw_overrides = _get_config("cf_suffix_overrides", "")
    if raw_overrides:
        try:
            config["cf_suffix_overrides"] = json.loads(raw_overrides)
        except Exception:
            pass

    # API Key
    config["api_key"] = cfg.API_KEY

    # Tunnel 模式 (公共 Tunnel 由环境变量控制, 不导出)
    tunnel_mode = _get_config("tunnel_mode", "")
    if tunnel_mode and tunnel_mode != "public":
        config["tunnel_mode"] = tunnel_mode

    # SSH 配置 (只导出跟随开关布尔, 与现有"仅真值才写键"风格一致)
    ssh_keys = _get_config("ssh_keys", [])
    if ssh_keys:
        config["ssh_keys"] = ssh_keys
    if _get_config("ssh_pw_follow", False):
        config["ssh_pw_follow"] = True

    # Tunnel 协议
    cf_protocol = _get_config("cf_protocol", "")
    if cf_protocol:
        config["cf_protocol"] = cf_protocol

    # LLM 配置 (仅导出 provider + provider_keys + 全局参数，不导出冗余的 flat key/model/url)
    llm_provider = _get_config("llm_provider", "")
    if llm_provider:
        config["llm_provider"] = llm_provider
        config["llm_temperature"] = _get_config("llm_temperature", 0.7)
        config["llm_max_tokens"] = _get_config("llm_max_tokens", 2000)
        config["llm_stream"] = _get_config("llm_stream", False)
    llm_provider_keys = _get_config("llm_provider_keys", {})
    if llm_provider_keys:
        config["llm_provider_keys"] = llm_provider_keys

    # 提示词编辑器设置
    prompt_settings = _get_config("prompt_settings", {})
    if prompt_settings:
        config["prompt_settings"] = prompt_settings

    # CivitAI NSFW 浏览设置
    civitai_nsfw_level = _get_config("civitai_nsfw_level", "")
    if civitai_nsfw_level != "":
        config["civitai_nsfw_level"] = civitai_nsfw_level
    civitai_nsfw_blur = _get_config("civitai_nsfw_blur", "")
    if civitai_nsfw_blur != "":
        config["civitai_nsfw_blur"] = civitai_nsfw_blur

    return Response(
        json.dumps(config, indent=2, ensure_ascii=False),
        mimetype="application/json",
        headers={
            "Content-Disposition": "attachment; filename=comfycarry-config.json",
            "Cache-Control": "no-cache"
        }
    )


@bp.route("/api/settings/import-config", methods=["POST"])
def api_settings_import_config():
    import base64 as _b64

    data = request.get_json(force=True) or {}
    if not data:
        return _err("invalid_config")

    applied = []
    errors = []

    if data.get("password"):
        try:
            cfg.DASHBOARD_PASSWORD = data["password"]
            cfg._save_dashboard_password(data["password"])
            applied.append("ComfyCarry 密码")
        except Exception as e:
            errors.append(f"密码: {e}")

    if data.get("civitai_token"):
        try:
            CONFIG_FILE.write_text(json.dumps({"api_key": data["civitai_token"]}))
            applied.append("CivitAI API Key")
        except Exception as e:
            errors.append(f"CivitAI: {e}")

    if data.get("rclone_config_base64"):
        try:
            rclone_dir = Path.home() / ".config" / "rclone"
            rclone_dir.mkdir(parents=True, exist_ok=True)
            conf_text = _b64.b64decode(data["rclone_config_base64"]).decode("utf-8")
            (rclone_dir / "rclone.conf").write_text(conf_text, encoding="utf-8")
            subprocess.run("chmod 600 ~/.config/rclone/rclone.conf", shell=True)
            applied.append("Rclone 配置")
        except Exception as e:
            errors.append(f"Rclone: {e}")

    if data.get("sync_rules"):
        try:
            SYNC_RULES_FILE.write_text(
                json.dumps(data["sync_rules"], indent=2, ensure_ascii=False),
                encoding="utf-8"
            )
            applied.append("同步规则")
        except Exception as e:
            errors.append(f"同步规则: {e}")
    if data.get("sync_settings"):
        try:
            _save_sync_settings(data["sync_settings"])
            applied.append("同步设置")
        except Exception as e:
            errors.append(f"同步设置: {e}")

    # Tunnel v2 配置
    if data.get("cf_api_token"):
        _set_config("cf_api_token", data["cf_api_token"])
        _set_config("cf_domain", data.get("cf_domain", ""))
        _set_config("cf_subdomain", data.get("cf_subdomain", ""))
        applied.append("Tunnel 配置")
    if data.get("cf_custom_services"):
        _set_config("cf_custom_services", json.dumps(data["cf_custom_services"]))
        applied.append("Tunnel 自定义服务")
    if data.get("cf_suffix_overrides"):
        _set_config("cf_suffix_overrides", json.dumps(data["cf_suffix_overrides"]))
    if data.get("cf_protocol"):
        _set_config("cf_protocol", data["cf_protocol"])

    # API Key
    if data.get("api_key"):
        cfg._save_api_key(data["api_key"])
        cfg.API_KEY = data["api_key"]
        applied.append("API Key")

    # Tunnel 模式 (公共 Tunnel 由环境变量控制, 不允许导入)
    if data.get("tunnel_mode") and data["tunnel_mode"] != "public":
        _set_config("tunnel_mode", data["tunnel_mode"])
        applied.append("Tunnel 模式")

    # SSH 配置 (ssh_pw_follow 按新语义应用)
    if data.get("ssh_keys"):
        _set_config("ssh_keys", data["ssh_keys"])
        applied.append("SSH 公钥")
    follow = data.get("ssh_pw_follow")
    if follow is not None:
        from .ssh import _apply_password_follow  # 函数内导入, 避免循环导入
        # 导入是非交互场景, force 恒按 false 处理:
        # - follow=true  → 复用与端点相同的内部应用逻辑 (chpasswd 当前面板
        #   密码 + 开密码认证 + 重启 sshd + 落 flag)。password 若也在导入
        #   文件里, 上面已先行应用, 这里同步的即导入后的面板密码, 语义一致。
        # - follow=false → 无有效公钥时会被 lockout 硬拦截: 此时仅落开关
        #   flag、不改 sshd_config, 记入 errors 提示 —— 导入文件不应把用户
        #   锁死在 SSH 之外, 由用户稍后在设置页自行处理 (重启后 restore 会
        #   按落下的 flag 生效)。
        applied_ok, err, _extra = _apply_password_follow(bool(follow))
        if applied_ok:
            applied.append("SSH 密码跟随")
        elif err["error_key"] == "lockout_risk":
            _set_config("ssh_pw_follow", bool(follow))
            errors.append("SSH 密码跟随: 当前无有效公钥, 仅保存开关状态, 未改动 sshd (lockout 防护)")
        else:
            errors.append(f"SSH 密码跟随: {err['error_key']}")

    # LLM 配置
    if data.get("llm_provider"):
        try:
            provider = data["llm_provider"]
            _set_config("llm_provider", provider)
            prov_keys = data.get("llm_provider_keys", {}).get(provider, {})
            _set_config("llm_model", prov_keys.get("model", ""))
            _set_config("llm_api_key", prov_keys.get("api_key", ""))
            _set_config("llm_base_url", prov_keys.get("base_url", ""))
            _set_config("llm_temperature", data.get("llm_temperature", 0.7))
            _set_config("llm_max_tokens", data.get("llm_max_tokens", 2000))
            _set_config("llm_stream", data.get("llm_stream", False))
            applied.append("LLM 配置")
        except Exception as e:
            errors.append(f"LLM 配置: {e}")
    if data.get("llm_provider_keys"):
        try:
            _set_config("llm_provider_keys", data["llm_provider_keys"])
            applied.append("LLM Provider Keys")
        except Exception as e:
            errors.append(f"LLM Provider Keys: {e}")

    try:
        state = _load_setup_state()
        if data.get("cf_api_token"):
            state["cf_api_token"] = data["cf_api_token"]
            state["cf_domain"] = data.get("cf_domain", "")
            state["cf_subdomain"] = data.get("cf_subdomain", "")
        if data.get("civitai_token"):
            state["civitai_token"] = data["civitai_token"]
        if "extra_plugins" in data or "disabled_default_plugins" in data:
            default_urls = [p["url"] for p in DEFAULT_PLUGINS]
            disabled = set(data.get("disabled_default_plugins", []))
            plugins = [u for u in default_urls if u not in disabled]
            plugins.extend(data.get("extra_plugins", []))
            state["plugins"] = plugins
            applied.append("插件列表")
        if data.get("rclone_config_base64"):
            state["rclone_config_method"] = "base64"
            state["rclone_config_value"] = data["rclone_config_base64"]
        if data.get("password"):
            state["password"] = data["password"]
        _save_setup_state(state)
    except Exception as e:
        errors.append(f"向导状态: {e}")

    if data.get("comfyui_params"):
        try:
            _set_config("comfyui_params", data["comfyui_params"])
            applied.append("ComfyUI 启动参数 (需重启 ComfyUI 生效)")
        except Exception as e:
            errors.append(f"ComfyUI 参数: {e}")

    # 提示词编辑器设置
    if data.get("prompt_settings") and isinstance(data["prompt_settings"], dict):
        try:
            _set_config("prompt_settings", data["prompt_settings"])
            applied.append("提示词编辑器设置")
        except Exception as e:
            errors.append(f"提示词编辑器设置: {e}")

    # CivitAI NSFW 浏览设置
    if data.get("civitai_nsfw_level") or data.get("civitai_nsfw_blur") is not None:
        try:
            if data.get("civitai_nsfw_level"):
                level = int(data["civitai_nsfw_level"])
                if not (1 <= level <= 31):
                    raise ValueError(f"out of range: {level}")
                _set_config("civitai_nsfw_level", level)
            if data.get("civitai_nsfw_blur") is not None:
                _set_config("civitai_nsfw_blur", bool(data["civitai_nsfw_blur"]))
            applied.append("CivitAI NSFW 浏览设置")
        except Exception as e:
            errors.append(f"CivitAI NSFW: {e}")

    msg_key = "config_imported_with_errors" if errors else "config_imported"
    return _ok(msg_key,
               params={"applied": len(applied), "failed": len(errors)},
               applied=applied, errors=errors)


@bp.route("/api/settings/reinitialize", methods=["POST"])
def api_settings_reinitialize():
    data = request.get_json(force=True) or {}
    keep_models = bool(data.get("keep_models", False))

    errors = []

    # 1) 停止 PM2 托管的服务
    try:
        stop_sync_worker()
        subprocess.run("pm2 delete comfy 2>/dev/null || true", shell=True, timeout=15)
        subprocess.run("pm2 delete sync 2>/dev/null || true", shell=True, timeout=15)
    except Exception as e:
        errors.append(_err_item("reinit_stop_failed", detail=str(e)))

    # 2) 强制结束所有可能残留的 ComfyUI 进程
    try:
        subprocess.run(
            "pkill -9 -f 'main.py.*--port 8188' 2>/dev/null || true; "
            "pkill -9 -f 'main.py.*--listen.*8188' 2>/dev/null || true; "
            "sleep 1",
            shell=True, timeout=10
        )
    except Exception:
        pass

    comfy_dir = Path(COMFYUI_DIR)
    if comfy_dir.exists():
        try:
            if keep_models:
                # 原地保留 models/input/output, 只删除 comfy_dir 下其余内容
                # (不做 mv 备份/还原, 避免大目录移动耗时且中途失败丢数据)
                for child in comfy_dir.iterdir():
                    if child.name in ("models", "input", "output"):
                        continue
                    if child.is_dir() and not child.is_symlink():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        child.unlink(missing_ok=True)
            else:
                shutil.rmtree(comfy_dir)
        except Exception as e:
            errors.append(_err_item("reinit_clean_failed", detail=str(e)))

    for f in [WORKSPACE_ROOT / "cloud_sync.sh", SYNC_RULES_FILE, SYNC_SETTINGS_FILE]:
        try:
            if f.exists():
                f.unlink()
        except Exception:
            pass

    try:
        preserved_steps = []
        if SETUP_STATE_FILE.exists():
            old_state = _load_setup_state()
            for step_key in ("system_deps", "pytorch"):
                if step_key in old_state.get("deploy_steps_completed", []):
                    preserved_steps.append(step_key)
        if SETUP_STATE_FILE.exists():
            SETUP_STATE_FILE.unlink()
        if preserved_steps:
            new_state = _load_setup_state()
            new_state["deploy_steps_completed"] = preserved_steps
            _save_setup_state(new_state)
    except Exception as e:
        errors.append(_err_item("reinit_reset_failed", detail=str(e)))

    subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=15)

    if errors:
        # 200 而非 500 —— useApiFetch 对非 2xx 直接返回 null, 回 500 的话前端
        # 拿不到 errors, 只能显示 "HTTP 500", 部分失败的明细全丢。
        return jsonify({"ok": False, "errors": errors}), 200

    return _ok("reinitialized")
