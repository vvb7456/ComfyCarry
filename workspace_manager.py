#!/usr/bin/env python3
"""
Workspace Manager v1.0 - ComfyUI RunPod/Vast 部署管理器
- 仪表盘: 系统监控, 服务控制
- 模型管理: 本地模型扫描, CivitAI 查询, Enhanced-Civicomfy 下载
- 日志查看: PM2 日志实时查看

启动: python workspace_manager.py [port]
"""

import json
import os
import sys
import subprocess
import hashlib
import threading
import time
import re
import secrets
import shlex
import uuid
import queue
from pathlib import Path
from datetime import datetime

import requests
from flask import Flask, jsonify, request, Response, send_file, redirect, session
from flask_cors import CORS

app = Flask(__name__, static_folder=None)
CORS(app)

# --- 配置 ---
COMFYUI_DIR = os.environ.get("COMFYUI_DIR", "/workspace/ComfyUI")
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://localhost:8188")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = Path(__file__).parent / ".civitai_config.json"
MEILI_URL = 'https://search.civitai.com/multi-search'
MEILI_BEARER = '8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61'
MANAGER_PORT = int(os.environ.get("MANAGER_PORT", 5000))

# ── 持久化配置 (.dashboard_env) ──────────────────────────────
# 所有用户可修改的运行时配置统一存储在此文件
DASHBOARD_ENV_FILE = Path("/workspace/.dashboard_env")

