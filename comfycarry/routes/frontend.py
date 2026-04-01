"""
ComfyCarry — 前端页面服务路由

- /              — Dashboard 或 Setup Wizard (来自 static/dist/)
- /favicon.ico   — 图标
- /assets/<path> — Vite 构建产物资源
"""

import os

from flask import Blueprint, Response, send_file
from pathlib import Path

from ..config import SCRIPT_DIR, _is_setup_complete

bp = Blueprint("frontend", __name__)

DIST_DIR = Path(SCRIPT_DIR) / "static" / "dist"


def _serve_public_file(filename: str, mimetype: str | None = None):
    """Serve Vite public files from dist root only."""
    dist_file = (DIST_DIR / filename).resolve()

    if dist_file.exists() and dist_file.is_file():
        resp = send_file(str(dist_file), mimetype=mimetype)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp
    return "", 404


@bp.route("/")
def index():
    if not _is_setup_complete():
        wizard_dist = DIST_DIR / "wizard.html"
        if wizard_dist.exists():
            resp = Response(wizard_dist.read_text(encoding="utf-8"),
                            mimetype="text/html")
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return resp
        return Response("<h1>dist/wizard.html not found</h1>",
                        mimetype="text/html", status=404)

    dist_index = DIST_DIR / "index.html"
    if dist_index.exists():
        resp = Response(dist_index.read_text(encoding="utf-8"),
                        mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return Response("<h1>dist/index.html not found</h1>",
                    mimetype="text/html", status=404)


@bp.route("/favicon.ico")
def serve_favicon():
    # 优先 dist/ 目录中的 favicon
    dist_ico = DIST_DIR / "favicon.ico"
    ico = str(dist_ico) if dist_ico.exists() else os.path.join(SCRIPT_DIR, "favicon.ico")
    if os.path.exists(ico):
        return send_file(ico, mimetype="image/x-icon")
    return "", 204


@bp.route("/apple-touch-icon.png")
def serve_apple_touch_icon():
    return _serve_public_file("apple-touch-icon.png", mimetype="image/png")


@bp.route("/logo.png")
def serve_logo():
    return _serve_public_file("logo.png", mimetype="image/png")


@bp.route("/logo-small.png")
def serve_logo_small():
    return _serve_public_file("logo-small.png", mimetype="image/png")


@bp.route("/fonts/<path:filename>")
def serve_fonts(filename):
    fonts_dir = (DIST_DIR / "fonts").resolve()
    safe_path = (fonts_dir / filename).resolve()
    if not str(safe_path).startswith(str(fonts_dir) + os.sep):
        return "", 403
    if safe_path.exists() and safe_path.is_file():
        resp = send_file(str(safe_path), mimetype="font/woff2" if filename.endswith(".woff2") else None)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp
    return "", 404


@bp.route("/assets/<path:filename>")
def serve_assets(filename):
    """Serve Vite build output assets (CSS/JS bundles)."""
    assets_dir = (DIST_DIR / "assets").resolve()
    safe_path = (assets_dir / filename).resolve()
    if not str(safe_path).startswith(str(assets_dir) + os.sep):
        return "", 403
    if safe_path.exists() and safe_path.is_file():
        mime = None
        if filename.endswith(".js"):
            mime = "application/javascript"
        elif filename.endswith(".css"):
            mime = "text/css"
        resp = send_file(str(safe_path), mimetype=mime)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp
    return "", 404
