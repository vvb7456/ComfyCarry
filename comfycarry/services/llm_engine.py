"""
ComfyCarry — LLM Engine

3 个 Provider 覆盖所有主流 LLM 服务:
  - OpenAICompatProvider  → OpenAI / DeepSeek / OpenRouter / 自定义
  - AnthropicProvider     → Claude
  - GeminiProvider        → Google AI Studio

统一接口: chat() / chat_stream() / generate_prompt()
"""

import json
import logging
import re

from pydantic import BaseModel, Field

from ..config import get_config, set_config

logger = logging.getLogger(__name__)

# ── 结构化输出 Schema ─────────────────────────────────────────────────────────

class PromptOutput(BaseModel):
    """提示词生成的结构化输出"""
    positive: str = Field(description="正面提示词")
    negative: str = Field(description="反面提示词（Flux 模型为空字符串）")
    notes: str = Field(description="LLM 的简要说明，使用用户输入的语言")


# ── JSON 解析容错 ─────────────────────────────────────────────────────────────

def parse_llm_json(text: str) -> dict:
    """从 LLM 输出中提取 JSON，带多级容错"""
    # 1. 直接解析
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. 提取 ```json ... ``` 代码块
    match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 3. 提取第一个 { ... } 块
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    # 4. 降级: 原始文本作为 positive
    return {"positive": text, "negative": "", "notes": "输出格式异常，已原样返回"}


def validate_prompt_output(data: dict) -> dict:
    """验证并规范化提示词输出字段"""
    return {
        "positive": str(data.get("positive", "")).strip(),
        "negative": str(data.get("negative", "")).strip(),
        "notes": str(data.get("notes", "")).strip(),
    }


# ── Provider 基类 ─────────────────────────────────────────────────────────────

class BaseLLMProvider:
    """LLM Provider 抽象基类"""

    name: str = "base"
    supports_json_schema: bool = False

    def list_models(self) -> list[dict]:
        """返回可用模型列表 — [{"id": ..., "name": ...}, ...]"""
        raise NotImplementedError

    def chat(self, messages: list[dict], **kwargs) -> str:
        raise NotImplementedError

    def chat_stream(self, messages: list[dict], **kwargs):
        raise NotImplementedError

    def chat_structured(self, messages: list[dict], **kwargs) -> dict:
        """结构化输出 — 子类可覆盖实现原生 json_schema"""
        # 默认: 普通 chat + parse
        text = self.chat(messages, **kwargs)
        return parse_llm_json(text)


# ── OpenAI Compatible Provider ────────────────────────────────────────────────

class OpenAICompatProvider(BaseLLMProvider):
    """OpenAI / DeepSeek / OpenRouter / 自定义 OpenAI 兼容端点"""

    name = "openai_compat"

    PRESET = {
        "openai":     {"base_url": "https://api.openai.com/v1",    "default_model": "gpt-4o-mini"},
        "deepseek":   {"base_url": "https://api.deepseek.com",     "default_model": "deepseek-chat"},
        "openrouter": {"base_url": "https://openrouter.ai/api/v1", "default_model": "openai/gpt-4o-mini"},
    }

    # 支持 json_schema strict mode 的模型前缀
    _SCHEMA_MODELS = {"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o3", "o4"}

    def __init__(self, api_key: str, model: str, base_url: str = ""):
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key, base_url=base_url or None)
        self.model = model
        self._base_url = base_url or ""
        self.supports_json_schema = any(model.startswith(p) for p in self._SCHEMA_MODELS)

    def list_models(self):
        # OpenRouter: 用 HTTP 直接请求获取富数据 (价格/上下文/modality)
        if "openrouter.ai" in self._base_url:
            return self._list_openrouter_models()

        models = []
        for m in self.client.models.list():
            models.append({"id": m.id, "name": getattr(m, "name", m.id), "owned_by": getattr(m, "owned_by", "")})
        return models

    def _list_openrouter_models(self):
        import httpx
        resp = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
        resp.raise_for_status()
        data = resp.json().get("data", [])
        models = []
        for m in data:
            info = {
                "id": m.get("id", ""),
                "name": m.get("name", m.get("id", "")),
            }
            if m.get("context_length"):
                info["context_length"] = m["context_length"]
            pricing = m.get("pricing", {})
            if pricing:
                info["pricing"] = {
                    "prompt": pricing.get("prompt", "0"),
                    "completion": pricing.get("completion", "0"),
                }
            arch = m.get("architecture", {})
            if arch:
                info["modality"] = arch.get("modality", "")
                info["tokenizer"] = arch.get("tokenizer", "")
            models.append(info)
        return models

    def chat(self, messages, **kwargs):
        resp = self.client.chat.completions.create(
            model=self.model, messages=messages, **kwargs
        )
        return resp.choices[0].message.content or ""

    def chat_stream(self, messages, **kwargs):
        kwargs.pop("response_format", None)
        stream = self.client.chat.completions.create(
            model=self.model, messages=messages, stream=True, **kwargs
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def chat_structured(self, messages, **kwargs):
        if self.supports_json_schema:
            try:
                resp = self.client.beta.chat.completions.parse(
                    model=self.model,
                    messages=messages,
                    response_format=PromptOutput,
                    **kwargs,
                )
                parsed = resp.choices[0].message.parsed
                if parsed:
                    return parsed.model_dump()
            except Exception as e:
                logger.warning("json_schema parse failed, falling back: %s", e)

        # 降级: json_object mode 或纯 prompt
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                **kwargs,
            )
            return parse_llm_json(resp.choices[0].message.content or "")
        except Exception:
            # 有些模型不支持 json_object, 用纯 prompt
            text = self.chat(messages, **kwargs)
            return parse_llm_json(text)


