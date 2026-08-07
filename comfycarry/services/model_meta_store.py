"""Model metadata index backed by the instance SQLite database.

The model index is deliberately kept in one place.  Download and enrich callers
pass resolver output here, while list/detail/generation callers only read the
normalized rows.  A model file is identified by its resolved absolute path;
``models.id`` is the identifier exposed by HTTP routes.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from ..config import (
    COMFYUI_DIR,
    MODEL_DIRS,
    MODEL_EXTENSIONS,
    WORKSPACE_ROOT,
    get_extra_model_paths,
)
from ..db import db
from .arch_detect import arch_from_base_model, detect_arch

log = logging.getLogger(__name__)

_PREVIEW_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
_auto_enrich_lock = threading.Lock()
_auto_enrich_queued: set[int] = set()
_auto_enrich_attempted: set[int] = set()
_auto_enrich_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model-enrich")


# ---------------------------------------------------------------------------
# JSON and value normalization
# ---------------------------------------------------------------------------


def _json_load(value: Any, default: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return default
    return parsed


def _json_dump(value: Any, default: Any) -> str:
    if value is None:
        value = default
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return json.dumps(default, ensure_ascii=False, separators=(",", ":"))


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _source_model(source_data: dict[str, Any]) -> dict[str, Any]:
    model = source_data.get("model")
    return model if isinstance(model, dict) else {}


def _source_value(source_data: dict[str, Any], model: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source_data.get(key)
        if value not in (None, ""):
            return value
    for key in keys:
        value = model.get(key)
        if value not in (None, ""):
            return value
    return ""


def _normalize_words(value: Any) -> list[str]:
    """Split comma-delimited trigger values, preserving first-seen spelling."""
    if value is None:
        return []
    if isinstance(value, dict):
        value = value.get("word", value.get("text", ""))
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, (list, tuple, set)):
        values = list(value)
    else:
        values = [value]

    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        if isinstance(item, dict):
            item = item.get("word", item.get("text", ""))
        if item is None:
            continue
        for part in str(item).split(","):
            word = part.strip()
            if word and word not in seen:
                seen.add(word)
                result.append(word)
    return result


def _normalize_image(image: Any) -> dict[str, Any] | None:
    if not isinstance(image, dict):
        return None
    url = _text(image.get("url"))
    if not url:
        return None
    raw_meta = image.get("meta")
    if not isinstance(raw_meta, dict):
        raw_meta = {}
    # Accept both the CivitAI wire shape and an already normalized image.
    meta: dict[str, Any] = {}
    meta_keys = {
        "seed": "seed",
        "prompt": "prompt",
        "positive": "prompt",
        "negativePrompt": "negative_prompt",
        "negative_prompt": "negative_prompt",
        "steps": "steps",
        "sampler": "sampler",
        "cfgScale": "cfg_scale",
        "cfg_scale": "cfg_scale",
        "Model": "model",
        "model": "model",
        "resources": "resources",
    }
    for source_key, target_key in meta_keys.items():
        if source_key in raw_meta and target_key not in meta:
            meta[target_key] = raw_meta[source_key]

    result: dict[str, Any] = {
        "url": url,
        "type": _text(image.get("type")) or "image",
    }
    for key in ("width", "height"):
        if image.get(key) is not None:
            result[key] = image[key]
    if image.get("nsfw_level") is not None:
        result["nsfw_level"] = image["nsfw_level"]
    elif image.get("nsfwLevel") is not None:
        result["nsfw_level"] = image["nsfwLevel"]
    if meta:
        result["meta"] = meta
    return result


def _normalize_images(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for image in value:
        normalized = _normalize_image(image)
        if normalized is not None:
            result.append(normalized)
    return result


def _normalize_links(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if isinstance(item, str):
            url, kind = item.strip(), "source"
        elif isinstance(item, dict):
            url = _text(item.get("url"))
            kind = _text(item.get("type")) or "source"
        else:
            continue
        # The API endpoint is an implementation detail and is not useful in
        # the local model detail view.  Filter it at normalization time so
        # old rows and newly fetched metadata have one public shape.
        if kind.lower() == "civitai_api":
            continue
        if not url or (kind, url) in seen:
            continue
        seen.add((kind, url))
        result.append({"type": kind, "url": url})
    return result


def _normalize_source(source_data: dict[str, Any] | None) -> dict[str, Any]:
    """Convert resolver output or a raw CivitAI version response to one shape."""
    data = source_data if isinstance(source_data, dict) else {}
    model = _source_model(data)

    model_id = _source_value(data, model, "model_id", "modelId")
    nested_source = data.get("source") if isinstance(data.get("source"), dict) else {}
    if model_id in (None, ""):
        model_id = nested_source.get("model_id", nested_source.get("modelId", ""))
    if model_id in (None, ""):
        model_id = model.get("id", "")
    if model_id in (None, "") and not model and data.get("version_id") not in (None, ""):
        # Some adapters expose a model ID as ``id`` alongside an explicit
        # version_id rather than nesting a model object.
        model_id = data.get("id", "")
    if model_id in (None, "") and isinstance(data.get("raw"), dict):
        raw = data["raw"]
        raw_model = raw.get("model") if isinstance(raw.get("model"), dict) else {}
        model_id = raw.get("modelId") or raw_model.get("id") or ""
    version_id = _source_value(data, model, "version_id", "versionId")
    if version_id in (None, ""):
        version_id = nested_source.get("version_id", nested_source.get("versionId", ""))
    # In a raw version response, ``id`` is the version ID; normalized resolver
    # output already supplies version_id and should not be overwritten.
    if version_id in (None, ""):
        version_id = data.get("id", "")
    # Raw CivitAI version responses use ``name`` for the version and nest the
    # model's display name under ``model.name``.  Prefer the nested value when
    # the resolver has not already supplied model_name explicitly.
    model_name = (
        data.get("model_name")
        or model.get("name")
        or (
            data.get("name")
            if not model and data.get("name") != data.get("version_name")
            else ""
        )
        or ""
    )
    version_name = (
        data.get("version_name")
        or data.get("versionName")
        or nested_source.get("version_name")
        or nested_source.get("versionName")
        or (data.get("name") if data.get("name") and data.get("name") != model_name else "")
        or ""
    )
    model_type = _source_value(data, model, "model_type", "type")
    base_model = _source_value(data, model, "base_model", "baseModel")
    # 白名单等显式声明的架构优先, 缺失时回退到 base_model 推断
    explicit_arch = _text(data.get("architecture")) or _text(model.get("architecture"))

    source_type = _text(data.get("source_type"))
    source = data.get("source")
    if not source_type and isinstance(source, dict):
        source_type = _text(source.get("type"))
    elif not source_type and isinstance(source, str):
        source_type = source.strip()
    if not source_type and (model_id not in (None, "") or version_id not in (None, "")):
        source_type = "civitai"

    # Keep the card title stable at the model level.  Version identity is
    # stored independently in ``source_version_name`` and shown where a
    # version-specific label is appropriate.
    display_name = _text(model_name)

    trained_words = data.get("trained_words")
    if trained_words is None:
        trained_words = data.get("trainedWords")
    if trained_words is None:
        trained_words = data.get("trigger_words", [])
    if not trained_words and isinstance(data.get("trigger_sources"), dict):
        trained_words = data["trigger_sources"].get("civitai", [])
    file_words = data.get("file_trigger_words", data.get("file_header_words", []))
    if not file_words and isinstance(data.get("trigger_sources"), dict):
        file_words = data["trigger_sources"].get("file_header", [])

    details = data.get("details_json", data.get("details"))
    if isinstance(details, str):
        details = _json_load(details, {})
    if not isinstance(details, dict):
        details = {}
    links = _normalize_links(data.get("links", details.get("links", [])))
    images_value = data.get("images")
    if images_value is None:
        images_value = details.get("images", [])
    images = _normalize_images(images_value)

    # HF 白名单平铺字段 → details_json 扩展 (仅新增键兼容, 不影响 civitai 读取)
    details_extra: dict[str, Any] = {}
    for key in ("author", "image_url", "source_url"):
        value = data.get(key)
        if value not in (None, ""):
            details_extra[key] = _text(value)
    size_bytes = data.get("size_bytes")
    if size_bytes not in (None, ""):
        try:
            details_extra["size_bytes"] = int(size_bytes)
        except (TypeError, ValueError):
            pass

    # CivitAI links are deterministic and therefore available even when the
    # resolver did not include a pre-built links list.
    if source_type == "civitai" and model_id not in (None, ""):
        model_url = f"https://civitai.com/models/{model_id}"
        if version_id not in (None, ""):
            model_url += f"?modelVersionId={version_id}"
        existing_urls = {link["url"] for link in links}
        if model_url not in existing_urls:
            links.append({"type": "civitai_web", "url": model_url})

    has_source = bool(
        source_type or model_id not in (None, "") or version_id not in (None, "")
        or model_name or version_name or model_type or base_model or trained_words
        or file_words or links or images
    )
    return {
        "source_type": source_type,
        "source_model_id": _text(model_id),
        "source_version_id": _text(version_id),
        "source_version_name": _text(version_name),
        "display_name": display_name,
        "model_type": _text(model_type),
        "base_model": _text(base_model),
        "architecture": explicit_arch or arch_from_base_model(_text(base_model)),
        "civitai_words": _normalize_words(trained_words),
        "file_words": _normalize_words(file_words),
        "links": links,
        "images": images,
        "details_extra": details_extra,
        "has_source": has_source,
        "has_images": "images" in data or "images" in details,
        # Generated CivitAI links count as source detail even when the resolver
        # supplied only IDs and names.
        "has_links": bool(links) or "links" in data or "links" in details,
    }


def _merge_words(
    civitai_words: list[str], file_words: list[str]
) -> tuple[list[str], dict[str, list[str]]]:
    civitai = _normalize_words(civitai_words)
    header = _normalize_words(file_words)
    merged: list[str] = []
    seen: set[str] = set()
    for word in [*civitai, *header]:
        if word not in seen:
            seen.add(word)
            merged.append(word)
    if not civitai and not header:
        return merged, {}
    return merged, {"civitai": civitai, "file_header": header}


def _details_from_values(links: list[dict[str, str]], images: list[dict[str, Any]]) -> dict[str, Any]:
    return {"links": links, "images": images}


# ---------------------------------------------------------------------------
# Paths and row conversion
# ---------------------------------------------------------------------------


def _resolve(path: str | os.PathLike[str]) -> Path:
    return Path(path).expanduser().resolve()


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, RuntimeError, TypeError, ValueError):
        return False


def _configured_roots() -> list[tuple[str, Path, str]]:
    """Return (category, root, storage_type) in canonical scan order."""
    result: list[tuple[str, Path, str]] = []
    seen: set[str] = set()
    comfy = _resolve(COMFYUI_DIR)
    for category, rel_dir in MODEL_DIRS.items():
        root = _resolve(comfy / rel_dir)
        key = str(root)
        if key in seen:
            continue
        seen.add(key)
        result.append((category, root, "primary"))
    for category, dirs in get_extra_model_paths().items():
        if not isinstance(dirs, list):
            continue
        for raw in dirs:
            if not raw:
                continue
            root = _resolve(raw)
            # An extra path equal to a primary path has primary ownership.
            key = str(root)
            if key in seen:
                continue
            seen.add(key)
            result.append((category, root, "extra"))
    return result


def _path_fields(model_path: Path, category: str) -> tuple[str, str]:
    """Return relative path and storage type for a model path."""
    path = model_path.resolve()
    for root_category, root, storage_type in _configured_roots():
        if root_category != category:
            continue
        if _is_under(path, root):
            return str(path.relative_to(root)), storage_type
    return path.name, "primary" if _is_under(path, _resolve(COMFYUI_DIR)) else "extra"


def local_preview_path(model_path: str | os.PathLike[str] | Path) -> Path | None:
    """Find the first same-stem preview beside a model file.

    Preview files are ordinary sidecar files, not database state.  The fixed
    extension order keeps the result deterministic when more than one exists.
    """
    try:
        path = _resolve(model_path)
    except (OSError, RuntimeError, TypeError, ValueError):
        return None
    for suffix in _PREVIEW_EXTENSIONS:
        candidate = path.with_suffix(suffix)
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _file_stat(path: Path) -> tuple[int, float]:
    try:
        st = path.stat()
        return int(st.st_size), float(st.st_mtime)
    except OSError:
        return 0, 0.0


def _model_row(model_id: int) -> Any:
    """Read the minimal row needed by hash caching."""
    return db.fetch_one(
        "SELECT sha256, size_bytes, file_mtime FROM models WHERE id = ?",
        (int(model_id),),
    )


def get_or_compute_model_sha256(
    model_id: int,
    model_path: str | os.PathLike[str],
    compute_sha256,
) -> str | None:
    """Return a valid cached hash or compute and persist the current hash.

    The cache is valid only while both file size and mtime match the indexed
    values.  A newly computed hash is persisted before any remote metadata
    request, so a CivitAI miss still avoids re-reading the same large file on a
    later attempt.  This helper owns the DB write to keep resolver code free of
    metadata-store persistence details.
    """
    path = _resolve(model_path)
    size_bytes, file_mtime = _file_stat(path)
    if not size_bytes and not file_mtime:
        return None
    row = _model_row(model_id)
    if row:
        cached = _text(row["sha256"]).upper()
        try:
            same_size = int(row["size_bytes"] or 0) == size_bytes
            same_mtime = abs(float(row["file_mtime"] or 0.0) - file_mtime) < 1e-6
        except (TypeError, ValueError):
            same_size = same_mtime = False
        if cached and same_size and same_mtime:
            return cached

    computed = compute_sha256(str(path))
    if not computed:
        return None
    normalized = _text(computed).upper()
    db.execute(
        "UPDATE models SET sha256 = ?, size_bytes = ?, file_mtime = ? WHERE id = ?",
        (normalized, size_bytes, file_mtime, int(model_id)),
    )
    return normalized


def _json_sources(value: Any) -> dict[str, list[str]]:
    parsed = _json_load(value, {})
    return parsed if isinstance(parsed, dict) else {}


def _json_words(value: Any) -> list[str]:
    return _normalize_words(_json_load(value, []))


def _row_base(row: Any) -> dict[str, Any]:
    d = dict(row)
    details = _json_load(d.pop("details_json", "{}"), {})
    if not isinstance(details, dict):
        details = {}
    trigger_sources = _json_sources(d.pop("trigger_sources_json", "{}"))
    trigger_words = _json_words(d.pop("trigger_words_json", "[]"))
    d["trigger_words"] = trigger_words
    d["trigger_sources"] = trigger_sources
    d["links"] = _normalize_links(details.get("links", []))
    d["images"] = _normalize_images(details.get("images", []))
    first_image = d["images"][0] if d["images"] else {}
    d["remote_preview_url"] = first_image.get("url") or None
    d["remote_preview_type"] = first_image.get("type") or None
    d["has_info"] = bool(d.get("has_info"))
    d.pop("details_json", None)
    try:
        path = _resolve(d.get("real_path", "")) if d.get("real_path") else Path()
    except (OSError, RuntimeError, TypeError, ValueError):
        path = Path()
    preview = local_preview_path(path) if d.get("real_path") else None
    has_preview = bool(preview)
    d["has_preview"] = has_preview
    d["preview_url"] = f"/api/local_models/{d['id']}/preview" if d["has_preview"] else None
    d["can_fetch_info"] = _is_under(path, _resolve(COMFYUI_DIR))
    d["can_delete"] = _is_under(path, _resolve(WORKSPACE_ROOT))
    d["capabilities"] = {
        "can_fetch_info": d["can_fetch_info"],
        "can_delete": d["can_delete"],
    }
    source_type = _text(d.get("source_type", ""))
    source_model_id = _text(d.get("source_model_id", ""))
    source_version_id = _text(d.get("source_version_id", ""))
    source_version_name = _text(d.get("source_version_name", ""))
    d["source"] = {
        "type": source_type,
        "model_id": source_model_id,
        "version_id": source_version_id,
        "version_name": source_version_name,
    }
    # Keep the public shape stable and avoid exposing the JSON storage column.
    d["source_type"] = source_type
    d["source_model_id"] = source_model_id
    d["source_version_id"] = source_version_id
    d["source_version_name"] = source_version_name
    return d


def _list_select_sql() -> str:
    return (
        "SELECT id, real_path, filename, category, relative_path, storage_type, "
        "size_bytes, file_mtime, display_name, model_type, architecture, base_model, "
        "source_type, source_model_id, source_version_id, source_version_name, "
        "has_info, details_json, updated_at "
        "FROM models"
    )


@contextmanager
def _transaction() -> Iterator[Any]:
    """Use Database's lock/connection for multi-statement atomic operations."""
    lock = getattr(db, "_lock", None)
    ensure = getattr(db, "_ensure_conn", None)
    if lock is None or ensure is None:
        # This fallback keeps the service easy to exercise with a tiny fake DB.
        yield None
        return
    with lock:
        conn = ensure()
        conn.execute("BEGIN")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise


