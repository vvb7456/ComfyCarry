"""
ComfyCarry — 通用文件管理路由

包含:
- GET  /api/files/stat   — 文件 / 目录信息 (存在性、大小、类型、修改时间)
- GET  /api/files/read   — 读取文件内容 (文本 或 Base64)
- POST /api/files/write  — 写入文件内容 (自动创建父目录、可选备份、可选权限)
- POST /api/files/delete — 删除文件或目录 (支持批量 / 递归 / 关联文件清理)
"""

import base64
import os
import shutil
from pathlib import Path

from flask import Blueprint, jsonify, request

bp = Blueprint("files", __name__)

# ── 安全边界: 所有操作限制在 /workspace 内 ──
WORKSPACE_ROOT = Path("/workspace").resolve()

# 模型关联文件后缀列表 (用于 companions 模式)
_COMPANION_SUFFIXES = [
    ".weilin-info.json",  # 元数据 (追加到完整文件名后)
    ".civitai.info",      # 旧版 CivitAI 元数据 (追加到完整文件名后)
    ".jpg",               # 预览图 (替换扩展名)
    ".jpeg",
    ".png",
    ".webp",
]


def _validate_path(raw: str, *, allow_root: bool = False) -> tuple[Path | None, str | None]:
    """验证并解析路径, 确保在 /workspace 内。

    支持:
    - 绝对路径: /workspace/ComfyUI/models/foo.safetensors
    - 相对路径: ComfyUI/models/foo.safetensors (相对于 /workspace)

    Args:
        allow_root: 是否允许 /workspace 本身 (stat/read 允许, delete 不允许)

    Returns:
        (resolved_path, None) on success
        (None, error_message) on failure
    """
    if not raw or not raw.strip():
        return None, "path is required"

    p = Path(raw.strip())
    if not p.is_absolute():
        p = WORKSPACE_ROOT / p
    resolved = p.resolve()

    if not resolved.is_relative_to(WORKSPACE_ROOT):
        return None, "Path outside /workspace boundary"
    if not allow_root and resolved == WORKSPACE_ROOT:
        return None, "Cannot operate on /workspace root"

    return resolved, None


def _delete_companions(file_path: Path) -> list[str]:
    """Delete companion files associated with a model file."""
    deleted = []
    base_no_ext = file_path.with_suffix("")

    for suffix in _COMPANION_SUFFIXES:
        # .weilin-info.json and .civitai.info append to full filename
        # image suffixes replace the file extension
        if suffix.startswith(".weilin") or suffix.startswith(".civitai"):
            companion = Path(str(file_path) + suffix)
        else:
            companion = base_no_ext.with_suffix(suffix)

        if companion.exists() and companion.is_file():
            companion.unlink()
            deleted.append(str(companion))

    return deleted


@bp.route("/api/files/delete", methods=["POST"])
def api_delete_files():
    """通用文件 / 目录删除端点。

    Request JSON:
        path      (str)           — 单个路径 (绝对 或 相对于 /workspace)
        paths     (list[str])     — 批量路径 (与 path 互斥, 二选一)
        recursive (bool, false)   — 删除目录时是否递归
        companions (bool, false)  — 同时删除关联文件 (模型元数据 + 预览图)

    Response JSON:
        ok        (bool)          — 全部成功为 true
        deleted   (list[str])     — 实际删除的路径列表
        errors    (list[object])  — 失败项 [{path, error}], 空数组表示无错误
    """
    data = request.get_json(force=True) or {}

    # ── 解析目标路径列表 ──
    raw_paths: list[str] = []
    if "paths" in data and isinstance(data["paths"], list):
        raw_paths = [str(p) for p in data["paths"] if p]
    elif "path" in data:
        raw_paths = [str(data["path"])]

    if not raw_paths:
        return jsonify({"error": "path or paths is required"}), 400

    recursive: bool = bool(data.get("recursive", False))
    companions: bool = bool(data.get("companions", False))

    deleted: list[str] = []
    errors: list[dict] = []

    for raw in raw_paths:
        target, err = _validate_path(raw)
        if err:
            errors.append({"path": raw, "error": err})
            continue

        if not target.exists():
            errors.append({"path": raw, "error": "Not found"})
            continue

        try:
            if target.is_file():
                # 删除关联文件 (可选)
                if companions:
                    deleted.extend(_delete_companions(target))
                target.unlink()
                deleted.append(str(target))

            elif target.is_dir():
                if not recursive:
                    errors.append({"path": raw, "error": "Is a directory — set recursive=true"})
                    continue
                shutil.rmtree(target)
                deleted.append(str(target))

            else:
                errors.append({"path": raw, "error": "Unsupported file type"})

        except PermissionError:
            errors.append({"path": raw, "error": "Permission denied"})
        except OSError as e:
            errors.append({"path": raw, "error": str(e)})

    return jsonify({
        "ok": len(errors) == 0,
        "deleted": deleted,
        "errors": errors,
    })


