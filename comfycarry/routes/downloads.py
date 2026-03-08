"""
ComfyCarry — Downloads 路由

通用下载管理 API, 基于 download_engine.py (aria2c JSON-RPC).

端点:
  POST /api/downloads/check    — 检查文件是否已安装 (单个或批量)
  POST /api/downloads           — 提交下载任务
  GET  /api/downloads           — 获取所有下载任务列表
  GET  /api/downloads/<id>      — 获取单个任务状态
  POST /api/downloads/<id>/cancel — 取消下载
  POST /api/downloads/<id>/pause  — 暂停下载 (断点续传)
  POST /api/downloads/<id>/resume — 恢复暂停的下载
  GET  /api/downloads/<id>/events — SSE 实时进度流
  POST /api/downloads/clear     — 清除已完成的历史
"""

import json
import logging
import os
import time

from flask import Blueprint, Response, jsonify, request

from ..config import COMFYUI_DIR, MODEL_DIRS
from ..services.download_engine import get_engine, DownloadStatus

logger = logging.getLogger(__name__)

bp = Blueprint("downloads", __name__)


@bp.route("/api/downloads/check", methods=["POST"])
def api_downloads_check():
    """
    检查文件是否已安装 + 是否有活跃下载.

    请求体:
      单文件: {"save_dir": "/path", "filename": "model.safetensors"}
      批量:   {"files": [{"save_dir": "...", "filename": "..."}, ...]}

    响应:
      单文件: {"installed": bool, "downloading": bool, "download_id": str|null}
      批量:   {"results": [{...}, ...]}
    """
    data = request.get_json(force=True) or {}
    engine = get_engine()

    # 批量模式
    if "files" in data:
        results = engine.check_files(data["files"])
        return jsonify({"results": results})

    # 单文件模式
    save_dir = data.get("save_dir", "").strip()
    filename = data.get("filename", "").strip()
    if not save_dir or not filename:
        return jsonify({"error": "save_dir 和 filename 必填"}), 400

    result = engine.check_file(save_dir, filename)
    return jsonify(result)


@bp.route("/api/downloads", methods=["POST"])
def api_downloads_submit():
    """
    提交下载任务.

    请求体:
      {
        "url": "https://...",
        "save_dir": "/path/to/save",          // 绝对路径, 或
        "model_type": "checkpoints",           // 使用 MODEL_DIRS 解析 (与 save_dir 二选一)
        "filename": "model.safetensors",
        "headers": {"Authorization": "Bearer xxx"},   // 可选
        "meta": {"source": "huggingface", ...}         // 可选
      }

    响应:
      {"download_id": "dl-abc123", "status": "active", ...}
    """
    data = request.get_json(force=True) or {}
    url = data.get("url", "").strip()
    save_dir = data.get("save_dir", "").strip()
    filename = data.get("filename", "").strip()
    model_type = data.get("model_type", "").strip()

    if not url:
        return jsonify({"error": "url 必填"}), 400
    if not filename:
        return jsonify({"error": "filename 必填"}), 400

    # 如果没有 save_dir 但有 model_type, 从 MODEL_DIRS 解析
    if not save_dir and model_type:
        rel_dir = MODEL_DIRS.get(model_type)
        if not rel_dir:
            rel_dir = f"models/{model_type}" if model_type else "models/other"
        save_dir = os.path.join(COMFYUI_DIR, rel_dir)

    if not save_dir:
        return jsonify({"error": "save_dir 或 model_type 必填"}), 400

    engine = get_engine()
    headers = data.get("headers")
    meta = data.get("meta")

    task = engine.submit(
        url=url,
        save_dir=save_dir,
        filename=filename,
        meta=meta,
        headers=headers,
    )

    resp = task.to_dict()
    if task.meta.get("existed"):
        resp["existed"] = True
        resp["message"] = f"文件已存在: {filename}"

    return jsonify(resp), 201 if task.status == DownloadStatus.ACTIVE else 200


@bp.route("/api/downloads", methods=["GET"])
def api_downloads_list():
    """获取所有下载任务列表"""
    engine = get_engine()
    tasks = engine.list_tasks()
    return jsonify({"tasks": tasks})