# ---------------------------------------------------------------------------
# Public CRUD API
# ---------------------------------------------------------------------------


def register_downloaded_model(
    model_path: str,
    category: str,
    source_data: dict,
    sha256: str,
    file_trigger_words: list[str],
) -> dict:
    """Normalize a completed download and upsert its model index row."""
    path = _resolve(model_path)
    source = _normalize_source(source_data)
    relative_path, storage_type = _path_fields(path, _text(category))
    size_bytes, file_mtime = _file_stat(path)
    detected_arch = detect_arch(str(path), relative_path) or "unknown"
    architecture = source["architecture"] if source["architecture"] != "unknown" else detected_arch
    if architecture == "unknown":
        architecture = "unknown"
    now = time.time()
    with _transaction() as conn:
        if conn is not None:
            existing = conn.execute("SELECT * FROM models WHERE real_path = ?", (str(path),)).fetchone()
        else:
            existing = db.fetch_one("SELECT * FROM models WHERE real_path = ?", (str(path),))
        old = dict(existing) if existing else {}
        words, sources = _merge_words(
            source["civitai_words"],
            file_trigger_words or source["file_words"],
        )
        details = _details_from_values(source["links"], source["images"])
        details.update(source.get("details_extra") or {})
        if existing:
            old_details = _json_load(old.get("details_json", "{}"), {})
            if not isinstance(old_details, dict):
                old_details = {}
            if not source["has_links"]:
                details["links"] = _normalize_links(old_details.get("links", []))
            if not source["has_images"]:
                details["images"] = _normalize_images(old_details.get("images", []))
        values = {
            "real_path": str(path),
            "filename": path.name,
            "category": _text(category),
            "relative_path": relative_path,
            "storage_type": storage_type,
            "size_bytes": size_bytes,
            "file_mtime": file_mtime,
            "sha256": _text(sha256).upper() or _text(old.get("sha256")),
            "display_name": source["display_name"] or _text(old.get("display_name")) or path.name,
            "model_type": source["model_type"] or _text(old.get("model_type")) or _text(category),
            "architecture": architecture if architecture != "unknown" else _text(old.get("architecture")) or "unknown",
            "base_model": source["base_model"] or _text(old.get("base_model")),
            "trigger_words_json": _json_dump(words, []),
            "trigger_sources_json": _json_dump(sources, {}),
            "source_type": source["source_type"] or _text(old.get("source_type")),
            "source_model_id": source["source_model_id"] or _text(old.get("source_model_id")),
            "source_version_id": source["source_version_id"] or _text(old.get("source_version_id")),
            "source_version_name": source["source_version_name"] or _text(old.get("source_version_name")),
            "details_json": _json_dump(details, {"links": [], "images": []}),
            "has_info": int(source["has_source"] or bool(old.get("has_info"))),
            "created_at": float(old.get("created_at") or now),
            "updated_at": now,
        }
        columns = tuple(values)
        params = tuple(values[column] for column in columns)
        update = ", ".join(f"{column}=excluded.{column}" for column in columns if column != "real_path" and column != "created_at")
        sql = (
            f"INSERT INTO models ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) "
            f"ON CONFLICT(real_path) DO UPDATE SET {update}"
        )
        if conn is not None:
            conn.execute(sql, params)
            row = conn.execute("SELECT * FROM models WHERE real_path = ?", (str(path),)).fetchone()
        else:
            db.execute(sql, params)
            row = db.fetch_one("SELECT * FROM models WHERE real_path = ?", (str(path),))
    return _row_base(row) if row else {}