# ── Anthropic Provider ────────────────────────────────────────────────────────

class AnthropicProvider(BaseLLMProvider):
    """Claude Provider — 使用 Tool Use 模拟结构化输出"""

    name = "anthropic"
    supports_json_schema = False

    def __init__(self, api_key: str, model: str, **_):
        from anthropic import Anthropic
        self.client = Anthropic(api_key=api_key)
        self.model = model

    @staticmethod
    def _split_system(messages):
        system_msg = ""
        chat_msgs = []
        for m in messages:
            if m["role"] == "system":
                system_msg = m["content"] if isinstance(m["content"], str) else str(m["content"])
            else:
                # Convert image parts from OpenAI format → Anthropic format
                chat_msgs.append(AnthropicProvider._convert_message(m))
        return system_msg, chat_msgs

    @staticmethod
    def _convert_message(msg):
        content = msg.get("content")
        if isinstance(content, str):
            return msg
        # Multi-part content (text + images)
        parts = []
        for part in content:
            if part.get("type") == "text":
                parts.append({"type": "text", "text": part["text"]})
            elif part.get("type") == "image_url":
                url = part["image_url"]["url"]
                if url.startswith("data:"):
                    # data:image/png;base64,xxxxx
                    header, b64 = url.split(",", 1)
                    mime = header.split(":")[1].split(";")[0]
                    parts.append({
                        "type": "image",
                        "source": {"type": "base64", "data": b64, "media_type": mime}
                    })
                else:
                    parts.append({
                        "type": "image",
                        "source": {"type": "url", "url": url}
                    })
        return {"role": msg["role"], "content": parts}

    def list_models(self):
        models = []
        for m in self.client.models.list(limit=1000):
            models.append({"id": m.id, "name": getattr(m, "display_name", m.id)})
        return models

    def chat(self, messages, **kwargs):
        system_msg, chat_msgs = self._split_system(messages)
        resp = self.client.messages.create(
            model=self.model,
            system=system_msg or "You are a helpful assistant.",
            messages=chat_msgs,
            max_tokens=kwargs.pop("max_tokens", 2000),
            **kwargs,
        )
        # Extract text from content blocks
        return "".join(
            block.text for block in resp.content if hasattr(block, "text")
        )

    def chat_stream(self, messages, **kwargs):
        system_msg, chat_msgs = self._split_system(messages)
        with self.client.messages.stream(
            model=self.model,
            system=system_msg or "You are a helpful assistant.",
            messages=chat_msgs,
            max_tokens=kwargs.pop("max_tokens", 2000),
            **kwargs,
        ) as stream:
            for text in stream.text_stream:
                yield text

    def chat_structured(self, messages, **kwargs):
        """使用 Tool Use 强制结构化输出"""
        system_msg, chat_msgs = self._split_system(messages)
        tool_schema = PromptOutput.model_json_schema()
        # 移除 Pydantic 额外字段
        props = tool_schema.get("properties", {})
        required = tool_schema.get("required", [])

        try:
            resp = self.client.messages.create(
                model=self.model,
                system=system_msg or "You are a helpful assistant.",
                messages=chat_msgs,
                max_tokens=kwargs.pop("max_tokens", 2000),
                tools=[{
                    "name": "output_prompt",
                    "description": "Output the generated prompt in structured JSON format",
                    "input_schema": {
                        "type": "object",
                        "properties": props,
                        "required": required,
                    }
                }],
                tool_choice={"type": "tool", "name": "output_prompt"},
            )
            for block in resp.content:
                if block.type == "tool_use":
                    return validate_prompt_output(block.input)
        except Exception as e:
            logger.warning("Anthropic tool_use failed, falling back: %s", e)

        # 降级: 纯文本 + parse
        text = self.chat(messages, **kwargs)
        return parse_llm_json(text)


