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
import time

from flask import Blueprint, Response, jsonify, request

from ..config import COMFYUI_DIR, MODEL_DIRS
from ..services.download_engine import get_engine, DownloadStatus
from ..services.resource_registry import get_registry
from ..utils import _sha256_file

logger = logging.getLogger(__name__)

bp = Blueprint("downloads", __name__)

# ComfyUI 根的 realpath (用于 subdir 防路径遍历校验)
_REAL_COMFYUI_DIR = os.path.realpath(COMFYUI_DIR)


# ====================================================================
# 响应文案 —— key + params, 前端按 `models.err.<key>` 翻译
# (downloads 路由复用 models 命名空间, 与 favorites.py 同策略)
# ====================================================================
def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `models.err.<key>` 翻译; _extra 是响应体的附加顶层字段。"""
    body = {"error_key": f"models.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


def _resolve_check_save_dir(spec: dict) -> str | None:
    """解析文件检查的目标目录 (save_dir)。

    - 提供 subdir (相对 ComfyUI 根, 如 "models/text_encoders"): 用
      os.path.join(COMFYUI_DIR, subdir) 解析, 忽略 save_dir; realpath 结果
      必须位于 COMFYUI_DIR 之下, 否则返回 None (按未安装处理)。
    - 未提供 subdir: 维持现有 save_dir (绝对路径) 行为, 不做遍历校验。
    """
    subdir = (spec.get("subdir") or "").strip()
    if subdir:
        save_dir = os.path.join(COMFYUI_DIR, subdir)
        if not os.path.realpath(save_dir).startswith(_REAL_COMFYUI_DIR + os.sep):
            return None
        return save_dir
    return (spec.get("save_dir") or "").strip()


def _check_file_spec(engine, spec: dict) -> dict:
    """单条文件检查, 返回 {installed, downloading, download_id}。

    目录解析失败 (subdir 越界 / 缺失) 或 filename 缺失时按未安装处理。
    """
    filename = (spec.get("filename") or "").strip()
    if not filename:
        return {"installed": False, "downloading": False, "download_id": None}
    save_dir = _resolve_check_save_dir(spec)
    if not save_dir:
        return {"installed": False, "downloading": False, "download_id": None}
    return engine.check_file(save_dir, filename)


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

        # 下载完成 → 立即失效 Generate 下拉选项缓存。
        # 新落盘的 checkpoint / UNet / 文本编码器 / VAE 必须马上能出现在选择器与
        # 高级设置的下拉里 (用户预期: 组件下完 select 自动出现并选中), 不能等
        # options 的 300s TTL。放在 emit 之前, 保证前端收到 SSE 完成事件时后端已是新数据。
        if new_status == DownloadStatus.COMPLETE:
            try:
                from .generate import invalidate_options_cache
                invalidate_options_cache()
            except Exception as e:
                logger.debug(f"[downloads] 失效 options 缓存失败 (非致命): {e}")

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
              或 {"subdir": "models/text_encoders", "filename": "model.safetensors"}
      批量:   {"files": [{"save_dir"|"subdir": "...", "filename": "..."}, ...]}

    subdir 为相对 ComfyUI 根的目录 (如 "models/text_encoders"), 提供时后端
    用 os.path.join(COMFYUI_DIR, subdir) 解析并忽略 save_dir; 防路径遍历:
    realpath 结果必须位于 COMFYUI_DIR 之下, 否则该项按未安装处理.

    响应:
      单文件: {"installed": bool, "downloading": bool, "download_id": str|null}
      批量:   {"results": [{...}, ...]}
    """
    data = request.get_json(force=True) or {}
    engine = get_engine()

    # 批量模式
    if "files" in data:
        results = [_check_file_spec(engine, spec) for spec in data["files"]]
        return jsonify({"results": results})

    # 单文件模式
    result = _check_file_spec(engine, data)
    if not (data.get("subdir", "").strip() or data.get("save_dir", "").strip()
            or data.get("filename", "").strip()):
        return _err("dl_missing_dir_or_filename")
    # subdir 路径越界或 filename 缺失时 _check_file_spec 已返回未安装,
    # 此处统一走正常响应, 避免把非法路径暴露为 4xx
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
    # CivitAI 来源 → 走原 /api/downloads/civitai 全套逻辑 (source 为顶层字段)
    if data.get("source") == "civitai":
        return _handle_civitai_source(data)
    # Hugging Face 来源 → 通用 URL 下载 + 白名单元数据完成登记 (SPEC §7-A)
    if data.get("source") == "huggingface":
        return _handle_huggingface_source(data)

    url = data.get("url", "").strip()
    save_dir = data.get("save_dir", "").strip()
    filename = data.get("filename", "").strip()
    model_type = data.get("model_type", "").strip()

    if not url:
        return _err("dl_url_required")
    if not filename:
        return _err("dl_filename_required")

    # 如果没有 save_dir 但有 model_type, 从 MODEL_DIRS 解析
    if not save_dir and model_type:
        rel_dir = MODEL_DIRS.get(model_type)
        if not rel_dir:
            rel_dir = f"models/{model_type}" if model_type else "models/other"
        save_dir = os.path.join(COMFYUI_DIR, rel_dir)

    if not save_dir:
        return _err("dl_save_dir_or_model_type_required")

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
        resp["message_key"] = "models.msg.dl_already_exists"
        resp["message_params"] = {"filename": filename}

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
        return _err("dl_task_not_found", 404)
    return jsonify(task.to_dict())


