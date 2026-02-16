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
from pathlib import Path
from datetime import datetime

import requests
from flask import Flask, jsonify, request, Response, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# --- 配置 ---
COMFYUI_DIR = os.environ.get("COMFYUI_DIR", "/workspace/ComfyUI")
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://localhost:8188")
CONFIG_FILE = Path(__file__).parent / ".civitai_config.json"
MEILI_URL = 'https://search.civitai.com/multi-search'
MEILI_BEARER = '8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61'
MANAGER_PORT = int(os.environ.get("MANAGER_PORT", 5000))

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

def _sha256_file(filepath, partial=True):
    """计算文件 SHA256 (partial=True 时只读前 10MB 用于快速匹配)"""
    sha = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            if partial:
                # CivitAI 使用完整文件哈希
                pass
            while True:
                chunk = f.read(8192)
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
    out = _run_cmd(f"pm2 {action} {name}", timeout=10)
    return jsonify({"ok": True, "output": out})


# ====================================================================
# 日志 API
# ====================================================================
@app.route("/api/logs/<name>")
def api_logs(name):
    """获取 PM2 日志"""
    lines = request.args.get("lines", "100")
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
        raw_data = request.get_data()
        print(f"\n[DEBUG] === Search Request ({datetime.now().isoformat()}) ===", flush=True)
        print(f"[DEBUG] Headers: {dict(request.headers)}", flush=True)
        print(f"[DEBUG] Raw Body: {raw_data.decode('utf-8', errors='ignore')}", flush=True)
        
        data = request.get_json(force=True, silent=True)
        if not data:
            print("[DEBUG] Error: No JSON body", flush=True)
            return jsonify({"error": "No JSON body"}), 400

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MEILI_BEARER}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        print(f"[DEBUG] Sending to Meili: {MEILI_URL} with headers {headers}", flush=True)
        resp = requests.post(MEILI_URL, headers=headers, json=data, timeout=10)
        
        print(f"[DEBUG] Meili Response Status: {resp.status_code}", flush=True)
        print(f"[DEBUG] Meili Response Text: {resp.text[:1000]}", flush=True) # Limit to 1000 chars

        return Response(resp.content, status=resp.status_code, mimetype="application/json")
    except Exception as e:
        print(f"[DEBUG] Search Exception: {e}", flush=True)
        import traceback
        traceback.print_exc()
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


# ====================================================================
# 前端页面
# ====================================================================
@app.route("/")
def index():
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
    safe_path = Path(__file__).parent / filename
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
