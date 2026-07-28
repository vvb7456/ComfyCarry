"""
ComfyCarry — ComfyUI 管理路由

- /api/comfyui/status   — 系统状态 + 启动参数
- /api/comfyui/params   — 参数定义/更新
- /api/comfyui/versions — 版本列表
- /api/comfyui/switch   — 切换版本
- /api/comfyui/queue     — 任务队列
- /api/comfyui/interrupt — 中断执行
- /api/comfyui/history   — 生成历史
- /api/comfyui/view      — 图片代理
- /api/comfyui/events    — SSE 实时事件
- /api/comfyui/logs/stream — SSE 日志流
"""

import json
import queue
import re
import shlex
import subprocess

import requests
from flask import Blueprint, Response, jsonify, request

from ..config import COMFYUI_URL, COMFYUI_DIR, _set_config
from ..services.comfyui_params import (
    COMFYUI_PARAM_GROUPS,
    parse_comfyui_args,
    build_comfyui_args,
)
from ..services.comfyui_bridge import get_bridge
from ..services.comfyui_version import get_versions, switch_version
from ..services.deploy_engine import _detect_python
from ..services.video_thumb import get_video_thumbnail, is_video_filename

bp = Blueprint("comfyui", __name__)


# ====================================================================
# ComfyUI 状态 & 参数
# ====================================================================
@bp.route("/api/comfyui/status")
def api_comfyui_status():
    """获取 ComfyUI 系统状态 + 当前启动参数"""
    result = {"online": False, "system": {},
              "params": {}, "args": []}
    try:
        resp = requests.get(f"{COMFYUI_URL}/system_stats", timeout=5)
        data = resp.json()
        result["online"] = True
        result["system"] = data.get("system", {})
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
                opts = list(gv["options"])
                # 根据安装状态过滤 Attention 选项
                if gk == "attention":
                    from ..config import _get_config
                    has_fa2 = _get_config("installed_fa2", False)
                    has_sa2 = _get_config("installed_sa2", False)
                    if not has_fa2:
                        opts = [o for o in opts if o[0] != "flash"]
                    if not has_sa2:
                        opts = [o for o in opts if o[0] != "sage"]
                schema[gk]["options"] = opts
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

    py = _detect_python()

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

        # 持久化到 .dashboard_env (容器重启后可恢复)
        _set_config("comfyui_args", args_str)

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
    # 后台 session 在跑时先停 session 再 interrupt。
    # 顺序不能反 —— 先 interrupt 再停 session, worker 会把这次中断当成
    # 「一轮结束」立刻重提。先停 session (worker 退出循环) 再 interrupt,
    # 所有中断入口语义统一, 前端零改动。
    # stop_session() 内部已经做了 interrupt + 清队列, 这里直接返回, 不再重复 POST。
    try:
        from ..services.background_run import is_running, stop_session
        if is_running():
            stop_session()
            return jsonify({"ok": True})
    except Exception:
        pass
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