@bp.route("/api/downloads/<download_id>/cancel", methods=["POST"])
def api_downloads_cancel(download_id: str):
    """取消下载任务"""
    engine = get_engine()
    ok = engine.cancel(download_id)
    if not ok:
        task = engine.get_task(download_id)
        if not task:
            return _err("dl_task_not_found", 404)
        return _err("dl_cannot_cancel", 409, status=task.status.value)
    return jsonify({"ok": True, "download_id": download_id})


@bp.route("/api/downloads/<download_id>/pause", methods=["POST"])
def api_downloads_pause(download_id: str):
    """暂停下载任务 (支持断点续传)"""
    engine = get_engine()
    ok = engine.pause(download_id)
    if not ok:
        task = engine.get_task(download_id)
        if not task:
            return _err("dl_task_not_found", 404)
        return _err("dl_cannot_pause", 409, status=task.status.value)
    return jsonify({"ok": True, "download_id": download_id})


@bp.route("/api/downloads/<download_id>/resume", methods=["POST"])
def api_downloads_resume(download_id: str):
    """恢复已暂停的下载任务"""
    engine = get_engine()
    ok = engine.resume(download_id)
    if not ok:
        task = engine.get_task(download_id)
        if not task:
            return _err("dl_task_not_found", 404)
        return _err("dl_cannot_resume", 409, status=task.status.value)
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
        return _err("dl_task_not_found", 404)

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
                yield ("data: " + json.dumps(
                    {"error_key": "models.err.dl_task_deleted"}) + "\n\n")
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
        return _err("dl_task_not_found", 404)
    if old_task.status != DownloadStatus.FAILED:
        return _err("dl_no_retry_needed", 409, status=old_task.status.value)

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
        elif new_task.status == DownloadStatus.COMPLETE:
            registry.task_complete(
                source,
                res_model_id,
                res_version_id,
                new_task.save_dir,
                new_task.filename,
            )
        else:
            registry.task_submitted(source, res_model_id, res_version_id,
                                    new_task.download_id)

    if new_task.status == DownloadStatus.FAILED:
        return jsonify({
            **new_task.to_dict(),
            "error_key": "models.err.dl_retry_failed",
            # aria2 原文进 {detail} —— 之前只回通用文案, 用户看不到真实原因
            "error_params": {"detail": new_task.error or ""},
        }), 200  # 200 而非 4xx: 响应体带 task 快照, stores/downloads.ts 要用

    status = 201 if new_task.status == DownloadStatus.ACTIVE else 200
    return jsonify({**new_task.to_dict(), "message_key": "models.msg.dl_resubmitted"}), status


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