# ── Gemini Provider ───────────────────────────────────────────────────────────

class GeminiProvider(BaseLLMProvider):
    """Google AI Studio / Gemini Provider"""

    name = "gemini"
    supports_json_schema = True

    def __init__(self, api_key: str, model: str, **_):
        from google import genai
        self._genai = genai
        self.client = genai.Client(api_key=api_key)
        self.model = model

    def list_models(self):
        models = []
        for m in self.client.models.list(config={"page_size": 100}).page:
            model_id = m.name
            # Strip "models/" prefix if present
            if model_id and model_id.startswith("models/"):
                model_id = model_id[7:]
            models.append({"id": model_id, "name": getattr(m, "display_name", model_id)})
        return models

    def _build_contents(self, messages):
        """将 OpenAI 格式消息转换为 Gemini 格式"""
        system_instruction = None
        contents = []
        for m in messages:
            if m["role"] == "system":
                system_instruction = m["content"] if isinstance(m["content"], str) else str(m["content"])
                continue
            role = "user" if m["role"] == "user" else "model"
            content = m.get("content")
            if isinstance(content, str):
                contents.append({"role": role, "parts": [{"text": content}]})
            else:
                # Multi-part content (text + images)
                parts = []
                for part in content:
                    if part.get("type") == "text":
                        parts.append({"text": part["text"]})
                    elif part.get("type") == "image_url":
                        url = part["image_url"]["url"]
                        if url.startswith("data:"):
                            header, b64 = url.split(",", 1)
                            mime = header.split(":")[1].split(";")[0]
                            parts.append({
                                "inline_data": {"data": b64, "mime_type": mime}
                            })
                contents.append({"role": role, "parts": parts})
        return system_instruction, contents

    def _safety_off(self):
        """关闭所有内容安全过滤"""
        genai = self._genai
        return [
            genai.types.SafetySetting(
                category=c, threshold="OFF"
            ) for c in [
                "HARM_CATEGORY_HARASSMENT",
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
                "HARM_CATEGORY_CIVIC_INTEGRITY",
            ]
        ]

    def chat(self, messages, **kwargs):
        genai = self._genai
        system_instruction, contents = self._build_contents(messages)
        config = genai.types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=kwargs.get("temperature"),
            safety_settings=self._safety_off(),
        )
        resp = self.client.models.generate_content(
            model=self.model, contents=contents, config=config,
        )
        return resp.text or ""

    def chat_stream(self, messages, **kwargs):
        genai = self._genai
        system_instruction, contents = self._build_contents(messages)
        config = genai.types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=kwargs.get("temperature"),
            safety_settings=self._safety_off(),
        )
        for chunk in self.client.models.generate_content_stream(
            model=self.model, contents=contents, config=config,
        ):
            if chunk.text:
                yield chunk.text

    def chat_structured(self, messages, **kwargs):
        """Gemini 原生 response_schema"""
        genai = self._genai
        system_instruction, contents = self._build_contents(messages)
        try:
            config = genai.types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=PromptOutput,
                temperature=kwargs.get("temperature"),
                safety_settings=self._safety_off(),
            )
            resp = self.client.models.generate_content(
                model=self.model, contents=contents, config=config,
            )
            return parse_llm_json(resp.text or "")
        except Exception as e:
            logger.warning("Gemini response_schema failed, falling back: %s", e)
            text = self.chat(messages, **kwargs)
            return parse_llm_json(text)