def enrich_model(
    model_id: int,
    source_data: dict,
    sha256: str,
    file_trigger_words: list[str] | None = None,
) -> dict:
    """Update one model row with normalized source metadata and return its detail."""
    source = _normalize_source(source_data)
    now = time.time()
    with _transaction() as conn:
        fetch = (lambda sql, params=(): conn.execute(sql, params).fetchone()) if conn is not None else db.fetch_one
        existing = fetch("SELECT * FROM models WHERE id = ?", (int(model_id),))
        if not existing:
            return {}
        old = dict(existing)
        path = _resolve(old.get("real_path", ""))
        size_bytes, file_mtime = _file_stat(path)
        detected_arch = detect_arch(str(path), old.get("relative_path", "")) or "unknown"
        architecture = source["architecture"] if source["architecture"] != "unknown" else _text(old.get("architecture")) or detected_arch
        words, sources = _merge_words(
            source["civitai_words"],
            file_trigger_words or source["file_words"],
        )
        details = _json_load(old.get("details_json", "{}"), {})
        if not isinstance(details, dict):
            details = {"links": [], "images": []}
        if source["has_links"]:
            details["links"] = source["links"]
        if source["has_images"]:
            details["images"] = source["images"]
        details.update(source.get("details_extra") or {})
        values = {
            "size_bytes": size_bytes,
            "file_mtime": file_mtime,
            "sha256": _text(sha256).upper() or _text(old.get("sha256")),
            "display_name": source["display_name"] or _text(old.get("display_name")) or path.name,
            "model_type": source["model_type"] or _text(old.get("model_type")),
            "architecture": architecture or "unknown",
            "base_model": source["base_model"] or _text(old.get("base_model")),
            "trigger_words_json": _json_dump(words, []),
            "trigger_sources_json": _json_dump(sources, {}),
            "source_type": source["source_type"] or _text(old.get("source_type")),
            "source_model_id": source["source_model_id"] or _text(old.get("source_model_id")),
            "source_version_id": source["source_version_id"] or _text(old.get("source_version_id")),
            "source_version_name": source["source_version_name"] or _text(old.get("source_version_name")),
            "details_json": _json_dump(details, {"links": [], "images": []}),
            "has_info": int(bool(source["has_source"]) or bool(old.get("has_info"))),
            "updated_at": now,
        }
        assignments = ", ".join(f"{key} = ?" for key in values)
        params = tuple(values.values()) + (int(model_id),)
        if conn is not None:
            conn.execute(f"UPDATE models SET {assignments} WHERE id = ?", params)
            row = conn.execute("SELECT * FROM models WHERE id = ?", (int(model_id),)).fetchone()
        else:
            db.execute(f"UPDATE models SET {assignments} WHERE id = ?", params)
            row = db.fetch_one("SELECT * FROM models WHERE id = ?", (int(model_id),))
    return _row_base(row) if row else {}


