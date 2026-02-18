"""
ComfyCarry — Cloud Sync v2 路由

- /api/sync/status           — Worker 状态 & 日志
- /api/sync/remotes          — rclone remote 列表
- /api/sync/remote/create|delete|browse — Remote 管理
- /api/sync/remote/types     — Remote 类型定义
- /api/sync/storage          — 容量查询
- /api/sync/rules            — 同步规则 CRUD
- /api/sync/rules/save|run   — 规则保存/执行
- /api/sync/worker/start|stop — Worker 控制
- /api/sync/settings         — 全局设置
- /api/sync/rclone_config    — 直接编辑 rclone.conf
- /api/sync/import_config    — 导入 rclone 配置
"""

import json
import re
import shlex
import subprocess
import threading

import requests
from flask import Blueprint, jsonify, request
from pathlib import Path

from ..config import (
    RCLONE_CONF, SYNC_RULE_TEMPLATES, REMOTE_TYPE_DEFS,
)
from ..services.sync_engine import (
    _load_sync_rules, _save_sync_rules, _parse_rclone_conf,
    _load_sync_settings, _save_sync_settings,
    _run_sync_rule, get_sync_log_buffer,
    is_worker_running, start_sync_worker, stop_sync_worker,
)

bp = Blueprint("sync", __name__)


# ====================================================================
# Worker 状态 & 日志
# ====================================================================
@bp.route("/api/sync/status")
def api_sync_status():
    worker_running = is_worker_running()
    pm2_status = "stopped"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout or "[]"):
                if p.get("name") == "sync":
                    pm2_status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    log_lines = get_sync_log_buffer()
    rules = _load_sync_rules()
    return jsonify({
        "worker_running": worker_running,
        "pm2_status": pm2_status,
        "log_lines": log_lines,
        "rules": rules,
    })


# ====================================================================
# Remote 管理
# ====================================================================
@bp.route("/api/sync/remotes")
def api_sync_remotes():
    remotes = _parse_rclone_conf()
    for r in remotes:
        t = r["type"]
        type_def = REMOTE_TYPE_DEFS.get(t, {})
        r["display_name"] = type_def.get("label", t)
        r["icon"] = type_def.get("icon", "💾")
        r["has_auth"] = bool(r.get("_has_token") or r.get("_has_keys")
                             or r.get("_has_pass"))
    return jsonify({"remotes": remotes})


