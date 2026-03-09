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


# ── POST /api/llm/prompt — 提示词生成 ────────────────────────────────────────

@bp.route("/api/llm/prompt", methods=["POST"])
def api_llm_prompt():
    data = request.get_json(silent=True) or {}
    user_input = str(data.get("input", "")).strip()
    target = str(data.get("target", "sdxl")).strip()
    stream = data.get("stream", True)

    if not user_input:
        return jsonify(ok=False, error="input 不能为空"), 400
    if len(user_input) > _MAX_INPUT_LEN:
        return jsonify(ok=False, error=f"输入过长 (最大 {_MAX_INPUT_LEN} 字符)"), 400
    if target not in PROMPT_REGISTRY:
        return jsonify(ok=False, error=f"不支持的 target: {target}"), 400

    if stream:
        return Response(
            generate_prompt_stream(user_input, target),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        try:
            result = generate_prompt(user_input, target)
            return jsonify(ok=True, data=result)
        except ValueError as e:
            return jsonify(ok=False, error=str(e)), 400
        except Exception as e:
            logger.exception("LLM prompt generation failed")
            return jsonify(ok=False, error=str(e)), 500


# ── POST /api/llm/chat — 通用对话 ────────────────────────────────────────────

@bp.route("/api/llm/chat", methods=["POST"])
def api_llm_chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    system = str(data.get("system", "")).strip()
    stream = data.get("stream", True)

    if not messages:
        return jsonify(ok=False, error="messages 不能为空"), 400

    # 验证 messages 格式
    for msg in messages:
        if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
            return jsonify(ok=False, error="messages 格式错误"), 400

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
            return jsonify(ok=False, error=str(e)), 500


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
        return jsonify(ok=False, error=f"不支持的 Provider: {provider}"), 400

    # 验证 temperature
    temp = data.get("temperature")
    if temp is not None:
        try:
            temp = float(temp)
            if not 0.0 <= temp <= 2.0:
                raise ValueError
            data["temperature"] = temp
        except (ValueError, TypeError):
            return jsonify(ok=False, error="temperature 必须在 0.0-2.0 之间"), 400

    # 验证 max_tokens
    mt = data.get("max_tokens")
    if mt is not None:
        try:
            mt = int(mt)
            if not 1 <= mt <= 100000:
                raise ValueError
            data["max_tokens"] = mt
        except (ValueError, TypeError):
            return jsonify(ok=False, error="max_tokens 必须在 1-100000 之间"), 400

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
        return jsonify(ok=False, error="provider, api_key, model 必填"), 400
    if provider not in PROVIDER_REGISTRY:
        return jsonify(ok=False, error=f"不支持的 Provider: {provider}"), 400

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
        return jsonify(ok=False, error="provider, api_key 必填"), 400
    if provider not in PROVIDER_REGISTRY:
        return jsonify(ok=False, error=f"不支持的 Provider: {provider}"), 400

    result = list_models(provider, api_key, base_url)
    return jsonify(**result)