def _load_config():
    """从 .dashboard_env 加载全部配置"""
    if DASHBOARD_ENV_FILE.exists():
        try:
            return json.loads(DASHBOARD_ENV_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_config(data):
    """写入 .dashboard_env"""
    DASHBOARD_ENV_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

def _get_config(key, default=""):
    """读取单个配置值"""
    return _load_config().get(key, default)

_config_lock = threading.Lock()

def _set_config(key, value):
    """写入单个配置值 (线程安全)"""
    with _config_lock:
        data = _load_config()
        data[key] = value
        _save_config(data)

# ── 密码 ──────────────────────────────────────────────────────
def _load_dashboard_password():
    """优先 .dashboard_env > 环境变量 > 默认值"""
    pw = _get_config("password")
    if pw:
        return pw
    env_pw = os.environ.get("DASHBOARD_PASSWORD", "")
    if env_pw:
        return env_pw
    return "comfy2025"

def _save_dashboard_password(pw):
    _set_config("password", pw)

DASHBOARD_PASSWORD = _load_dashboard_password()

# ── Session Secret (持久化 → 重启不掉线) ─────────────────────
def _load_session_secret():
    """从 .dashboard_env 读 session_secret, 不存在则生成并保存"""
    existing = _get_config("session_secret")
    if existing:
        return existing
    new_secret = secrets.token_hex(32)
    _set_config("session_secret", new_secret)
    return new_secret

app.secret_key = _load_session_secret()

# 模型目录映射
MODEL_DIRS = {
    "checkpoints": "models/checkpoints",
    "loras": "models/loras",
    "controlnet": "models/controlnet",
    "vae": "models/vae",
    "upscale_models": "models/upscale_models",
    "embeddings": "models/embeddings",
    "clip": "models/clip",
    "unet": "models/unet",
    "clip_vision": "models/clip_vision",
}

MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin"}

# --- Setup Wizard State ---
SETUP_STATE_FILE = Path("/workspace/.setup_state.json")

# 默认插件列表 (与原 deploy.sh 完全一致)
DEFAULT_PLUGINS = [
    {"url": "https://github.com/ltdrdata/ComfyUI-Manager", "name": "ComfyUI-Manager", "required": True},
    {"url": "https://github.com/Fannovel16/comfyui_controlnet_aux", "name": "ControlNet Aux"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Impact-Pack", "name": "Impact Pack"},
    {"url": "https://github.com/yolain/ComfyUI-Easy-Use", "name": "Easy Use"},
    {"url": "https://github.com/crystian/ComfyUI-Crystools", "name": "Crystools"},
    {"url": "https://github.com/ssitu/ComfyUI_UltimateSDUpscale", "name": "Ultimate SD Upscale"},
    {"url": "https://github.com/adieyal/comfyui-dynamicprompts", "name": "Dynamic Prompts"},
    {"url": "https://github.com/weilin9999/WeiLin-Comfyui-Tools", "name": "WeiLin Tools"},
    {"url": "https://github.com/GreenLandisaLie/AuraSR-ComfyUI", "name": "AuraSR"},
    {"url": "https://github.com/ltdrdata/was-node-suite-comfyui", "name": "WAS Node Suite"},
    {"url": "https://github.com/kijai/ComfyUI-KJNodes", "name": "KJNodes"},
    {"url": "https://github.com/BenjaMITM/Enhanced-Civicomfy", "name": "Enhanced Civicomfy", "required": True},
    {"url": "https://github.com/pythongosssss/ComfyUI-WD14-Tagger", "name": "WD14 Tagger"},
    {"url": "https://github.com/rgthree/rgthree-comfy", "name": "rgthree"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Inspire-Pack", "name": "Inspire Pack"},
]


def _load_setup_state():
    """加载 Setup Wizard 状态"""
    defaults = {
        "completed": False,
        "current_step": 0,
        "image_type": "",         # "generic" or "prebuilt"
        "password": "",
        "cloudflared_token": "",
        "rclone_config_method": "",  # "url", "base64", "skip"
        "rclone_config_value": "",
        "civitai_token": "",
        "plugins": [p["url"] for p in DEFAULT_PLUGINS],
        "deploy_started": False,
        "deploy_completed": False,
        "deploy_error": "",
        "deploy_steps_completed": [],
        "deploy_log": [],
    }
    if SETUP_STATE_FILE.exists():
        try:
            state = json.loads(SETUP_STATE_FILE.read_text(encoding="utf-8"))
            for k, v in defaults.items():
                if k not in state:
                    state[k] = v
            return state
        except Exception:
            pass
    return defaults


def _save_setup_state(state):
    """保存 Setup Wizard 状态"""
    SETUP_STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def _is_setup_complete():
    """检查部署是否已完成"""
    if not SETUP_STATE_FILE.exists():
        # 如果 ComfyUI 已存在且有 main.py，视为已部署 (兼容旧脚本)
        if Path("/workspace/ComfyUI/main.py").exists():
            return True
        return False
    state = _load_setup_state()
    return state.get("deploy_completed", False)


# --- 鉴权 ---


LOGIN_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - ComfyCarry</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans','IBM Plex Sans SC',-apple-system,sans-serif;background:#0a0a0f;color:#e8e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:clamp(15px,1.1vw,21px)}
.card{background:#1a1a28;border:1px solid #2a2a3e;border-radius:14px;padding:clamp(32px,3vw,48px);width:clamp(360px,28vw,480px);max-width:92vw}
.card h2{text-align:center;margin-bottom:clamp(20px,2vw,32px);font-size:clamp(1.3rem,1.8vw,1.8rem);background:linear-gradient(135deg,#7c5cfc,#e879f9);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
input{width:100%;padding:clamp(10px,1.2vw,16px) clamp(14px,1.5vw,20px);background:#0e0e18;color:#e8e8f0;border:1px solid #2a2a3e;border-radius:10px;font-size:clamp(.9rem,1vw,1.1rem);margin-bottom:clamp(14px,1.2vw,20px)}
input:focus{border-color:#7c5cfc;outline:none}
button{width:100%;padding:clamp(10px,1.2vw,16px);background:#7c5cfc;color:#fff;border:none;border-radius:10px;font-size:clamp(.9rem,1vw,1.1rem);cursor:pointer;font-weight:600}
button:hover{background:#9078ff}
.err{color:#f87171;font-size:clamp(.82rem,.9vw,1rem);text-align:center;margin-bottom:10px}
</style></head>
<body><div class="card"><h2>ComfyCarry</h2>
<form method="POST" action="/login">
<div class="err" id="err">__ERR__</div>
<input name="password" type="password" placeholder="输入访问密码..." autofocus>
<button type="submit">登录</button>
</form></div></body></html>"""


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return Response(LOGIN_PAGE.replace("__ERR__", ""), mimetype="text/html")
    pw = request.form.get("password", "")
    if pw == DASHBOARD_PASSWORD:
        session["authed"] = True
        return redirect("/")
    return Response(LOGIN_PAGE.replace("__ERR__", "密码错误"), mimetype="text/html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.before_request
def check_auth():
    """全局鉴权与 Setup Wizard 路由"""
    # Setup 相关路由始终允许
    if request.path.startswith("/api/setup/") or request.path == "/setup":
        return
    # 配置导入在 Setup 阶段也需要可用
    if request.path == "/api/settings/import-config":
        return
    if request.path in ("/login", "/favicon.ico", "/dashboard.js", "/api/version"):
        return
    if request.path.startswith("/static/"):
        return
    # 如果尚未完成部署向导, 重定向到向导页
    if not _is_setup_complete():
        if request.path.startswith("/api/"):
            return jsonify({"error": "Setup not complete", "setup_required": True}), 503
        if request.path != "/":
            return redirect("/")
        return  # 让 index() 处理向导页渲染
    # 正常鉴权
    if not DASHBOARD_PASSWORD:
        return
    if session.get("authed"):
        return
    if request.path.startswith("/api/"):
        return jsonify({"error": "Unauthorized"}), 401
    return redirect("/login")


# --- 工具函数 ---
def _get_api_key():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text()).get("api_key", "")
        except Exception:
            return ""
    return ""

def _run_cmd(cmd, timeout=10):
    """运行 shell 命令并返回输出"""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception as e:
        return f"Error: {e}"

def _sha256_file(filepath):
    """计算文件完整 SHA256 (CivitAI 需要完整文件哈希)"""
    sha = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                sha.update(chunk)
        return sha.hexdigest().upper()
    except Exception:
        return None


# ====================================================================
# 版本信息 API
# ====================================================================
@app.route("/api/version")
def api_version():
    """返回当前部署版本信息"""
    version_info = {"version": "v2.4", "branch": "main", "commit": ""}
    version_file = os.path.join(SCRIPT_DIR, ".version")
    try:
        if os.path.exists(version_file):
            with open(version_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line:
                        k, v = line.split("=", 1)
                        version_info[k.strip().lower()] = v.strip()
    except Exception:
        pass
    # Also try git if available (dev environment)
    if not version_info.get("commit"):
        try:
            import subprocess
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                cwd=SCRIPT_DIR, timeout=3
            )
            if result.returncode == 0:
                version_info["commit"] = result.stdout.strip()
            result2 = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True,
                cwd=SCRIPT_DIR, timeout=3
            )
            if result2.returncode == 0:
                version_info["branch"] = result2.stdout.strip()
        except Exception:
            pass
    return jsonify(version_info)


# 系统监控 API
# ====================================================================
@app.route("/api/system")
def api_system():
    """获取系统信息"""
    info = {"cpu": {}, "memory": {}, "disk": {}, "gpu": [], "network": {}, "uptime": ""}

    # CPU
    try:
        import psutil
        info["cpu"]["percent"] = psutil.cpu_percent(interval=0.5)
        info["cpu"]["cores"] = psutil.cpu_count()
        info["cpu"]["freq"] = psutil.cpu_freq()._asdict() if psutil.cpu_freq() else {}
        load = os.getloadavg()
        info["cpu"]["load"] = {"1m": load[0], "5m": load[1], "15m": load[2]}
    except Exception as e:
        info["cpu"]["error"] = str(e)

    # Memory
    try:
        import psutil
        mem = psutil.virtual_memory()
        info["memory"] = {
            "total": mem.total, "used": mem.used, "available": mem.available,
            "percent": mem.percent
        }
    except Exception as e:
        info["memory"]["error"] = str(e)

    # Disk
    try:
        import psutil
        disk = psutil.disk_usage("/workspace" if os.path.exists("/workspace") else "/")
        info["disk"] = {
            "total": disk.total, "used": disk.used, "free": disk.free,
            "percent": disk.percent, "path": "/workspace"
        }
    except Exception as e:
        info["disk"]["error"] = str(e)

    # GPU (nvidia-smi)
    try:
        gpu_out = _run_cmd(
            "nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,"
            "utilization.gpu,temperature.gpu,power.draw,power.limit "
            "--format=csv,nounits,noheader", timeout=5
        )
        for line in gpu_out.strip().split("\n"):
            if not line.strip():
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 9:
                info["gpu"].append({
                    "index": int(parts[0]), "name": parts[1],
                    "mem_total": int(parts[2]), "mem_used": int(parts[3]),
                    "mem_free": int(parts[4]), "util": int(parts[5]),
                    "temp": int(parts[6]),
                    "power": float(parts[7]) if parts[7] != "[N/A]" else 0,
                    "power_limit": float(parts[8]) if parts[8] != "[N/A]" else 0,
                })
    except Exception:
        pass

    # Network
    try:
        import psutil
        net = psutil.net_io_counters()
        info["network"] = {
            "bytes_sent": net.bytes_sent, "bytes_recv": net.bytes_recv,
            "packets_sent": net.packets_sent, "packets_recv": net.packets_recv,
        }
    except Exception:
        pass

    # Uptime
    try:
        info["uptime"] = _run_cmd("uptime -p", timeout=3)
    except Exception:
        pass

    return jsonify(info)


# ====================================================================
# 服务管理 API (PM2)
# ====================================================================
@app.route("/api/services")
def api_services():
    """获取 PM2 服务列表"""
    try:
        out = _run_cmd("pm2 jlist", timeout=5)
        if out and not out.startswith("Error"):
            services = json.loads(out)
            result = []
            for s in services:
                result.append({
                    "name": s.get("name"),
                    "pm_id": s.get("pm_id"),
                    "status": s.get("pm2_env", {}).get("status"),
                    "cpu": s.get("monit", {}).get("cpu", 0),
                    "memory": s.get("monit", {}).get("memory", 0),
                    "restarts": s.get("pm2_env", {}).get("restart_time", 0),
                    "uptime": s.get("pm2_env", {}).get("pm_uptime", 0),
                    "pid": s.get("pid"),
                })
            return jsonify({"services": result})
        return jsonify({"services": [], "error": out})
    except Exception as e:
        return jsonify({"services": [], "error": str(e)})


@app.route("/api/services/<name>/<action>", methods=["POST"])
def api_service_action(name, action):
    """控制服务: restart, stop, start"""
    if action not in ("restart", "stop", "start"):
        return jsonify({"error": "Invalid action"}), 400
    if not re.match(r'^[\w\-]+$', name):
        return jsonify({"error": "Invalid service name"}), 400
    out = _run_cmd(f"pm2 {action} {name}", timeout=10)
    return jsonify({"ok": True, "output": out})


# ====================================================================
# 日志 API
# ====================================================================
@app.route("/api/logs/<name>")
def api_logs(name):
    """获取 PM2 日志"""
    if not re.match(r'^[\w\-]+$', name):
        return jsonify({"logs": "", "error": "Invalid service name"}), 400
    try:
        lines = int(request.args.get("lines", "100"))
        lines = min(max(lines, 1), 1000)
    except (ValueError, TypeError):
        lines = 100
    try:
        out = _run_cmd(f"pm2 logs {name} --nostream --lines {lines}", timeout=5)
        return jsonify({"logs": out})
    except Exception as e:
        return jsonify({"logs": "", "error": str(e)})


# ====================================================================
# 配置 API (CivitAI Key)
# ====================================================================
@app.route("/api/config", methods=["GET"])
def get_config():
    key = _get_api_key()
    return jsonify({
        "api_key": key, "has_key": bool(key),
        "key_preview": f"{key[:8]}...{key[-4:]}" if len(key) > 12 else ("****" if key else ""),
        "comfyui_dir": COMFYUI_DIR, "comfyui_url": COMFYUI_URL,
    })

@app.route("/api/config", methods=["POST"])
def save_config():
    data = request.get_json(force=True) or {}
    api_key = data.get("api_key", "").strip()
    CONFIG_FILE.write_text(json.dumps({"api_key": api_key}))
    return jsonify({"ok": True, "has_key": bool(api_key)})


# ====================================================================
# CivitAI 搜索代理 (Meilisearch CORS bypass)
# ====================================================================
@app.route("/api/search", methods=["POST"])
def proxy_search():
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({"error": "No JSON body"}), 400

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MEILI_BEARER}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        resp = requests.post(MEILI_URL, headers=headers, json=data, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 本地模型管理 API
# ====================================================================
@app.route("/api/local_models")
def api_local_models():
    """扫描本地模型文件"""
    category = request.args.get("category", "all")
    results = []

    dirs_to_scan = MODEL_DIRS if category == "all" else {category: MODEL_DIRS.get(category, "")}

    for cat, rel_dir in dirs_to_scan.items():
        full_dir = os.path.join(COMFYUI_DIR, rel_dir)
        if not os.path.isdir(full_dir):
            continue
        for root, _, files in os.walk(full_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in MODEL_EXTENSIONS:
                    continue
                fpath = os.path.join(root, fname)
                rel_path = os.path.relpath(fpath, os.path.join(COMFYUI_DIR, rel_dir))
                stat = os.stat(fpath)

                # Check for metadata files
                base_no_ext = os.path.splitext(fpath)[0]
                info_path = f"{fpath}.weilin-info.json"
                info_data = None
                if os.path.exists(info_path):
                    try:
                        with open(info_path, "r", encoding="utf-8") as f:
                            info_data = json.load(f)
                    except Exception:
                        pass

                # Check for preview image
                preview = None
                for pext in [".jpg", ".png", ".jpeg", ".webp"]:
                    ppath = base_no_ext + pext
                    if os.path.exists(ppath):
                        preview = os.path.relpath(ppath, COMFYUI_DIR)
                        break

                entry = {
                    "filename": fname,
                    "rel_path": rel_path,
                    "category": cat,
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                    "abs_path": fpath,
                    "has_info": info_data is not None,
                    "has_preview": preview is not None,
                    "preview_path": preview,
                }

                if info_data:
                    entry["name"] = info_data.get("name", fname)
                    entry["base_model"] = info_data.get("baseModel", "")
                    entry["type"] = info_data.get("type", cat)
                    entry["trained_words"] = [
                        w.get("word", "") for w in info_data.get("trainedWords", [])
                    ]
                    entry["links"] = info_data.get("links", [])
                    # CivitAI IDs from raw data
                    raw_civitai = info_data.get("raw", {}).get("civitai", {})
                    entry["civitai_id"] = raw_civitai.get("modelId")
                    entry["civitai_version_id"] = raw_civitai.get("id")
                    entry["version_name"] = raw_civitai.get("name", "")
                    entry["sha256"] = info_data.get("sha256", "")
                    # Images from info (full array)
                    imgs = info_data.get("images", [])
                    entry["images"] = imgs
                    if imgs:
                        entry["civitai_image"] = imgs[0].get("url", "")
                else:
                    entry["name"] = fname
                    entry["base_model"] = ""
                    entry["type"] = cat
                    entry["trained_words"] = []

                results.append(entry)

    results.sort(key=lambda x: x["modified"], reverse=True)
    return jsonify({"models": results, "total": len(results)})


@app.route("/api/local_models/preview")
def api_model_preview():
    """返回模型预览图"""
    rel = request.args.get("path", "")
    full = os.path.realpath(os.path.join(COMFYUI_DIR, rel))
    # 路径安全检查: 必须在 COMFYUI_DIR 内
    if not full.startswith(os.path.realpath(COMFYUI_DIR) + os.sep):
        return jsonify({"error": "路径越界"}), 403
    if os.path.isfile(full):
        return send_file(full)
    return "", 404


@app.route("/api/local_models/delete", methods=["POST"])
def api_delete_model():
    """删除本地模型及其关联文件"""
    data = request.get_json(force=True) or {}
    abs_path = os.path.realpath(data.get("abs_path", ""))

    # 安全检查: realpath + 前缀匹配含 /
    if not abs_path.startswith(os.path.realpath(COMFYUI_DIR) + os.sep):
        return jsonify({"error": "路径不在 ComfyUI 目录内"}), 403

    if not os.path.isfile(abs_path):
        return jsonify({"error": "文件不存在"}), 404

    deleted = [abs_path]
    os.remove(abs_path)

    # 删除关联文件
    base_no_ext = os.path.splitext(abs_path)[0]
    for suffix in [".weilin-info.json", ".jpg", ".png", ".jpeg", ".webp", ".civitai.info"]:
        companion = (abs_path + suffix) if suffix.startswith(".weilin") else (base_no_ext + suffix)
        if os.path.exists(companion):
            os.remove(companion)
            deleted.append(companion)

    return jsonify({"ok": True, "deleted": deleted})


@app.route("/api/local_models/fetch_info", methods=["POST"])
def api_fetch_model_info():
    """通过 SHA256 从 CivitAI 获取模型元数据并保存"""
    data = request.get_json(force=True) or {}
    abs_path = os.path.realpath(data.get("abs_path", ""))

    # 安全检查: realpath + 前缀匹配含 /
    if not abs_path.startswith(os.path.realpath(COMFYUI_DIR) + os.sep):
        return jsonify({"error": "路径不在 ComfyUI 目录内"}), 403

    if not os.path.isfile(abs_path):
        return jsonify({"error": "文件不存在"}), 404

    # 计算 SHA256
    file_hash = _sha256_file(abs_path)
    if not file_hash:
        return jsonify({"error": "无法计算哈希"}), 500

    # 调用 CivitAI API
    api_key = _get_api_key()
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        api_url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
        resp = requests.get(api_url, headers=headers, timeout=30)
        if resp.status_code == 404:
            return jsonify({"error": "CivitAI 未找到该模型", "hash": file_hash}), 404
        resp.raise_for_status()
        civitai_data = resp.json()
    except Exception as e:
        return jsonify({"error": f"API 请求失败: {e}", "hash": file_hash}), 500

    # 构建 weilin-info.json
    info_data = {
        "file": os.path.basename(abs_path),
        "path": abs_path,
        "sha256": file_hash,
        "name": civitai_data.get("model", {}).get("name", ""),
        "type": civitai_data.get("model", {}).get("type", ""),
        "baseModel": civitai_data.get("baseModel", ""),
        "images": [],
        "trainedWords": [],
        "links": [],
        "raw": {"civitai": civitai_data},
    }

    # 版本名
    ver_name = civitai_data.get("name", "")
    if ver_name:
        info_data["name"] += f" - {ver_name}"

    # 触发词
    trigger_words = civitai_data.get("trainedWords", [])
    for w in trigger_words:
        info_data["trainedWords"].append({"word": w, "civitai": True})

    # Links
    model_id = civitai_data.get("modelId")
    version_id = civitai_data.get("id")
    if model_id:
        link = f"https://civitai.com/models/{model_id}"
        if version_id:
            link += f"?modelVersionId={version_id}"
        info_data["links"].append(link)

    # 图片
    for img in civitai_data.get("images", []):
        img_url = img.get("url", "")
        if img_url:
            img_entry = {
                "url": img_url,
                "type": img.get("type", "image"),
                "width": img.get("width"),
                "height": img.get("height"),
                "nsfwLevel": img.get("nsfwLevel"),
            }
            meta = img.get("meta") or {}
            if meta:
                img_entry["positive"] = meta.get("prompt", "")
                img_entry["negative"] = meta.get("negativePrompt", "")
                img_entry["seed"] = meta.get("seed")
                img_entry["sampler"] = meta.get("sampler")
                img_entry["cfg"] = meta.get("cfgScale")
                img_entry["steps"] = meta.get("steps")
                img_entry["model"] = meta.get("Model")
            info_data["images"].append(img_entry)

    # 保存 info json
    info_path = f"{abs_path}.weilin-info.json"
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info_data, f, sort_keys=False, indent=2, ensure_ascii=False)

    # 下载预览图
    base_no_ext = os.path.splitext(abs_path)[0]
    if info_data["images"]:
        first_img_url = info_data["images"][0].get("url", "")
        if first_img_url:
            try:
                with requests.get(first_img_url, timeout=15, stream=True) as img_resp:
                    img_resp.raise_for_status()
                    ct = img_resp.headers.get("Content-Type", "")
                    ext = ".png"
                    if "jpeg" in ct or "jpg" in ct:
                        ext = ".jpeg"
                    elif "webp" in ct:
                        ext = ".webp"
                    preview_path = base_no_ext + ext
                    with open(preview_path, "wb") as pf:
                        for chunk in img_resp.iter_content(4096):
                            pf.write(chunk)
                    info_data["_preview_saved"] = preview_path
            except Exception:
                pass

    return jsonify({"ok": True, "info": info_data, "hash": file_hash})


# ====================================================================
# Enhanced-Civicomfy 下载代理
# ====================================================================
@app.route("/api/download", methods=["POST"])
def api_download_model():
    """代理请求到 ComfyUI 的 Enhanced-Civicomfy 下载接口"""
    data = request.get_json(force=True) or {}
    api_key = data.get("api_key") or _get_api_key()

    payload = {
        "model_url_or_id": data.get("model_id", ""),
        "model_type": data.get("model_type", "checkpoint"),
        "api_key": api_key,
        "num_connections": data.get("num_connections", 4),
    }
    if data.get("version_id"):
        payload["model_version_id"] = int(data["version_id"])
    if data.get("custom_filename"):
        payload["custom_filename"] = data["custom_filename"]

    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/download", json=payload, timeout=30)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "ComfyUI 未运行，无法下载。请先启动 ComfyUI 服务。"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/status")
def api_download_status():
    """获取 Civicomfy 下载状态"""
    try:
        resp = requests.get(f"{COMFYUI_URL}/civitai/status", timeout=5)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception:
        return jsonify({"queue": [], "active": [], "history": []}), 200


@app.route("/api/download/cancel", methods=["POST"])
def api_download_cancel():
    """取消指定下载任务"""
    data = request.get_json(force=True) or {}
    download_id = data.get("download_id", "")
    if not download_id:
        return jsonify({"error": "download_id required"}), 400
    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/cancel", json={"download_id": download_id}, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/retry", methods=["POST"])
def api_download_retry():
    """重试失败/取消的下载"""
    data = request.get_json(force=True) or {}
    download_id = data.get("download_id", "")
    if not download_id:
        return jsonify({"error": "download_id required"}), 400
    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/retry", json={"download_id": download_id}, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/clear_history", methods=["POST"])
def api_download_clear_history():
    """清除下载历史"""
    try:
        resp = requests.post(f"{COMFYUI_URL}/civitai/clear_history", json={}, timeout=10)
        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/tunnel_links")
def api_tunnel_links():
    """获取 Cloudflare Tunnel 代理的服务链接"""
    links = []
    # 尝试从环境变量获取
    tunnel_url = os.environ.get("CF_TUNNEL_URL", os.environ.get("TUNNEL_URL", ""))
    if tunnel_url:
        links.append({"name": "ComfyUI", "url": tunnel_url.rstrip("/"), "icon": "🎨"})
    jupyter_url = os.environ.get("JUPYTER_URL", "")
    if jupyter_url:
        links.append({"name": "Jupyter", "url": jupyter_url, "icon": "📓"})

    if not links:
        links = _parse_tunnel_ingress()

    vast_proxy = os.environ.get("VAST_PROXY_URL", "")
    if vast_proxy:
        links.append({"name": "Vast.ai Proxy", "url": vast_proxy, "icon": "☁️"})

    return jsonify({"links": links})


def _parse_tunnel_ingress():
    """从 PM2 tunnel 日志中解析 Cloudflare Tunnel ingress 配置"""
    links = []
    try:
        r = subprocess.run(
            "pm2 logs tunnel --nostream --lines 300 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        log = r.stdout + r.stderr

        # Strategy 1: Parse config="{...}" with escaped JSON (named tunnels)
        # The JSON value has escaped quotes, so we can't use simple (.*?) — match
        # everything between config=" and the closing " that is NOT preceded by \
        cfg_match = re.search(r'config="((?:[^"\\]|\\.)*)"', log)
        if cfg_match:
            raw = cfg_match.group(1).replace('\\"', '"').replace('\\\\', '\\')
            try:
                cfg = json.loads(raw)
                ingress = cfg.get("ingress", [])
                _tunnel_ingress_to_links(ingress, links)
            except (json.JSONDecodeError, ValueError):
                pass

        # Strategy 2: Look for "ingress" JSON array directly in logs
        if not links:
            # Sometimes the config is logged as plain JSON
            ing_match = re.search(r'"ingress"\s*:\s*\[', log)
            if ing_match:
                # Find the matching closing bracket
                start = ing_match.start()
                brace_start = log.index('[', start)
                depth = 0
                end = brace_start
                for i in range(brace_start, min(brace_start + 5000, len(log))):
                    if log[i] == '[': depth += 1
                    elif log[i] == ']': depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
                try:
                    ingress = json.loads(log[brace_start:end])
                    _tunnel_ingress_to_links(ingress, links)
                except (json.JSONDecodeError, ValueError):
                    pass

        # Strategy 3: Find hostname→URL mappings from "Registered tunnel connection" lines
        if not links:
            # Look for registered hostnames like "Updated to ... hostname=xxx.com"
            hostnames = re.findall(r'hostname[=:]\s*([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', log)
            for h in set(hostnames):
                if 'cloudflare' not in h:
                    links.append({"name": h.split(".")[0].replace("-", " ").title(),
                                  "url": f"https://{h}", "icon": "🌐"})

        # Strategy 4: Fallback — trycloudflare quick tunnel URLs
        if not links:
            urls = list(set(re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com', log)))
            for i, u in enumerate(urls):
                links.append({"name": f"Service #{i+1}", "url": u, "icon": "🌐"})
    except Exception:
        pass
    return links


def _tunnel_ingress_to_links(ingress, links):
    """将 Cloudflare Tunnel ingress 列表转换为服务链接"""
    port_services = _detect_port_services()
    jupyter_token = _get_jupyter_token()
    for entry in ingress:
        hostname = entry.get("hostname", "")
        service = entry.get("service", "")
        if not hostname or "http_status:" in service:
            continue
        port_match = re.search(r':(\d+)', service)
        port = port_match.group(1) if port_match else ""
        proto = "ssh" if service.startswith("ssh://") else "http"
        if proto == "ssh":
            continue
        svc_name = port_services.get(port, "")
        if not svc_name:
            svc_name = hostname.split(".")[0].replace("-", " ").title()
        icon = {"comfyui": "🎨", "jupyter": "📓", "dashboard": "📊"}.get(svc_name.lower(), "🌐")
        url = f"https://{hostname}"
        # Append Jupyter token if applicable
        if svc_name.lower() == "jupyter" and jupyter_token:
            url += f"/?token={jupyter_token}"
        links.append({
            "name": svc_name, "url": url,
            "icon": icon, "port": port, "service": service
        })


def _get_jupyter_token():
    """从 jupyter server list 获取运行中的 Jupyter token"""
    try:
        r = subprocess.run(
            "jupyter server list 2>&1",
            shell=True, capture_output=True, text=True, timeout=5
        )
        output = r.stdout + r.stderr
        # Match: https://host:port/?token=TOKEN :: /path
        # or:   http://host:port/?token=TOKEN :: /path
        match = re.search(r'https?://[^?]+\?token=([a-f0-9]+)', output)
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


def _detect_port_services():
    """检测本机端口对应的服务名称"""
    mapping = {}
    # 尝试用 PM2 获取动态端口映射
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            procs = json.loads(r.stdout)
            for p in procs:
                name = p.get("name", "")
                args = p.get("pm2_env", {}).get("args", [])
                if isinstance(args, list):
                    for i, a in enumerate(args):
                        if a == "--port" and i + 1 < len(args):
                            mapping[str(args[i + 1])] = name.title()
    except Exception:
        pass
    # 已知端口（覆盖 PM2 自动检测，确保名称准确）
    mapping["8188"] = "ComfyUI"
    mapping["5000"] = "Dashboard"
    mapping["8080"] = "Jupyter"
    mapping["8888"] = "Jupyter"
    return mapping


@app.route("/api/tunnel_status")
def api_tunnel_status():
    """获取 Tunnel 状态和日志"""
    # PM2 进程信息
    status = "unknown"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            procs = json.loads(r.stdout)
            for p in procs:
                if p.get("name") == "tunnel":
                    status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    # 日志 (strip ANSI codes and PM2 prefixes)
    try:
        r = subprocess.run(
            "pm2 logs tunnel --nostream --lines 100 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw_logs = r.stdout + r.stderr
        # Strip ANSI escape codes
        ansi_re = re.compile(r'\x1b\[[0-9;]*m')
        logs = ansi_re.sub('', raw_logs)
        # Strip PM2 prefix like "1|tunnel   | "
        logs = re.sub(r'^\d+\|[^|]+\|\s*', '', logs, flags=re.MULTILINE)
        # Strip PM2 tailing header lines
        logs = '\n'.join(l for l in logs.split('\n')
                        if not l.startswith('[TAILING]') and 'last 100 lines' not in l and '/root/.pm2/logs/' not in l)
    except Exception:
        logs = ""

    # Ingress 链接
    links = _parse_tunnel_ingress()

    return jsonify({"status": status, "logs": logs, "links": links})


# ====================================================================
# Plugin Management API (代理 ComfyUI-Manager 端点)
# ====================================================================

def _cm_get(path, params=None, timeout=30):
    """向 ComfyUI-Manager 发送 GET 请求"""
    try:
        r = requests.get(f"{COMFYUI_URL}{path}", params=params, timeout=timeout)
        return r
    except requests.exceptions.ConnectionError:
        return None
    except Exception:
        return None


def _cm_post(path, json_data=None, text_data=None, timeout=30):
    """向 ComfyUI-Manager 发送 POST 请求"""
    try:
        if text_data is not None:
            r = requests.post(f"{COMFYUI_URL}{path}", data=text_data,
                              headers={"Content-Type": "text/plain"}, timeout=timeout)
        else:
            r = requests.post(f"{COMFYUI_URL}{path}", json=json_data, timeout=timeout)
        return r
    except requests.exceptions.ConnectionError:
        return None
    except Exception:
        return None


# ====================================================================
# ComfyUI 管理 API
# ====================================================================

# ---------- 启动参数定义 ----------
COMFYUI_PARAM_GROUPS = {
    "vram": {
        "label": "VRAM 管理",
        "type": "select",
        "help": "控制模型显存分配策略。默认自动检测，High VRAM 适合大显存GPU不卸载模型，Low VRAM 适合小显存拆分推理",
        "options": [
            ("default", "默认 (自动)"),
            ("gpu-only", "GPU Only (全部保留在GPU)"),
            ("highvram", "High VRAM (模型不卸载)"),
            ("normalvram", "Normal VRAM (强制正常模式)"),
            ("lowvram", "Low VRAM (拆分 UNet)"),
            ("novram", "No VRAM (极限低显存)"),
        ],
        "flag_map": {
            "gpu-only": "--gpu-only", "highvram": "--highvram",
            "normalvram": "--normalvram", "lowvram": "--lowvram",
            "novram": "--novram",
        },
    },
    "attention": {
        "label": "Attention 方案",
        "type": "select",
        "help": "PyTorch SDPA 推荐，自动调用最优内核(含FlashAttention)。FlashAttention/SageAttention 需要额外安装对应包",
        "options": [
            ("default", "默认 (自动选择)"),
            ("pytorch-cross", "PyTorch SDPA (推荐✓)"),
            ("split-cross", "Split Cross Attention (省VRAM)"),
            ("quad-cross", "Sub-Quadratic"),
            ("flash", "FlashAttention (需flash-attn包)"),
            ("sage", "SageAttention (需sageattention包)"),
        ],
        "flag_map": {
            "pytorch-cross": "--use-pytorch-cross-attention",
            "split-cross": "--use-split-cross-attention",
            "quad-cross": "--use-quad-cross-attention",
            "flash": "--use-flash-attention",
            "sage": "--use-sage-attention",
        },
    },
    "disable_xformers": {
        "label": "禁用 xFormers",
        "type": "bool",
        "help": "xFormers 在新版 PyTorch 下已不推荐，建议禁用并使用 PyTorch SDPA",
        "flag": "--disable-xformers",
    },
    "unet_precision": {
        "label": "UNet 精度",
        "type": "select",
        "help": "控制 UNet 推理精度。FP8 可大幅减少显存占用，适合大模型；BF16 是 Ampere+ 推荐精度",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("fp8_e4m3fn", "FP8 (e4m3fn)"), ("fp8_e5m2", "FP8 (e5m2)"),
        ],
        "flag_map": {
            "fp32": "--fp32-unet", "fp16": "--fp16-unet", "bf16": "--bf16-unet",
            "fp8_e4m3fn": "--fp8_e4m3fn-unet", "fp8_e5m2": "--fp8_e5m2-unet",
        },
    },
    "vae_precision": {
        "label": "VAE 精度",
        "type": "select",
        "help": "VAE 解码精度。FP32 最稳定，FP16/BF16 更快。黑图时可尝试 FP32",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("cpu", "CPU (在CPU上运行)"),
        ],
        "flag_map": {
            "fp32": "--fp32-vae", "fp16": "--fp16-vae",
            "bf16": "--bf16-vae", "cpu": "--cpu-vae",
        },
    },
    "text_enc_precision": {
        "label": "Text Encoder 精度",
        "type": "select",
        "help": "文本编码器精度。通常默认即可，FP8 可节省显存",
        "options": [
            ("default", "默认 (自动)"),
            ("fp32", "FP32"), ("fp16", "FP16"), ("bf16", "BF16"),
            ("fp8_e4m3fn", "FP8 (e4m3fn)"), ("fp8_e5m2", "FP8 (e5m2)"),
        ],
        "flag_map": {
            "fp32": "--fp32-text-enc", "fp16": "--fp16-text-enc",
            "bf16": "--bf16-text-enc",
            "fp8_e4m3fn": "--fp8_e4m3fn-text-enc", "fp8_e5m2": "--fp8_e5m2-text-enc",
        },
    },
    "fast": {
        "label": "实验性优化 (--fast)",
        "type": "bool",
        "help": "启用 ComfyUI 实验性加速，可能提升推理速度 10-20%，极少数工作流可能不兼容",
        "flag": "--fast",
    },
    "preview_method": {
        "label": "预览方式",
        "type": "select",
        "help": "生成过程中的实时预览方式。TAESD 效果最好但稍慢，Latent2RGB 最快但模糊",
        "options": [
            ("auto", "自动"), ("none", "无"),
            ("latent2rgb", "Latent2RGB"), ("taesd", "TAESD"),
        ],
        "flag_prefix": "--preview-method",
    },
    "cache": {
        "label": "缓存策略",
        "type": "select",
        "help": "控制节点输出缓存。LRU 精细控制缓存大小，经典模式激进缓存更快但占更多内存",
        "options": [
            ("default", "默认"), ("classic", "经典 (Aggressive)"),
            ("lru", "LRU"), ("none", "禁用"),
        ],
        "flag_map": {
            "classic": "--cache-classic", "none": "--cache-none",
        },
    },
    "cache_lru_size": {
        "label": "LRU 缓存大小",
        "type": "number",
        "help": "LRU 缓存最大条目数，0 = 无限制。建议根据可用内存设置",
        "flag_prefix": "--cache-lru",
        "depends_on": {"cache": "lru"},
    },
}

# Reverse lookup: flag -> (group_key, value)
_FLAG_TO_PARAM = {}
for _gk, _gv in COMFYUI_PARAM_GROUPS.items():
    if _gv["type"] == "bool":
        _FLAG_TO_PARAM[_gv["flag"]] = (_gk, True)
    elif "flag_map" in _gv:
        for _val, _flag in _gv["flag_map"].items():
            _FLAG_TO_PARAM[_flag] = (_gk, _val)


def _parse_comfyui_args(args):
    """从命令行参数列表解析为结构化参数字典"""
    params = {k: (False if v["type"] == "bool" else 0 if v["type"] == "number" else "default")
              for k, v in COMFYUI_PARAM_GROUPS.items()}
    params["listen"] = "0.0.0.0"
    params["port"] = 8188

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--listen" and i + 1 < len(args):
            params["listen"] = args[i + 1]; i += 2; continue
        elif a == "--port" and i + 1 < len(args):
            params["port"] = int(args[i + 1]); i += 2; continue
        elif a == "--preview-method" and i + 1 < len(args):
            params["preview_method"] = args[i + 1]; i += 2; continue
        elif a == "--cache-lru" and i + 1 < len(args):
            params["cache"] = "lru"
            params["cache_lru_size"] = int(args[i + 1]); i += 2; continue
        elif a in _FLAG_TO_PARAM:
            gk, val = _FLAG_TO_PARAM[a]
            params[gk] = val
        i += 1
    return params


def _build_comfyui_args(params):
    """从结构化参数字典构建命令行参数字符串"""
    args = ["--listen", params.get("listen", "0.0.0.0"),
            "--port", str(params.get("port", 8188))]

    for gk, gv in COMFYUI_PARAM_GROUPS.items():
        val = params.get(gk)
        if val is None or val == "default" or val is False:
            continue
        if gv["type"] == "bool" and val:
            args.append(gv["flag"])
        elif gv["type"] == "select" and "flag_map" in gv and val in gv["flag_map"]:
            args.append(gv["flag_map"][val])
        elif gv["type"] == "select" and "flag_prefix" in gv and val != "default":
            args.extend([gv["flag_prefix"], str(val)])
        elif gv["type"] == "number" and "flag_prefix" in gv and val is not None:
            # val=0 对 --cache-lru 仍有意义 (无限制)，只跳过初始默认值 0
            if gk == "cache_lru_size" and params.get("cache") != "lru":
                continue  # cache 不是 LRU 模式时不输出
            args.extend([gv["flag_prefix"], str(int(val))])

    return " ".join(args)


@app.route("/api/comfyui/status")
def api_comfyui_status():
    """获取 ComfyUI 系统状态 + 当前启动参数"""
    result = {"online": False, "system": {}, "devices": [], "params": {}, "args": []}
    # 系统状态 from ComfyUI
    try:
        resp = requests.get(f"{COMFYUI_URL}/system_stats", timeout=5)
        data = resp.json()
        result["online"] = True
        result["system"] = data.get("system", {})
        result["devices"] = data.get("devices", [])
    except Exception:
        pass
    # 当前启动参数 from PM2
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        procs = json.loads(r.stdout or "[]")
        comfy = next((p for p in procs if p.get("name") == "comfy"), None)
        if comfy:
            pm2_env = comfy.get("pm2_env", {})
            raw_args = pm2_env.get("args", [])
            if isinstance(raw_args, str):
                raw_args = raw_args.split()
            result["args"] = raw_args
            result["params"] = _parse_comfyui_args(raw_args)
            result["pm2_status"] = pm2_env.get("status", "unknown")
            result["pm2_restarts"] = pm2_env.get("restart_time", 0)
            result["pm2_uptime"] = pm2_env.get("pm_uptime", 0)
    except Exception:
        pass
    return jsonify(result)


@app.route("/api/comfyui/params", methods=["GET"])
def api_comfyui_params_get():
    """获取参数定义 + 当前值"""
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        procs = json.loads(r.stdout or "[]")
        comfy = next((p for p in procs if p.get("name") == "comfy"), None)
        raw_args = []
        if comfy:
            raw_args = comfy.get("pm2_env", {}).get("args", [])
            if isinstance(raw_args, str):
                raw_args = raw_args.split()
        current = _parse_comfyui_args(raw_args)
        # Build schema for frontend
        schema = {}
        for gk, gv in COMFYUI_PARAM_GROUPS.items():
            schema[gk] = {
                "label": gv["label"], "type": gv["type"],
                "value": current.get(gk),
            }
            if "options" in gv:
                schema[gk]["options"] = gv["options"]
            if "depends_on" in gv:
                schema[gk]["depends_on"] = gv["depends_on"]
            if "help" in gv:
                schema[gk]["help"] = gv["help"]
            if "flag" in gv:
                schema[gk]["flag"] = gv["flag"]
            if "flag_map" in gv:
                schema[gk]["flag_map"] = gv["flag_map"]
            if "flag_prefix" in gv:
                schema[gk]["flag_prefix"] = gv["flag_prefix"]
        return jsonify({"schema": schema, "current": current, "raw_args": raw_args})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/comfyui/params", methods=["POST"])
def api_comfyui_params_update():
    """更新 ComfyUI 启动参数并重启"""
    data = request.get_json()
    params = data.get("params", {})
    extra_args = data.get("extra_args", "").strip()
    args_str = _build_comfyui_args(params)
    if extra_args:
        args_str = args_str + " " + extra_args

    # 查找 Python 路径
    py = "/usr/bin/python3.13"
    for candidate in ["/usr/bin/python3.13", "/usr/bin/python3.12",
                      "/usr/bin/python3.11", "/usr/bin/python3"]:
        if os.path.isfile(candidate):
            py = candidate
            break

    try:
        subprocess.run("pm2 delete comfy 2>/dev/null || true",
                       shell=True, timeout=10)
        cmd = (
            f'cd /workspace/ComfyUI && pm2 start {py} --name comfy '
            f'--interpreter none --log /workspace/comfy.log --time '
            f'--restart-delay 3000 --max-restarts 10 '
            f'-- main.py {args_str}'
        )
        subprocess.run(cmd, shell=True, timeout=30, check=True)
        subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=5)
        return jsonify({"ok": True, "args": args_str})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/comfyui/queue")
def api_comfyui_queue():
    """获取 ComfyUI 任务队列"""
    try:
        resp = requests.get(f"{COMFYUI_URL}/queue", timeout=5)
        return jsonify(resp.json())
    except Exception:
        return jsonify({"queue_running": [], "queue_pending": [], "error": "ComfyUI 无法连接"})


@app.route("/api/comfyui/interrupt", methods=["POST"])
def api_comfyui_interrupt():
    """中断当前执行"""
    try:
        requests.post(f"{COMFYUI_URL}/interrupt", timeout=5)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "ComfyUI 无法连接"}), 503


@app.route("/api/comfyui/free", methods=["POST"])
def api_comfyui_free():
    """释放 VRAM / 卸载模型"""
    try:
        requests.post(f"{COMFYUI_URL}/free",
                      json={"unload_models": True, "free_memory": True}, timeout=10)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "ComfyUI 无法连接"}), 503


@app.route("/api/comfyui/history")
def api_comfyui_history():
    """获取最近生成记录"""
    max_items = request.args.get("max_items", 5, type=int)
    try:
        resp = requests.get(f"{COMFYUI_URL}/history",
                            params={"max_items": max_items}, timeout=10)
        raw = resp.json()
        # Convert from dict {prompt_id: {outputs, status}} to sorted list
        items = []
        for pid, entry in raw.items():
            status = entry.get("status", {})
            outputs = entry.get("outputs", {})
            # Find output images
            images = []
            for node_id, node_out in outputs.items():
                for img in node_out.get("images", []):
                    images.append({
                        "filename": img.get("filename", ""),
                        "subfolder": img.get("subfolder", ""),
                        "type": img.get("type", "output"),
                    })
            items.append({
                "prompt_id": pid,
                "completed": status.get("completed", False),
                "images": images,
                "timestamp": status.get("status_str_start_time", ""),
            })
        # Sort by timestamp desc
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return jsonify({"history": items[:max_items]})
    except Exception:
        return jsonify({"history": [], "error": "ComfyUI 无法连接"})


@app.route("/api/comfyui/view")
def api_comfyui_view():
    """代理 ComfyUI 图片查看 (用于缩略图)"""
    filename = request.args.get("filename", "")
    subfolder = request.args.get("subfolder", "")
    img_type = request.args.get("type", "output")
    preview = request.args.get("preview", "")
    if not filename:
        return "", 400
    try:
        params = {"filename": filename, "type": img_type}
        if subfolder:
            params["subfolder"] = subfolder
        if preview:
            params["preview"] = preview
        resp = requests.get(f"{COMFYUI_URL}/view", params=params,
                            timeout=10, stream=True)
        return resp.content, resp.status_code, {
            "Content-Type": resp.headers.get("Content-Type", "image/png")
        }
    except Exception:
        return "", 503


# ====================================================================
#   ComfyUI WebSocket → SSE 实时事件推送
# ====================================================================

import websocket  # websocket-client

class ComfyWSBridge:
    """Maintains a WebSocket connection to ComfyUI and broadcasts events via SSE."""

    def __init__(self, comfyui_url):
        self._ws_url = comfyui_url.replace("http://", "ws://").replace("https://", "wss://")
        self._client_id = str(uuid.uuid4())
        self._subscribers = {}   # id -> queue.Queue
        self._lock = threading.Lock()
        self._ws = None
        self._running = False
        self._thread = None
        # Latest state cache for new subscribers
        self._last_status = None
        self._last_progress = None
        self._exec_info = {}     # Current execution info

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def _run_loop(self):
        """Reconnect loop — keeps trying to connect to ComfyUI WS."""
        while self._running:
            try:
                url = f"{self._ws_url}/ws?clientId={self._client_id}"
                self._ws = websocket.WebSocketApp(
                    url,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                    on_open=self._on_open,
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception:
                pass
            if self._running:
                time.sleep(3)  # Wait before reconnect

    def _on_open(self, ws):
        self._broadcast({"type": "ws_connected"})

    def _on_error(self, ws, error):
        pass  # Will reconnect in _run_loop

    def _on_close(self, ws, close_status_code=None, close_msg=None):
        self._broadcast({"type": "ws_disconnected"})

    def _on_message(self, ws, message):
        if isinstance(message, bytes):
            # Binary = preview image, skip for SSE (too large)
            return
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            msg_data = data.get("data", {})

            if msg_type == "status":
                q_info = msg_data.get("status", {}).get("exec_info", {})
                q_remaining = q_info.get("queue_remaining", 0)
                old_remaining = (self._last_status or {}).get("status", {}).get(
                    "exec_info", {}).get("queue_remaining", 0)

                # Detect execution start/end from queue transitions
                if old_remaining == 0 and q_remaining > 0 and not self._exec_info:
                    self._exec_info = {"start_time": time.time()}
                    self._broadcast({"type": "execution_start", "data": {
                        "start_time": self._exec_info["start_time"]
                    }})
                elif q_remaining == 0 and self._exec_info:
                    elapsed = time.time() - self._exec_info.get("start_time", time.time())
                    self._broadcast({"type": "execution_done", "data": {
                        "elapsed": round(elapsed, 1)
                    }})
                    self._exec_info = {}
                    self._last_progress = None

                self._last_status = msg_data
                self._broadcast({"type": "status", "data": msg_data})

            elif msg_type == "crystools.monitor":
                # Real-time GPU/CPU/RAM stats from Crystools plugin
                self._broadcast({"type": "monitor", "data": msg_data})

            elif msg_type in ("execution_start", "executing", "progress",
                              "executed", "execution_error", "execution_cached",
                              "execution_success"):
                # These are normally only sent to the prompt submitter,
                # but forward them if we somehow receive them
                if msg_type == "progress":
                    val = msg_data.get("value", 0)
                    mx = msg_data.get("max", 1)
                    self._last_progress = {"value": val, "max": mx,
                                           "percent": round(val / mx * 100) if mx > 0 else 0}
                    self._broadcast({"type": "progress", "data": self._last_progress})
                elif msg_type == "execution_error":
                    self._broadcast({"type": "execution_error", "data": msg_data})
                    self._exec_info = {}
                    self._last_progress = None
                else:
                    self._broadcast({"type": msg_type, "data": msg_data})

        except Exception:
            pass

    def subscribe(self):
        """Add a new SSE subscriber and return (sub_id, queue)."""
        sub_id = str(uuid.uuid4())
        q = queue.Queue(maxsize=200)
        with self._lock:
            self._subscribers[sub_id] = q
        # Send cached state to new subscriber
        if self._last_status:
            q.put({"type": "status", "data": self._last_status})
        if self._exec_info:
            q.put({"type": "executing", "data": self._exec_info})
        if self._last_progress:
            q.put({"type": "progress", "data": self._last_progress})
        return sub_id, q

    def unsubscribe(self, sub_id):
        with self._lock:
            self._subscribers.pop(sub_id, None)

    def _broadcast(self, event):
        with self._lock:
            dead = []
            for sid, q in self._subscribers.items():
                try:
                    q.put_nowait(event)
                except queue.Full:
                    dead.append(sid)
            for sid in dead:
                self._subscribers.pop(sid, None)


# Global WebSocket bridge instance
_comfy_ws_bridge = ComfyWSBridge(COMFYUI_URL)
_comfy_ws_bridge.start()


@app.route("/api/comfyui/events")
def api_comfyui_events():
    """SSE endpoint — streams real-time ComfyUI events to the frontend."""
    sub_id, q = _comfy_ws_bridge.subscribe()

    def generate():
        try:
            while True:
                try:
                    event = q.get(timeout=30)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    # Send keepalive
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            _comfy_ws_bridge.unsubscribe(sub_id)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@app.route("/api/comfyui/logs/stream")
def api_comfyui_logs_stream():
    """SSE endpoint — streams pm2 log lines for comfy in real-time."""
    def generate():
        proc = None
        try:
            # Use pm2 logs --raw --lines 0 to get only new lines
            proc = subprocess.Popen(
                ["pm2", "logs", "comfy", "--raw", "--lines", "50"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1
            )
            for line in iter(proc.stdout.readline, ''):
                if not line:
                    break
                line = line.rstrip('\n')
                if not line:
                    continue
                # Classify log level
                lvl = "info"
                if re.search(r'error|exception|traceback', line, re.I):
                    lvl = "error"
                elif re.search(r'warn', line, re.I):
                    lvl = "warn"
                yield f"data: {json.dumps({'line': line, 'level': lvl}, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            pass
        finally:
            if proc:
                try:
                    proc.kill()
                    proc.stdout.close()
                    proc.wait(timeout=5)
                except Exception:
                    pass

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@app.route("/api/plugins/installed")
def api_plugins_installed():
    """获取已安装插件列表"""
    r = _cm_get("/customnode/installed", params={"mode": "default"})
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI，请确认 ComfyUI 正在运行"}), 502
    if r.status_code != 200:
        return jsonify({"error": f"ComfyUI-Manager 返回 {r.status_code}"}), r.status_code
    try:
        return jsonify(r.json())
    except Exception:
        return jsonify({"error": "解析响应失败"}), 500


@app.route("/api/plugins/available")
def api_plugins_available():
    """获取所有可用插件列表(含安装状态)"""
    r = _cm_get("/customnode/getlist", params={"mode": "remote", "skip_update": "true"}, timeout=60)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI，请确认 ComfyUI 正在运行"}), 502
    if r.status_code != 200:
        return jsonify({"error": f"ComfyUI-Manager 返回 {r.status_code}"}), r.status_code
    try:
        return jsonify(r.json())
    except Exception:
        return jsonify({"error": "解析响应失败"}), 500


@app.route("/api/plugins/versions/<path:node_name>")
def api_plugins_versions(node_name):
    """获取某插件所有可用版本"""
    r = _cm_get(f"/customnode/versions/{node_name}")
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    if r.status_code != 200:
        return jsonify({"error": f"返回 {r.status_code}"}), r.status_code
    try:
        return jsonify(r.json())
    except Exception:
        return jsonify({"error": "解析响应失败"}), 500


@app.route("/api/plugins/fetch_updates")
def api_plugins_fetch_updates():
    """拉取更新信息 (git fetch)"""
    r = _cm_get("/customnode/fetch_updates", params={"mode": "remote"}, timeout=120)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    # 200=无更新, 201=有更新可用
    return jsonify({"has_updates": r.status_code == 201, "status_code": r.status_code})


@app.route("/api/plugins/install", methods=["POST"])
def api_plugins_install():
    """安装插件 (排入队列)"""
    data = request.get_json(force=True) or {}
    payload = {
        "id": data.get("id", ""),
        "version": data.get("version", "unknown"),
        "selected_version": data.get("selected_version", "latest"),
        "channel": "default",
        "mode": "remote",
        "ui_id": f"dash-{int(time.time())}",
        "skip_post_install": False,
    }
    if data.get("repository"):
        payload["repository"] = data["repository"]
    if data.get("files"):
        payload["files"] = data["files"]
    r = _cm_post("/manager/queue/install", json_data=payload)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    if r.status_code not in (200, 201):
        return jsonify({"error": f"安装请求失败: {r.status_code}"}), r.status_code
    # 自动启动队列处理
    _cm_get("/manager/queue/start")
    return jsonify({"ok": True, "message": "已加入安装队列"})


@app.route("/api/plugins/uninstall", methods=["POST"])
def api_plugins_uninstall():
    """卸载插件"""
    data = request.get_json(force=True) or {}
    payload = {
        "id": data.get("id", ""),
        "version": data.get("version", "unknown"),
        "ui_id": f"dash-{int(time.time())}",
    }
    if data.get("files"):
        payload["files"] = data["files"]
    r = _cm_post("/manager/queue/uninstall", json_data=payload)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    if r.status_code not in (200, 201):
        return jsonify({"error": f"卸载请求失败: {r.status_code}"}), r.status_code
    _cm_get("/manager/queue/start")
    return jsonify({"ok": True, "message": "已加入卸载队列"})


@app.route("/api/plugins/update", methods=["POST"])
def api_plugins_update():
    """更新插件"""
    data = request.get_json(force=True) or {}
    payload = {
        "id": data.get("id", ""),
        "version": data.get("version", "unknown"),
        "ui_id": f"dash-{int(time.time())}",
    }
    r = _cm_post("/manager/queue/update", json_data=payload)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    if r.status_code not in (200, 201):
        return jsonify({"error": f"更新请求失败: {r.status_code}"}), r.status_code
    _cm_get("/manager/queue/start")
    return jsonify({"ok": True, "message": "已加入更新队列"})


@app.route("/api/plugins/update_all", methods=["POST"])
def api_plugins_update_all():
    """一键更新所有插件"""
    r = _cm_get("/manager/queue/update_all", params={"mode": "remote"}, timeout=120)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    _cm_get("/manager/queue/start")
    return jsonify({"ok": True, "message": "所有插件已加入更新队列"})


@app.route("/api/plugins/disable", methods=["POST"])
def api_plugins_disable():
    """禁用/启用插件"""
    data = request.get_json(force=True) or {}
    payload = {
        "id": data.get("id", ""),
        "version": data.get("version", "unknown"),
        "ui_id": f"dash-{int(time.time())}",
    }
    r = _cm_post("/manager/queue/disable", json_data=payload)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    if r.status_code not in (200, 201):
        return jsonify({"error": f"操作失败: {r.status_code}"}), r.status_code
    _cm_get("/manager/queue/start")
    return jsonify({"ok": True, "message": "操作已提交"})


@app.route("/api/plugins/install_git", methods=["POST"])
def api_plugins_install_git():
    """通过 Git URL 直接安装"""
    data = request.get_json(force=True) or {}
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL 不能为空"}), 400
    r = _cm_post("/customnode/install/git_url", text_data=url, timeout=120)
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    if r.status_code not in (200, 201):
        return jsonify({"error": f"安装失败: {r.status_code}"}), r.status_code
    return jsonify({"ok": True, "message": "Git URL 安装完成"})


@app.route("/api/plugins/queue_status")
def api_plugins_queue_status():
    """查询队列状态"""
    r = _cm_get("/manager/queue/status")
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    try:
        return jsonify(r.json())
    except Exception:
        return jsonify({"total_count": 0, "done_count": 0, "in_progress_count": 0, "is_processing": False})


@app.route("/api/plugins/manager_version")
def api_plugins_manager_version():
    """获取 ComfyUI-Manager 版本"""
    r = _cm_get("/manager/version")
    if r is None:
        return jsonify({"error": "无法连接 ComfyUI"}), 502
    return jsonify({"version": r.text.strip()})


# ====================================================================
# Settings API (密码 / 配置管理)
# ====================================================================

@app.route("/api/settings", methods=["GET"])
def api_settings_get():
    """返回当前设置概览"""
    api_key = _get_api_key()
    return jsonify({
        "password_set": bool(DASHBOARD_PASSWORD),
        "password_masked": DASHBOARD_PASSWORD[:2] + "***" if DASHBOARD_PASSWORD and len(DASHBOARD_PASSWORD) > 2 else "***",
        "civitai_key_set": bool(api_key),
        "civitai_key_masked": api_key[:6] + "..." if api_key and len(api_key) > 6 else ("已设置" if api_key else ""),
    })


@app.route("/api/settings/password", methods=["POST"])
def api_settings_password():
    """修改 Dashboard 密码"""
    global DASHBOARD_PASSWORD
    data = request.get_json(force=True) or {}
    current = data.get("current", "")
    new_pw = data.get("new", "").strip()

    if not new_pw:
        return jsonify({"error": "新密码不能为空"}), 400
    if len(new_pw) < 4:
        return jsonify({"error": "密码至少 4 个字符"}), 400
    if current != DASHBOARD_PASSWORD:
        return jsonify({"error": "当前密码错误"}), 403

    DASHBOARD_PASSWORD = new_pw
    _save_dashboard_password(new_pw)
    return jsonify({"ok": True, "message": "密码已更新并持久化保存"})


@app.route("/api/settings/restart", methods=["POST"])
def api_settings_restart():
    """重启 Dashboard (pm2 restart dashboard，延迟执行)"""
    import threading
    def _do_restart():
        import time; time.sleep(1)
        subprocess.run("pm2 restart dashboard", shell=True, timeout=15)
    threading.Thread(target=_do_restart, daemon=True).start()
    return jsonify({"ok": True, "message": "Dashboard 正在重启..."})


@app.route("/api/settings/debug", methods=["GET"])
def api_settings_debug_get():
    """获取 debug 模式状态"""
    return jsonify({"debug": _get_config("debug", False)})


@app.route("/api/settings/debug", methods=["POST"])
def api_settings_debug_set():
    """切换 debug 模式"""
    data = request.get_json(force=True) or {}
    enabled = bool(data.get("enabled", False))
    _set_config("debug", enabled)
    return jsonify({"ok": True, "debug": enabled})


@app.route("/api/settings/export-config")
def api_settings_export_config():
    """导出所有配置为 JSON 文件"""
    import base64 as _b64
    config = {"_version": 1, "_exported_at": datetime.now().isoformat()}

    # 1. Dashboard 密码
    config["password"] = DASHBOARD_PASSWORD

    # 2. CivitAI API Key
    try:
        if CONFIG_FILE.exists():
            config["civitai_token"] = json.loads(CONFIG_FILE.read_text()).get("api_key", "")
    except Exception:
        pass

    # 3. 部署模式
    state = _load_setup_state()
    config["image_type"] = state.get("image_type", "")

    # 4. Cloudflare Tunnel Token
    config["cloudflared_token"] = state.get("cloudflared_token", "")

    # 5. Rclone 配置 (Base64 编码)
    rclone_conf = Path.home() / ".config" / "rclone" / "rclone.conf"
    if rclone_conf.exists():
        try:
            config["rclone_config_base64"] = _b64.b64encode(
                rclone_conf.read_bytes()
            ).decode("ascii")
        except Exception:
            pass

    # 6. 插件列表 — 分离: 默认插件 + 额外插件
    default_urls = {p["url"] for p in DEFAULT_PLUGINS}
    all_plugins = state.get("plugins", [])
    config["extra_plugins"] = [u for u in all_plugins if u not in default_urls]
    # 也保存用户对默认插件的取消选择 (如果有)
    config["disabled_default_plugins"] = [u for u in default_urls if u not in all_plugins]

    # 7. 同步规则 (v2) + 旧版同步偏好 (向后兼容)
    if SYNC_RULES_FILE.exists():
        try:
            config["sync_rules"] = json.loads(SYNC_RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    sync_prefs_file = Path("/workspace/.sync_prefs.json")
    if sync_prefs_file.exists():
        try:
            config["sync_prefs"] = json.loads(sync_prefs_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    # 8. ComfyUI 启动参数
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True,
                           capture_output=True, text=True, timeout=5)
        procs = json.loads(r.stdout or "[]")
        comfy = next((p for p in procs if p.get("name") == "comfy"), None)
        if comfy:
            raw_args = comfy.get("pm2_env", {}).get("args", [])
            if isinstance(raw_args, str):
                raw_args = raw_args.split()
            config["comfyui_params"] = _parse_comfyui_args(raw_args)
    except Exception:
        pass

    # 9. Debug 模式
    config["debug"] = _get_config("debug", False)

    return Response(
        json.dumps(config, indent=2, ensure_ascii=False),
        mimetype="application/json",
        headers={
            "Content-Disposition": "attachment; filename=comfyui-config.json",
            "Cache-Control": "no-cache"
        }
    )


@app.route("/api/settings/import-config", methods=["POST"])
def api_settings_import_config():
    """导入配置 JSON — 合并覆盖现有设置"""
    import base64 as _b64

    data = request.get_json(force=True) or {}
    if not data:
        return jsonify({"error": "无效的配置文件"}), 400

    applied = []
    errors = []

    # 1. 密码
    if data.get("password"):
        try:
            global DASHBOARD_PASSWORD
            DASHBOARD_PASSWORD = data["password"]
            _save_dashboard_password(data["password"])
            applied.append("Dashboard 密码")
        except Exception as e:
            errors.append(f"密码: {e}")

    # 2. CivitAI API Key
    if data.get("civitai_token"):
        try:
            CONFIG_FILE.write_text(json.dumps({"api_key": data["civitai_token"]}))
            applied.append("CivitAI API Key")
        except Exception as e:
            errors.append(f"CivitAI: {e}")

    # 3. Rclone 配置
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

    # 4. 同步规则 (v2) / 旧版同步偏好
    if data.get("sync_rules"):
        try:
            SYNC_RULES_FILE.write_text(
                json.dumps(data["sync_rules"], indent=2, ensure_ascii=False), encoding="utf-8"
            )
            applied.append("同步规则")
        except Exception as e:
            errors.append(f"同步规则: {e}")
    if data.get("sync_prefs"):
        try:
            Path("/workspace/.sync_prefs.json").write_text(
                json.dumps(data["sync_prefs"], indent=2, ensure_ascii=False), encoding="utf-8"
            )
            applied.append("同步偏好 (旧版)")
        except Exception as e:
            errors.append(f"同步偏好: {e}")

    # 5. Debug 模式
    if "debug" in data:
        _set_config("debug", bool(data["debug"]))
        applied.append("Debug 模式")

    # 6. Setup Wizard 状态 (image_type, plugins, tunnel token)
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
        # 合并插件列表
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

    # 7. ComfyUI 启动参数 (只在 ComfyUI 运行中时生效)
    if data.get("comfyui_params"):
        try:
            # 参数将在下次启动/重启时通过 API 应用
            applied.append("ComfyUI 启动参数 (需重启 ComfyUI 生效)")
        except Exception as e:
            errors.append(f"ComfyUI 参数: {e}")

    return jsonify({
        "ok": True,
        "applied": applied,
        "errors": errors,
        "message": f"已导入 {len(applied)} 项配置" + (f", {len(errors)} 项失败" if errors else "")
    })


@app.route("/api/settings/reinitialize", methods=["POST"])
def api_settings_reinitialize():
    """重新初始化 — 停止服务, 清理 ComfyUI, 重置向导状态, 进入 Setup Wizard

    保留: apt/pip 已安装的包 (system_deps, pytorch), Tunnel (如无变更)
    删除: ComfyUI 目录 (可选保留 models), 自定义节点, 部署状态
    """
    data = request.get_json(force=True) or {}
    keep_models = bool(data.get("keep_models", False))

    errors = []

    # 1. 停止 ComfyUI 和 sync 服务
    try:
        _stop_sync_worker()
        subprocess.run("pm2 delete comfy 2>/dev/null || true", shell=True, timeout=15)
        subprocess.run("pm2 delete sync 2>/dev/null || true", shell=True, timeout=15)
    except Exception as e:
        errors.append(f"停止服务失败: {e}")

    # 2. 清理 ComfyUI 目录
    comfy_dir = Path(COMFYUI_DIR)
    if comfy_dir.exists():
        try:
            if keep_models:
                # 保留 models 目录, 删除其他
                models_tmp = Path("/workspace/.models_backup")
                models_src = comfy_dir / "models"
                if models_src.exists():
                    subprocess.run(f'mv "{models_src}" "{models_tmp}"', shell=True, timeout=60)
                subprocess.run(f'rm -rf "{comfy_dir}"', shell=True, timeout=120)
                if models_tmp.exists():
                    comfy_dir.mkdir(parents=True, exist_ok=True)
                    subprocess.run(f'mv "{models_tmp}" "{models_src}"', shell=True, timeout=60)
            else:
                subprocess.run(f'rm -rf "{comfy_dir}"', shell=True, timeout=120)
        except Exception as e:
            errors.append(f"清理 ComfyUI 目录失败: {e}")

    # 3. 清理生成的脚本和同步配置
    for f in [Path("/workspace/cloud_sync.sh"), Path("/workspace/.sync_prefs.json"), Path("/workspace/.sync_rules.json")]:
        try:
            if f.exists():
                f.unlink()
        except Exception:
            pass

    # 4. 重置 Setup Wizard 状态 — 保留 system_deps 和 pytorch 步骤标记
    try:
        preserved_steps = []
        if SETUP_STATE_FILE.exists():
            old_state = _load_setup_state()
            for step_key in ("system_deps", "pytorch"):
                if step_key in old_state.get("deploy_steps_completed", []):
                    preserved_steps.append(step_key)
        # 删除旧状态文件, 写入仅含保留步骤的干净状态
        if SETUP_STATE_FILE.exists():
            SETUP_STATE_FILE.unlink()
        if preserved_steps:
            new_state = _load_setup_state()  # 获取默认值
            new_state["deploy_steps_completed"] = preserved_steps
            _save_setup_state(new_state)
    except Exception as e:
        errors.append(f"重置状态失败: {e}")

    # 5. 保存 PM2 配置
    subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=15)

    if errors:
        return jsonify({"ok": False, "errors": errors}), 500
    return jsonify({"ok": True, "message": "已重置, 请刷新页面进入 Setup Wizard"})


# ====================================================================
# Setup Wizard API
# ====================================================================
_deploy_thread = None
_deploy_log_lines = []       # 实时日志行缓冲, SSE 消费
_deploy_log_lock = threading.Lock()


def _detect_image_type():
    """检测当前环境是 prebuilt 还是 generic 镜像
    预构建镜像在 /opt/ComfyUI/ 保存了 ComfyUI 副本,
    部署时复制到 /workspace/ComfyUI/"""
    opt_comfyui = Path("/opt/ComfyUI/main.py")
    if opt_comfyui.exists():
        return "prebuilt"
    return "generic"


@app.route("/api/setup/state")
def api_setup_state():
    """获取向导状态"""
    state = _load_setup_state()
    # 不返回敏感值的完整内容
    safe = {k: v for k, v in state.items() if k != "deploy_log"}
    safe["has_rclone_config"] = bool(state.get("rclone_config_value"))
    safe["rclone_config_value"] = ""   # 不暴露
    safe["plugins_available"] = DEFAULT_PLUGINS
    # GPU 信息 (如果 torch 可用)
    safe["gpu_info"] = _detect_gpu_info()
    # 镜像类型自动检测
    safe["detected_image_type"] = _detect_image_type()
    # 环境变量预填充 — 让向导自动检测已设置的值
    env_vars = {}
    if os.environ.get("DASHBOARD_PASSWORD"):
        env_vars["password"] = os.environ["DASHBOARD_PASSWORD"]
    if os.environ.get("CF_TUNNEL_TOKEN"):
        env_vars["cloudflared_token"] = os.environ["CF_TUNNEL_TOKEN"]
    if os.environ.get("CIVITAI_TOKEN"):
        env_vars["civitai_token"] = os.environ["CIVITAI_TOKEN"]
    if os.environ.get("RCLONE_CONF_BASE64"):
        env_vars["rclone_config_method"] = "base64"
        env_vars["rclone_has_env"] = True  # 不暴露完整值
    safe["env_vars"] = env_vars
    return jsonify(safe)


@app.route("/api/setup/save", methods=["POST"])
def api_setup_save():
    """保存向导某一步的配置"""
    data = request.get_json(force=True)
    state = _load_setup_state()
    # 合并前端提交的字段
    allowed_keys = {
        "current_step", "image_type", "password",
        "cloudflared_token", "rclone_config_method", "rclone_config_value",
        "civitai_token", "plugins", "sync_options",
    }
    for k, v in data.items():
        if k in allowed_keys:
            state[k] = v
    _save_setup_state(state)
    return jsonify({"ok": True})


@app.route("/api/setup/plugins")
def api_setup_plugins():
    """返回默认插件列表"""
    return jsonify({"plugins": DEFAULT_PLUGINS})


_deploy_lock = threading.Lock()


@app.route("/api/setup/deploy", methods=["POST"])
def api_setup_deploy():
    """开始部署 — 在后台线程执行全部安装逻辑"""
    global _deploy_thread
    with _deploy_lock:
        if _deploy_thread and _deploy_thread.is_alive():
            return jsonify({"error": "部署已在进行中"}), 409

        state = _load_setup_state()
        state["deploy_started"] = True
        state["deploy_completed"] = False
        state["deploy_error"] = ""
        # 保留 deploy_steps_completed 以支持智能重试
        _save_setup_state(state)

        with _deploy_log_lock:
            _deploy_log_lines.clear()

        _deploy_thread = threading.Thread(target=_run_deploy, args=(dict(state),), daemon=True)
        _deploy_thread.start()
    return jsonify({"ok": True, "message": "部署已启动"})


@app.route("/api/setup/log_stream")
def api_setup_log_stream():
    """SSE 实时日志流"""
    def generate():
        idx = 0
        while True:
            with _deploy_log_lock:
                new_lines = _deploy_log_lines[idx:]
                idx = len(_deploy_log_lines)
            for line in new_lines:
                yield f"data: {json.dumps(line, ensure_ascii=False)}\n\n"
            # 检查是否结束
            state = _load_setup_state()
            if state.get("deploy_completed") and idx >= len(_deploy_log_lines):
                yield f"data: {json.dumps({'type': 'done', 'success': True}, ensure_ascii=False)}\n\n"
                break
            if not _deploy_thread or not _deploy_thread.is_alive():
                if not state.get("deploy_completed"):
                    error_msg = state.get("deploy_error") or "部署进程异常终止"
                    yield f"data: {json.dumps({'type': 'done', 'success': False, 'msg': error_msg}, ensure_ascii=False)}\n\n"
                break
            time.sleep(0.5)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/setup/reset", methods=["POST"])
def api_setup_reset():
    """重置向导 (调试用)"""
    if SETUP_STATE_FILE.exists():
        SETUP_STATE_FILE.unlink()
    return jsonify({"ok": True})


def _detect_gpu_info():
    """检测 GPU 信息"""
    info = {"name": "", "cuda_cap": "", "vram_gb": 0}
    try:
        r = subprocess.run(
            'python3.13 -c "import torch; d=torch.cuda.get_device_properties(0); '
            'print(f\\"{d.name}|{d.major}.{d.minor}|{d.total_mem / 1073741824:.1f}\\")"',
            shell=True, capture_output=True, text=True, timeout=15
        )
        if r.returncode == 0 and "|" in r.stdout:
            parts = r.stdout.strip().split("|")
            info["name"] = parts[0]
            info["cuda_cap"] = parts[1]
            info["vram_gb"] = float(parts[2])
    except Exception:
        pass
    return info


# ── 部署执行引擎 ──
def _deploy_log(msg, level="info"):
    """向 SSE 推送一行日志"""
    entry = {"type": "log", "level": level, "msg": msg, "time": datetime.now().strftime("%H:%M:%S")}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)


def _deploy_step(name):
    """标记一个部署步骤开始"""
    entry = {"type": "step", "name": name, "time": datetime.now().strftime("%H:%M:%S")}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)


def _deploy_exec(cmd, timeout=600, label=""):
    """执行 shell 命令, 实时推送输出"""
    if label:
        _deploy_log(f"$ {label}")
    try:
        proc = subprocess.Popen(
            cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                _deploy_log(line, "output")
        proc.wait(timeout=timeout)
        if proc.returncode != 0:
            _deploy_log(f"命令退出码: {proc.returncode}", "warn")
        return proc.returncode == 0
    except Exception as e:
        _deploy_log(f"执行失败: {e}", "error")
        if proc:
            try:
                proc.kill()
                proc.stdout.close()
                proc.wait(timeout=5)
            except Exception:
                pass
        return False


def _step_done(step_key):
    """检查某个部署步骤是否在上次尝试中已完成 (用于智能重试)"""
    state = _load_setup_state()
    return step_key in state.get("deploy_steps_completed", [])


def _mark_step_done(step_key):
    """标记步骤完成并持久化"""
    state = _load_setup_state()
    completed = state.get("deploy_steps_completed", [])
    if step_key not in completed:
        completed.append(step_key)
    state["deploy_steps_completed"] = completed
    _save_setup_state(state)


def _run_deploy(config):
    """主部署流程 — 在后台线程运行, 完整复刻 deploy.sh / deploy-prebuilt.sh 逻辑"""
    import base64 as _b64

    PY = "python3.13"
    PIP = f"{PY} -m pip"
    image_type = config.get("image_type", "generic")

    try:
        # ─────────────────────────────────────────────
        # STEP 1: 系统依赖
        # ─────────────────────────────────────────────
        if _step_done("system_deps"):
            _deploy_step("安装系统依赖 ✅ (已完成, 跳过)")
        else:
            _deploy_step("安装系统依赖")
            _deploy_log("正在安装系统依赖包...")
            _deploy_exec(
                "apt-get update -qq && "
                "apt-get install -y --no-install-recommends "
                "git git-lfs aria2 rclone jq curl ffmpeg libgl1 "
                "libglib2.0-0 libsm6 libxext6 build-essential",
                timeout=300, label="apt-get install"
            )

            # 将系统 python 指向 3.13 (保持原 deploy.sh 逻辑)
            py313 = subprocess.run("command -v python3.13", shell=True, capture_output=True, text=True).stdout.strip()
            if py313:
                _deploy_exec(f'ln -sf "{py313}" /usr/local/bin/python && ln -sf "{py313}" /usr/bin/python || true')
            _deploy_exec(f'{PIP} install --upgrade pip setuptools packaging ninja -q', label="pip upgrade")
            _mark_step_done("system_deps")

        # ─────────────────────────────────────────────
        # STEP 2: Cloudflare Tunnel
        # ─────────────────────────────────────────────
        cf_token = config.get("cloudflared_token", "")
        if cf_token:
            # 检查 tunnel 是否已在运行 (bootstrap 可能已启动)
            tunnel_pid = subprocess.run(
                "pm2 pid tunnel 2>/dev/null", shell=True, capture_output=True, text=True
            ).stdout.strip()
            tunnel_running = tunnel_pid and tunnel_pid != "0" and tunnel_pid.isdigit()

            if tunnel_running:
                _deploy_step("Cloudflare Tunnel (已在运行)")
                _deploy_log("Tunnel 已由 bootstrap 启动，跳过重启以保持连接稳定")
            else:
                _deploy_step("启动 Cloudflare Tunnel")
                # cloudflared 已在 bootstrap.sh 中安装
                _deploy_exec("pm2 delete tunnel 2>/dev/null || true")
                _deploy_exec(f'pm2 start cloudflared --name tunnel -- tunnel run --token "{cf_token}"')
                _deploy_log("Cloudflare Tunnel 已启动")

        # ─────────────────────────────────────────────
        # STEP 3: Rclone 配置
        # ─────────────────────────────────────────────
        rclone_method = config.get("rclone_config_method", "skip")
        rclone_value = config.get("rclone_config_value", "")
        # 支持 base64_env: 从环境变量 RCLONE_CONF_BASE64 读取
        if rclone_method == "base64_env":
            rclone_method = "base64"
            rclone_value = os.environ.get("RCLONE_CONF_BASE64", "")
        if rclone_method != "skip" and rclone_value:
            _deploy_step("配置 Rclone")
            _deploy_exec("mkdir -p ~/.config/rclone")
            if rclone_method == "url":
                _deploy_log(f"从 URL 下载 rclone.conf...")
                _deploy_exec(f'curl -fsSL "{rclone_value}" -o ~/.config/rclone/rclone.conf')
            elif rclone_method == "base64":
                _deploy_log("从 Base64 解码 rclone.conf...")
                try:
                    conf_text = _b64.b64decode(rclone_value).decode("utf-8")
                    Path.home().joinpath(".config/rclone/rclone.conf").write_text(conf_text, encoding="utf-8")
                except Exception as e:
                    _deploy_log(f"Base64 解码失败: {e}", "error")
            _deploy_exec("chmod 600 ~/.config/rclone/rclone.conf")
            _deploy_exec("rclone listremotes", label="检测 remotes")

        # ─────────────────────────────────────────────
        # STEP 4: PyTorch
        # ─────────────────────────────────────────────
        if image_type == "generic":
            if _step_done("pytorch"):
                _deploy_step("安装 PyTorch ✅ (已完成, 跳过)")
            else:
                _deploy_step("安装 PyTorch")
                TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
                _deploy_log("安装 torch 2.9.1 (CUDA 12.8)...")
                _deploy_exec(
                    f'{PIP} install --no-cache-dir torch==2.9.1 --index-url "{TORCH_INDEX}"',
                    timeout=600, label="pip install torch"
                )
                _deploy_exec(f'{PIP} install --no-cache-dir hf_transfer', label="hf_transfer")
                _mark_step_done("pytorch")
        else:
            _deploy_step("检查预装 PyTorch")
            _deploy_log("预构建镜像 — 跳过 torch 安装")
            _deploy_exec(f'{PY} -c "import torch; print(f\\"PyTorch {{torch.__version__}} CUDA {{torch.version.cuda}}\\")"')

        # ─────────────────────────────────────────────
        # STEP 5: ComfyUI
        # ─────────────────────────────────────────────
        if _step_done("comfyui_install"):
            _deploy_step("安装 ComfyUI ✅ (已完成, 跳过)")
            _deploy_step("ComfyUI 健康检查 ✅ (已完成, 跳过)")
        else:
            _deploy_step("安装 ComfyUI")
            if image_type == "prebuilt":
                # 预构建镜像: 从 /opt/ComfyUI 复制
                if not Path("/workspace/ComfyUI/main.py").exists():
                    _deploy_log("从镜像复制 ComfyUI...")
                    _deploy_exec("mkdir -p /workspace/ComfyUI && cp -r /opt/ComfyUI/* /workspace/ComfyUI/")
                else:
                    _deploy_log("ComfyUI 已存在, 跳过复制")
            else:
                # 通用镜像: git clone
                if Path("/workspace/ComfyUI").exists():
                    _deploy_exec("rm -rf /workspace/ComfyUI")
                _deploy_log("克隆 ComfyUI 仓库...")
                _deploy_exec("cd /workspace && git clone https://github.com/comfyanonymous/ComfyUI.git", timeout=120)
                _deploy_log("安装 ComfyUI 依赖...")
                _deploy_exec(f"cd /workspace/ComfyUI && {PIP} install --no-cache-dir -r requirements.txt", timeout=300)

            # 健康检查 (不加载插件, 仅验证 ComfyUI 核心能启动)
            _deploy_step("ComfyUI 健康检查")
            _deploy_log("启动首次健康检查 (跳过插件加载)...")
            _deploy_exec(f'cd /workspace/ComfyUI && {PY} main.py --listen 127.0.0.1 --port 8188 --disable-all-custom-nodes > /tmp/comfy_boot.log 2>&1 &')
            boot_ok = False
            for i in range(30):
                time.sleep(2)
                try:
                    log = Path("/tmp/comfy_boot.log").read_text(errors="ignore")
                    if "To see the GUI go to" in log:
                        boot_ok = True
                        break
                except Exception:
                    pass
                _deploy_log(f"等待 ComfyUI 启动... ({i+1}/30)")

            # 清理健康检查进程
            _deploy_exec("pkill -f 'main.py --listen 127.0.0.1 --port 8188 --disable-all-custom-nodes' 2>/dev/null; sleep 1", label="停止检查进程")

            if boot_ok:
                _deploy_log("✅ ComfyUI 健康检查通过")
            else:
                _deploy_log("❌ ComfyUI 健康检查失败!", "error")
                try:
                    err = Path("/tmp/comfy_boot.log").read_text(errors="ignore")[-500:]
                    _deploy_log(f"最后日志: {err}", "error")
                except Exception:
                    pass
                # 不中断, 继续后续步骤

            _mark_step_done("comfyui_install")

        # ─────────────────────────────────────────────
        # STEP 6: 加速组件 (FA3 / SA3)
        # ─────────────────────────────────────────────
        if image_type == "generic":
            if _step_done("accelerators"):
                _deploy_step("安装加速组件 ✅ (已完成, 跳过)")
            else:
                _deploy_step("安装加速组件 (FA3/SA3)")
                _deploy_log("检测 GPU 架构...")
                gpu_info = _detect_gpu_info()
                cuda_cap = gpu_info.get("cuda_cap", "0.0")
                cuda_major = int(cuda_cap.split(".")[0]) if cuda_cap else 0
                _deploy_log(f"GPU: {gpu_info.get('name', '?')} | CUDA Cap: {cuda_cap}")

                # Python 版本 tag
                py_ver_tag = subprocess.run(
                    f'{PY} -c "import sys; print(f\\"cp{{sys.version_info.major}}{{sys.version_info.minor}}\\")"',
                    shell=True, capture_output=True, text=True, timeout=5
                ).stdout.strip()

                # 下载预编译 wheels
                GH_WHEELS = "https://github.com/vvb7456/ComfyCarry/releases/download/v4.5-wheels"
                _deploy_exec("mkdir -p /workspace/prebuilt_wheels")
                _deploy_exec(
                    f'wget -q -O /workspace/prebuilt_wheels/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl '
                    f'"{GH_WHEELS}/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl" || true',
                    label="下载 FA3 wheel"
                )
                if py_ver_tag in ("cp313", "cp312"):
                    _deploy_exec(
                        f'wget -q -O /workspace/prebuilt_wheels/sageattn3-1.0.0-{py_ver_tag}-{py_ver_tag}-linux_x86_64.whl '
                        f'"{GH_WHEELS}/sageattn3-1.0.0-{py_ver_tag}-{py_ver_tag}-linux_x86_64.whl" || true',
                        label=f"下载 SA3 wheel ({py_ver_tag})"
                    )

                # FlashAttention 安装 (保持原 deploy.sh 逻辑)
                if cuda_major >= 9:
                    fa_wheel = "/workspace/prebuilt_wheels/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl"
                    if not _deploy_exec(f'[ -f "{fa_wheel}" ] && {PIP} install "{fa_wheel}"'):
                        _deploy_log("Wheel 不可用, 源码编译 FA3...", "warn")
                        _deploy_exec(
                            f'cd /workspace && git clone https://github.com/Dao-AILab/flash-attention.git && '
                            f'cd flash-attention/hopper && MAX_JOBS=8 {PY} setup.py install && '
                            f'cd /workspace && rm -rf flash-attention',
                            timeout=1200, label="编译 FA3"
                        )
                else:
                    _deploy_exec(f'{PIP} install --no-cache-dir flash-attn --no-build-isolation',
                                 timeout=600, label="安装 FA2")

                # SageAttention 安装 (保持原 deploy.sh 逻辑)
                if cuda_major >= 10:
                    sa_wheel = f"/workspace/prebuilt_wheels/sageattn3-1.0.0-{py_ver_tag}-{py_ver_tag}-linux_x86_64.whl"
                    if not _deploy_exec(f'[ -f "{sa_wheel}" ] && {PIP} install "{sa_wheel}"'):
                        _deploy_log("Wheel 不可用, 源码编译 SA3...", "warn")
                        _deploy_exec(
                            f'cd /workspace && git clone https://github.com/thu-ml/SageAttention.git && '
                            f'cd SageAttention/sageattention3_blackwell && {PY} setup.py install && '
                            f'cd /workspace && rm -rf SageAttention',
                            timeout=1200, label="编译 SA3"
                        )
                else:
                    _deploy_exec(
                        f'cd /workspace && git clone https://github.com/thu-ml/SageAttention.git && '
                        f'cd SageAttention && {PIP} install . --no-build-isolation && '
                        f'cd /workspace && rm -rf SageAttention',
                        timeout=600, label="安装 SA2"
                    )

                _deploy_exec("rm -rf /workspace/prebuilt_wheels")
                _deploy_log("✅ 加速组件安装完成")
                _mark_step_done("accelerators")
        else:
            _deploy_step("检查加速组件")
            _deploy_log("预构建镜像 — FA3/SA3 已预装, 跳过")

        # ─────────────────────────────────────────────
        # STEP 7: 插件安装
        # ─────────────────────────────────────────────
        _deploy_step("安装插件")
        plugins = config.get("plugins", [])
        if image_type == "prebuilt":
            _deploy_log("预构建镜像已含插件, 检查额外插件...")
            # 只安装不在镜像中的新插件
            for url in plugins:
                name = url.rstrip("/").split("/")[-1].replace(".git", "")
                if not Path(f"/workspace/ComfyUI/custom_nodes/{name}").exists():
                    _deploy_log(f"安装新插件: {name}")
                    _deploy_exec(f'cd /workspace/ComfyUI/custom_nodes && git clone "{url}" || true', timeout=60)
        else:
            _deploy_log(f"安装 {len(plugins)} 个插件...")
            _deploy_exec("mkdir -p /workspace/ComfyUI/custom_nodes")
            for url in plugins:
                name = url.rstrip("/").split("/")[-1].replace(".git", "")
                _deploy_log(f"  克隆 {name}...")
                _deploy_exec(f'cd /workspace/ComfyUI/custom_nodes && git clone "{url}" || true', timeout=60)

        # 批量安装插件依赖
        _deploy_log("安装插件依赖...")
        _deploy_exec(
            f'find /workspace/ComfyUI/custom_nodes -name "requirements.txt" -type f '
            f'-exec {PIP} install --no-cache-dir -r {{}} \\; 2>&1 || true',
            timeout=600, label="pip install plugin deps"
        )

        # ─────────────────────────────────────────────
        # STEP 8: 执行 deploy 同步规则
        # ─────────────────────────────────────────────
        if rclone_method != "skip" and rclone_value:
            _deploy_step("同步云端资产")
            # 迁移旧配置或加载规则
            _migrate_old_sync_prefs()
            rules = _load_sync_rules()
            deploy_rules = [r for r in rules if r.get("trigger") == "deploy" and r.get("enabled", True)]
            if deploy_rules:
                for rule in deploy_rules:
                    name = rule.get("name", rule.get("id", "?"))
                    _deploy_log(f"执行: {name}...")
                    ok = _run_sync_rule(rule)
                    if not ok:
                        _deploy_log(f"⚠️ {name} 未完全成功, 继续", "warning")
                _deploy_log("✅ 资产同步完成")
            else:
                _deploy_log("没有 deploy 同步规则, 跳过")
        else:
            _deploy_log("未配置 Rclone, 跳过资产同步")

        # ─────────────────────────────────────────────
        # STEP 9: 启动服务
        # ─────────────────────────────────────────────
        _deploy_step("启动服务")

        # 启动 Sync Worker (如有 watch 规则)
        if rclone_method != "skip" and rclone_value:
            rules = _load_sync_rules()
            watch_rules = [r for r in rules if r.get("trigger") == "watch" and r.get("enabled", True)]
            if watch_rules:
                _start_sync_worker()
                _deploy_log(f"✅ Sync Worker 已启动 ({len(watch_rules)} 条监控规则)")

        # CivitAI API Key
        civitai_token = config.get("civitai_token", "")
        if civitai_token:
            CONFIG_FILE.write_text(json.dumps({"api_key": civitai_token}))
            _deploy_log("CivitAI API Key 已保存")

        # 启动 ComfyUI
        _deploy_log("启动 ComfyUI 主服务...")
        _deploy_exec("pm2 delete comfy 2>/dev/null || true")
        _deploy_exec(
            f'cd /workspace/ComfyUI && pm2 start {PY} --name comfy '
            f'--interpreter none --log /workspace/comfy.log --time '
            f'--restart-delay 3000 --max-restarts 10 '
            f'-- main.py --listen 0.0.0.0 --port 8188 '
            f'--use-pytorch-cross-attention --fast --disable-xformers'
        )

        # 保存 PM2 配置
        _deploy_exec("pm2 save 2>/dev/null || true")

        # ─────────────────────────────────────────────
        # STEP 10: 后台任务
        # ─────────────────────────────────────────────
        _deploy_step("后台任务")

        # jtoken 快捷命令
        _deploy_log("安装 jtoken 命令...")
        jtoken_script = '''#!/bin/bash
echo '🔍 正在查找 Jupyter 信息...'
JUPYTER_TOKEN=$(ps aux | grep '[j]upyter-lab' | grep -oP 'token=\\K[a-zA-Z0-9-]+' | head -1)
JUPYTER_PORT=$(ps aux | grep '[j]upyter-lab' | grep -oP -- '--port=\\K[0-9]+' | head -1)
if [ -z "$JUPYTER_TOKEN" ]; then echo '❌ Jupyter Lab 未运行'; exit 1; fi
echo "📊 Jupyter Lab: 端口=${JUPYTER_PORT:-未知} Token=$JUPYTER_TOKEN"
if command -v pm2 >/dev/null 2>&1; then
    JUPYTER_DOMAIN=$(pm2 logs tunnel --nostream --lines 100 2>/dev/null | grep -oP 'dest=https://jupyter[^/]+' | head -1 | sed 's/dest=https:\\/\\///')
    [ -n "$JUPYTER_DOMAIN" ] && echo "🌐 https://$JUPYTER_DOMAIN/?token=$JUPYTER_TOKEN"
fi
echo "🔗 http://localhost:${JUPYTER_PORT}/?token=$JUPYTER_TOKEN"
'''
        Path("/usr/local/bin/jtoken").write_text(jtoken_script)
        _deploy_exec("chmod +x /usr/local/bin/jtoken")

        # AuraSR 下载 (前台, 显示进度)
        _deploy_log("下载 AuraSR V2...")
        _deploy_exec("mkdir -p /workspace/ComfyUI/models/Aura-SR")
        _deploy_exec(
            'aria2c -x 16 -s 16 '
            '-d "/workspace/ComfyUI/models/Aura-SR" -o "model.safetensors" '
            '"https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true"',
            timeout=300, label="AuraSR model.safetensors"
        )
        _deploy_exec(
            'aria2c -x 16 -s 16 '
            '-d "/workspace/ComfyUI/models/Aura-SR" -o "config.json" '
            '"https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true"',
            timeout=60, label="AuraSR config.json"
        )

        # ─────────────────────────────────────────────
        # 完成
        # ─────────────────────────────────────────────
        _deploy_step("部署完成")

        # 更新 Dashboard 密码 (持久化)
        new_pw = config.get("password", "")
        if new_pw:
            global DASHBOARD_PASSWORD
            DASHBOARD_PASSWORD = new_pw
            _save_dashboard_password(new_pw)
            _deploy_log(f"Dashboard 密码已更新并保存")

        state = _load_setup_state()
        state["deploy_completed"] = True
        state["deploy_error"] = ""
        state["deploy_steps_completed"] = []  # 清理: 成功后无需保留
        _save_setup_state(state)

        gpu_info = _detect_gpu_info()
        _deploy_log(f"🚀 部署完成! GPU: {gpu_info.get('name', '?')} | CUDA: {gpu_info.get('cuda_cap', '?')}")
        _deploy_log("请刷新页面进入 Dashboard")

    except Exception as e:
        _deploy_log(f"❌ 部署失败: {e}", "error")
        import traceback
        _deploy_log(traceback.format_exc(), "error")
        # 保存错误状态, 允许重试 (deploy_steps_completed 已逐步保存)
        try:
            state = _load_setup_state()
            state["deploy_error"] = str(e)
            state["deploy_started"] = False
            _save_setup_state(state)
        except Exception:
            pass


# ====================================================================
# Cloud Sync v2 — 规则驱动的灵活同步引擎
# ====================================================================
RCLONE_CONF = Path.home() / ".config" / "rclone" / "rclone.conf"
SYNC_RULES_FILE = Path("/workspace/.sync_rules.json")
SYNC_PREFS_FILE = Path("/workspace/.sync_prefs.json")  # 向后兼容

# 同步规则预设模板 (前端快速添加)
SYNC_RULE_TEMPLATES = [
    {"id": "tpl-pull-workflows",  "name": "⬇️ 下拉工作流",        "direction": "pull", "remote_path": "comfyui-assets/workflow",    "local_path": "user/default/workflows", "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-loras",      "name": "⬇️ 下拉 LoRA",         "direction": "pull", "remote_path": "comfyui-assets/loras",       "local_path": "models/loras",           "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-checkpoints","name": "⬇️ 下拉 Checkpoints",  "direction": "pull", "remote_path": "comfyui-assets/checkpoints", "local_path": "models/checkpoints",     "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-controlnet", "name": "⬇️ 下拉 ControlNet",   "direction": "pull", "remote_path": "comfyui-assets/controlnet",  "local_path": "models/controlnet",      "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-embeddings", "name": "⬇️ 下拉 Embeddings",   "direction": "pull", "remote_path": "comfyui-assets/embeddings",  "local_path": "models/embeddings",      "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-vae",        "name": "⬇️ 下拉 VAE",          "direction": "pull", "remote_path": "comfyui-assets/vae",         "local_path": "models/vae",             "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-upscale",    "name": "⬇️ 下拉 Upscale",      "direction": "pull", "remote_path": "comfyui-assets/upscale",     "local_path": "models/upscale_models",  "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-pull-wildcards",  "name": "⬇️ 下拉 Wildcards",    "direction": "pull", "remote_path": "comfyui-assets/wildcards",   "local_path": "custom_nodes/comfyui-dynamicprompts/wildcards", "method": "sync", "trigger": "deploy"},
    {"id": "tpl-pull-input",      "name": "⬇️ 下拉 Input 素材",   "direction": "pull", "remote_path": "comfyui-assets/input",       "local_path": "input",                  "method": "sync",  "trigger": "deploy"},
    {"id": "tpl-push-output",     "name": "⬆️ 上传输出 (移动)",    "direction": "push", "remote_path": "ComfyUI_Output",             "local_path": "output",                 "method": "move",  "trigger": "watch", "watch_interval": 15, "filters": ["+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}", "- .*/**", "- *"]},
    {"id": "tpl-push-output-copy","name": "⬆️ 上传输出 (保留本地)","direction": "push", "remote_path": "ComfyUI_Output",             "local_path": "output",                 "method": "copy",  "trigger": "watch", "watch_interval": 15, "filters": ["+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}", "- .*/**", "- *"]},
    {"id": "tpl-push-workflows",  "name": "⬆️ 备份工作流",        "direction": "push", "remote_path": "comfyui-assets/workflow",     "local_path": "user/default/workflows", "method": "sync",  "trigger": "manual"},
]

# Remote 类型表单定义 (非 OAuth)
REMOTE_TYPE_DEFS = {
    "s3": {
        "label": "S3 / Cloudflare R2",
        "icon": "☁️",
        "fields": [
            {"key": "provider", "label": "Provider", "type": "select", "options": ["Cloudflare", "AWS", "Minio", "DigitalOcean", "Wasabi", "Other"], "default": "Cloudflare"},
            {"key": "access_key_id", "label": "Access Key ID", "type": "text", "required": True},
            {"key": "secret_access_key", "label": "Secret Access Key", "type": "password", "required": True},
            {"key": "endpoint", "label": "Endpoint URL", "type": "text", "required": True, "placeholder": "https://<account_id>.r2.cloudflarestorage.com"},
            {"key": "acl", "label": "ACL", "type": "text", "default": "private"},
        ],
    },
    "sftp": {
        "label": "SFTP",
        "icon": "🖥️",
        "fields": [
            {"key": "host", "label": "Host", "type": "text", "required": True},
            {"key": "port", "label": "Port", "type": "text", "default": "22"},
            {"key": "user", "label": "用户名", "type": "text", "required": True},
            {"key": "pass", "label": "密码", "type": "password"},
            {"key": "key_file", "label": "SSH Key 路径", "type": "text", "placeholder": "~/.ssh/id_rsa"},
        ],
    },
    "webdav": {
        "label": "WebDAV",
        "icon": "🌐",
        "fields": [
            {"key": "url", "label": "WebDAV URL", "type": "text", "required": True},
            {"key": "user", "label": "用户名", "type": "text"},
            {"key": "pass", "label": "密码", "type": "password"},
            {"key": "vendor", "label": "Vendor", "type": "select", "options": ["other", "nextcloud", "owncloud", "sharepoint"], "default": "other"},
        ],
    },
    "onedrive": {
        "label": "OneDrive",
        "icon": "📁",
        "oauth": True,
        "fields": [
            {"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
             "help": "在本地执行 <code>rclone authorize \"onedrive\"</code> 获取 token JSON"},
        ],
    },
    "drive": {
        "label": "Google Drive",
        "icon": "📂",
        "oauth": True,
        "fields": [
            {"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
             "help": "在本地执行 <code>rclone authorize \"drive\"</code> 获取 token JSON"},
        ],
    },
    "dropbox": {
        "label": "Dropbox",
        "icon": "📦",
        "oauth": True,
        "fields": [
            {"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
             "help": "在本地执行 <code>rclone authorize \"dropbox\"</code> 获取 token JSON"},
        ],
    },
}


# ── Sync Rules CRUD ──────────────────────────────────────────────

def _load_sync_rules():
    """加载同步规则"""
    if SYNC_RULES_FILE.exists():
        try:
            return json.loads(SYNC_RULES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def _save_sync_rules(rules):
    """保存同步规则"""
    SYNC_RULES_FILE.write_text(json.dumps(rules, indent=2, ensure_ascii=False), encoding="utf-8")


def _parse_rclone_conf():
    """解析 rclone.conf 返回 remote 列表"""
    remotes = []
    if not RCLONE_CONF.exists():
        return remotes
    current = None
    for line in RCLONE_CONF.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        m = re.match(r'^\[(.+)\]$', line)
        if m:
            if current:
                remotes.append(current)
            current = {"name": m.group(1), "type": "", "params": {},
                        "_has_token": False, "_has_keys": False}
        elif current and '=' in line:
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip()
            if k == "type":
                current["type"] = v
            if k == "token" and v:
                current["_has_token"] = True
            if k == "access_key_id" and v:
                current["_has_keys"] = True
            if k not in ("token", "access_key_id", "secret_access_key", "refresh_token"):
                current["params"][k] = v
    if current:
        remotes.append(current)
    return remotes


# ── Sync Worker (Python 后台线程) ────────────────────────────────

_sync_worker_thread = None
_sync_worker_stop = threading.Event()
_sync_log_buffer = []         # 最近 300 行日志
_sync_log_lock = threading.Lock()


def _sync_log(msg):
    """写日志到内存 buffer"""
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    with _sync_log_lock:
        _sync_log_buffer.append(line)
        if len(_sync_log_buffer) > 300:
            _sync_log_buffer[:] = _sync_log_buffer[-300:]
    app.logger.debug(f"[sync] {msg}")


def _run_sync_rule(rule):
    """执行单条同步规则 (rclone subprocess)"""
    remote = rule.get("remote", "")
    remote_path = rule.get("remote_path", "")
    local_rel = rule.get("local_path", "")
    method = rule.get("method", "sync")    # sync|copy|move
    direction = rule.get("direction", "pull")
    filters = rule.get("filters", [])
    name = rule.get("name", rule.get("id", "?"))

    local_abs = os.path.join(COMFYUI_DIR, local_rel)
    os.makedirs(local_abs, exist_ok=True)

    remote_spec = f"{remote}:{remote_path}"
    if direction == "pull":
        src, dst = remote_spec, local_abs
    else:
        src, dst = local_abs, remote_spec

    cmd = ["rclone", method, src, dst, "--transfers", "4", "-P"]
    for f in filters:
        cmd.extend(["--filter", f])

    _sync_log(f"{'⬇' if direction == 'pull' else '⬆'} {name}: {src} → {dst} ({method})")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        # 提取 rclone 输出摘要
        output = (proc.stdout + proc.stderr).strip()
        if output:
            for line in output.split('\n')[-3:]:
                line = line.strip()
                if line:
                    _sync_log(f"  {line}")
        if proc.returncode == 0:
            _sync_log(f"✅ {name} 完成")
        else:
            _sync_log(f"❌ {name} 失败 (code={proc.returncode})")
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        _sync_log(f"⏰ {name} 超时 (600s)")
        return False
    except Exception as e:
        _sync_log(f"❌ {name} 异常: {e}")
        return False


def _sync_worker_loop():
    """后台线程: 持续执行 watch 类型规则"""
    _sync_log("☁️ Sync Worker 已启动")
    while not _sync_worker_stop.is_set():
        rules = _load_sync_rules()
        watch_rules = [r for r in rules if r.get("trigger") == "watch" and r.get("enabled", True)]
        if not watch_rules:
            _sync_worker_stop.wait(30)
            continue
        for rule in watch_rules:
            if _sync_worker_stop.is_set():
                break
            _run_sync_rule(rule)
        # 等待最短 interval，默认 15 秒
        intervals = [r.get("watch_interval", 15) for r in watch_rules]
        wait = max(min(intervals), 5) if intervals else 15
        _sync_worker_stop.wait(wait)
    _sync_log("🛑 Sync Worker 已停止")


def _start_sync_worker():
    """启动 sync worker 后台线程"""
    global _sync_worker_thread
    _stop_sync_worker()
    _sync_worker_stop.clear()
    _sync_worker_thread = threading.Thread(target=_sync_worker_loop, daemon=True, name="sync-worker")
    _sync_worker_thread.start()
    return True


def _stop_sync_worker():
    """停止 sync worker"""
    global _sync_worker_thread
    _sync_worker_stop.set()
    if _sync_worker_thread and _sync_worker_thread.is_alive():
        _sync_worker_thread.join(timeout=5)
    _sync_worker_thread = None


# ── API 端点 ─────────────────────────────────────────────────────

@app.route("/api/sync/status")
def api_sync_status():
    """获取 Sync Worker 状态和日志"""
    worker_running = _sync_worker_thread is not None and _sync_worker_thread.is_alive()

    # 也检查旧的 PM2 sync 进程 (向后兼容)
    pm2_status = "stopped"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout or "[]"):
                if p.get("name") == "sync":
                    pm2_status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    with _sync_log_lock:
        log_lines = list(_sync_log_buffer)

    rules = _load_sync_rules()
    return jsonify({
        "worker_running": worker_running,
        "pm2_status": pm2_status,
        "log_lines": log_lines,
        "rules": rules,
    })


@app.route("/api/sync/remotes")
def api_sync_remotes():
    """列出 rclone 配置的 remote"""
    remotes = _parse_rclone_conf()
    for r in remotes:
        t = r["type"]
        type_def = REMOTE_TYPE_DEFS.get(t, {})
        r["display_name"] = type_def.get("label", t)
        r["icon"] = type_def.get("icon", "💾")
        r["has_auth"] = bool(r.get("_has_token") or r.get("_has_keys"))
    return jsonify({"remotes": remotes})


@app.route("/api/sync/remote/create", methods=["POST"])
def api_sync_remote_create():
    """创建新的 rclone remote"""
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    rtype = data.get("type", "").strip()
    params = data.get("params", {})

    if not name or not rtype:
        return jsonify({"error": "name 和 type 必填"}), 400
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        return jsonify({"error": "Remote 名称只能包含字母、数字、下划线和短横线"}), 400

    # 已存在检查
    existing = [r["name"] for r in _parse_rclone_conf()]
    if name in existing:
        return jsonify({"error": f"Remote '{name}' 已存在"}), 409

    # 构建 rclone config create 命令
    cmd = f'rclone config create "{name}" "{rtype}"'
    for k, v in params.items():
        if v:
            # 对 token 等含特殊字符的值需要安全传递
            cmd += f" {k}={shlex.quote(str(v))}"

    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return jsonify({"error": f"创建失败: {r.stderr.strip() or r.stdout.strip()}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True, "message": f"Remote '{name}' 已创建"})


@app.route("/api/sync/remote/delete", methods=["POST"])
def api_sync_remote_delete():
    """删除 rclone remote"""
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "缺少 remote 名称"}), 400
    try:
        r = subprocess.run(f'rclone config delete "{name}"', shell=True, capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return jsonify({"error": f"删除失败: {r.stderr.strip()}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "message": f"Remote '{name}' 已删除"})


@app.route("/api/sync/remote/browse", methods=["POST"])
def api_sync_remote_browse():
    """浏览 remote 路径下的目录"""
    data = request.get_json(force=True)
    remote = data.get("remote", "")
    path = data.get("path", "")
    try:
        cmd = f'rclone lsjson "{remote}:{path}" --dirs-only -R --max-depth 1 2>/dev/null'
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            items = json.loads(r.stdout or "[]")
            dirs = [i["Path"] for i in items if i.get("IsDir")]
            return jsonify({"ok": True, "dirs": sorted(dirs)})
        return jsonify({"ok": True, "dirs": []})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sync/remote/types")
def api_sync_remote_types():
    """返回支持的 remote 类型定义 (前端表单渲染)"""
    return jsonify({"types": REMOTE_TYPE_DEFS})


@app.route("/api/sync/storage")
def api_sync_storage():
    """获取各 remote 的容量信息"""
    remotes = _parse_rclone_conf()
    results = {}
    for r in remotes:
        name = r["name"]
        try:
            proc = subprocess.run(
                f'rclone about "{name}:" --json 2>/dev/null',
                shell=True, capture_output=True, text=True, timeout=30
            )
            if proc.returncode == 0:
                about = json.loads(proc.stdout)
                results[name] = {
                    "total": about.get("total"),
                    "used": about.get("used"),
                    "free": about.get("free"),
                    "trashed": about.get("trashed"),
                }
            else:
                results[name] = {"error": "不支持容量查询"}
        except subprocess.TimeoutExpired:
            results[name] = {"error": "查询超时"}
        except Exception as e:
            results[name] = {"error": str(e)}
    return jsonify({"storage": results})


# ── 同步规则 API ─────────────────────────────────────────────────

@app.route("/api/sync/rules")
def api_sync_rules():
    """获取所有同步规则"""
    return jsonify({"rules": _load_sync_rules(), "templates": SYNC_RULE_TEMPLATES})


@app.route("/api/sync/rules/save", methods=["POST"])
def api_sync_rules_save():
    """保存同步规则 (整体替换)"""
    data = request.get_json(force=True)
    rules = data.get("rules", [])
    # 校验
    for r in rules:
        if not r.get("id") or not r.get("remote") or not r.get("local_path"):
            return jsonify({"error": "每条规则必须有 id, remote, local_path"}), 400
    _save_sync_rules(rules)

    # 如果有 watch 规则且 worker 没运行, 自动启动
    watch_rules = [r for r in rules if r.get("trigger") == "watch" and r.get("enabled", True)]
    if watch_rules and (not _sync_worker_thread or not _sync_worker_thread.is_alive()):
        _start_sync_worker()
    elif not watch_rules:
        _stop_sync_worker()

    return jsonify({"ok": True, "message": f"已保存 {len(rules)} 条规则"})


@app.route("/api/sync/rules/run", methods=["POST"])
def api_sync_rules_run():
    """手动执行指定规则 (或全部 deploy 规则)"""
    data = request.get_json(force=True)
    rule_id = data.get("rule_id")  # 为空则执行全部 deploy 规则
    rules = _load_sync_rules()

    if rule_id:
        targets = [r for r in rules if r.get("id") == rule_id]
    else:
        targets = [r for r in rules if r.get("trigger") == "deploy" and r.get("enabled", True)]

    if not targets:
        return jsonify({"error": "没有找到匹配的规则"}), 404

    # 后台执行 (非阻塞)
    def _run_targets():
        for r in targets:
            _run_sync_rule(r)

    threading.Thread(target=_run_targets, daemon=True).start()
    return jsonify({"ok": True, "message": f"开始执行 {len(targets)} 条规则"})


@app.route("/api/sync/worker/start", methods=["POST"])
def api_sync_worker_start():
    """启动 Sync Worker"""
    _start_sync_worker()
    return jsonify({"ok": True, "message": "Sync Worker 已启动"})


@app.route("/api/sync/worker/stop", methods=["POST"])
def api_sync_worker_stop():
    """停止 Sync Worker"""
    _stop_sync_worker()
    return jsonify({"ok": True, "message": "Sync Worker 已停止"})


# ── Rclone 配置文件直接编辑 (高级) ───────────────────────────────

@app.route("/api/sync/rclone_config", methods=["GET"])
def api_get_rclone_config():
    """获取 rclone.conf 完整内容"""
    if not RCLONE_CONF.exists():
        return jsonify({"config": "", "exists": False})
    raw = RCLONE_CONF.read_text(encoding="utf-8")
    return jsonify({"config": raw, "exists": True})


@app.route("/api/sync/rclone_config", methods=["POST"])
def api_save_rclone_config():
    """保存 rclone.conf"""
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
        r = subprocess.run("rclone listremotes 2>&1", shell=True, capture_output=True, text=True, timeout=5)
        remotes = [l.strip().rstrip(':') for l in r.stdout.strip().split('\n') if l.strip()]
    except Exception:
        remotes = []
    return jsonify({"ok": True, "message": f"配置已保存，检测到 {len(remotes)} 个 remote: {', '.join(remotes)}"})


@app.route("/api/sync/import_config", methods=["POST"])
def api_import_config():
    """从 URL 或 base64 导入 rclone.conf"""
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
        r = subprocess.run("rclone listremotes 2>&1", shell=True, capture_output=True, text=True, timeout=5)
        remotes = [l.strip().rstrip(':') for l in r.stdout.strip().split('\n') if l.strip()]
    except Exception:
        remotes = []
    return jsonify({"ok": True, "message": f"导入成功，检测到 {len(remotes)} 个 remote: {', '.join(remotes)}"})


# ── 向后兼容: 旧的 sync_prefs → rules 迁移 ──────────────────────

def _migrate_old_sync_prefs():
    """如果存在旧的 .sync_prefs.json 且没有 rules，自动迁移"""
    if SYNC_RULES_FILE.exists():
        return  # 已有新规则
    if not SYNC_PREFS_FILE.exists():
        return
    try:
        prefs = json.loads(SYNC_PREFS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return

    rules = []
    remotes = _parse_rclone_conf()
    remote_names = {r["type"]: r["name"] for r in remotes}

    # R2 下拉规则
    r2_name = remote_names.get("s3", "")
    r2_prefs = prefs.get("r2", {})
    if r2_name and r2_prefs.get("enabled", True):
        if r2_prefs.get("sync_workflows", True):
            rules.append({"id": "migrated-pull-workflows", "name": "下拉工作流", "direction": "pull",
                          "remote": r2_name, "remote_path": "comfyui-assets/workflow",
                          "local_path": "user/default/workflows", "method": "sync", "trigger": "deploy", "enabled": True})
        if r2_prefs.get("sync_loras", True):
            rules.append({"id": "migrated-pull-loras", "name": "下拉 LoRA", "direction": "pull",
                          "remote": r2_name, "remote_path": "comfyui-assets/loras",
                          "local_path": "models/loras", "method": "sync", "trigger": "deploy", "enabled": True})
        if r2_prefs.get("sync_wildcards", True):
            rules.append({"id": "migrated-pull-wildcards", "name": "下拉 Wildcards", "direction": "pull",
                          "remote": r2_name, "remote_path": "comfyui-assets/wildcards",
                          "local_path": "custom_nodes/comfyui-dynamicprompts/wildcards",
                          "method": "sync", "trigger": "deploy", "enabled": True})

    # OneDrive / GDrive 输出上传规则
    od_name = remote_names.get("onedrive", "")
    od_prefs = prefs.get("onedrive", {})
    if od_name and od_prefs.get("enabled", False):
        rules.append({"id": "migrated-push-od", "name": "上传输出到 OneDrive", "direction": "push",
                      "remote": od_name, "remote_path": od_prefs.get("destination", "ComfyUI_Transfer"),
                      "local_path": "output", "method": "move", "trigger": "watch", "watch_interval": 15,
                      "filters": ["+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}", "- .*/**", "- *"], "enabled": True})

    gd_name = remote_names.get("drive", "")
    gd_prefs = prefs.get("gdrive", {})
    if gd_name and gd_prefs.get("enabled", False):
        rules.append({"id": "migrated-push-gd", "name": "上传输出到 Google Drive", "direction": "push",
                      "remote": gd_name, "remote_path": gd_prefs.get("destination", "ComfyUI_Transfer"),
                      "local_path": "output", "method": "move", "trigger": "watch", "watch_interval": 15,
                      "filters": ["+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}", "- .*/**", "- *"], "enabled": True})

    if rules:
        _save_sync_rules(rules)
        _sync_log(f"已从旧配置迁移 {len(rules)} 条同步规则")


# ====================================================================
# 前端页面
# ====================================================================
@app.route("/")
def index():
    # 如果向导未完成，显示向导页面
    if not _is_setup_complete():
        wizard_path = Path(__file__).parent / "setup_wizard.html"
        if wizard_path.exists():
            resp = Response(wizard_path.read_text(encoding="utf-8"), mimetype="text/html")
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return resp
        return Response("<h1>setup_wizard.html not found</h1>", mimetype="text/html", status=404)
    html_path = Path(__file__).parent / "dashboard.html"
    if html_path.exists():
        resp = Response(html_path.read_text(encoding="utf-8"), mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return Response("<h1>dashboard.html not found</h1>", mimetype="text/html", status=404)


@app.route("/dashboard.js")
def serve_js():
    js_path = Path(__file__).parent / "dashboard.js"
    if js_path.exists():
        resp = Response(js_path.read_text(encoding="utf-8"), mimetype="application/javascript")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return "", 404


@app.route("/favicon.ico")
def serve_favicon():
    """Serve favicon"""
    ico = os.path.join(SCRIPT_DIR, "favicon.ico")
    if os.path.exists(ico):
        return send_file(ico, mimetype="image/x-icon")
    return "", 204

@app.route("/static/<path:filename>")
def serve_static(filename):
    """通用静态文件服务"""
    base_dir = Path(__file__).parent.resolve()
    safe_path = (base_dir / filename).resolve()
    if not str(safe_path).startswith(str(base_dir)):
        return "", 403
    if safe_path.exists() and safe_path.is_file():
        return send_file(str(safe_path))
    return "", 404


# ====================================================================
# 启动
# ====================================================================
if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else MANAGER_PORT

    # 从环境变量导入 API Key
    if os.environ.get("CIVITAI_TOKEN") and not _get_api_key():
        CONFIG_FILE.write_text(json.dumps({"api_key": os.environ["CIVITAI_TOKEN"]}))
        print(f"  📝 已从环境变量 CIVITAI_TOKEN 导入 API Key")

    # 迁移旧 sync_prefs → rules 并启动 watch worker
    _migrate_old_sync_prefs()
    rules = _load_sync_rules()
    watch_rules = [r for r in rules if r.get("trigger") == "watch" and r.get("enabled", True)]
    if watch_rules:
        _start_sync_worker()
        print(f"  ☁️  Sync Worker 已启动 ({len(watch_rules)} 条监控规则)")

    print(f"\n{'='*50}")
    print(f"  🖥️  ComfyCarry v2.4")
    print(f"  访问地址: http://localhost:{port}")
    print(f"  ComfyUI:  {COMFYUI_DIR}")
    print(f"{'='*50}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
