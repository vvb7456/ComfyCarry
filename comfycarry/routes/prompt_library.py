"""
ComfyCarry — 提示词库路由

端点:
  GET    /api/prompt-library/status            标签库状态
  GET    /api/prompt-library/groups            一级分类
  GET    /api/prompt-library/subgroups         子分类 (?parent=<group_id>)
  GET    /api/prompt-library/tags              标签 (?parent=<subgroup_id>)
  GET    /api/prompt-library/tree              完整树形结构
  GET    /api/prompt-library/autocomplete      自动补全 (?q=<query>&limit=20)
  GET    /api/prompt-library/history           历史/收藏 (?type=all&page=1&size=20)
  POST   /api/prompt-library/history           新增历史
  PUT    /api/prompt-library/history/<id>      更新历史
  DELETE /api/prompt-library/history/<id>      删除历史
  DELETE /api/prompt-library/history/batch     批量删除
  GET    /api/prompt-library/init/status       初始化数据源状态
  POST   /api/prompt-library/init              一键导入
"""

import json
import logging
import threading
import time

from flask import Blueprint, Response, jsonify, request

from ..config import get_config, set_config
from ..services import prompt_library as pl
from ..services import prompt_library_init as pl_init
from ..services import translate_service as ts

logger = logging.getLogger(__name__)

bp = Blueprint("prompt_library", __name__)


# ====================================================================
# 标签库状态
# ====================================================================
@bp.route("/api/prompt-library/status", methods=["GET"])
def api_pl_status():
    try:
        return jsonify(pl.get_status()), 200
    except Exception as e:
        logger.error("prompt-library status error: %s", e)
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 标签库只读查询
# ====================================================================
@bp.route("/api/prompt-library/groups", methods=["GET"])
def api_pl_groups():
    try:
        return jsonify({"data": pl.get_groups()}), 200
    except Exception as e:
        logger.error("prompt-library groups error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/subgroups", methods=["GET"])
def api_pl_subgroups():
    parent = request.args.get("parent", type=int)
    if parent is None:
        return jsonify({"error": "Missing 'parent' parameter (group_id)"}), 400
    try:
        return jsonify({"data": pl.get_subgroups(parent)}), 200
    except Exception as e:
        logger.error("prompt-library subgroups error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/tags", methods=["GET"])
def api_pl_tags():
    parent = request.args.get("parent", type=int)
    if parent is None:
        return jsonify({"error": "Missing 'parent' parameter (subgroup_id)"}), 400
    try:
        return jsonify({"data": pl.get_tags(parent)}), 200
    except Exception as e:
        logger.error("prompt-library tags error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/tree", methods=["GET"])
def api_pl_tree():
    try:
        return jsonify({"data": pl.get_tree()}), 200
    except Exception as e:
        logger.error("prompt-library tree error: %s", e)
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 自动补全
# ====================================================================
@bp.route("/api/prompt-library/autocomplete", methods=["GET"])
def api_pl_autocomplete():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"data": []}), 200
    limit = request.args.get("limit", 20, type=int)
    limit = max(1, min(limit, 100))  # 限制 1-100
    try:
        return jsonify({"data": pl.autocomplete(q, limit)}), 200
    except Exception as e:
        logger.error("prompt-library autocomplete error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/resolve", methods=["POST"])
def api_pl_resolve():
    """批量解析 tag 文本 → {color, translate}"""
    data = request.get_json(silent=True) or {}
    texts = data.get("texts", [])
    if not isinstance(texts, list) or len(texts) > 200:
        return jsonify({"error": "texts must be an array (max 200)"}), 400
    # 过滤非字符串和空值
    texts = [t for t in texts if isinstance(t, str) and t.strip()]
    try:
        return jsonify({"data": pl.resolve_tags(texts)}), 200
    except Exception as e:
        logger.error("prompt-library resolve error: %s", e)
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 历史 / 收藏
# ====================================================================
@bp.route("/api/prompt-library/history", methods=["GET"])
def api_pl_history_list():
    history_type = request.args.get("type", "all")
    if history_type not in ("all", "history", "favorite"):
        return jsonify({"error": "Invalid type, must be: all|history|favorite"}), 400
    page = request.args.get("page", 1, type=int)
    size = request.args.get("size", 20, type=int)
    size = max(1, min(size, 100))
    try:
        return jsonify(pl.list_history(history_type, page, size)), 200
    except Exception as e:
        logger.error("prompt-library history list error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/history", methods=["POST"])