def list_models(category: str | None = None) -> list[dict]:
    """Read the lightweight fields used by the local model list."""
    sql = _list_select_sql()
    params: tuple[Any, ...] = ()
    if category and category != "all":
        sql += " WHERE category = ?"
        params = (_text(category),)
    sql += " ORDER BY updated_at DESC, id DESC"
    rows = db.fetch_all(sql, params)
    return [_row_base(row) for row in rows]


def get_model_detail(model_id: int) -> dict | None:
    """Read one model row and expand details/trigger/source JSON fields."""
    row = db.fetch_one("SELECT * FROM models WHERE id = ?", (int(model_id),))
    if not row:
        return None
    return _row_base(row)


def get_generation_metadata(categories: list[str]) -> dict[tuple[str, str], dict]:
    """Batch-read architecture and trigger metadata for generation selectors."""
    cats = [_text(value) for value in categories if _text(value)]
    if not cats:
        return {}
    placeholders = ", ".join("?" for _ in cats)
    rows = db.fetch_all(
        f"SELECT id, real_path, category, relative_path, storage_type, display_name, "
        f"architecture, base_model, sha256, trigger_words_json, source_type, "
        f"source_model_id, source_version_id, source_version_name, details_json "
        f"FROM models WHERE category IN ({placeholders}) "
        f"ORDER BY id ASC",
        tuple(cats),
    )
    # Re-apply the configured root order in memory.  The schema intentionally
    # keeps only storage_type (not a portable root ID), so two extra roots with
    # the same category/relative path need this deterministic canonical choice.
    roots = _configured_roots()

    def _root_rank(row: Any) -> int:
        try:
            path = _resolve(row["real_path"])
        except (OSError, RuntimeError, TypeError, ValueError):
            return len(roots) + (0 if row["storage_type"] == "primary" else 1)
        for index, (root_category, root, _storage_type) in enumerate(roots):
            if root_category == row["category"] and _is_under(path, root):
                return index
        return len(roots) + (0 if row["storage_type"] == "primary" else 1)

    rows = sorted(rows, key=lambda row: (_root_rank(row), int(row["id"])))
    result: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (row["category"], row["relative_path"])
        # primary rows are sorted before extra rows; keep the first canonical
        # record when roots overlap and expose one generation option.
        if key in result:
            continue
        details = _json_load(row["details_json"], {})
        if not isinstance(details, dict):
            details = {}
        images = _normalize_images(details.get("images", []))[:6]
        preview = local_preview_path(row["real_path"])
        has_preview = bool(preview)
        result[key] = {
            "id": row["id"],
            "category": row["category"],
            "relative_path": row["relative_path"],
            "display_name": row["display_name"] or row["relative_path"].rsplit("/", 1)[-1],
            "architecture": row["architecture"] or "unknown",
            "base_model": row["base_model"] or "",
            "sha256": row["sha256"] or "",
            "trigger_words": _json_words(row["trigger_words_json"]),
            "source_type": row["source_type"] or "",
            "source_model_id": row["source_model_id"] or "",
            "source_version_id": row["source_version_id"] or "",
            "source_version_name": row["source_version_name"] or "",
            "preview_url": f"/api/local_models/{row['id']}/preview" if has_preview else None,
            "has_preview": has_preview,
            "images": images,
        }
    return result