# ── Provider Registry ─────────────────────────────────────────────────────────

PROVIDER_REGISTRY = {
    "openai":     {"cls": OpenAICompatProvider, "name": "OpenAI"},
    "deepseek":   {"cls": OpenAICompatProvider, "name": "DeepSeek"},
    "openrouter": {"cls": OpenAICompatProvider, "name": "OpenRouter"},
    "anthropic":  {"cls": AnthropicProvider,    "name": "Anthropic"},
    "gemini":     {"cls": GeminiProvider,        "name": "Google AI Studio"},
    "custom":     {"cls": OpenAICompatProvider, "name": "自定义 (OpenAI 兼容)"},
}

PROVIDER_CAPABILITIES = {
    "openai":     {"json_schema": True,  "vision": True,  "image_gen": True},
    "anthropic":  {"json_schema": False, "vision": True,  "image_gen": False},
    "gemini":     {"json_schema": True,  "vision": True,  "image_gen": True},
    "deepseek":   {"json_schema": False, "vision": True,  "image_gen": False},
    "openrouter": {"json_schema": True,  "vision": True,  "image_gen": False},
    "custom":     {"json_schema": False, "vision": True,  "image_gen": False},
}


def create_provider(provider_id: str, api_key: str, model: str, base_url: str = "") -> BaseLLMProvider:
    """根据 provider_id 创建 Provider 实例"""
    entry = PROVIDER_REGISTRY.get(provider_id)
    if not entry:
        raise ValueError(f"Unknown provider: {provider_id}")

    cls = entry["cls"]
    if cls == OpenAICompatProvider:
        preset = OpenAICompatProvider.PRESET.get(provider_id, {})
        effective_url = base_url or preset.get("base_url", "")
        return cls(api_key=api_key, model=model, base_url=effective_url)
    return cls(api_key=api_key, model=model)


# ── LLM Engine (高层接口) ─────────────────────────────────────────────────────

def get_llm_config() -> dict:
    """获取当前 LLM 配置"""
    return {
        "provider": get_config("llm_provider", ""),
        "model": get_config("llm_model", ""),
        "api_key": get_config("llm_api_key", ""),
        "base_url": get_config("llm_base_url", ""),
        "temperature": get_config("llm_temperature", 0.7),
        "max_tokens": get_config("llm_max_tokens", 2000),
        "stream": get_config("llm_stream", False),
        "provider_keys": get_config("llm_provider_keys", {}),
    }


def save_llm_config(data: dict):
    """保存 LLM 配置"""
    for key in ("provider", "model", "api_key", "base_url", "temperature", "max_tokens", "stream"):
        if key in data:
            set_config(f"llm_{key}", data[key])

    # Per-provider key/model/base_url persistence
    provider = data.get("provider") or get_config("llm_provider", "")
    if provider and "api_key" in data:
        keys = get_config("llm_provider_keys", {})
        keys[provider] = {
            "api_key": data.get("api_key", ""),
            "model": data.get("model", ""),
            "base_url": data.get("base_url", ""),
        }
        set_config("llm_provider_keys", keys)


def mask_api_key(key: str) -> str:
    """遮蔽 API Key (前 4 + 后 4 位)"""
    if not key or len(key) <= 8:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


def get_provider_from_config() -> BaseLLMProvider:
    """从当前持久化配置创建 Provider 实例"""
    cfg = get_llm_config()
    if not cfg["provider"] or not cfg["api_key"]:
        raise ValueError("LLM 未配置，请在设置中配置 Provider 和 API Key")
    return create_provider(
        provider_id=cfg["provider"],
        api_key=cfg["api_key"],
        model=cfg["model"],
        base_url=cfg["base_url"],
    )


