"""
ComfyCarry — Setup Wizard 路由

- /api/setup/state           — 向导状态
- /api/setup/save            — 保存步骤配置
- /api/setup/preview_remotes — 预览 rclone remote
- /api/setup/plugins         — 默认插件列表
- /api/setup/deploy          — 启动部署
- /api/setup/log_stream      — SSE 部署日志
- /api/setup/reset           — 重置向导
"""

import json
import os
import re
import subprocess
import time
import zipfile
import io

from flask import Blueprint, Response, jsonify, request, send_file

from ..config import (
    DEFAULT_PLUGINS, SYNC_RULE_TEMPLATES, REMOTE_TYPE_DEFS,
    SETUP_STATE_FILE,
    _load_setup_state, _save_setup_state,
)
from ..services.deploy_engine import (
    start_deploy, get_deploy_thread, get_deploy_log_slice,
    _detect_gpu_info, _read_prebuilt_info,
)

bp = Blueprint("setup", __name__)


@bp.route("/api/setup/state")
def api_setup_state():
    state = _load_setup_state()
    safe = {k: v for k, v in state.items() if k != "deploy_log"}
    safe["has_rclone_config"] = bool(state.get("rclone_config_value"))
    safe["rclone_config_value"] = ""
    safe["plugins_available"] = DEFAULT_PLUGINS
    safe["gpu_info"] = _detect_gpu_info()
    safe["detected_image_type"] = "prebuilt" if _read_prebuilt_info() else "unsupported"
    safe["prebuilt_info"] = _read_prebuilt_info()

    env_vars = {}
    if os.environ.get("DASHBOARD_PASSWORD"):
        env_vars["password"] = os.environ["DASHBOARD_PASSWORD"]
    if os.environ.get("CF_API_TOKEN"):
        env_vars["cf_api_token"] = os.environ["CF_API_TOKEN"]
    if os.environ.get("CF_DOMAIN"):
        env_vars["cf_domain"] = os.environ["CF_DOMAIN"]
    if os.environ.get("CF_SUBDOMAIN"):
        env_vars["cf_subdomain"] = os.environ["CF_SUBDOMAIN"]
    if os.environ.get("CIVITAI_TOKEN"):
        env_vars["civitai_token"] = os.environ["CIVITAI_TOKEN"]
    if os.environ.get("RCLONE_CONF_BASE64"):
        env_vars["rclone_config_method"] = "base64"
        env_vars["rclone_has_env"] = True
    safe["env_vars"] = env_vars

    safe["sync_templates"] = SYNC_RULE_TEMPLATES
    safe["remote_type_defs"] = REMOTE_TYPE_DEFS
    return jsonify(safe)


@bp.route("/api/setup/save", methods=["POST"])
def api_setup_save():
    data = request.get_json(force=True)
    state = _load_setup_state()
    allowed_keys = {
        "current_step", "image_type", "password",
        "cf_api_token", "cf_domain", "cf_subdomain",
        "rclone_config_method", "rclone_config_value",
        "civitai_token", "plugins",
        "install_fa2", "install_sa2",
        "wizard_sync_rules", "wizard_remotes",
        "_imported_sync_rules",
    }
    for k, v in data.items():
        if k in allowed_keys:
            state[k] = v
    _save_setup_state(state)
    return jsonify({"ok": True})


@bp.route("/api/setup/preview_remotes", methods=["POST"])
def api_setup_preview_remotes():
    import base64 as _b64
    data = request.get_json(force=True)
    method = data.get("method", "skip")
    value = data.get("value", "")
    conf_text = ""

    if method == "skip":
        return jsonify({"remotes": []})
    if method == "base64_env":
        value = os.environ.get("RCLONE_CONF_BASE64", "")
        method = "base64"
    if method in ("base64", "file") and value:
        try:
            conf_text = _b64.b64decode(value).decode("utf-8")
        except Exception:
            pass
    elif method == "url":
        try:
            r = subprocess.run(["curl", "-fsSL", value],
                               capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                conf_text = r.stdout
        except Exception:
            pass

    remotes = []
    if conf_text:
        current = None
        for line in conf_text.splitlines():
            line = line.strip()
            m = re.match(r'^\[(.+)\]$', line)
            if m:
                if current:
                    remotes.append(current)
                current = {"name": m.group(1), "type": ""}
            elif current and line.startswith("type"):
                parts = line.split("=", 1)
                if len(parts) == 2:
                    current["type"] = parts[1].strip()
        if current:
            remotes.append(current)

    return jsonify({"remotes": remotes})


@bp.route("/api/setup/plugins")
def api_setup_plugins():
    return jsonify({"plugins": DEFAULT_PLUGINS})


@bp.route("/api/setup/deploy", methods=["POST"])
def api_setup_deploy():
    state = _load_setup_state()
    state["deploy_started"] = True
    state["deploy_completed"] = False
    state["deploy_error"] = ""
    _save_setup_state(state)

    ok, msg = start_deploy(state)
    if not ok:
        return jsonify({"error": msg}), 409
    return jsonify({"ok": True, "message": msg})


@bp.route("/api/setup/log_stream")
def api_setup_log_stream():
    def generate():
        idx = 0
        while True:
            new_lines, total = get_deploy_log_slice(idx)
            idx = total
            for line in new_lines:
                yield f"data: {json.dumps(line, ensure_ascii=False)}\n\n"
            state = _load_setup_state()
            if state.get("deploy_completed"):
                # 确保剩余日志全部发完
                remaining, total2 = get_deploy_log_slice(idx)
                idx = total2
                for line in remaining:
                    yield f"data: {json.dumps(line, ensure_ascii=False)}\n\n"
                done_evt = {'type': 'done', 'success': True}
                # 附带 attention 安装警告 (如有)
                attn_warnings = state.get("attn_install_warnings", [])
                if attn_warnings:
                    done_evt["attn_warnings"] = attn_warnings
                yield f"data: {json.dumps(done_evt, ensure_ascii=False)}\n\n"
                break
            deploy_thread = get_deploy_thread()
            if not deploy_thread or not deploy_thread.is_alive():
                if not state.get("deploy_completed"):
                    error_msg = state.get("deploy_error") or "部署进程异常终止"
                    yield f"data: {json.dumps({'type': 'done', 'success': False, 'msg': error_msg}, ensure_ascii=False)}\n\n"
                break
            time.sleep(0.5)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@bp.route("/api/setup/reset", methods=["POST"])
def api_setup_reset():
    if SETUP_STATE_FILE.exists():
        SETUP_STATE_FILE.unlink()
    return jsonify({"ok": True})


# ── Rclone Helper Bundle ────────────────────────────────────────────────
# 镜像内预装了 Windows 版 rclone.exe (/opt/rclone-win/rclone.exe)
# 此端点将 bat + rclone.exe 打包成 zip 供用户下载

RCLONE_WIN_EXE = "/opt/rclone-win/rclone.exe"


@bp.route("/api/setup/rclone-bundle")
def api_setup_rclone_bundle():
    """下载 rclone 配置助手压缩包 (rclone-setup.bat + rclone.exe)"""
    if not os.path.exists(RCLONE_WIN_EXE):
        return jsonify({"error": "镜像中未找到 rclone.exe，请更新镜像"}), 500

    bat_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "static", "rclone-setup.bat")
    )
    if not os.path.exists(bat_path):
        return jsonify({"error": "bat 脚本不存在"}), 500

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(bat_path, "rclone-setup.bat")
        zf.write(RCLONE_WIN_EXE, "rclone.exe")
    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="ComfyCarry-RcloneHelper.zip"
    )