def delete_model(model_id: int) -> list[str]:
    """Delete a model file, its registered preview, and the model row."""
    row = db.fetch_one("SELECT * FROM models WHERE id = ?", (int(model_id),))
    if not row:
        return []
    model_path = _resolve(row["real_path"])
    if not _is_under(model_path, _resolve(WORKSPACE_ROOT)):
        raise PermissionError("model path is outside the current workspace")
    deleted: list[str] = []
    # The database remains until all file operations have succeeded, so a
    # failed unlink leaves a record that can be retried or reconciled.
    if model_path.exists():
        model_path.unlink()
        deleted.append(str(model_path))
    for suffix in _PREVIEW_EXTENSIONS:
        preview = model_path.with_suffix(suffix)
        if preview != model_path and preview.exists():
            preview.unlink()
            deleted.append(str(preview))
    db.execute("DELETE FROM models WHERE id = ?", (int(model_id),))
    return deleted


def _run_auto_enrich(model_id: int, model_path: str) -> None:
    try:
        from ..utils import _get_api_key
        from .civitai_resolver import enrich_model_by_hash

        enrich_model_by_hash(model_path, api_key=_get_api_key(), local_model_id=model_id)
        try:
            from ..routes.generate import invalidate_options_cache
            invalidate_options_cache()
        except Exception:
            pass
    except Exception:
        log.exception("[models] automatic metadata enrich failed: %s", model_path)
    finally:
        with _auto_enrich_lock:
            _auto_enrich_queued.discard(model_id)


