import base64
import os
import shutil
from pathlib import Path

from flask import Blueprint, jsonify, request

# 文件 API 保留物理路径范围检查；根标记本身不扩大软链接的访问范围。
from ..config import WORKSPACE_ROOT, COMFYUI_DIR, resolve_file_path, FilePathError

bp = Blueprint("files", __name__)


# ====================================================================
# 响应文案 —— 一律 key + params, 由前端翻译 (i18n/locales/*/files.json)
# 契约同 sync.py: error_key=files.err.<key> + error_params; 前端
# apiErrorText() 查 key, 缺条目原样显示 key。str(e) 原文不翻译, 作为
# detail 参数透传。
# ====================================================================
def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `files.err.<key>` 翻译; _extra 是响应体附加顶层字段。"""
    body = {"error_key": f"files.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


_COMPANION_SUFFIXES = [
    ".jpg",               # 预览图 (替换扩展名)
    ".jpeg",
    ".png",
    ".webp",
]


def _validate_path(
    raw: str, *, allow_root: bool = False
) -> tuple[Path | None, tuple[str, dict] | None]:
    try:
        p = resolve_file_path(raw)
    except FilePathError as exc:
        return None, (exc.key, exc.params)
    resolved = p.resolve()

    if not any(resolved.is_relative_to(root.resolve()) for root in (WORKSPACE_ROOT, Path(COMFYUI_DIR))):
        return None, ("path_outside", {"root": "{workspace}, {ComfyUI}"})
    if not allow_root and resolved == WORKSPACE_ROOT:
        return None, ("path_is_root", {"root": str(WORKSPACE_ROOT)})

    return resolved, None


def _delete_companions(file_path: Path) -> list[str]:
    deleted = []
    base_no_ext = file_path.with_suffix("")

    for suffix in _COMPANION_SUFFIXES:
        companion = base_no_ext.with_suffix(suffix)

        if companion.exists() and companion.is_file():
            companion.unlink()
            deleted.append(str(companion))

    return deleted


@bp.route("/api/files/delete", methods=["POST"])
def api_delete_files():
    data = request.get_json(force=True) or {}

    raw_paths: list[str] = []
    if "paths" in data and isinstance(data["paths"], list):
        raw_paths = [str(p) for p in data["paths"] if p]
    elif "path" in data:
        raw_paths = [str(data["path"])]

    if not raw_paths:
        return _err("path_required")

    recursive: bool = bool(data.get("recursive", False))
    companions: bool = bool(data.get("companions", False))

    deleted: list[str] = []
    errors: list[dict] = []

    for raw in raw_paths:
        target, err = _validate_path(raw)
        if err:
            errors.append({"path": raw,
                           "error_key": f"files.err.{err[0]}",
                           "error_params": err[1]})
            continue

        if not target.exists():
            errors.append({"path": raw,
                           "error_key": "files.err.not_found"})
            continue

        try:
            if target.is_file():
                if companions:
                    deleted.extend(_delete_companions(target))
                target.unlink()
                deleted.append(str(target))

            elif target.is_dir():
                if not recursive:
                    errors.append({"path": raw,
                                   "error_key": "files.err.is_directory"})
                    continue
                shutil.rmtree(target)
                deleted.append(str(target))

            else:
                errors.append({"path": raw,
                               "error_key": "files.err.unsupported_type"})

        except PermissionError:
            errors.append({"path": raw, "error_key": "files.err.permission_denied"})
        except OSError as e:
            errors.append({"path": raw, "error_key": "files.err.internal",
                           "error_params": {"detail": str(e)}})

    return jsonify({
        "ok": len(errors) == 0,
        "deleted": deleted,
        "errors": errors,
    })


@bp.route("/api/files/stat", methods=["GET"])
def api_files_stat():
    raw = request.args.get("path", "")
    target, err = _validate_path(raw, allow_root=True)
    if err:
        return _err(err[0], 400, **err[1])

    if not target.exists():
        return jsonify({"exists": False, "path": str(target)})

    stat = target.stat()
    return jsonify({
        "exists": True,
        "is_file": target.is_file(),
        "is_dir": target.is_dir(),
        "size": stat.st_size if target.is_file() else 0,
        "mtime": stat.st_mtime,
        "path": str(target),
    })


@bp.route("/api/files/read", methods=["GET"])
def api_files_read():
    raw = request.args.get("path", "")
    target, err = _validate_path(raw)
    if err:
        return _err(err[0], 400, **err[1])

    if not target.is_file():
        return _err("not_a_file", 404)

    size = target.stat().st_size
    if size > 10 * 1024 * 1024:
        return _err("file_too_large", 413, size=size, max=10 * 1024 * 1024)

    is_binary = request.args.get("binary", "").lower() in ("1", "true", "yes")

    try:
        if is_binary:
            data = target.read_bytes()
            return jsonify({
                "content_base64": base64.b64encode(data).decode("ascii"),
                "size": size,
                "path": str(target),
            })
        else:
            encoding = request.args.get("encoding", "utf-8")
            content = target.read_text(encoding=encoding)
            return jsonify({
                "content": content,
                "size": size,
                "path": str(target),
            })
    except UnicodeDecodeError:
        return _err("cannot_decode", 422)
    except OSError as e:
        return _err("internal", 500, detail=str(e))


@bp.route("/api/files/write", methods=["POST"])
def api_files_write():
    data = request.get_json(force=True) or {}

    raw = data.get("path", "")
    target, err = _validate_path(raw)
    if err:
        return _err(err[0], 400, **err[1])

    if target.exists() and target.is_dir():
        return _err("is_directory")

    content_text = data.get("content")
    content_b64 = data.get("content_base64")

    if content_text is None and content_b64 is None:
        return _err("content_required")

    if data.get("mkdir", True):
        target.parent.mkdir(parents=True, exist_ok=True)

    if data.get("backup") and target.exists():
        bak = target.with_suffix(target.suffix + ".bak")
        shutil.copy2(target, bak)

    try:
        if content_b64 is not None:
            raw_bytes = base64.b64decode(content_b64)
            target.write_bytes(raw_bytes)
            size = len(raw_bytes)
        else:
            encoding = data.get("encoding", "utf-8")
            target.write_text(content_text, encoding=encoding)
            size = target.stat().st_size
    except (ValueError, UnicodeEncodeError) as e:
        return _err("encoding_error", 400, detail=str(e))
    except OSError as e:
        return _err("internal", 500, detail=str(e))

    mode = data.get("mode")
    if mode:
        try:
            os.chmod(target, int(mode, 8))
        except (ValueError, OSError) as e:
            return _err("chmod_failed", 500, detail=str(e))

    return jsonify({
        "ok": True,
        "path": str(target),
        "size": size,
    })