# ─────────────────────────────────────────────────────────
# GET /api/files/stat — 文件 / 目录信息
# ─────────────────────────────────────────────────────────

@bp.route("/api/files/stat", methods=["GET"])
def api_files_stat():
    """查询文件或目录的基本信息。

    Query params:
        path  (str) — 绝对 或 相对于 /workspace

    Response JSON:
        exists   (bool)
        is_file  (bool)
        is_dir   (bool)
        size     (int, bytes) — 仅文件
        mtime    (float, unix timestamp)
        path     (str) — 解析后的绝对路径
    """
    raw = request.args.get("path", "")
    target, err = _validate_path(raw, allow_root=True)
    if err:
        return jsonify({"error": err}), 400

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


# ─────────────────────────────────────────────────────────
# GET /api/files/read — 读取文件内容
# ─────────────────────────────────────────────────────────

@bp.route("/api/files/read", methods=["GET"])
def api_files_read():
    """读取文件内容 (文本 或 Base64 编码的二进制)。

    Query params:
        path     (str)          — 绝对 或 相对于 /workspace
        encoding (str, utf-8)   — 文本编码
        binary   (bool, false)  — 以 Base64 返回二进制内容

    Response JSON:
        content        (str) — 文本内容 (binary=false)
        content_base64 (str) — Base64 编码内容 (binary=true)
        size           (int) — 文件大小 (bytes)
        path           (str) — 解析后的绝对路径
    """
    raw = request.args.get("path", "")
    target, err = _validate_path(raw)
    if err:
        return jsonify({"error": err}), 400

    if not target.is_file():
        return jsonify({"error": "Not a file or does not exist"}), 404

    # 限制读取大小 (10 MB)
    size = target.stat().st_size
    if size > 10 * 1024 * 1024:
        return jsonify({"error": f"File too large ({size} bytes), max 10 MB"}), 413

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
        return jsonify({"error": "Cannot decode file as text — try binary=true"}), 422
    except OSError as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────
# POST /api/files/write — 写入文件内容
# ─────────────────────────────────────────────────────────

@bp.route("/api/files/write", methods=["POST"])
def api_files_write():
    """写入文件内容。

    Request JSON:
        path           (str)          — 绝对 或 相对于 /workspace
        content        (str)          — 文本内容 (与 content_base64 二选一)
        content_base64 (str)          — Base64 编码的二进制内容
        encoding       (str, utf-8)   — 文本写入编码
        mkdir          (bool, true)   — 自动创建父目录
        backup         (bool, false)  — 覆盖前创建 .bak 备份
        mode           (str)          — 文件权限 (如 "0600"), 可选

    Response JSON:
        ok    (bool)
        path  (str) — 写入的绝对路径
        size  (int) — 写入的字节数
    """
    data = request.get_json(force=True) or {}

    raw = data.get("path", "")
    target, err = _validate_path(raw)
    if err:
        return jsonify({"error": err}), 400

    # 不允许写入目录路径
    if target.exists() and target.is_dir():
        return jsonify({"error": "Cannot write to a directory"}), 400

    # 解析内容
    content_text = data.get("content")
    content_b64 = data.get("content_base64")

    if content_text is None and content_b64 is None:
        return jsonify({"error": "content or content_base64 is required"}), 400

    # 自动创建父目录
    if data.get("mkdir", True):
        target.parent.mkdir(parents=True, exist_ok=True)

    # 备份现有文件
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
        return jsonify({"error": f"Content encoding error: {e}"}), 400
    except OSError as e:
        return jsonify({"error": str(e)}), 500

    # 设置文件权限
    mode = data.get("mode")
    if mode:
        try:
            os.chmod(target, int(mode, 8))
        except (ValueError, OSError) as e:
            return jsonify({"error": f"chmod failed: {e}"}), 500

    return jsonify({
        "ok": True,
        "path": str(target),
        "size": size,
    })
