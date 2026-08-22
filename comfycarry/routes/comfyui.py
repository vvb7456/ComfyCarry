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
"""

import json
import queue
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


def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `comfyui.err.<key>` 翻译; _extra 是响应体的附加顶层字段。"""
    body = {"error_key": f"comfyui.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


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
        return _err("internal", 500, detail=str(e))


def restart_comfyui(args_str: str = "") -> tuple[bool, dict | None]:
    """用 delete + start 重建 comfy 进程 (不能用 pm2 restart -- 后者沿用 dump 旧配置,
    会丢 --log /workspace/comfy.log, 日志回默认 ~/.pm2/logs/, 前端面板看不到)。

    args_str 为空时用已保存的 comfyui_args。启动前以磁盘上的 ComfyUI 源码
    校验参数有效性 (上游删掉的 flag 会让进程起不来并被 pm2 反复拉起),
    校验不通过时不碰 pm2。

    返回 (是否成功, 错误体)。错误体为 {"error_key", "error_params"} 形态,
    与 _err() 的响应契约一致, 可直接 jsonify 给前端 toast; 成功时为 None。
    """
    if not args_str:
        from ..config import _get_config
        from ..services.comfyui_params import ensure_preview_method
        args_str = ensure_preview_method(_get_config("comfyui_args", ""))
    py = _detect_python()

    from ..services.comfyui_args_check import check_comfyui_args
    check_ok, unsupported = check_comfyui_args(args_str, python=py)
    if not check_ok:
        return False, {"error_key": "comfyui.err.args_check_failed"}
    if unsupported:
        return False, {
            "error_key": "comfyui.err.unsupported_args",
            "error_params": {"flags": ", ".join(unsupported)},
        }
    try:
        # 清掉 pm2 注入的日志路径环境变量, 否则它们覆盖 --log 命令行参数
        # (pm2 把 pm_log_path 等注入被管理进程, dashboard 继承后调 pm2 start
        # 时这些环境变量被传给 pm2 CLI, 覆盖 --log /workspace/comfy.log)。
        from ..services.log_service import clean_pm2_env
        env = clean_pm2_env()
        subprocess.run("pm2 delete comfy 2>/dev/null || true", shell=True, timeout=10, env=env)
        import time as _time
        _time.sleep(1)
        cmd = (
            f'cd {COMFYUI_DIR} && pm2 start {py} --name comfy '
            f'--interpreter none --log /workspace/comfy.log --merge-logs --time '
            f'--restart-delay 3000 --max-restarts 10 '
            f'-- main.py {args_str}'
        )
        subprocess.run(cmd, shell=True, timeout=30, check=True, env=env)
        subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=5, env=env)
        return True, None
    except Exception as e:
        return False, {"error_key": "comfyui.err.internal",
                       "error_params": {"detail": str(e)}}


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
            return _err("invalid_extra_args")
        args_str = args_str + " " + " ".join(shlex.quote(t) for t in tokens)

    ok, err_body = restart_comfyui(args_str)
    if not ok:
        return jsonify(err_body), 500

    # 持久化到 .dashboard_env (容器重启后可恢复)
    _set_config("comfyui_args", args_str)

    return jsonify({"ok": True, "args": args_str})


@bp.route("/api/comfyui/restart", methods=["POST"])
def api_comfyui_restart():
    """重启 ComfyUI (pm2 delete + start, 沿用已保存的启动参数, 保留 --log)。

    供插件管理等场景独立触发重启; 参数页的重启走 params POST (保存+重启)。
    """
    ok, err_body = restart_comfyui()
    if not ok:
        return jsonify(err_body), 500
    return jsonify({"ok": True})


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
                        "error_key": "comfyui.err.unreachable",
                        "error_params": {}})


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
        return _err("unreachable", 503)


@bp.route("/api/comfyui/queue/delete", methods=["POST"])
def api_comfyui_queue_delete():
    """删除指定的待排队 prompt（不影响正在执行的）"""
    data = request.get_json(force=True)
    prompt_ids = data.get("delete", [])
    if not prompt_ids:
        return _err("missing_delete_param")
    try:
        requests.post(f"{COMFYUI_URL}/queue",
                      json={"delete": prompt_ids}, timeout=5)
        return jsonify({"ok": True})
    except Exception:
        return _err("unreachable", 503)


@bp.route("/api/comfyui/queue/clear", methods=["POST"])
def api_comfyui_queue_clear():
    """清空所有待排队的 prompt"""
    try:
        requests.post(f"{COMFYUI_URL}/queue",
                      json={"clear": True}, timeout=5)
        return jsonify({"ok": True})
    except Exception:
        return _err("unreachable", 503)


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
        return jsonify({"history": [],
                        "error_key": "comfyui.err.unreachable",
                        "error_params": {}})


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
        return _err("video_thumb_failed", status, detail=err or "")
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
        return _err("missing_version")

    result = switch_version(version, install_deps=install_deps)
    if not result["ok"]:
        # result 本身已经是 key + params 形态 (见 switch_version docstring)
        return jsonify(result), 500

    # 重启 ComfyUI (delete + start, 不能用 pm2 restart -- 会丢 --log)。
    # 版本已切换成功, 重启失败只降级为警告; 若是参数校验不通过, 警告里
    # 带上具体失效的 flag (新版本没有旧参数)。
    ok, err_body = restart_comfyui()
    if not ok:
        if err_body and err_body.get("error_key") == "comfyui.err.unsupported_args":
            result["warning_key"] = err_body["error_key"]
            result["warning_params"] = err_body.get("error_params", {})
        else:
            result["warning_key"] = "comfyui.warn.switch_restart"

    return jsonify(result)