@bp.route("/api/downloads/<download_id>", methods=["GET"])
def api_downloads_get(download_id: str):
    """获取单个任务状态"""
    engine = get_engine()
    task = engine.get_task(download_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task.to_dict())


@bp.route("/api/downloads/<download_id>/cancel", methods=["POST"])
def api_downloads_cancel(download_id: str):
    """取消下载任务"""
    engine = get_engine()
    ok = engine.cancel(download_id)
    if not ok:
        task = engine.get_task(download_id)
        if not task:
            return jsonify({"error": "任务不存在"}), 404
        return jsonify({"error": f"任务状态为 {task.status.value}, 无法取消"}), 409
    return jsonify({"ok": True, "download_id": download_id})


@bp.route("/api/downloads/<download_id>/pause", methods=["POST"])
def api_downloads_pause(download_id: str):
    """暂停下载任务 (支持断点续传)"""
    engine = get_engine()
    ok = engine.pause(download_id)
    if not ok:
        task = engine.get_task(download_id)
        if not task:
            return jsonify({"error": "任务不存在"}), 404
        return jsonify({"error": f"任务状态为 {task.status.value}, 无法暂停"}), 409
    return jsonify({"ok": True, "download_id": download_id})


@bp.route("/api/downloads/<download_id>/resume", methods=["POST"])
def api_downloads_resume(download_id: str):
    """恢复已暂停的下载任务"""
    engine = get_engine()
    ok = engine.resume(download_id)
    if not ok:
        task = engine.get_task(download_id)
        if not task:
            return jsonify({"error": "任务不存在"}), 404
        return jsonify({"error": f"任务状态为 {task.status.value}, 无法恢复"}), 409
    return jsonify({"ok": True, "download_id": download_id})


