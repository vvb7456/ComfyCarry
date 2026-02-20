"""
ComfyCarry — 设置路由

- /api/settings           — 设置概览
- /api/settings/password  — 修改密码
- /api/settings/restart   — 重启 Dashboard
- /api/settings/debug     — Debug 模式
- /api/settings/export-config  — 配置导出
- /api/settings/import-config  — 配置导入
- /api/settings/reinitialize   — 重新初始化
"""

import json
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
    COMFYUI_DIR,
)
from ..utils import _get_api_key
from ..services.comfyui_params import parse_comfyui_args
from ..services.sync_engine import (
    stop_sync_worker, _save_sync_settings,
)

bp = Blueprint("settings", __name__)


@bp.route("/api/settings", methods=["GET"])
def api_settings_get():
    api_key = _get_api_key()
    return jsonify({
        "password_set": bool(cfg.DASHBOARD_PASSWORD),
        "password_masked": (cfg.DASHBOARD_PASSWORD[:2] + "***"
                            if cfg.DASHBOARD_PASSWORD and len(cfg.DASHBOARD_PASSWORD) > 2
                            else "***"),
        "civitai_key_set": bool(api_key),
        "civitai_key_masked": (api_key[:6] + "..."
                               if api_key and len(api_key) > 6
                               else ("已设置" if api_key else "")),
    })


@bp.route("/api/settings/password", methods=["POST"])
def api_settings_password():
    data = request.get_json(force=True) or {}
    current = data.get("current", "")
    new_pw = data.get("new", "").strip()

    if not new_pw:
        return jsonify({"error": "新密码不能为空"}), 400
    if len(new_pw) < 4:
        return jsonify({"error": "密码至少 4 个字符"}), 400
    if current != cfg.DASHBOARD_PASSWORD:
        return jsonify({"error": "当前密码错误"}), 403

    cfg.DASHBOARD_PASSWORD = new_pw
    cfg._save_dashboard_password(new_pw)
    return jsonify({"ok": True, "message": "密码已更新并持久化保存"})


@bp.route("/api/settings/restart", methods=["POST"])
def api_settings_restart():
    def _do_restart():
        time.sleep(1)
        subprocess.run("pm2 restart dashboard", shell=True, timeout=15)
    threading.Thread(target=_do_restart, daemon=True).start()
    return jsonify({"ok": True, "message": "ComfyCarry 正在重启..."})


@bp.route("/api/settings/debug", methods=["GET"])
def api_settings_debug_get():
    return jsonify({"debug": _get_config("debug", False)})


@bp.route("/api/settings/debug", methods=["POST"])
def api_settings_debug_set():
    data = request.get_json(force=True) or {}
    enabled = bool(data.get("enabled", False))
    _set_config("debug", enabled)
    return jsonify({"ok": True, "debug": enabled})


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
    config["image_type"] = state.get("image_type", "")
    config["cloudflared_token"] = state.get("cloudflared_token", "")
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

    config["debug"] = _get_config("debug", False)

    return Response(
        json.dumps(config, indent=2, ensure_ascii=False),
        mimetype="application/json",
        headers={
            "Content-Disposition": "attachment; filename=comfyui-config.json",
            "Cache-Control": "no-cache"
        }
    )


@bp.route("/api/settings/import-config", methods=["POST"])
def api_settings_import_config():
    import base64 as _b64

    data = request.get_json(force=True) or {}
    if not data:
        return jsonify({"error": "无效的配置文件"}), 400

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

    if "debug" in data:
        _set_config("debug", bool(data["debug"]))
        applied.append("Debug 模式")

    try:
        state = _load_setup_state()
        if data.get("image_type"):
            state["image_type"] = data["image_type"]
            applied.append("部署模式")
        if data.get("cloudflared_token"):
            state["cloudflared_token"] = data["cloudflared_token"]
            applied.append("Tunnel Token")
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

    return jsonify({
        "ok": True,
        "applied": applied,
        "errors": errors,
        "message": (f"已导入 {len(applied)} 项配置"
                    + (f", {len(errors)} 项失败" if errors else ""))
    })


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
        errors.append(f"停止服务失败: {e}")

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
                models_tmp = Path("/workspace/.models_backup")
                models_src = comfy_dir / "models"
                if models_src.exists():
                    subprocess.run(f'mv "{models_src}" "{models_tmp}"',
                                   shell=True, timeout=60)
                subprocess.run(f'rm -rf "{comfy_dir}"', shell=True, timeout=120)
                if models_tmp.exists():
                    comfy_dir.mkdir(parents=True, exist_ok=True)
                    subprocess.run(f'mv "{models_tmp}" "{models_src}"',
                                   shell=True, timeout=60)
            else:
                subprocess.run(f'rm -rf "{comfy_dir}"', shell=True, timeout=120)
        except Exception as e:
            errors.append(f"清理 ComfyUI 目录失败: {e}")

    for f in [Path("/workspace/cloud_sync.sh"),
              Path("/workspace/.sync_rules.json"),
              Path("/workspace/.sync_settings.json")]:
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
        errors.append(f"重置状态失败: {e}")

    subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=15)

    if errors:
        return jsonify({"ok": False, "errors": errors}), 500

    return jsonify({"ok": True, "message": "已重置，刷新页面进入 Setup Wizard"})
