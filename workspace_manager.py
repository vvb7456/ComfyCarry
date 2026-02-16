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
from pathlib import Path
from datetime import datetime

import requests
from flask import Flask, jsonify, request, Response, send_file, redirect, session
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Session secret key
app.secret_key = os.environ.get("SESSION_SECRET", secrets.token_hex(32))

# --- 配置 ---
COMFYUI_DIR = os.environ.get("COMFYUI_DIR", "/workspace/ComfyUI")
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://localhost:8188")
CONFIG_FILE = Path(__file__).parent / ".civitai_config.json"
MEILI_URL = 'https://search.civitai.com/multi-search'
MEILI_BEARER = '8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61'
MANAGER_PORT = int(os.environ.get("MANAGER_PORT", 5000))
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "comfy2025")

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
<title>Login - Workspace Manager</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#e8e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#1a1a28;border:1px solid #2a2a3e;border-radius:12px;padding:32px;width:360px;max-width:92vw}
.card h2{text-align:center;margin-bottom:20px;background:linear-gradient(135deg,#7c5cfc,#e879f9);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
input{width:100%;padding:10px 14px;background:#0e0e18;color:#e8e8f0;border:1px solid #2a2a3e;border-radius:8px;font-size:.9rem;margin-bottom:14px}
input:focus{border-color:#7c5cfc;outline:none}
button{width:100%;padding:10px;background:#7c5cfc;color:#fff;border:none;border-radius:8px;font-size:.9rem;cursor:pointer;font-weight:600}
button:hover{background:#9078ff}
.err{color:#f87171;font-size:.82rem;text-align:center;margin-bottom:10px}
</style></head>
<body><div class="card"><h2>Workspace Manager</h2>
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
    if request.path in ("/login", "/favicon.ico", "/dashboard.js"):
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
    data = request.get_json()
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
                    # Images from info
                    imgs = info_data.get("images", [])
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
    full = os.path.join(COMFYUI_DIR, rel)
    if os.path.isfile(full):
        return send_file(full)
    return "", 404


@app.route("/api/local_models/delete", methods=["POST"])
def api_delete_model():
    """删除本地模型及其关联文件"""
    data = request.get_json()
    abs_path = data.get("abs_path", "")

    # 安全检查
    if not abs_path.startswith(COMFYUI_DIR):
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
    data = request.get_json()
    abs_path = data.get("abs_path", "")

    # 安全检查
    if not abs_path.startswith(COMFYUI_DIR):
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
                img_resp = requests.get(first_img_url, timeout=15, stream=True)
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
    data = request.get_json()
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
    data = request.get_json()
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
    data = request.get_json()
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
        import re as _re

        # Strategy 1: Parse config="{...}" with escaped JSON (named tunnels)
        # The JSON value has escaped quotes, so we can't use simple (.*?) — match
        # everything between config=" and the closing " that is NOT preceded by \
        cfg_match = _re.search(r'config="((?:[^"\\]|\\.)*)"', log)
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
            ing_match = _re.search(r'"ingress"\s*:\s*\[', log)
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
            hostnames = _re.findall(r'hostname[=:]\s*([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', log)
            for h in set(hostnames):
                if 'cloudflare' not in h:
                    links.append({"name": h.split(".")[0].replace("-", " ").title(),
                                  "url": f"https://{h}", "icon": "🌐"})

        # Strategy 4: Fallback — trycloudflare quick tunnel URLs
        if not links:
            urls = list(set(_re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com', log)))
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
        import re as _re
        port_match = _re.search(r':(\d+)', service)
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
        import re as _re
        # Match: https://host:port/?token=TOKEN :: /path
        # or:   http://host:port/?token=TOKEN :: /path
        match = _re.search(r'https?://[^?]+\?token=([a-f0-9]+)', output)
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
    import re as _re
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
        ansi_re = _re.compile(r'\x1b\[[0-9;]*m')
        logs = ansi_re.sub('', raw_logs)
        # Strip PM2 prefix like "1|tunnel   | "
        logs = _re.sub(r'^\d+\|[^|]+\|\s*', '', logs, flags=_re.MULTILINE)
        # Strip PM2 tailing header lines
        logs = '\n'.join(l for l in logs.split('\n')
                        if not l.startswith('[TAILING]') and 'last 100 lines' not in l and '/root/.pm2/logs/' not in l)
    except Exception:
        logs = ""

    # Ingress 链接
    links = _parse_tunnel_ingress()

    return jsonify({"status": status, "logs": logs, "links": links})


# ====================================================================
# Setup Wizard API
# ====================================================================
_deploy_thread = None
_deploy_log_lines = []       # 实时日志行缓冲, SSE 消费
_deploy_log_lock = threading.Lock()


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
        "civitai_token", "plugins",
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


@app.route("/api/setup/deploy", methods=["POST"])
def api_setup_deploy():
    """开始部署 — 在后台线程执行全部安装逻辑"""
    global _deploy_thread
    if _deploy_thread and _deploy_thread.is_alive():
        return jsonify({"error": "部署已在进行中"}), 409

    state = _load_setup_state()
    state["deploy_started"] = True
    state["deploy_completed"] = False
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
                    yield f"data: {json.dumps({'type': 'done', 'success': False, 'msg': '部署进程异常终止'}, ensure_ascii=False)}\n\n"
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
        return False


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

        # ─────────────────────────────────────────────
        # STEP 2: Cloudflare Tunnel
        # ─────────────────────────────────────────────
        cf_token = config.get("cloudflared_token", "")
        if cf_token:
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
            _deploy_step("安装 PyTorch")
            TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
            _deploy_log("安装 torch 2.9.1 (CUDA 12.8)...")
            _deploy_exec(
                f'{PIP} install --no-cache-dir torch==2.9.1 --index-url "{TORCH_INDEX}"',
                timeout=600, label="pip install torch"
            )
            _deploy_exec(f'{PIP} install --no-cache-dir hf_transfer', label="hf_transfer")
        else:
            _deploy_step("检查预装 PyTorch")
            _deploy_log("预构建镜像 — 跳过 torch 安装")
            _deploy_exec(f'{PY} -c "import torch; print(f\\"PyTorch {{torch.__version__}} CUDA {{torch.version.cuda}}\\")"')

        # ─────────────────────────────────────────────
        # STEP 5: ComfyUI
        # ─────────────────────────────────────────────
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

        # 健康检查 (与原 deploy.sh 完全一致)
        _deploy_step("ComfyUI 健康检查")
        _deploy_log("启动首次健康检查...")
        _deploy_exec(f'cd /workspace/ComfyUI && {PY} main.py --listen 127.0.0.1 --port 8188 > /tmp/comfy_boot.log 2>&1 &')
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
        _deploy_exec("pkill -f 'main.py --listen 127.0.0.1 --port 8188' 2>/dev/null; sleep 1", label="停止检查进程")

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

        # ─────────────────────────────────────────────
        # STEP 6: 加速组件 (FA3 / SA3)
        # ─────────────────────────────────────────────
        if image_type == "generic":
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
            GH_WHEELS = "https://github.com/vvb7456/ComfyUI_RunPod_Sync/releases/download/v4.5-wheels"
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
        # STEP 8: R2 资产同步
        # ─────────────────────────────────────────────
        if rclone_method != "skip" and rclone_value:
            _deploy_step("同步云端资产")
            # 检测 R2 remote
            r2_name = subprocess.run(
                "grep -E '^\\[(r2|.*r2.*)\\]' ~/.config/rclone/rclone.conf 2>/dev/null | head -n1 | tr -d '[]'",
                shell=True, capture_output=True, text=True
            ).stdout.strip()

            if r2_name:
                prefs = _load_sync_prefs()
                r2p = prefs.get("r2", {})
                if r2p.get("sync_workflows", True):
                    _deploy_log("同步工作流...")
                    _deploy_exec(
                        f'rclone sync "{r2_name}:comfyui-assets/workflow" /workspace/ComfyUI/user/default/workflows/ -P',
                        timeout=300
                    )
                if r2p.get("sync_loras", True):
                    _deploy_log("同步 LoRA...")
                    _deploy_exec(
                        f'rclone sync "{r2_name}:comfyui-assets/loras" /workspace/ComfyUI/models/loras/ -P',
                        timeout=300
                    )
                if r2p.get("sync_wildcards", True):
                    _deploy_log("同步 Wildcards...")
                    _deploy_exec(
                        f'rclone sync "{r2_name}:comfyui-assets/wildcards" '
                        f'/workspace/ComfyUI/custom_nodes/comfyui-dynamicprompts/wildcards/ -P',
                        timeout=300
                    )
                _deploy_log("✅ 资产同步完成")
            else:
                _deploy_log("未检测到 R2 remote, 跳过资产同步")
        else:
            _deploy_log("未配置 Rclone, 跳过资产同步")

        # ─────────────────────────────────────────────
        # STEP 9: 启动服务
        # ─────────────────────────────────────────────
        _deploy_step("启动服务")

        # Output 云端同步 (OneDrive / Google Drive)
        if rclone_method != "skip" and rclone_value:
            prefs = _load_sync_prefs()
            od = prefs.get("onedrive", {}).get("enabled", False)
            gd = prefs.get("gdrive", {}).get("enabled", False)
            if od or gd:
                _deploy_log("生成 cloud_sync.sh...")
                remotes = {r["name"]: r for r in _parse_rclone_conf()}
                _regenerate_sync_script(remotes, prefs)
                _deploy_exec("pm2 delete sync 2>/dev/null || true")
                _deploy_exec("pm2 start /workspace/cloud_sync.sh --name sync --log /workspace/sync.log")
                _deploy_log("✅ 云端同步服务已启动")

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

        # AuraSR 下载
        _deploy_log("后台下载 AuraSR V2...")
        _deploy_exec("mkdir -p /workspace/ComfyUI/models/Aura-SR")
        _deploy_exec(
            'aria2c -x 16 -s 16 --console-log-level=error '
            '-d "/workspace/ComfyUI/models/Aura-SR" -o "model.safetensors" '
            '"https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true" &',
            label="AuraSR model"
        )
        _deploy_exec(
            'aria2c -x 16 -s 16 --console-log-level=error '
            '-d "/workspace/ComfyUI/models/Aura-SR" -o "config.json" '
            '"https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true" &',
            label="AuraSR config"
        )

        # ─────────────────────────────────────────────
        # 完成
        # ─────────────────────────────────────────────
        _deploy_step("部署完成")

        # 更新 Dashboard 密码
        new_pw = config.get("password", "")
        if new_pw:
            global DASHBOARD_PASSWORD
            DASHBOARD_PASSWORD = new_pw
            _deploy_log(f"Dashboard 密码已更新")

        state = _load_setup_state()
        state["deploy_completed"] = True
        _save_setup_state(state)

        gpu_info = _detect_gpu_info()
        _deploy_log(f"🚀 部署完成! GPU: {gpu_info.get('name', '?')} | CUDA: {gpu_info.get('cuda_cap', '?')}")
        _deploy_log("请刷新页面进入 Dashboard")

    except Exception as e:
        _deploy_log(f"❌ 部署失败: {e}", "error")
        import traceback
        _deploy_log(traceback.format_exc(), "error")


# ====================================================================
# Cloud Sync (Rclone) 管理
# ====================================================================
RCLONE_CONF = Path.home() / ".config" / "rclone" / "rclone.conf"
CLOUD_SYNC_SCRIPT = Path("/workspace/cloud_sync.sh")
SYNC_PREFS_FILE = Path("/workspace/.sync_prefs.json")


def _load_sync_prefs():
    """加载同步偏好设置"""
    defaults = {
        "r2": {"enabled": True, "sync_workflows": True, "sync_loras": True, "sync_wildcards": True},
        "onedrive": {"enabled": True, "destination": "ComfyUI_Transfer"},
        "gdrive": {"enabled": False, "destination": "ComfyUI_Transfer"},
    }
    if SYNC_PREFS_FILE.exists():
        try:
            prefs = json.loads(SYNC_PREFS_FILE.read_text(encoding="utf-8"))
            # Merge with defaults
            for k, v in defaults.items():
                if k not in prefs:
                    prefs[k] = v
                else:
                    for dk, dv in v.items():
                        if dk not in prefs[k]:
                            prefs[k][dk] = dv
            return prefs
        except Exception:
            pass
    return defaults


def _save_sync_prefs(prefs):
    """保存同步偏好设置"""
    SYNC_PREFS_FILE.write_text(json.dumps(prefs, indent=2, ensure_ascii=False), encoding="utf-8")

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
            # 不要暴露敏感 token
            if k not in ("token", "access_key_id", "secret_access_key", "refresh_token"):
                current["params"][k] = v
    if current:
        remotes.append(current)
    return remotes


def _parse_sync_log_entries(raw_log, max_entries=100):
    """将 rclone 日志解析为结构化条目，并附中文翻译"""
    entries = []
    for line in raw_log.split('\n'):
        line = line.strip()
        if not line:
            continue
        # rclone log: 2026/02/16 02:15:55 INFO  : file.png: Copied (new)
        m = re.match(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\w+)\s*:\s*(.*)', line)
        if m:
            ts, level, msg = m.group(1), m.group(2), m.group(3)
            cn_msg = _translate_rclone_msg(msg)
            entries.append({"time": ts, "level": level, "raw": msg, "msg": cn_msg})
        else:
            # 自定义行如 [HH:MM:SS] New files detected
            m2 = re.match(r'\[(\d{2}:\d{2}:\d{2})\]\s*(.*)', line)
            if m2:
                entries.append({"time": m2.group(1), "level": "INFO", "raw": m2.group(2),
                                "msg": _translate_sync_event(m2.group(2))})
            elif line.startswith("Transferred:") or line.startswith("Checks:") or \
                    line.startswith("Deleted:") or line.startswith("Renamed:") or \
                    line.startswith("Elapsed"):
                entries.append({"time": "", "level": "STAT", "raw": line,
                                "msg": _translate_rclone_stat(line)})
    return entries[-max_entries:]


def _translate_rclone_msg(msg):
    """翻译 rclone 操作消息为中文"""
    # file.png: Copied (new)
    m = re.match(r'(.+?):\s*Copied\s*\(new\)', msg)
    if m:
        return f"📤 上传新文件: {m.group(1)}"
    m = re.match(r'(.+?):\s*Copied\s*\(replaced existing\)', msg)
    if m:
        return f"🔄 覆盖更新: {m.group(1)}"
    m = re.match(r'(.+?):\s*Deleted', msg)
    if m:
        return f"🗑️ 已删除本地: {m.group(1)}"
    m = re.match(r'(.+?):\s*Moved', msg)
    if m:
        return f"📦 已移动: {m.group(1)}"
    if "There was nothing to transfer" in msg:
        return "✅ 无需同步，全部最新"
    if "Renamed" in msg:
        return f"📝 重命名: {msg}"
    return msg


def _translate_sync_event(msg):
    """翻译自定义同步事件"""
    if "New files detected" in msg:
        return "🔍 检测到新文件，开始同步..."
    if "OneDrive sync completed" in msg:
        return "✅ OneDrive 同步完成"
    if "Google Drive sync completed" in msg:
        return "✅ Google Drive 同步完成"
    if "Sync Service Started" in msg:
        return "🚀 同步服务已启动"
    return msg


def _translate_rclone_stat(line):
    """翻译 rclone 统计行"""
    if line.startswith("Transferred:") and "/" in line:
        # Transferred: 281.952 KiB / 281.952 KiB, 100%, 94.052 KiB/s
        parts = line.split(",")
        size_part = parts[0].replace("Transferred:", "").strip()
        return f"📊 已传输: {size_part}" + (f" ({parts[1].strip()})" if len(parts) > 1 else "")
    if line.startswith("Deleted:"):
        return f"🗑️ {line}"
    if line.startswith("Elapsed"):
        return f"⏱️ {line}"
    if line.startswith("Checks:"):
        return f"🔍 {line}"
    return line


@app.route("/api/sync/status")
def api_sync_status():
    """获取 Cloud Sync 状态、日志和配置"""
    # PM2 进程状态
    status = "unknown"
    try:
        r = subprocess.run("pm2 jlist 2>/dev/null", shell=True, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            for p in json.loads(r.stdout):
                if p.get("name") == "sync":
                    status = p.get("pm2_env", {}).get("status", "unknown")
                    break
    except Exception:
        pass

    # 同步日志
    try:
        r = subprocess.run(
            "pm2 logs sync --nostream --lines 150 2>/dev/null",
            shell=True, capture_output=True, text=True, timeout=5
        )
        raw = r.stdout + r.stderr
        # Strip ANSI and PM2 prefix
        raw = re.sub(r'\x1b\[[0-9;]*m', '', raw)
        raw = re.sub(r'^\d+\|[^|]+\|\s*', '', raw, flags=re.MULTILINE)
        raw = '\n'.join(l for l in raw.split('\n')
                       if not l.startswith('[TAILING]') and 'last 150 lines' not in l
                       and '/root/.pm2/logs/' not in l)
        entries = _parse_sync_log_entries(raw)
    except Exception:
        entries = []

    # 当前同步偏好
    prefs = _load_sync_prefs()

    return jsonify({
        "status": status,
        "entries": entries,
        "prefs": prefs
    })


@app.route("/api/sync/remotes")
def api_sync_remotes():
    """列出 rclone 配置的 remote，包含同步偏好"""
    remotes = _parse_rclone_conf()
    prefs = _load_sync_prefs()
    for r in remotes:
        t = r["type"]
        if t == "s3":
            r["category"] = "r2"
            r["display_name"] = "Cloudflare R2"
            r["icon"] = "☁️"
            r["prefs"] = prefs.get("r2", {})
        elif "onedrive" in t:
            r["category"] = "onedrive"
            r["display_name"] = "OneDrive"
            r["icon"] = "📁"
            r["prefs"] = prefs.get("onedrive", {})
        elif t == "drive":
            r["category"] = "gdrive"
            r["display_name"] = "Google Drive"
            r["icon"] = "📂"
            r["prefs"] = prefs.get("gdrive", {})
        else:
            r["category"] = "other"
            r["display_name"] = r["name"]
            r["icon"] = "💾"
            r["prefs"] = {}
        # Auth status — check if token/keys exist
        r["has_auth"] = bool(r.get("_has_token") or r.get("_has_keys"))
    return jsonify({"remotes": remotes, "prefs": prefs})


@app.route("/api/sync/storage")
def api_sync_storage():
    """获取各 remote 的容量信息"""
    remotes = _parse_rclone_conf()
    results = {}
    for r in remotes:
        name = r["name"]
        try:
            proc = subprocess.run(
                f"rclone about {name}: --json 2>/dev/null",
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


@app.route("/api/sync/toggle", methods=["POST"])
def api_sync_toggle():
    """更新同步偏好设置"""
    data = request.get_json(force=True)
    category = data.get("category", "")  # r2, onedrive, gdrive
    updates = data.get("updates", {})    # e.g. {"enabled": true, "sync_loras": false}

    prefs = _load_sync_prefs()
    if category not in prefs:
        prefs[category] = {}
    prefs[category].update(updates)
    _save_sync_prefs(prefs)

    # 如果是 output sync 相关的变更，重新生成 cloud_sync.sh
    if category in ("onedrive", "gdrive") and "enabled" in updates:
        remotes = {r["name"]: r for r in _parse_rclone_conf()}
        _regenerate_sync_script(remotes, prefs)
        subprocess.run("pm2 restart sync 2>/dev/null", shell=True, timeout=10)

    return jsonify({"ok": True, "message": "设置已保存", "prefs": prefs})


def _regenerate_sync_script(remotes, prefs):
    """重新生成 cloud_sync.sh，根据偏好设置控制哪些 remote 参与输出同步"""
    onedrive_enabled = prefs.get("onedrive", {}).get("enabled", False)
    gdrive_enabled = prefs.get("gdrive", {}).get("enabled", False)

    # 找到实际 remote 名称
    onedrive_name = ""
    gdrive_name = ""
    for name, r in remotes.items():
        if r["type"] == "onedrive" or "onedrive" in name.lower():
            onedrive_name = name
        elif r["type"] == "drive" or "gdrive" in name.lower():
            gdrive_name = name

    od_dest = prefs.get("onedrive", {}).get("destination", "ComfyUI_Transfer")
    gd_dest = prefs.get("gdrive", {}).get("destination", "ComfyUI_Transfer")

    # 构建 sync 块
    sync_blocks = []
    if onedrive_enabled and onedrive_name:
        sync_blocks.append(f'''        # OneDrive 同步
        rclone move "$SOURCE_DIR" "{onedrive_name}:{od_dest}" \\
            --min-age "30s" \\
            --filter "+ *.{{png,jpg,jpeg,webp,gif,mp4,mov,webm}}" \\
            --filter "- .*/**" \\
            --filter "- *" \\
            --transfers 4 -v && echo "[$TIME] OneDrive sync completed"''')

    if gdrive_enabled and gdrive_name:
        sync_blocks.append(f'''        # Google Drive 同步
        rclone move "$SOURCE_DIR" "{gdrive_name}:{gd_dest}" \\
            --min-age "30s" \\
            --filter "+ *.{{png,jpg,jpeg,webp,gif,mp4,mov,webm}}" \\
            --filter "- .*/**" \\
            --filter "- *" \\
            --transfers 4 -v && echo "[$TIME] Google Drive sync completed"''')

    # 生成启用信息
    info_lines = []
    if onedrive_name:
        info_lines.append(f'echo "  OneDrive: {onedrive_name} ({"启用" if onedrive_enabled else "禁用"})"')
    if gdrive_name:
        info_lines.append(f'echo "  Google Drive: {gdrive_name} ({"启用" if gdrive_enabled else "禁用"})"')

    script = f'''#!/bin/bash
SOURCE_DIR="/workspace/ComfyUI/output"

echo "--- Cloud Sync Service Started ---"
{chr(10).join(info_lines)}

while true; do
    FOUND_FILES=$(find "$SOURCE_DIR" -type f -mmin +0.5 \\( -iname "*.png" -o -iname "*.jpg" -o -iname "*.mp4" -o -iname "*.webp" \\) ! -path '*/.*' -print -quit)

    if [ -n "$FOUND_FILES" ]; then
        TIME=$(date '+%H:%M:%S')
        echo "[$TIME] New files detected. Syncing..."

{chr(10).join(sync_blocks) if sync_blocks else '        echo "[$TIME] No remotes enabled, skipping"'}

    fi
    sleep 10
done
'''
    CLOUD_SYNC_SCRIPT.write_text(script, encoding="utf-8")
    CLOUD_SYNC_SCRIPT.chmod(0o755)


@app.route("/api/sync/rclone_config", methods=["GET"])
def api_get_rclone_config():
    """获取 rclone.conf 完整内容（Dashboard 已有密码保护）"""
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

    # 基本语法校验：至少有一个 [remote] 段
    sections = re.findall(r'^\[.+\]', config_text, re.MULTILINE)
    if not sections:
        return jsonify({"error": "配置格式错误：至少需要一个 [remote] 段"}), 400

    # 备份旧配置
    if RCLONE_CONF.exists():
        backup = RCLONE_CONF.with_suffix('.conf.bak')
        backup.write_text(RCLONE_CONF.read_text(encoding="utf-8"), encoding="utf-8")

    # 写入新配置
    RCLONE_CONF.parent.mkdir(parents=True, exist_ok=True)
    RCLONE_CONF.write_text(config_text, encoding="utf-8")
    RCLONE_CONF.chmod(0o600)

    # 验证配置是否可用
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

    # 验证
    sections = re.findall(r'^\[.+\]', config_text, re.MULTILINE)
    if not sections:
        return jsonify({"error": "导入的内容不是有效的 rclone 配置"}), 400

    # 备份 + 写入
    if RCLONE_CONF.exists():
        backup = RCLONE_CONF.with_suffix('.conf.bak')
        backup.write_text(RCLONE_CONF.read_text(encoding="utf-8"), encoding="utf-8")
    RCLONE_CONF.parent.mkdir(parents=True, exist_ok=True)
    RCLONE_CONF.write_text(config_text, encoding="utf-8")
    RCLONE_CONF.chmod(0o600)

    # 列出 remotes
    try:
        r = subprocess.run("rclone listremotes 2>&1", shell=True, capture_output=True, text=True, timeout=5)
        remotes = [l.strip().rstrip(':') for l in r.stdout.strip().split('\n') if l.strip()]
    except Exception:
        remotes = []

    return jsonify({"ok": True, "message": f"导入成功，检测到 {len(remotes)} 个 remote: {', '.join(remotes)}"})


# ====================================================================
# 前端页面
# ====================================================================
@app.route("/")
def index():
    # 如果向导未完成，显示向导页面
    if not _is_setup_complete():
        wizard_path = Path(__file__).parent / "setup_wizard.html"
        if wizard_path.exists():
            return Response(wizard_path.read_text(encoding="utf-8"), mimetype="text/html")
        return Response("<h1>setup_wizard.html not found</h1>", mimetype="text/html", status=404)
    html_path = Path(__file__).parent / "dashboard.html"
    if html_path.exists():
        return Response(html_path.read_text(encoding="utf-8"), mimetype="text/html")
    return Response("<h1>dashboard.html not found</h1>", mimetype="text/html", status=404)


@app.route("/dashboard.js")
def serve_js():
    js_path = Path(__file__).parent / "dashboard.js"
    if js_path.exists():
        return Response(js_path.read_text(encoding="utf-8"), mimetype="application/javascript")
    return "", 404


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

    print(f"\n{'='*50}")
    print(f"  🖥️  Workspace Manager v1.0")
    print(f"  访问地址: http://localhost:{port}")
    print(f"  ComfyUI:  {COMFYUI_DIR}")
    print(f"{'='*50}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
