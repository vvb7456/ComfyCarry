"""
ComfyCarry — ComfyUI 管理路由

- /api/comfyui/status   — 系统状态 + 启动参数
- /api/comfyui/params   — 参数定义/更新
- /api/comfyui/queue     — 任务队列
- /api/comfyui/interrupt — 中断执行
- /api/comfyui/free      — 释放 VRAM
- /api/comfyui/history   — 生成历史
- /api/comfyui/view      — 图片代理
- /api/comfyui/events    — SSE 实时事件
- /api/comfyui/logs/stream — SSE 日志流
"""

import json
import os
import queue
import re
import shlex
import subprocess

import requests
from flask import Blueprint, Response, jsonify, request

from ..config import COMFYUI_URL, COMFYUI_DIR
from ..services.comfyui_params import (
    COMFYUI_PARAM_GROUPS,
    parse_comfyui_args,
    build_comfyui_args,
)
from ..services.comfyui_bridge import get_bridge

bp = Blueprint("comfyui", __name__)


# ====================================================================
# ComfyUI 状态 & 参数
# ====================================================================
@bp.route("/api/comfyui/status")
def api_comfyui_status():
    """获取 ComfyUI 系统状态 + 当前启动参数"""
    result = {"online": False, "system": {}, "devices": [],
              "params": {}, "args": []}
    try:
        resp = requests.get(f"{COMFYUI_URL}/system_stats", timeout=5)
        data = resp.json()
        result["online"] = True
        result["system"] = data.get("system", {})
        result["devices"] = data.get("devices", [])
    except Exception:
        pass
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
            result["params"] = parse_comfyui_args(raw_args)
            result["pm2_status"] = pm2_env.get("status", "unknown")
            result["pm2_restarts"] = pm2_env.get("restart_time", 0)
            result["pm2_uptime"] = pm2_env.get("pm_uptime", 0)
    except Exception:
        pass
    return jsonify(result)


@bp.route("/api/comfyui/params", methods=["GET"])
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
        current = parse_comfyui_args(raw_args)
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


@bp.route("/api/comfyui/params", methods=["POST"])
def api_comfyui_params_update():
    """更新 ComfyUI 启动参数并重启"""
    data = request.get_json()
    params = data.get("params", {})
    extra_args = data.get("extra_args", "").strip()
    args_str = build_comfyui_args(params)
    if extra_args:
        try:
            tokens = shlex.split(extra_args)
        except ValueError:
            return jsonify({"error": "extra_args 格式无效"}), 400
        args_str = args_str + " " + " ".join(shlex.quote(t) for t in tokens)

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
            f'cd {COMFYUI_DIR} && pm2 start {py} --name comfy '
            f'--interpreter none --log /workspace/comfy.log --time '
            f'--restart-delay 3000 --max-restarts 10 '
            f'-- main.py {args_str}'
        )
        subprocess.run(cmd, shell=True, timeout=30, check=True)
        subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=5)
        return jsonify({"ok": True, "args": args_str})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 队列/控制
# ====================================================================
@bp.route("/api/comfyui/queue")
def api_comfyui_queue():
    try:
        resp = requests.get(f"{COMFYUI_URL}/queue", timeout=5)
        return jsonify(resp.json())
    except Exception:
        return jsonify({"queue_running": [], "queue_pending": [],
                        "error": "ComfyUI 无法连接"})


@bp.route("/api/comfyui/interrupt", methods=["POST"])
def api_comfyui_interrupt():
    try:
        requests.post(f"{COMFYUI_URL}/interrupt", timeout=5)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "ComfyUI 无法连接"}), 503


@bp.route("/api/comfyui/queue/delete", methods=["POST"])
def api_comfyui_queue_delete():
    """删除指定的待排队 prompt（不影响正在执行的）"""
    data = request.get_json(force=True)
    prompt_ids = data.get("delete", [])
    if not prompt_ids:
        return jsonify({"error": "缺少 delete 参数"}), 400
    try:
        requests.post(f"{COMFYUI_URL}/queue",
                      json={"delete": prompt_ids}, timeout=5)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "ComfyUI 无法连接"}), 503


@bp.route("/api/comfyui/queue/clear", methods=["POST"])
def api_comfyui_queue_clear():
    """清空所有待排队的 prompt"""
    try:
        requests.post(f"{COMFYUI_URL}/queue",
                      json={"clear": True}, timeout=5)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "ComfyUI 无法连接"}), 503


@bp.route("/api/comfyui/free", methods=["POST"])
def api_comfyui_free():
    try:
        requests.post(f"{COMFYUI_URL}/free",
                      json={"unload_models": True, "free_memory": True},
                      timeout=10)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "ComfyUI 无法连接"}), 503


# ====================================================================
# 历史 & 图片
# ====================================================================
@bp.route("/api/comfyui/history")
def api_comfyui_history():
    max_items = request.args.get("max_items", 5, type=int)
    try:
        resp = requests.get(f"{COMFYUI_URL}/history",
                            params={"max_items": max_items}, timeout=10)
        raw = resp.json()
        items = []
        for pid, entry in raw.items():
            status = entry.get("status", {})
            outputs = entry.get("outputs", {})
            images = []
            for node_id, node_out in outputs.items():
                for img in node_out.get("images", []):
                    if img.get("type") == "temp":
                        continue
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
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return jsonify({"history": items[:max_items]})
    except Exception:
        return jsonify({"history": [], "error": "ComfyUI 无法连接"})


@bp.route("/api/comfyui/view")
def api_comfyui_view():
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
# SSE 实时事件流 (ComfyUI WS → SSE 桥接)
# ====================================================================
@bp.route("/api/comfyui/events")
def api_comfyui_events():
    bridge = get_bridge()
    sub_id, q = bridge.subscribe()

    def generate():
        try:
            while True:
                try:
                    event = q.get(timeout=30)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            bridge.unsubscribe(sub_id)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@bp.route("/api/comfyui/logs/stream")
def api_comfyui_logs_stream():
    """SSE — pm2 log lines for comfy in real-time."""
    def generate():
        proc = None
        try:
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