def generate_prompt(user_input: str, target: str = "sdxl", **kwargs) -> dict:
    """同步生成提示词 — 返回 {"positive": ..., "negative": ..., "notes": ...}"""
    from .llm_prompts import PROMPT_REGISTRY

    if target not in PROMPT_REGISTRY:
        raise ValueError(f"Unknown target: {target}. Available: {list(PROMPT_REGISTRY.keys())}")

    prompt_cfg = PROMPT_REGISTRY[target]
    messages = [
        {"role": "system", "content": prompt_cfg["system"]},
        {"role": "user", "content": user_input},
    ]

    provider = get_provider_from_config()
    cfg = get_llm_config()
    extra = {}
    if cfg["temperature"]:
        extra["temperature"] = float(cfg["temperature"])
    if cfg["max_tokens"]:
        extra["max_tokens"] = int(cfg["max_tokens"])

    result = provider.chat_structured(messages, **extra)
    return validate_prompt_output(result)


def generate_prompt_stream(user_input: str, target: str = "sdxl", **kwargs):
    """流式生成提示词 — yield SSE data lines"""
    from .llm_prompts import PROMPT_REGISTRY

    if target not in PROMPT_REGISTRY:
        yield f'data: {json.dumps({"type": "error", "message": f"Unknown target: {target}"})}\n\n'
        return

    prompt_cfg = PROMPT_REGISTRY[target]
    messages = [
        {"role": "system", "content": prompt_cfg["system"]},
        {"role": "user", "content": user_input},
    ]

    provider = get_provider_from_config()
    cfg = get_llm_config()
    extra = {}
    if cfg["temperature"]:
        extra["temperature"] = float(cfg["temperature"])
    if cfg["max_tokens"]:
        extra["max_tokens"] = int(cfg["max_tokens"])

    full_text = ""
    try:
        for chunk in provider.chat_stream(messages, **extra):
            full_text += chunk
            yield f'data: {json.dumps({"type": "chunk", "content": chunk})}\n\n'
    except Exception as e:
        yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'
        return

    # 解析完整输出
    try:
        result = parse_llm_json(full_text)
        result = validate_prompt_output(result)
        yield f'data: {json.dumps({"type": "result", "data": result})}\n\n'
    except Exception as e:
        yield f'data: {json.dumps({"type": "error", "message": f"JSON 解析失败: {e}"})}\n\n'

    yield "data: [DONE]\n\n"


def chat_stream(messages: list[dict], system: str = "", **kwargs):
    """通用对话流式 — yield SSE data lines"""
    if system:
        messages = [{"role": "system", "content": system}] + messages

    provider = get_provider_from_config()
    cfg = get_llm_config()
    extra = {}
    if cfg["temperature"]:
        extra["temperature"] = float(cfg["temperature"])
    if cfg["max_tokens"]:
        extra["max_tokens"] = int(cfg["max_tokens"])

    full_text = ""
    try:
        for chunk in provider.chat_stream(messages, **extra):
            full_text += chunk
            yield f'data: {json.dumps({"type": "chunk", "content": chunk})}\n\n'
    except Exception as e:
        yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'
        return

    yield f'data: {json.dumps({"type": "done", "content": full_text})}\n\n'
    yield "data: [DONE]\n\n"


def chat_sync(messages: list[dict], system: str = "", **kwargs) -> str:
    """通用对话同步 — 返回完整文本"""
    if system:
        messages = [{"role": "system", "content": system}] + messages

    provider = get_provider_from_config()
    cfg = get_llm_config()
    extra = {}
    if cfg["temperature"]:
        extra["temperature"] = float(cfg["temperature"])
    if cfg["max_tokens"]:
        extra["max_tokens"] = int(cfg["max_tokens"])

    return provider.chat(messages, **extra)


def test_connection(provider_id: str, api_key: str, model: str, base_url: str = "") -> dict:
    """测试 LLM 连接是否有效"""
    import time

    provider = create_provider(provider_id, api_key, model, base_url)
    messages = [
        {"role": "user", "content": "Say 'ok' in one word."}
    ]

    start = time.time()
    try:
        text = provider.chat(messages, max_tokens=10)
        latency = int((time.time() - start) * 1000)
        return {"ok": True, "model": model, "latency_ms": latency, "response": text.strip()}
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        return {"ok": False, "model": model, "latency_ms": latency, "error": str(e)}


def list_models(provider_id: str, api_key: str, base_url: str = "") -> dict:
    """动态获取 Provider 的可用模型列表"""
    try:
        provider = create_provider(provider_id, api_key, model="", base_url=base_url)
        models = provider.list_models()
        return {"ok": True, "models": models}
    except Exception as e:
        return {"ok": False, "error": str(e)}