def api_pl_history_add():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400
    positive = data.get("positive", "")
    negative = data.get("negative", "")
    if not positive and not negative:
        return jsonify({"error": "At least one of 'positive' or 'negative' is required"}), 400
    try:
        hid = pl.add_history(positive, negative)
        return jsonify({"success": True, "id": hid}), 201
    except Exception as e:
        logger.error("prompt-library history add error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/history/<int:history_id>", methods=["PUT"])
def api_pl_history_update(history_id):
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "No JSON body"}), 400
    try:
        ok = pl.update_history(history_id, **data)
        if not ok:
            return jsonify({"error": "No valid fields to update"}), 400
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.error("prompt-library history update error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/history/<int:history_id>", methods=["DELETE"])
def api_pl_history_delete(history_id):
    try:
        pl.delete_history(history_id)
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.error("prompt-library history delete error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/history/batch", methods=["DELETE"])
def api_pl_history_batch_delete():
    data = request.get_json(force=True, silent=True)
    if not data or "ids" not in data:
        return jsonify({"error": "Missing 'ids' array"}), 400
    ids = data["ids"]
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        return jsonify({"error": "'ids' must be an array of integers"}), 400
    try:
        count = pl.delete_history_batch(ids)
        return jsonify({"success": True, "deleted": count}), 200
    except Exception as e:
        logger.error("prompt-library history batch delete error: %s", e)
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 数据初始化
# ====================================================================
@bp.route("/api/prompt-library/init/status", methods=["GET"])
def api_pl_init_status():
    try:
        source = pl_init.check_source()
        lib_status = pl.get_status()
        return jsonify({**source, **lib_status}), 200
    except Exception as e:
        logger.error("prompt-library init status error: %s", e)
        return jsonify({"error": str(e)}), 500


# 导入状态锁
_import_lock = threading.Lock()
_import_progress = {
    "running": False,
    "phase": "",       # "downloading" | "importing" | "done" | "error"
    "step": "",
    "done": 0,
    "total": 0,
    "percent": 0,
    "error": "",
    "result": None,
}


def _reset_progress():
    _import_progress["running"] = False
    _import_progress["phase"] = ""
    _import_progress["step"] = ""
    _import_progress["done"] = 0
    _import_progress["total"] = 0
    _import_progress["percent"] = 0
    _import_progress["error"] = ""
    _import_progress["result"] = None


