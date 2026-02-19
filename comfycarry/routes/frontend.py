"""
ComfyCarry — 前端页面服务路由

- /              — Dashboard 或 Setup Wizard
- /dashboard.js  — 前端 JS
- /favicon.ico   — 图标
- /static/<path> — 静态文件
"""

import os

from flask import Blueprint, Response, send_file
from pathlib import Path

from ..config import SCRIPT_DIR, _is_setup_complete

bp = Blueprint("frontend", __name__)


@bp.route("/")
def index():
    if not _is_setup_complete():
        wizard_path = Path(SCRIPT_DIR) / "setup_wizard.html"
        if wizard_path.exists():
            resp = Response(wizard_path.read_text(encoding="utf-8"),
                            mimetype="text/html")
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return resp
        return Response("<h1>setup_wizard.html not found</h1>",
                        mimetype="text/html", status=404)
    html_path = Path(SCRIPT_DIR) / "dashboard.html"
    if html_path.exists():
        resp = Response(html_path.read_text(encoding="utf-8"),
                        mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return Response("<h1>dashboard.html not found</h1>",
                    mimetype="text/html", status=404)


@bp.route("/dashboard.js")
def serve_js():
    js_path = Path(SCRIPT_DIR) / "dashboard.js"
    if js_path.exists():
        resp = Response(js_path.read_text(encoding="utf-8"),
                        mimetype="application/javascript")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return "", 404


@bp.route("/favicon.ico")
def serve_favicon():
    ico = os.path.join(SCRIPT_DIR, "favicon.ico")
    if os.path.exists(ico):
        return send_file(ico, mimetype="image/x-icon")
    return "", 204


@bp.route("/static/<path:filename>")
def serve_static(filename):
    static_dir = (Path(SCRIPT_DIR) / "static").resolve()
    safe_path = (static_dir / filename).resolve()
    if not str(safe_path).startswith(str(static_dir) + os.sep):
        return "", 403
    if safe_path.exists() and safe_path.is_file():
        # JS modules need correct MIME type
        mime = None
        if filename.endswith(".js"):
            mime = "application/javascript"
        elif filename.endswith(".css"):
            mime = "text/css"
        resp = send_file(str(safe_path), mimetype=mime)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    return "", 404