def _handle_civitai_source(data: dict):
    """
    处理 CivitAI 来源 (source == 'civitai') 的下载 — 原 /api/downloads/civitai 逻辑。

    请求体:
      {
        "source": "civitai",
        "model_id": "12345" 或 CivitAI URL,
        "model_type": "checkpoint",
        "version_id": 67890,
        "custom_filename": "my_model.safetensors",
        "api_key": "...",
        "dir_keys": {"<filename>": "<MODEL_DIRS key>"}   // 用户裁决 (二次提交)
      }

    响应:
      {"download_id": "dl-xxx", "status": "active", "message": "...", ...}

      判不出目录时**不提交下载**, 返回 409 + needs_classification, 前端弹目录
      选择, 用户选完带 dir_keys 重新调本端点。契约见
      docs/DOWNLOAD_CLASSIFICATION_SPEC.md §5-B。
    """
    from ..services.civitai_resolver import (
        resolve_civitai_download, download_preview_image,
        extract_file_trigger_words, NoDownloadableFiles,
    )
    from ..services.model_meta_store import register_downloaded_model
    from ..services.header_probe import ProbeAuthError
    from ..utils import _get_api_key

    model_input = str(data.get("model_id", "")).strip()
    if not model_input:
        return _err("dl_model_id_required")

    api_key = data.get("api_key") or _get_api_key()
    model_type = data.get("model_type", "")
    version_id = data.get("version_id")
    if version_id:
        try:
            version_id = int(version_id)
        except (ValueError, TypeError):
            version_id = None
    custom_filename = data.get("custom_filename", "")

    # 用户在目录选择 modal 里的裁决 (二次提交时带回)。只接受 MODEL_DIRS 里的 key,
    # 防止前端传任意路径造成目录穿越。
    dir_keys = {}
    raw_dir_keys = data.get("dir_keys") or {}
    if isinstance(raw_dir_keys, dict):
        for fname, key in raw_dir_keys.items():
            key = str(key or "").strip()
            if key and key in MODEL_DIRS:
                dir_keys[str(fname)] = key

    try:
        resolved = resolve_civitai_download(
            input_str=model_input,
            model_type=model_type,
            version_id=version_id,
            api_key=api_key,
            custom_filename=custom_filename,
            dir_keys=dir_keys or None,
        )
    except ValueError as e:
        return _err("dl_civitai_invalid", 400, detail=str(e))
    except ProbeAuthError:
        # T1 探针收到 401 —— 文件需付费或无权限下载。
        # 不创建下载任务 (探针是 preflight, 在建任务前拦住)。
        # 返回 403 + probe_auth 标记, 前端据此 toast 且不进 409 弹窗流程。
        return _err("dl_probe_auth", 403, _extra={"probe_auth": True})
    except NoDownloadableFiles as e:
        # 422 而非 502 —— 是这个 version 的内容本身没有权重, 重试无用。
        return _err("dl_no_downloadable", 422, detail=str(e))
    except RuntimeError as e:
        return _err("dl_civitai_runtime", 502, detail=str(e))

    # 有文件判不出目录 → 不提交下载, 让前端弹目录选择。
    # 用 409 而非 200: 这是一次**未完成**的提交, 前端必须处理后重试。
    if resolved.get("needs_classification"):
        return jsonify({
            "needs_classification": True,
            "pending_files": resolved["pending_files"],
            "civitai_url": resolved.get("civitai_url", ""),
            "display_name": resolved.get("display_name", ""),
            "model_id": model_input,
            "version_id": version_id,
            # 可选目录全集随响应下发, 前端不再复制一份 MODEL_DIRS (单一事实源)
            "dir_options": [
                {"key": k, "path": v} for k, v in sorted(MODEL_DIRS.items())
            ],
        }), 409

    # Early Access 付费模型检测
    info = resolved["info"]
    if info.get("availability") == "EarlyAccess":
        ea = info.get("early_access_config") or {}
        if ea.get("chargeForDownload"):
            price = ea.get("downloadPrice", "?")
            return _err("dl_early_access", 403, price=price, _extra={"early_access": True})
        # EarlyAccess 但不收费: 可能仅需登录, 继续尝试下载

    def _on_civitai_complete(task):
        # 目录已在下载前逐文件定好；完成钩子在终态广播前登记模型元数据。
        model_path = os.path.join(task.save_dir, task.filename)
        sha256 = _sha256_file(model_path)
        if not sha256:
            raise RuntimeError("SHA256 计算失败")
        download_preview_image(model_path, info.get("images", []))
        detail = register_downloaded_model(
            model_path=model_path,
            category=resolved.get("model_type", "") or info.get("save_dir_key", ""),
            source_data=info,
            sha256=sha256,
            file_trigger_words=extract_file_trigger_words(model_path),
        )
        task.meta["local_model_id"] = detail["id"]

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
            "completion_requires_callback": True,
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
            "error_key": "models.err.dl_submit_failed",
            "error_params": {"name": resolved['display_name'],
                             "detail": task.error or ""},
            "resource_state": registry.get_state("civitai", res_model_id, res_version_id),
        }), 200

    if existed:
        msg_key = "models.msg.dl_model_exists"
        msg_params = {"name": resolved['display_name']}
    else:
        msg_key = "models.msg.dl_submitted"
        msg_params = {"name": resolved['display_name']}

    return jsonify({
        **task.to_dict(),
        "message_key": msg_key,
        "message_params": msg_params,
        "existed": existed,
        "resource_state": registry.get_state("civitai", res_model_id, res_version_id),
    }), 201 if task.status == DownloadStatus.ACTIVE else 200


