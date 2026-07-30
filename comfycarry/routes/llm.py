"""
ComfyCarry — LLM 路由

POST /api/llm/prompt      — 提示词生成 (SSE 流式 / JSON)
POST /api/llm/chat         — 通用 LLM 对话 (SSE 流式)
GET  /api/llm/providers    — 可用 Provider 列表
POST /api/llm/models       — 动态获取 Provider 可用模型列表
GET  /api/llm/config       — 当前 LLM 配置 (API Key 遮蔽)
PUT  /api/llm/config       — 更新 LLM 配置
POST /api/llm/test         — 连接测试
"""

import logging

from flask import Blueprint, Response, jsonify, request

from ..services.llm_engine import (
    PROVIDER_CAPABILITIES,
    PROVIDER_REGISTRY,
    chat_stream,
    chat_sync,
    generate_prompt,
    generate_prompt_stream,
    get_llm_config,
    list_models,
    mask_api_key,
    save_llm_config,
    test_connection,
)
from ..services.llm_prompts import PROMPT_REGISTRY

logger = logging.getLogger(__name__)

bp = Blueprint("llm", __name__)

_MAX_INPUT_LEN = 2000


# ====================================================================
# 响应文案 —— key + params, 前端按 `llm.err.<key>` 翻译
#
# /api/llm/* 的消费方全是面板前端 (设置页 LLM 标签、向导 Step6、生成页助手),
# 回中文成品文案的话英文 locale 下会直接冒中文。ok:false 保留 —— 这几个
# 消费方都按 ok 分支, 不看状态码。
# ====================================================================
def _err(key: str, status: int = 400, /, **params):
    """错误响应。形参位置化 (`/`): 插值参数里有 provider / target 之外还可能
    有 key / status 这种名字, 不然会和函数自己的形参撞车。"""
    return jsonify({"ok": False, "error_key": f"llm.err.{key}",
                    "error_params": params}), status


def _exc_err(e: Exception, status: int = 500):
    """异常 → 响应。LLMError 带 key 的走 key, 否则回落 internal + 原文 detail
    (那是 Provider SDK 抛的英文报错, 透出原文比造键有用)。"""
    if getattr(e, "key", ""):
        return _err(e.key, status, **(getattr(e, "params", {}) or {}))
    return _err("internal", status, detail=str(e))


# ── POST /api/llm/prompt — 提示词生成 ────────────────────────────────────────

@bp.route("/api/llm/prompt", methods=["POST"])
def api_llm_prompt():
    data = request.get_json(silent=True) or {}
    user_input = str(data.get("input", "")).strip()
    image = str(data.get("image", "")).strip()
    target = str(data.get("target", "sdxl")).strip()
    stream = data.get("stream", True)

    if not user_input and not image:
        return _err("input_required")
    if user_input and len(user_input) > _MAX_INPUT_LEN:
        return _err("input_too_long", max=_MAX_INPUT_LEN)

    valid_targets = [k for k in PROMPT_REGISTRY if not k.endswith("_vision")]
    if target not in valid_targets:
        return _err("unsupported_target", target=target)

    if stream:
        return Response(
            generate_prompt_stream(user_input, target, image=image),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        try:
            result = generate_prompt(user_input, target, image=image)
            return jsonify(ok=True, data=result)
        except ValueError as e:
            return _exc_err(e, 400)
        except Exception as e:
            logger.exception("LLM prompt generation failed")
            return _exc_err(e)


# ── POST /api/llm/chat — 通用对话 ────────────────────────────────────────────

@bp.route("/api/llm/chat", methods=["POST"])
def api_llm_chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    system = str(data.get("system", "")).strip()
    stream = data.get("stream", True)

    if not messages:
        return _err("messages_required")

    # 验证 messages 格式
    for msg in messages:
        if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
            return _err("messages_invalid")

    if stream:
        return Response(
            chat_stream(messages, system=system),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        try:
            text = chat_sync(messages, system=system)
            return jsonify(ok=True, content=text)
        except Exception as e:
            logger.exception("LLM chat failed")
            return _exc_err(e)


# ── GET /api/llm/providers — Provider 列表 ───────────────────────────────────

@bp.route("/api/llm/providers")
def api_llm_providers():
    providers = []
    for pid, entry in PROVIDER_REGISTRY.items():
        caps = PROVIDER_CAPABILITIES.get(pid, {})
        info = {
            "id": pid,
            "name": entry["name"],
            "supports_json_schema": caps.get("json_schema", False),
            "supports_vision": caps.get("vision", False),
            "supports_image_gen": caps.get("image_gen", False),
            "requires": ["api_key"],
        }
        if pid in ("custom", "openrouter"):
            info["supports_custom_model"] = True
        if pid == "custom":
            info["requires"] = ["api_key", "base_url"]
        if pid == "gemini":
            info["notes"] = "免费额度 1500 次/天"
        providers.append(info)

    targets = []
    for tid, cfg in PROMPT_REGISTRY.items():
        targets.append({"id": tid, "label": cfg["label"]})

    return jsonify(providers=providers, targets=targets)


# ── GET /api/llm/config — 当前配置 ───────────────────────────────────────────

@bp.route("/api/llm/config")
def api_llm_config_get():
    cfg = get_llm_config()
    cfg["api_key"] = mask_api_key(cfg["api_key"])
    return jsonify(ok=True, data=cfg)


# ── PUT /api/llm/config — 更新配置 ───────────────────────────────────────────

@bp.route("/api/llm/config", methods=["PUT"])
def api_llm_config_put():
    data = request.get_json(silent=True) or {}

    # 验证 provider
    provider = data.get("provider", "")
    if provider and provider not in PROVIDER_REGISTRY:
        return _err("unsupported_provider", provider=provider)

    # 验证 temperature
    temp = data.get("temperature")
    if temp is not None:
        try:
            temp = float(temp)
            if not 0.0 <= temp <= 2.0:
                raise ValueError
            data["temperature"] = temp
        except (ValueError, TypeError):
            return _err("temperature_range")

    # 验证 max_tokens
    mt = data.get("max_tokens")
    if mt is not None:
        try:
            mt = int(mt)
            if not 1 <= mt <= 100000:
                raise ValueError
            data["max_tokens"] = mt
        except (ValueError, TypeError):
            return _err("max_tokens_range")

    # 验证 stream
    stream = data.get("stream")
    if stream is not None:
        data["stream"] = bool(stream)

    save_llm_config(data)
    return jsonify(ok=True)


# ── POST /api/llm/test — 连接测试 ────────────────────────────────────────────

@bp.route("/api/llm/test", methods=["POST"])
def api_llm_test():
    data = request.get_json(silent=True) or {}
    provider = data.get("provider", "")
    api_key = data.get("api_key", "")
    model = data.get("model", "")
    base_url = data.get("base_url", "")

    if not provider or not api_key or not model:
        return _err("config_fields_required")
    if provider not in PROVIDER_REGISTRY:
        return _err("unsupported_provider", provider=provider)

    result = test_connection(provider, api_key, model, base_url)
    return jsonify(**result)

# ── POST /api/llm/models — 动态获取可用模型列表 ───────────────────────────

@bp.route("/api/llm/models", methods=["POST"])
def api_llm_models():
    data = request.get_json(silent=True) or {}
    provider = data.get("provider", "")
    api_key = data.get("api_key", "")
    base_url = data.get("base_url", "")

    if not provider or not api_key:
        return _err("test_fields_required")
    if provider not in PROVIDER_REGISTRY:
        return _err("unsupported_provider", provider=provider)

    result = list_models(provider, api_key, base_url)
    return jsonify(**result)