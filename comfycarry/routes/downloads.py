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
  GET  /api/downloads/<id>/events — SSE 实时进度流 (per-task)
  POST /api/downloads/clear     — 清除已完成的历史
  GET  /api/downloads/snapshot  — 资源+任务快照
  GET  /api/downloads/stream    — 全局 SSE 事件流
"""

import json
import logging
import os
import queue
import threading
import time

from flask import Blueprint, Response, jsonify, request

from ..config import COMFYUI_DIR, MODEL_DIRS
from ..services.download_engine import get_engine, DownloadStatus
from ..services.resource_registry import get_registry

logger = logging.getLogger(__name__)

bp = Blueprint("downloads", __name__)

# ── Registry ↔ Engine 集成 ───────────────────────────────────────────────────

_registry_wired = False


def _persist_task(task) -> None:
    """将 engine task 快照写入 download_tasks 表 (fire-and-forget)。"""
    try:
        from ..services import download_store as store
        meta = task.meta or {}
        source = meta.get("source", "")
        model_id = meta.get("model_id", "")
        version_id = meta.get("version_id", "")
        resource_key = f"{source}:{model_id}:{version_id}" if source else ""
        store.upsert_task(
            task_id=task.download_id,
            resource_key=resource_key,
            url=task.url,
            save_dir=task.save_dir,
            filename=task.filename,
            status=task.status.value,
            total_bytes=task.total_bytes,
            completed_bytes=task.completed_bytes,
            speed=task.speed,
            progress=task.progress,
            error=task.error,
            meta=meta,
            completed_at=task.completed_at if task.completed_at else None,
        )
    except Exception as e:
        logger.debug(f"[downloads] task persist failed: {e}")


def _wire_registry():
    """将 download_engine 的状态变化事件桥接到 resource_registry"""
    global _registry_wired
    if _registry_wired:
        return
    _registry_wired = True

    registry = get_registry()
    engine = get_engine()

    # 节流: 进度更新只在跨越 10% 门槛时写入 DB
    _progress_thresholds: dict[str, int] = {}  # download_id → last written 10% bucket

    def _on_status_change(task, old_status, new_status):
        """Engine 状态变化 → Registry 推进 ResourceState + DB 持久化"""
        meta = task.meta or {}
        source = meta.get("source", "")
        model_id = meta.get("model_id", "")
        version_id = meta.get("version_id", "")

        # Registry (仅 civitai 来源)
        if source and model_id:
            if new_status == DownloadStatus.COMPLETE:
                registry.task_complete(source, model_id, version_id,
                                       task.save_dir, task.filename)
            elif new_status == DownloadStatus.FAILED:
                registry.task_failed(source, model_id, version_id, task.error)
            elif new_status == DownloadStatus.CANCELLED:
                registry.task_cancelled(source, model_id, version_id)
            elif new_status == DownloadStatus.PAUSED:
                registry.task_paused(source, model_id, version_id)
            elif new_status in (DownloadStatus.ACTIVE, DownloadStatus.QUEUED):
                if old_status == DownloadStatus.PAUSED:
                    registry.task_resumed(source, model_id, version_id)

        # Emit task event to global stream
        registry.emit_task_event("task.updated", task.to_dict())

        # DB: 状态变化时一律持久化
        _persist_task(task)

    def _on_progress(task):
        """Engine 进度变化 → 全局 SSE 流 + 节流 DB 持久化"""
        registry.emit_task_event("task.progress", task.to_dict())

        # 节流: 仅在进度跨越 10% 门槛时写 DB
        bucket = int(task.progress // 10)
        last = _progress_thresholds.get(task.download_id, -1)
        if bucket != last:
            _progress_thresholds[task.download_id] = bucket
            _persist_task(task)

    engine._on_status_change.append(_on_status_change)
    engine._on_progress.append(_on_progress)
    logger.info("[downloads] Registry ↔ Engine 已连接")


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

    _wire_registry()
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

    # 立即持久化新任务 (消除首次提交→首个 poll tick 之间的空窗)
    _persist_task(task)

    resp = task.to_dict()
    if task.meta.get("existed"):
        resp["existed"] = True
        resp["message"] = f"文件已存在: {filename}"

    return jsonify(resp), 201 if task.status == DownloadStatus.ACTIVE else 200


@bp.route("/api/downloads", methods=["GET"])
def api_downloads_list():
    """获取所有下载任务列表"""
    _wire_registry()
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
    try:
        from ..services import download_store as store
        store.delete_task(download_id)
    except Exception:
        pass

    # Registry: 标记资源为 submit_pending (重试 = 重新走完整生命周期)
    _wire_registry()
    registry = get_registry()
    source = old_task.meta.get("source", "")
    res_model_id = old_task.meta.get("model_id", "")
    res_version_id = old_task.meta.get("version_id", "")
    if source and res_model_id:
        registry.submit_pending(source, res_model_id, res_version_id)

    new_task = engine.submit(
        url=url,
        save_dir=old_task.save_dir,
        filename=old_task.filename,
        meta=old_task.meta,
        on_complete=old_task.on_complete,
    )

    # 立即持久化新任务
    _persist_task(new_task)

    # Registry: 更新提交结果
    if source and res_model_id:
        if new_task.status == DownloadStatus.FAILED:
            registry.task_failed(source, res_model_id, res_version_id,
                                 new_task.error)
        else:
            registry.task_submitted(source, res_model_id, res_version_id,
                                    new_task.download_id)

    if new_task.status == DownloadStatus.FAILED:
        return jsonify({
            **new_task.to_dict(),
            "error": new_task.error or "重试提交失败",
        }), 200  # 200 + error 字段 (兼容前端 useDownloads)

    return jsonify({**new_task.to_dict(), "message": "已重新提交"}), 201


@bp.route("/api/downloads/clear", methods=["POST"])
def api_downloads_clear():
    """清除已完成的历史任务"""
    engine = get_engine()
    count = engine.clear_completed()
    # 同步清理 DB 中的终态 task (保留 24 小时内的)
    try:
        from ..services import download_store as store
        store.clear_terminal_tasks(max_age_seconds=0)
    except Exception as e:
        logger.debug(f"[downloads] DB clear failed: {e}")
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
        enrich_model_by_hash,
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

        # 异步二次丰富: SHA256 → by-hash API → 覆写完整元数据 (含 modelId + images.meta)
        def _enrich():
            try:
                enrich_model_by_hash(model_path, api_key=api_key)
            except Exception as e:
                logger.warning(f"CivitAI 异步 enrich 失败: {e}")

        threading.Thread(target=_enrich, daemon=True).start()

    engine = get_engine()
    _wire_registry()
    registry = get_registry()

    # Registry: 标记资源为 submit_pending
    res_model_id = str(info.get("model_id", ""))
    res_version_id = str(info.get("version_id", ""))
    registry.submit_pending("civitai", res_model_id, res_version_id, meta={
        "model_name": info.get("model_name", ""),
        "model_type": info.get("model_type", ""),
    })

    task = engine.submit(
        url=resolved["url"],
        save_dir=resolved["save_dir"],
        filename=resolved["filename"],
        on_complete=_on_civitai_complete,
        meta={
            "source": "civitai",
            "model_id": res_model_id,
            "version_id": res_version_id,
            "model_name": info.get("model_name", ""),
            "version_name": info.get("version_name", ""),
            "model_type": info.get("model_type", ""),
            "base_model": info.get("base_model", ""),
            "image_url": (info.get("images") or [{}])[0].get("url", ""),
        },
    )

    # 立即持久化新任务 (消除首次提交→首个 poll tick 之间的空窗)
    _persist_task(task)

    existed = task.meta.get("existed", False)

    # Registry: 更新资源状态
    if task.status == DownloadStatus.FAILED:
        registry.task_failed("civitai", res_model_id, res_version_id, task.error)
    elif existed:
        registry.mark_installed("civitai", res_model_id, res_version_id, emit=True)
    else:
        registry.task_submitted("civitai", res_model_id, res_version_id,
                                task.download_id)

    # 提交失败 (aria2 RPC error) — 返回 200 + error 字段 (兼容 useApiFetch)
    if task.status == DownloadStatus.FAILED:
        return jsonify({
            **task.to_dict(),
            "error": task.error or "下载提交失败",
            "message": f"提交失败: {resolved['display_name']}",
            "resource_state": registry.get_state("civitai", res_model_id, res_version_id),
        }), 200

    if existed:
        msg = f"该模型已存在: {resolved['display_name']}"
    else:
        msg = f"已提交: {resolved['display_name']}"

    return jsonify({
        **task.to_dict(),
        "message": msg,
        "existed": existed,
        "resource_state": registry.get_state("civitai", res_model_id, res_version_id),
    }), 201 if task.status == DownloadStatus.ACTIVE else 200


# SSE 轮询间隔 (秒)
_SSE_POLL_INTERVAL = 0.8


# ── Snapshot + Global SSE ────────────────────────────────────────────────────

@bp.route("/api/downloads/snapshot", methods=["GET"])
def api_downloads_snapshot():
    """
    返回资源+任务完整快照.

    响应:
      {
        "tasks": [...],
        "resources": [...],
        "version": 42,
        "server_time": 1710000000.0
      }
    """
    _wire_registry()
    registry = get_registry()
    return jsonify(registry.get_snapshot())


@bp.route("/api/downloads/stream", methods=["GET"])
def api_downloads_stream():
    """
    全局 SSE 事件流 — 所有任务+资源状态变化.

    事件格式:
      data: {"type": "resource.updated", "data": {...}, "time": 1710000000.0}
      data: {"type": "task.updated", "data": {...}, "time": 1710000000.0}
      data: {"type": "task.progress", "data": {...}, "time": 1710000000.0}
    """
    _wire_registry()
    registry = get_registry()
    event_queue: queue.Queue = queue.Queue(maxsize=100)

    def _listener(event):
        try:
            event_queue.put_nowait(event)
        except queue.Full:
            pass  # 丢弃旧事件, 防止阻塞

    registry.add_listener(_listener)

    def _sse_generator():
        heartbeat_counter = 0
        try:
            while True:
                try:
                    event = event_queue.get(timeout=1.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    heartbeat_counter = 0
                except queue.Empty:
                    heartbeat_counter += 1
                    if heartbeat_counter >= 12:  # ~12s
                        yield ": heartbeat\n\n"
                        heartbeat_counter = 0
        finally:
            registry.remove_listener(_listener)

    return Response(
        _sse_generator(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