@bp.route("/api/downloads/<download_id>/events", methods=["GET"])
def api_downloads_events(download_id: str):
    """
    SSE 实时进度流.

    事件格式:
      data: {"status": "active", "progress": 45.2, "speed": 52428800, ...}

    当下载完成/失败/取消时发送最终事件并关闭连接.
    """
    engine = get_engine()
    task = engine.get_task(download_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404

    def _sse_generator():
        last_progress = -1
        heartbeat_counter = 0
        terminal_states = (
            DownloadStatus.COMPLETE,
            DownloadStatus.FAILED,
            DownloadStatus.CANCELLED,
        )

        while True:
            t = engine.get_task(download_id)
            if not t:
                yield f"data: {json.dumps({'error': '任务已删除'})}\n\n"
                break

            # 进度变化或终态 → 推送数据
            if t.progress != last_progress or t.status in terminal_states:
                event = {
                    "status": t.status.value,
                    "progress": t.progress,
                    "completed_bytes": t.completed_bytes,
                    "total_bytes": t.total_bytes,
                    "speed": t.speed,
                    "filename": t.filename,
                }
                if t.error:
                    event["error"] = t.error
                yield f"data: {json.dumps(event)}\n\n"
                last_progress = t.progress
                heartbeat_counter = 0
            else:
                # 进度无变化时定期发心跳, 防止连接被中间件/浏览器超时断开
                heartbeat_counter += 1
                if heartbeat_counter >= 15:  # 约每 12 秒
                    yield ": heartbeat\n\n"
                    heartbeat_counter = 0

            if t.status in terminal_states:
                break

            time.sleep(_SSE_POLL_INTERVAL)

    return Response(
        _sse_generator(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@bp.route("/api/downloads/<download_id>/retry", methods=["POST"])
def api_downloads_retry(download_id: str):
    """重试失败的下载 — 重新提交相同任务"""
    engine = get_engine()
    old_task = engine.get_task(download_id)
    if not old_task:
        return jsonify({"error": "任务不存在"}), 404
    if old_task.status != DownloadStatus.FAILED:
        return jsonify({"error": f"任务状态为 {old_task.status.value}, 无需重试"}), 409

    url = old_task.url

    # CivitAI 下载重试时重新注入当前 API Key
    if old_task.meta.get("source") == "civitai":
        from ..utils import _get_api_key
        from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
        api_key = _get_api_key()
        # 先移除旧的 token 参数
        parsed = urlparse(url)
        params = parse_qs(parsed.query, keep_blank_values=True)
        params.pop("token", None)
        new_query = urlencode(params, doseq=True)
        url = urlunparse(parsed._replace(query=new_query))
        # 注入新的 token
        if api_key and api_key.strip():
            sep = "&" if "?" in url and url.split("?")[1] else "?"
            url += f"{sep}token={api_key}"

    # 移除旧的失败记录
    engine.clear_task(download_id)

    new_task = engine.submit(
        url=url,
        save_dir=old_task.save_dir,
        filename=old_task.filename,
        meta=old_task.meta,
        on_complete=old_task.on_complete,
    )
    return jsonify({**new_task.to_dict(), "message": "已重新提交"}), 201


@bp.route("/api/downloads/clear", methods=["POST"])
def api_downloads_clear():
    """清除已完成的历史任务"""
    engine = get_engine()
    count = engine.clear_completed()
    return jsonify({"ok": True, "cleared": count})


@bp.route("/api/downloads/civitai", methods=["POST"])
def api_downloads_civitai():
    """
    提交 CivitAI 模型下载任务.

    请求体:
      {
        "model_id": "12345" 或 CivitAI URL,
        "model_type": "checkpoint",
        "version_id": 67890,
        "custom_filename": "my_model.safetensors",
        "api_key": "..."
      }

    响应:
      {"download_id": "dl-xxx", "status": "active", "message": "...", ...}
    """
    from ..services.civitai_resolver import (
        resolve_civitai_download, save_model_metadata, download_preview_image,
    )
    from ..utils import _get_api_key

    data = request.get_json(force=True) or {}
    model_input = str(data.get("model_id", "")).strip()
    if not model_input:
        return jsonify({"error": "model_id 必填"}), 400

    api_key = data.get("api_key") or _get_api_key()
    model_type = data.get("model_type", "")
    version_id = data.get("version_id")
    if version_id:
        try:
            version_id = int(version_id)
        except (ValueError, TypeError):
            version_id = None
    custom_filename = data.get("custom_filename", "")

    try:
        resolved = resolve_civitai_download(
            input_str=model_input,
            model_type=model_type,
            version_id=version_id,
            api_key=api_key,
            custom_filename=custom_filename,
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

    # Early Access 付费模型检测
    info = resolved["info"]
    if info.get("availability") == "EarlyAccess":
        ea = info.get("early_access_config") or {}
        if ea.get("chargeForDownload"):
            price = ea.get("downloadPrice", "?")
            return jsonify({
                "error": f"该模型为 Early Access 付费模型，需要 {price} Buzz 才能下载。请在 CivitAI 网站购买后再试。",
                "early_access": True,
            }), 403
        # EarlyAccess 但不收费: 可能仅需登录, 继续尝试下载

    def _on_civitai_complete(task):
        model_path = os.path.join(task.save_dir, task.filename)
        try:
            save_model_metadata(model_path, info)
            download_preview_image(model_path, info.get("images", []))
        except Exception as e:
            logger.warning(f"CivitAI 元数据保存失败: {e}")

    engine = get_engine()
    task = engine.submit(
        url=resolved["url"],
        save_dir=resolved["save_dir"],
        filename=resolved["filename"],
        on_complete=_on_civitai_complete,
        meta={
            "source": "civitai",
            "model_id": info.get("model_id"),
            "version_id": info.get("version_id"),
            "model_name": info.get("model_name", ""),
            "version_name": info.get("version_name", ""),
            "model_type": info.get("model_type", ""),
            "base_model": info.get("base_model", ""),
            "image_url": (info.get("images") or [{}])[0].get("url", ""),
        },
    )

    existed = task.meta.get("existed", False)
    if existed:
        msg = f"该模型已存在: {resolved['display_name']}"
    else:
        msg = f"已提交: {resolved['display_name']}"

    return jsonify({
        **task.to_dict(),
        "message": msg,
        "existed": existed,
    }), 201 if task.status == DownloadStatus.ACTIVE else 200


# SSE 轮询间隔 (秒)
_SSE_POLL_INTERVAL = 0.8