# ====================================================================
# 历史 & 图片
# ====================================================================
@bp.route("/api/comfyui/history")
def api_comfyui_history():
    max_items = request.args.get("max_items", 5, type=int)
    filter_prompt_id = request.args.get("prompt_id", "").strip()
    try:
        if filter_prompt_id:
            # 直接获取特定 prompt 的历史 (ComfyUI 支持 /history/{prompt_id})
            resp = requests.get(f"{COMFYUI_URL}/history/{filter_prompt_id}", timeout=10)
            raw = resp.json()
        else:
            resp = requests.get(f"{COMFYUI_URL}/history",
                                params={"max_items": max_items}, timeout=10)
            raw = resp.json()
        items = []
        for pid, entry in raw.items():
            status = entry.get("status", {})
            outputs = entry.get("outputs", {})
            images = []
            for node_id, node_out in outputs.items():
                # ComfyUI 视频节点 (SaveVideo/PreviewVideo) 在节点输出层带
                # "animated" 字段 (值是 Python 元组 (True,), JSON 序列化为
                # [true]); 图像节点 (SaveImage/PreviewImage) 也带该字段但
                # 恒为 (False,)。该字段位于节点输出层, 与 "images" 平级,
                # 而非单个 image 条目内。这里把它下放到每个 image 条目上,
                # 让前端按条目判定媒体类型, 不用反查节点结构。
                node_animated = node_out.get("animated")
                # 兼容元组/列表/标量三种形态 (元组 JSON→list[True])
                if isinstance(node_animated, (list, tuple)):
                    node_animated = bool(node_animated[0]) if node_animated else False
                else:
                    node_animated = bool(node_animated)
                for img in node_out.get("images", []):
                    filename = img.get("filename", "")
                    # 扩展名兜底: ComfyUI 对 .mp4/.webm/.mov 等视频产物,
                    # 即使 animated 字段缺失也能靠扩展名判定媒体类型
                    ext_is_video = is_video_filename(filename)
                    images.append({
                        "filename": filename,
                        "subfolder": img.get("subfolder", ""),
                        "type": img.get("type", "output"),
                        "animated": bool(node_animated or ext_is_video),
                    })
            # 优先 output 类型, 仅在无 output 时回退到 temp
            # 排除 subfolder 以 "input" 开头的图片 (CN 预处理输出)
            output_imgs = [i for i in images
                           if i["type"] == "output"
                           and not i["subfolder"].startswith("input")]
            temp_imgs = [i for i in images if i["type"] == "temp"]
            images = output_imgs if output_imgs else temp_imgs
            # 无有效 output 图片的条目跳过 (如纯预处理工作流)
            if not output_imgs and not filter_prompt_id:
                continue
            # 从 status.messages 中提取时间戳
            timestamp = 0
            for msg in status.get("messages", []):
                if isinstance(msg, list) and len(msg) >= 2:
                    if msg[0] == "execution_start" and isinstance(msg[1], dict):
                        timestamp = msg[1].get("timestamp", 0)
                        break
            items.append({
                "prompt_id": pid,
                "completed": status.get("completed", False),
                "images": images,
                "timestamp": timestamp,
            })
        items.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
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
        # 视频产物 (SaveVideo mp4, moov atom 在文件尾) 的浏览器播放依赖 Range 请求:
        # 不透传则 Chrome 无法定位元数据 → <video> 灰色、时长恒 0:00。
        # 故转发 Range/If-Range, 回传 206 与 Content-Range/Accept-Ranges 等头, 并流式输出
        # (旧实现 resp.content 一次性读全量, timeout=10 对大视频也不够用)。
        upstream_headers = {"Accept-Encoding": "identity"}
        for h in ("Range", "If-Range"):
            v = request.headers.get(h)
            if v:
                upstream_headers[h] = v
        resp = requests.get(f"{COMFYUI_URL}/view", params=params,
                            headers=upstream_headers,
                            timeout=(5, 120), stream=True)
    except Exception:
        return "", 503

    out_headers = {}
    for h in ("Content-Type", "Content-Length", "Content-Range",
              "Accept-Ranges", "Content-Disposition", "ETag",
              "Last-Modified", "Cache-Control"):
        v = resp.headers.get(h)
        if v:
            out_headers[h] = v
    out_headers.setdefault("Content-Type", "application/octet-stream")
    # 上游 (aiohttp) 恒支持 Range; 即便本次请求未带 Range 也声明能力,
    # 浏览器后续分段请求才会发出。
    out_headers.setdefault("Accept-Ranges", "bytes")

    def stream():
        try:
            yield from resp.iter_content(chunk_size=64 * 1024)
        finally:
            resp.close()

    return Response(stream(), status=resp.status_code, headers=out_headers)


# ====================================================================
# 视频首帧缩略图 (ffmpeg 抽帧 + 磁盘缓存)
# ====================================================================
# 端点最终 URL: GET /api/comfyui/video_thumb
# 参数签名 (与 /api/comfyui/view 对齐):
#   filename  (必填) — ComfyUI output 下的文件名 (如 ComfyUI_00001_.mp4)
#   subfolder (可选) — 子目录 (如 video/Wan2.2_i2v)
#   type      (可选) — output (默认) / temp / input
# 返回: image/webp (首帧缩略图), 命中缓存直接返回
# 失败: 400 缺参 / 404 文件不可达 / 415 非视频或损坏 / 500 缓存目录问题 / 502 ffmpeg 失败
@bp.route("/api/comfyui/video_thumb")
def api_comfyui_video_thumb():
    filename = request.args.get("filename", "")
    subfolder = request.args.get("subfolder", "")
    img_type = request.args.get("type", "output")
    data, err, status = get_video_thumbnail(filename, subfolder, img_type)
    if data is None:
        return jsonify({"error": err or "未知错误"}), status
    return data, 200, {"Content-Type": "image/webp",
                       "Cache-Control": "public, max-age=86400"}


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


# ====================================================================
# 版本管理
# ====================================================================

@bp.route("/api/comfyui/versions")
def api_comfyui_versions():
    """获取所有可用 ComfyUI 版本 (git tags)"""
    fetch = request.args.get("fetch", "true").lower() != "false"
    return jsonify(get_versions(fetch=fetch))


@bp.route("/api/comfyui/switch", methods=["POST"])
def api_comfyui_switch():
    """切换 ComfyUI 版本并重启"""
    data = request.get_json(silent=True) or {}
    version = data.get("version", "").strip()
    install_deps = data.get("install_deps", False)

    if not version:
        return jsonify({"ok": False, "error": "缺少 version 参数"}), 400

    result = switch_version(version, install_deps=install_deps)
    if not result["ok"]:
        return jsonify(result), 500

    # 重启 ComfyUI PM2 进程
    try:
        subprocess.run(["pm2", "restart", "comfy"], capture_output=True, timeout=15)
    except Exception:
        result["warning"] = "版本已切换，但 PM2 重启失败，请手动重启"

    return jsonify(result)