def _queue_auto_enrich(model_id: int, model_path: str) -> None:
    """Queue at most one best-effort enrich attempt per model per process."""
    with _auto_enrich_lock:
        if model_id in _auto_enrich_attempted or model_id in _auto_enrich_queued:
            return
        _auto_enrich_attempted.add(model_id)
        _auto_enrich_queued.add(model_id)
    _auto_enrich_executor.submit(_run_auto_enrich, model_id, model_path)


# ---------------------------------------------------------------------------
# Startup reconciliation
# ---------------------------------------------------------------------------


def _scan_root(root: Path, category: str, storage_type: str) -> tuple[list[dict[str, Any]], bool]:
    if not root.is_dir():
        return [], False
    candidates: list[dict[str, Any]] = []
    scan_ok = True

    def onerror(_error: OSError):
        nonlocal scan_ok
        scan_ok = False

    try:
        for current, _dirs, files in os.walk(root, onerror=onerror, followlinks=False):
            current_path = Path(current)
            for filename in files:
                entry = current_path / filename
                if entry.suffix.lower() not in MODEL_EXTENSIONS:
                    continue
                try:
                    real_path = entry.resolve()
                    if not real_path.is_file() or not _is_under(real_path, root):
                        continue
                    stat = real_path.stat()
                except OSError:
                    scan_ok = False
                    continue
                try:
                    relative = str(entry.relative_to(root))
                except ValueError:
                    relative = entry.name
                candidates.append({
                    "real_path": str(real_path),
                    "filename": entry.name,
                    "category": category,
                    "relative_path": relative,
                    "storage_type": storage_type,
                    "size_bytes": int(stat.st_size),
                    "file_mtime": float(stat.st_mtime),
                })
    except OSError:
        scan_ok = False
    return candidates, scan_ok