def _handle_huggingface_source(data: dict):
    """
    处理 Hugging Face 来源 (source == 'huggingface') 的下载。

    请求体 (白名单契约, SPEC §2-C / §6-E):
      {
        "source": "huggingface",
        "url": "https://huggingface.co/.../resolve/main/model.safetensors",
        "model_type": "checkpoints",
        "filename": "model.safetensors",
        "meta": {
          "model_id": "-100001", "version_id": "-10000101",
          "model_name": "...", "version_name": "...", "category": "checkpoints",
          "model_type": "Checkpoint", "base_model": "SDXL 1.0",
          "architecture": "sdxl", "sha256": "...", "size_bytes": 0,
          "trained_words": [...], "images": [...], "author": "...", "source_url": "..."
        }
      }

    目录按 model_type → MODEL_DIRS 解析 (与通用路径一致), 不做目录裁决。
    文件下载完成后由 _on_huggingface_complete 把任务携带的白名单元数据直接登记到
    模型索引 (SPEC §7-B)。响应结构与通用下载一致 (download_id / status /
    existed / message_key 等)。
    """
    from ..services.model_meta_store import register_downloaded_model

    url = data.get("url", "").strip()
    filename = data.get("filename", "").strip()
    model_type = data.get("model_type", "").strip()
    meta = data.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}

    if not url:
        return _err("dl_url_required")
    if not filename:
        return _err("dl_filename_required")

    # 与通用路径相同的 model_type → MODEL_DIRS 目录解析 (不新造)
    rel_dir = MODEL_DIRS.get(model_type)
    if not rel_dir:
        rel_dir = f"models/{model_type}" if model_type else "models/other"
    save_dir = os.path.join(COMFYUI_DIR, rel_dir)

    def _on_huggingface_complete(task):
        # 白名单元数据直接登记; 回调期间不读取模型文件内容 (SPEC §7-B / §11-B-4)。
        model_path = os.path.join(task.save_dir, task.filename)
        detail = register_downloaded_model(
            model_path=model_path,
            category=task.meta["category"],
            source_data=task.meta,
            sha256=task.meta["sha256"],
            file_trigger_words=[],
        )
        task.meta["local_model_id"] = detail["id"]

    # 任务 meta: 白名单字段 + 强制完成登记回调 (前端已传则尊重, 缺省补 true)
    task_meta = dict(meta)
    task_meta.setdefault("source", "huggingface")
    task_meta.setdefault("category", model_type)
    task_meta.setdefault("completion_requires_callback", True)

    _wire_registry()
    engine = get_engine()
    registry = get_registry()

    # Registry: 标记资源为 submit_pending (资源 key: huggingface:<model_id>:<version_id>)
    res_model_id = str(meta.get("model_id", ""))
    res_version_id = str(meta.get("version_id", ""))
    registry.submit_pending("huggingface", res_model_id, res_version_id, meta={
        "model_name": meta.get("model_name", ""),
        "model_type": meta.get("model_type", ""),
    })

    task = engine.submit(
        url=url,
        save_dir=save_dir,
        filename=filename,
        meta=task_meta,
        headers=data.get("headers"),
        on_complete=_on_huggingface_complete,
    )

    # 立即持久化新任务 (消除首次提交→首个 poll tick 之间的空窗)
    _persist_task(task)

    existed = task.meta.get("existed", False)

    # Registry: 更新资源状态 (已存在文件时 engine 已触发完成回调登记, 走 mark_installed)
    if task.status == DownloadStatus.FAILED:
        registry.task_failed("huggingface", res_model_id, res_version_id, task.error)
    elif existed:
        registry.mark_installed("huggingface", res_model_id, res_version_id, emit=True)
    else:
        registry.task_submitted("huggingface", res_model_id, res_version_id,
                                task.download_id)

    resp = task.to_dict()
    if existed:
        resp["existed"] = True
        resp["message_key"] = "models.msg.dl_already_exists"
        resp["message_params"] = {"filename": filename}

    return jsonify(resp), 201 if task.status == DownloadStatus.ACTIVE else 200


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