@bp.route("/api/sync/remote/create", methods=["POST"])
def api_sync_remote_create():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    rtype = data.get("type", "").strip()
    params = data.get("params", {})

    if not name or not rtype:
        return jsonify({"error": "name 和 type 必填"}), 400
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        return jsonify({"error": "Remote 名称只能包含字母、数字、下划线和短横线"}), 400

    existing = [r["name"] for r in _parse_rclone_conf()]
    if name in existing:
        return jsonify({"error": f"Remote '{name}' 已存在"}), 409

    cmd = f'rclone config create "{name}" "{rtype}"'
    for k, v in params.items():
        if v:
            cmd += f" {k}={shlex.quote(str(v))}"
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True,
                           text=True, timeout=15)
        if r.returncode != 0:
            return jsonify({"error": f"创建失败: {r.stderr.strip() or r.stdout.strip()}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "message": f"Remote '{name}' 已创建"})


@bp.route("/api/sync/remote/delete", methods=["POST"])
def api_sync_remote_delete():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "缺少 remote 名称"}), 400
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        return jsonify({"error": "Remote 名称只能包含字母、数字、下划线和连字符"}), 400
    try:
        r = subprocess.run(f'rclone config delete {shlex.quote(name)}',
                           shell=True, capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return jsonify({"error": f"删除失败: {r.stderr.strip()}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "message": f"Remote '{name}' 已删除"})


@bp.route("/api/sync/remote/browse", methods=["POST"])
def api_sync_remote_browse():
    data = request.get_json(force=True)
    remote = data.get("remote", "")
    path = data.get("path", "")
    try:
        cmd = (f'rclone lsjson "{remote}:{path}" --dirs-only '
               f'-R --max-depth 1 2>/dev/null')
        r = subprocess.run(cmd, shell=True, capture_output=True,
                           text=True, timeout=30)
        if r.returncode == 0:
            items = json.loads(r.stdout or "[]")
            dirs = [i["Path"] for i in items if i.get("IsDir")]
            return jsonify({"ok": True, "dirs": sorted(dirs)})
        return jsonify({"ok": True, "dirs": []})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/sync/remote/types")
def api_sync_remote_types():
    return jsonify({"types": REMOTE_TYPE_DEFS})


@bp.route("/api/sync/storage")
def api_sync_storage():
    remotes = _parse_rclone_conf()
    results = {}
    for r in remotes:
        name = r["name"]
        try:
            proc = subprocess.run(
                f'rclone about "{name}:" --json 2>/dev/null',
                shell=True, capture_output=True, text=True, timeout=30
            )
            if proc.returncode == 0 and proc.stdout.strip():
                about = json.loads(proc.stdout)
                if about.get("total") or about.get("used") or about.get("free"):
                    results[name] = {
                        "total": about.get("total"),
                        "used": about.get("used"),
                        "free": about.get("free"),
                        "trashed": about.get("trashed"),
                    }
                else:
                    results[name] = {"error": "此存储类型不支持容量查询"}
            else:
                results[name] = {"error": "此存储类型不支持容量查询"}
        except subprocess.TimeoutExpired:
            results[name] = {"error": "查询超时"}
        except Exception as e:
            results[name] = {"error": str(e)}
    return jsonify({"storage": results})


# ====================================================================
# 同步规则
# ====================================================================
@bp.route("/api/sync/rules")
def api_sync_rules():
    return jsonify({"rules": _load_sync_rules(),
                    "templates": SYNC_RULE_TEMPLATES})


@bp.route("/api/sync/rules/save", methods=["POST"])
def api_sync_rules_save():
    data = request.get_json(force=True)
    rules = data.get("rules", [])
    for r in rules:
        if not r.get("id") or not r.get("remote") or not r.get("local_path"):
            return jsonify({"error": "每条规则必须有 id, remote, local_path"}), 400
    _save_sync_rules(rules)

    watch_rules = [r for r in rules
                   if r.get("trigger") == "watch" and r.get("enabled", True)]
    if watch_rules and not is_worker_running():
        start_sync_worker()
    elif not watch_rules:
        stop_sync_worker()

    return jsonify({"ok": True, "message": f"已保存 {len(rules)} 条规则"})


@bp.route("/api/sync/rules/run", methods=["POST"])
def api_sync_rules_run():
    data = request.get_json(force=True)
    rule_id = data.get("rule_id")
    rules = _load_sync_rules()

    if rule_id:
        targets = [r for r in rules if r.get("id") == rule_id]
    else:
        targets = [r for r in rules
                   if r.get("trigger") == "deploy" and r.get("enabled", True)]

    if not targets:
        return jsonify({"error": "没有找到匹配的规则"}), 404

    def _run_targets():
        for r in targets:
            _run_sync_rule(r)

    threading.Thread(target=_run_targets, daemon=True).start()
    return jsonify({"ok": True, "message": f"开始执行 {len(targets)} 条规则"})


# ====================================================================
# Worker 控制
# ====================================================================
@bp.route("/api/sync/worker/start", methods=["POST"])
def api_sync_worker_start():
    start_sync_worker()
    return jsonify({"ok": True, "message": "Sync Worker 已启动"})


@bp.route("/api/sync/worker/stop", methods=["POST"])
def api_sync_worker_stop_route():
    stop_sync_worker()
    return jsonify({"ok": True, "message": "Sync Worker 已停止"})


# ====================================================================
# 全局设置
# ====================================================================
@bp.route("/api/sync/settings", methods=["GET"])
def api_sync_settings_get():
    return jsonify(_load_sync_settings())


@bp.route("/api/sync/settings", methods=["POST"])
def api_sync_settings_save():
    data = request.get_json(force=True)
    settings = _load_sync_settings()
    try:
        if "min_age" in data:
            settings["min_age"] = max(int(data["min_age"]), 0)
        if "watch_interval" in data:
            settings["watch_interval"] = max(int(data["watch_interval"]), 5)
    except (ValueError, TypeError):
        return jsonify({"error": "min_age 和 watch_interval 必须为数字"}), 400
    _save_sync_settings(settings)
    return jsonify({"ok": True, "settings": settings})


# ====================================================================
# Rclone 配置直接编辑
# ====================================================================
@bp.route("/api/sync/rclone_config", methods=["GET"])
def api_get_rclone_config():
    if not RCLONE_CONF.exists():
        return jsonify({"config": "", "exists": False})
    raw = RCLONE_CONF.read_text(encoding="utf-8")
    return jsonify({"config": raw, "exists": True})


@bp.route("/api/sync/rclone_config", methods=["POST"])
def api_save_rclone_config():
    data = request.get_json(force=True)
    config_text = data.get("config", "")
    if not config_text.strip():
        return jsonify({"error": "配置内容不能为空"}), 400
    sections = re.findall(r'^\[.+\]', config_text, re.MULTILINE)
    if not sections:
        return jsonify({"error": "配置格式错误：至少需要一个 [remote] 段"}), 400
    if RCLONE_CONF.exists():
        RCLONE_CONF.with_suffix('.conf.bak').write_text(
            RCLONE_CONF.read_text(encoding="utf-8"), encoding="utf-8")
    RCLONE_CONF.parent.mkdir(parents=True, exist_ok=True)
    RCLONE_CONF.write_text(config_text, encoding="utf-8")
    RCLONE_CONF.chmod(0o600)
    try:
        r = subprocess.run("rclone listremotes 2>&1", shell=True,
                           capture_output=True, text=True, timeout=5)
        remotes = [l.strip().rstrip(':') for l in r.stdout.strip().split('\n')
                   if l.strip()]
    except Exception:
        remotes = []
    return jsonify({"ok": True,
                    "message": f"配置已保存，检测到 {len(remotes)} 个 remote: {', '.join(remotes)}"})


@bp.route("/api/sync/import_config", methods=["POST"])
def api_import_config():
    import base64
    data = request.get_json(force=True)
    import_type = data.get("type", "")
    value = data.get("value", "")
    config_text = ""
    if import_type == "url" and value:
        try:
            resp = requests.get(value, timeout=15)
            resp.raise_for_status()
            config_text = resp.text
        except Exception as e:
            return jsonify({"error": f"下载失败: {e}"}), 400
    elif import_type == "base64" and value:
        try:
            config_text = base64.b64decode(value).decode("utf-8")
        except Exception as e:
            return jsonify({"error": f"Base64 解码失败: {e}"}), 400
    else:
        return jsonify({"error": "请提供 type (url/base64) 和 value"}), 400
    sections = re.findall(r'^\[.+\]', config_text, re.MULTILINE)
    if not sections:
        return jsonify({"error": "导入的内容不是有效的 rclone 配置"}), 400
    if RCLONE_CONF.exists():
        RCLONE_CONF.with_suffix('.conf.bak').write_text(
            RCLONE_CONF.read_text(encoding="utf-8"), encoding="utf-8")
    RCLONE_CONF.parent.mkdir(parents=True, exist_ok=True)
    RCLONE_CONF.write_text(config_text, encoding="utf-8")
    RCLONE_CONF.chmod(0o600)
    try:
        r = subprocess.run("rclone listremotes 2>&1", shell=True,
                           capture_output=True, text=True, timeout=5)
        remotes = [l.strip().rstrip(':') for l in r.stdout.strip().split('\n')
                   if l.strip()]
    except Exception:
        remotes = []
    return jsonify({"ok": True,
                    "message": f"导入成功，检测到 {len(remotes)} 个 remote: {', '.join(remotes)}"})