@bp.route("/api/prompt-library/init", methods=["POST"])
def api_pl_init():
    """
    一键下载+导入预处理数据。返回 SSE 事件流。

    Events (text/event-stream):
      data: {"phase":"downloading","percent":0}
      data: {"phase":"importing","step":"prompt_groups","done":1,"total":4}
      data: {"phase":"done","result":{...}}
      data: {"phase":"error","error":"..."}
    """
    if _import_progress["running"]:
        return jsonify({"error": "Import already running"}), 409

    source = pl_init.check_source()
    if not source["available"]:
        return jsonify({"error": "Prompt library data not available", "reason": "no_source"}), 404

    if not _import_lock.acquire(blocking=False):
        return jsonify({"error": "Import already running"}), 409

    def sse_stream():
        try:
            _import_progress["running"] = True
            _import_progress["error"] = ""

            # Phase 1: download source DB (skips if local file already exists)
            _import_progress["phase"] = "downloading"
            _import_progress["percent"] = 0
            yield _sse_msg({"phase": "downloading", "percent": 0})

            def on_dl_progress(step, done, total):
                pct = int(done / max(total, 1) * 100)
                _import_progress["step"] = step
                _import_progress["done"] = done
                _import_progress["total"] = total
                _import_progress["percent"] = pct

            pl_init.download_source(on_dl_progress)
            yield _sse_msg({"phase": "downloading", "percent": 100})

            # Phase 2: import
            _import_progress["phase"] = "importing"
            yield _sse_msg({"phase": "importing", "step": "", "done": 0, "total": 4})

            def on_import_progress(step, done, total):
                _import_progress["step"] = step
                _import_progress["done"] = done
                _import_progress["total"] = total
                _import_progress["percent"] = int(done / max(total, 1) * 100)

            result = pl_init.import_all(on_import_progress)

            # Phase 3: done
            _import_progress["phase"] = "done"
            _import_progress["result"] = result
            yield _sse_msg({"phase": "done", "result": result})

        except Exception as e:
            logger.error("prompt-library init error: %s", e)
            _import_progress["phase"] = "error"
            _import_progress["error"] = str(e)
            yield _sse_msg({"phase": "error", "error": str(e)})
        finally:
            _import_progress["running"] = False
            _import_lock.release()

    return Response(sse_stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@bp.route("/api/prompt-library/init/progress", methods=["GET"])
def api_pl_init_progress():
    """轮询当前导入进度 (SSE 备用)。"""
    return jsonify(_import_progress), 200


def _sse_msg(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ====================================================================
# 翻译
# ====================================================================
@bp.route("/api/prompt-library/translate", methods=["POST"])
def api_pl_translate():
    """翻译文本。body: {text, from?, to?, provider?}"""
    data = request.get_json(force=True, silent=True)
    if not data or not data.get("text"):
        return jsonify({"error": "Missing 'text'"}), 400
    text = data["text"]
    from_lang = data.get("from", "en")
    to_lang = data.get("to", "zh")
    provider = data.get("provider")
    try:
        result = ts.translate(text, from_lang, to_lang, provider)
        return jsonify(result), 200
    except Exception as e:
        logger.error("prompt-library translate error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/translate/word", methods=["GET"])
def api_pl_translate_word():
    """单词快速翻译 (仅本地 DB)。?word=<tag>"""
    word = request.args.get("word", "").strip()
    if not word:
        return jsonify({"translate": "", "from_db": False}), 200
    try:
        return jsonify(ts.translate_word(word)), 200
    except Exception as e:
        logger.error("prompt-library translate word error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/translate/providers", methods=["GET"])
def api_pl_translate_providers():
    """获取可用翻译 provider 列表"""
    return jsonify({
        "providers": list(ts.PROVIDERS.keys()),
        "default_chain": ts.DEFAULT_CHAIN,
    }), 200


# ====================================================================
# 编辑器设置
# ====================================================================

_PROMPT_SETTINGS_KEY = "prompt_settings"

_PROMPT_SETTINGS_DEFAULTS: dict = {
    "show_translation": True,
    "show_nsfw": False,
    "normalize_comma": True,
    "normalize_period": True,
    "normalize_bracket": True,
    "normalize_underscore": False,
    "comma_close_autocomplete": False,
    "escape_bracket": False,
    "autocomplete_limit": 20,
    "translate_provider": "",
}


def _get_prompt_settings() -> dict:
    """读取编辑器设置，未配置的项用默认值补全。"""
    saved = get_config(_PROMPT_SETTINGS_KEY, {})
    if not isinstance(saved, dict):
        saved = {}
    merged = {**_PROMPT_SETTINGS_DEFAULTS, **saved}
    return merged


@bp.route("/api/prompt-library/settings", methods=["GET"])
def api_pl_settings_get():
    """获取提示词编辑器设置"""
    try:
        settings = _get_prompt_settings()
        settings["translate_providers"] = list(ts.PROVIDERS.keys())
        settings["translate_default_chain"] = ts.DEFAULT_CHAIN
        return jsonify(settings), 200
    except Exception as e:
        logger.error("prompt-library settings GET error: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/api/prompt-library/settings", methods=["PUT"])
def api_pl_settings_put():
    """保存提示词编辑器设置"""
    try:
        data = request.get_json(force=True) or {}
        # 只保留已知 key，防止注入
        clean: dict = {}
        for key, default in _PROMPT_SETTINGS_DEFAULTS.items():
            if key in data:
                val = data[key]
                # 类型校验
                if isinstance(default, bool):
                    clean[key] = bool(val)
                elif isinstance(default, int):
                    clean[key] = max(5, min(100, int(val)))
                elif isinstance(default, str):
                    clean[key] = str(val).strip()
            else:
                clean[key] = default
        set_config(_PROMPT_SETTINGS_KEY, clean)
        return jsonify({"ok": True, **clean}), 200
    except Exception as e:
        logger.error("prompt-library settings PUT error: %s", e)
        return jsonify({"error": str(e)}), 500
