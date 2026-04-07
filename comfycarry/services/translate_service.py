"""
ComfyCarry — 翻译服务

本地 DB 优先 + 多 provider fallback。
provider 列表: local_db, mymemory, bing, youdao, alibaba
"""

import logging
import re
import threading
import time
from abc import ABC, abstractmethod

import requests

from ..db import db

log = logging.getLogger(__name__)

# ── 语言代码映射 ────────────────────────────────────────


# ── 翻译 Provider 基类 ─────────────────────────────────

class TranslateProvider(ABC):
    """翻译 provider 基类"""

    name: str = ""

    @abstractmethod
    def translate(self, text: str, from_lang: str, to_lang: str) -> str:
        """翻译文本，返回翻译结果字符串。失败抛异常。"""


# ── 本地 DB 查词 ────────────────────────────────────────

class LocalDBProvider(TranslateProvider):
    """从 prompt_tags.translate + danbooru_tags.translate 查词"""

    name = "local_db"

    def translate(self, text: str, from_lang: str = "en", to_lang: str = "zh") -> str:
        """
        本地 DB 精确匹配翻译。
        按逗号分割多 tag → 每个 tag 整体精确查 DB → 全部未匹配返回空串触发 fallback。
        英→中: _lookup_en (含 underscore/space 互换)。中→英: _lookup_zh。
        """
        text = text.strip()
        if not text:
            return ""

        # 判断方向
        if to_lang.startswith("zh"):
            return self._en_to_zh(text)
        elif to_lang.startswith("en"):
            return self._zh_to_en(text)
        return ""

    def _en_to_zh(self, text: str) -> str:
        """英→中翻译: 整体精确匹配。完全未匹配时返回空串以触发 fallback。"""
        parts = [p.strip() for p in text.split(",") if p.strip()]
        translated = []
        any_found = False
        for part in parts:
            result = self._lookup_en(part)
            if result:
                translated.append(result)
                any_found = True
            else:
                translated.append(part)
        return ", ".join(translated) if any_found else ""

    def _zh_to_en(self, text: str) -> str:
        """中→英翻译: 查 DB 反向映射。全部未匹配时返回空串以触发 fallback。"""
        parts = [p.strip() for p in text.split(",") if p.strip()]
        translated = []
        any_found = False
        for part in parts:
            result = self._lookup_zh(part)
            if result:
                translated.append(result)
                any_found = True
            else:
                translated.append(part)
        # 如果没有任何一个词被翻译，返回空串让 fallback 链继续
        return ", ".join(translated) if any_found else ""

    @staticmethod
    def _lookup_en(word: str) -> str | None:
        """查询英文 tag 的中文翻译"""
        # prompt_tags 优先
        row = db.fetch_one(
            "SELECT translate FROM prompt_tags WHERE text=? AND translate!='' LIMIT 1",
            (word,),
        )
        if row:
            return row[0]
        # danbooru_tags fallback (下划线形式)
        underscore = word.replace(" ", "_")
        row = db.fetch_one(
            "SELECT translate FROM danbooru_tags WHERE tag=? AND translate!='' LIMIT 1",
            (underscore,),
        )
        if row:
            return row[0]
        # 也查空格形式
        if "_" in word:
            space_form = word.replace("_", " ")
            row = db.fetch_one(
                "SELECT translate FROM prompt_tags WHERE text=? AND translate!='' LIMIT 1",
                (space_form,),
            )
            if row:
                return row[0]
        return None

    @staticmethod
    def _lookup_zh(word: str) -> str | None:
        """查询中文描述的英文 tag"""
        row = db.fetch_one(
            "SELECT text FROM prompt_tags WHERE translate=? LIMIT 1",
            (word,),
        )
        if row:
            return row[0]
        row = db.fetch_one(
            "SELECT tag FROM danbooru_tags WHERE translate=? LIMIT 1",
            (word,),
        )
        if row:
            return row[0]
        return None


# ── MyMemory (免费默认) ─────────────────────────────────