def reconcile_model_index() -> dict:
    """Scan configured model roots and reconcile the SQLite model index."""
    candidates: dict[str, dict[str, Any]] = {}
    successful_roots: list[Path] = []
    for category, root, storage_type in _configured_roots():
        found, ok = _scan_root(root, category, storage_type)
        if ok:
            successful_roots.append(root)
        # Roots are visited in canonical priority order, so first real path wins.
        for candidate in found:
            candidates.setdefault(candidate["real_path"], candidate)

    inserted = 0
    updated = 0
    removed = 0
    enrich_ids: list[tuple[int, str]] = []
    now = time.time()
    with _transaction() as conn:
        if conn is not None:
            existing_rows = conn.execute("SELECT * FROM models").fetchall()
        else:
            existing_rows = db.fetch_all("SELECT * FROM models")
        existing_by_path = {str(row["real_path"]): row for row in existing_rows}

        for real_path, candidate in candidates.items():
            old = existing_by_path.get(real_path)
            old_dict = dict(old) if old else {}
            # Architecture detection is relatively expensive. Existing
            # unchanged rows retain their value, including ``unknown``.
            file_changed = (
                not old
                or int(old_dict.get("size_bytes") or 0) != int(candidate["size_bytes"])
                or abs(float(old_dict.get("file_mtime") or 0.0) - float(candidate["file_mtime"])) >= 1e-6
            )
            old_arch = _text(old_dict.get("architecture"))
            if file_changed:
                architecture = detect_arch(real_path, candidate["relative_path"]) or old_arch or "unknown"
            else:
                architecture = old_arch or "unknown"
            values = {
                **candidate,
                "sha256": _text(old_dict.get("sha256")).upper(),
                "display_name": _text(old_dict.get("display_name")) or candidate["filename"],
                "model_type": _text(old_dict.get("model_type")) or candidate["category"],
                "architecture": architecture,
                "base_model": _text(old_dict.get("base_model")),
                "trigger_words_json": _text(old_dict.get("trigger_words_json")) or "[]",
                "trigger_sources_json": _text(old_dict.get("trigger_sources_json")) or "{}",
                "source_type": _text(old_dict.get("source_type")),
                "source_model_id": _text(old_dict.get("source_model_id")),
                "source_version_id": _text(old_dict.get("source_version_id")),
                "source_version_name": _text(old_dict.get("source_version_name")),
                "details_json": _text(old_dict.get("details_json")) or "{}",
                "has_info": int(old_dict.get("has_info") or 0),
                "created_at": float(old_dict.get("created_at") or now),
                "updated_at": now,
            }
            if old:
                # Do not touch updated_at (or issue an upsert) when the
                # filesystem facts and indexed fields are unchanged.
                changed = any(
                    values[key] != old_dict.get(key)
                    for key in ("filename", "category", "relative_path", "storage_type",
                                "size_bytes", "file_mtime", "architecture")
                )
                if not changed:
                    continue
                values["updated_at"] = now
            columns = tuple(values)
            params = tuple(values[column] for column in columns)
            update = ", ".join(f"{column}=excluded.{column}" for column in columns if column not in {"real_path", "created_at"})
            sql = (
                f"INSERT INTO models ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) "
                f"ON CONFLICT(real_path) DO UPDATE SET {update}"
            )
            if conn is not None:
                conn.execute(sql, params)
            else:
                db.execute(sql, params)
            if old:
                updated += 1
            else:
                inserted += 1
        # A missing root is not considered a successful scan and cannot cause
        # rows to be removed.  This protects models on temporarily unavailable
        # extra volumes.
        if successful_roots:
            stale = []
            candidate_paths = set(candidates)
            for row in existing_rows:
                real_path = _resolve(row["real_path"])
                if str(real_path) in candidate_paths:
                    continue
                if any(_is_under(real_path, root) for root in successful_roots):
                    stale.append(int(row["id"]))
            for model_id in stale:
                if conn is not None:
                    conn.execute("DELETE FROM models WHERE id = ?", (model_id,))
                else:
                    db.execute("DELETE FROM models WHERE id = ?", (model_id,))
            removed = len(stale)

    # One query is enough to find locally indexed models that have never had
    # the automatic metadata attempt. Restrict it to this successful disk scan
    # so an unavailable mounted root is not queued accidentally.
    candidate_paths = set(candidates)
    for row in db.fetch_all(
        "SELECT id, real_path FROM models WHERE has_info = 0 AND sha256 = ''"
    ):
        real_path = str(row["real_path"])
        if real_path in candidate_paths:
            enrich_ids.append((int(row["id"]), real_path))

    for model_id, real_path in enrich_ids:
        _queue_auto_enrich(model_id, real_path)

    return {
        "scanned": len(candidates),
        "inserted": inserted,
        "updated": updated,
        "removed": removed,
        "roots": len(successful_roots),
    }