class MyMemoryProvider(TranslateProvider):
    """MyMemory 免费翻译 API (匿名 1000 字/天, 注册 10K)"""

    name = "mymemory"
    _url = "https://api.mymemory.translated.net/get"

    # 语言代码映射
    _lang_map = {
        "zh": "zh-CN", "zh-CN": "zh-CN", "zh-Hans": "zh-CN",
        "en": "en-GB", "ja": "ja-JP", "ko": "ko-KR",
    }

    def translate(self, text: str, from_lang: str = "en", to_lang: str = "zh") -> str:
        src = self._lang_map.get(from_lang, from_lang)
        tgt = self._lang_map.get(to_lang, to_lang)
        resp = requests.get(
            self._url,
            params={"q": text, "langpair": f"{src}|{tgt}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        translated = data.get("responseData", {}).get("translatedText", "")
        if not translated:
            raise RuntimeError(f"MyMemory returned empty: {data}")
        return translated


# ── Bing 翻译逆向 (Edge Token) ─────────────────────────

class BingProvider(TranslateProvider):
    """Bing/Edge 翻译 (参考 WeiLin bing.py)"""

    name = "bing"
    _token_url = "https://edge.microsoft.com/translate/auth"
    _api_url = "https://api-edge.cognitive.microsofttranslator.com/translate"

    # Token 缓存 (3h)
    _token: str | None = None
    _token_time: float = 0
    _token_ttl = 3 * 3600
    _lock = threading.Lock()

    # 语言代码映射
    _lang_map = {
        "zh": "zh-Hans", "zh-CN": "zh-Hans", "zh-Hans": "zh-Hans",
        "zh-TW": "zh-Hant", "zh-Hant": "zh-Hant",
        "en": "en", "ja": "ja", "ko": "ko",
    }

    def translate(self, text: str, from_lang: str = "en", to_lang: str = "zh") -> str:
        token = self._get_token()
        src = self._lang_map.get(from_lang, from_lang)
        tgt = self._lang_map.get(to_lang, to_lang)

        resp = requests.post(
            self._api_url,
            params={
                "from": src,
                "to": tgt,
                "api-version": "3.0",
                "includeSentenceLength": "true",
            },
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=[{"Text": text}],
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data[0]["translations"][0]["text"]

    @classmethod
    def _get_token(cls) -> str:
        with cls._lock:
            now = time.time()
            if cls._token and now - cls._token_time < cls._token_ttl:
                return cls._token
            resp = requests.get(
                cls._token_url,
                headers={
                    "accept": "*/*",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "none",
                    "sec-mesh-client-edge-channel": "stable",
                    "sec-mesh-client-edge-version": "143.0.3650.80",
                    "sec-mesh-client-os": "Windows",
                    "sec-mesh-client-os-version": "10.0.26300",
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
                    ),
                },
                timeout=10,
            )
            resp.raise_for_status()
            cls._token = resp.text.strip()
            cls._token_time = now
            return cls._token


# ── 有道翻译 Demo API ─────────────────────────────────

class YoudaoProvider(TranslateProvider):
    """有道翻译 Demo API (参考 WeiLin wangyi.py)"""

    name = "youdao"
    _url = "https://aidemo.youdao.com/trans"

    _lang_map = {
        "zh": "zh-CHS", "zh-CN": "zh-CHS", "zh-Hans": "zh-CHS",
        "en": "en", "ja": "ja", "ko": "ko",
        "auto": "Auto",
    }

    def translate(self, text: str, from_lang: str = "en", to_lang: str = "zh") -> str:
        if len(text) > 1000:
            raise ValueError("Youdao text limit: 1000 chars")
        src = self._lang_map.get(from_lang, from_lang)
        tgt = self._lang_map.get(to_lang, to_lang)

        resp = requests.post(
            self._url,
            data={"q": text, "from": src, "to": tgt},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("errorCode") != "0":
            raise RuntimeError(f"Youdao error: {data.get('errorCode')}")
        translations = data.get("translation", [])
        if not translations:
            raise RuntimeError("Youdao returned empty translation")
        return translations[0]


# ── 阿里翻译 v2 逆向 ──────────────────────────────────

class AlibabaProvider(TranslateProvider):
    """阿里翻译 v2 逆向 (参考 WeiLin alibabav2.py)"""

    name = "alibaba"
    _host_url = "https://translate.alibaba.com"
    _api_url = "https://translate.alibaba.com/api/translate/text"
    _csrf_url = "https://translate.alibaba.com/api/translate/csrftoken"
    _lang_pattern = re.compile(
        r"//lang\.alicdn\.com/mcms/translation-open-portal/(.*?)/translation-open-portal_interface\.json"
    )

    # Session 缓存
    _session: requests.Session | None = None
    _csrf_token: dict | None = None
    _query_count = 0
    _begin_time = 0.0
    _lock = threading.Lock()
    _input_limit = 5000
    _session_ttl = 1500  # 25 分钟

    _lang_map = {
        "zh": "zh", "zh-CN": "zh", "zh-Hans": "zh",
        "en": "en", "ja": "ja", "ko": "ko",
        "auto": "auto",
    }

    def translate(self, text: str, from_lang: str = "en", to_lang: str = "zh") -> str:
        if len(text) > self._input_limit:
            raise ValueError(f"Alibaba text limit: {self._input_limit} chars")
        src = self._lang_map.get(from_lang, from_lang)
        tgt = self._lang_map.get(to_lang, to_lang)

        with self._lock:
            self._ensure_session()
            self._query_count += 1

            files_data = {
                "query": (None, text),
                "srcLang": (None, src),
                "tgtLang": (None, tgt),
                "_csrf": (None, self._csrf_token["token"]),
                "domain": (None, "general"),
            }
            resp = self._session.post(
                self._api_url,
                files=files_data,
                headers={
                    "Origin": self._host_url,
                    "Referer": self._host_url,
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()

        translated = data.get("data", {}).get("translateText", "")
        if not translated:
            raise RuntimeError(f"Alibaba returned empty: {data}")
        return translated

    @classmethod
    def _ensure_session(cls):
        """初始化或刷新 Session + CSRF Token"""
        now = time.time()
        need_refresh = (
            cls._session is None
            or cls._csrf_token is None
            or cls._query_count % 1000 == 0
            or now - cls._begin_time > cls._session_ttl
        )
        if not need_refresh:
            return

        cls._session = requests.Session()
        cls._session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/143.0.0.0 Safari/537.36"
            ),
        })

        # 1. GET 主页 (建立 cookie)
        cls._session.get(cls._host_url, timeout=10)

        # 2. GET CSRF Token
        csrf_resp = cls._session.get(cls._csrf_url, timeout=10)
        csrf_resp.raise_for_status()
        cls._csrf_token = csrf_resp.json()
        # csrf_token 格式: {"headerName": "x-csrf-token", "token": "..."}

        # 3. 更新 session headers
        cls._session.headers.update({
            cls._csrf_token["headerName"]: cls._csrf_token["token"],
        })

        cls._begin_time = now
        cls._query_count = 0


# ── 翻译服务 (统一入口) ────────────────────────────────

# Provider 注册表
PROVIDERS: dict[str, TranslateProvider] = {
    "local_db": LocalDBProvider(),
    "mymemory": MyMemoryProvider(),
    "bing": BingProvider(),
    "youdao": YoudaoProvider(),
    "alibaba": AlibabaProvider(),
}

# 默认 fallback 链
DEFAULT_CHAIN = ["local_db", "bing", "mymemory"]


def translate(
    text: str,
    from_lang: str = "en",
    to_lang: str = "zh",
    provider: str | None = None,
) -> dict:
    """
    翻译文本。

    Args:
        text: 待翻译文本
        from_lang: 源语言 (en/zh/auto)
        to_lang: 目标语言 (zh/en)
        provider: 指定 provider 名称。None 则按 DEFAULT_CHAIN fallback。

    Returns:
        {"translate": str, "provider": str, "from_db": bool}
    """
    text = text.strip()
    if not text:
        return {"translate": "", "provider": "", "from_db": False}

    # 指定 provider
    if provider and provider in PROVIDERS:
        try:
            result = PROVIDERS[provider].translate(text, from_lang, to_lang)
            return {
                "translate": result,
                "provider": provider,
                "from_db": provider == "local_db",
            }
        except Exception as e:
            log.warning("[translate] %s failed: %s", provider, e)
            return {"translate": "", "provider": provider, "error": str(e)}

    # Fallback 链
    for name in DEFAULT_CHAIN:
        p = PROVIDERS.get(name)
        if not p:
            continue
        try:
            result = p.translate(text, from_lang, to_lang)
            # Skip if empty or result is just the original text (translation failed)
            if result and result.lower() != text.lower():
                return {
                    "translate": result,
                    "provider": name,
                    "from_db": name == "local_db",
                }
        except Exception as e:
            log.debug("[translate] %s failed, trying next: %s", name, e)
            continue

    return {"translate": "", "provider": "", "from_db": False}


def translate_word(word: str) -> dict:
    """
    单词快速翻译 (仅本地 DB)。用于 tag chip 的 tooltip。
    """
    text = word.strip()
    if not text:
        return {"translate": "", "from_db": False}
    result = LocalDBProvider._lookup_en(text)
    if result:
        return {"translate": result, "from_db": True}
    return {"translate": "", "from_db": False}
