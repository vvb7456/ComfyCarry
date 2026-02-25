"""
ComfyCarry — 认证模块 (Login/Logout + check_auth 中间件)
"""

from flask import Blueprint, request, Response, jsonify, redirect, session

from . import config

auth_bp = Blueprint("auth", __name__)

LOGIN_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - ComfyCarry</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans','IBM Plex Sans SC',-apple-system,sans-serif;background:#0a0a0f;color:#e8e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:clamp(15px,1.1vw,21px)}
.card{background:#1a1a28;border:1px solid #2a2a3e;border-radius:14px;padding:clamp(32px,3vw,48px);width:clamp(360px,28vw,480px);max-width:92vw}
.card h2{text-align:center;margin-bottom:clamp(20px,2vw,32px);font-size:clamp(1.3rem,1.8vw,1.8rem);background:linear-gradient(135deg,#7c5cfc,#e879f9);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
input{width:100%;padding:clamp(10px,1.2vw,16px) clamp(14px,1.5vw,20px);background:#0e0e18;color:#e8e8f0;border:1px solid #2a2a3e;border-radius:10px;font-size:clamp(.9rem,1vw,1.1rem);margin-bottom:clamp(14px,1.2vw,20px)}
input:focus{border-color:#7c5cfc;outline:none}
button{width:100%;padding:clamp(10px,1.2vw,16px);background:#7c5cfc;color:#fff;border:none;border-radius:10px;font-size:clamp(.9rem,1vw,1.1rem);cursor:pointer;font-weight:600}
button:hover{background:#9078ff}
.err{color:#f87171;font-size:clamp(.82rem,.9vw,1rem);text-align:center;margin-bottom:10px}
</style></head>
<body><div class="card"><h2>ComfyCarry</h2>
<form method="POST" action="/login">
<div class="err" id="err">__ERR__</div>
<input name="password" type="password" placeholder="输入访问密码..." autofocus>
<button type="submit">登录</button>
</form></div></body></html>"""


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return Response(LOGIN_PAGE.replace("__ERR__", ""), mimetype="text/html")
    pw = request.form.get("password", "")
    if pw == config.DASHBOARD_PASSWORD:
        session["authed"] = True
        return redirect("/")
    return Response(LOGIN_PAGE.replace("__ERR__", "密码错误"), mimetype="text/html")


@auth_bp.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


def register_auth_middleware(app):
    """注册全局认证中间件到 Flask app"""

    @app.before_request
    def check_auth():
        """全局鉴权与 Setup Wizard 路由"""
        # Setup 相关路由始终允许
        if request.path.startswith("/api/setup/") or request.path == "/setup":
            return
        # 配置导入在 Setup 阶段也需要可用
        if request.path == "/api/settings/import-config" and not config._is_setup_complete():
            return
        # Tunnel 验证在 Setup 阶段需要可用 (Setup Wizard Step 2)
        if request.path == "/api/tunnel/validate" and not config._is_setup_complete():
            return
        if request.path in ("/login", "/favicon.ico", "/api/version"):
            return
        if request.path.startswith("/static/"):
            return
        # 如果尚未完成部署向导, 重定向到向导页
        if not config._is_setup_complete():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Setup not complete", "setup_required": True}), 503
            if request.path != "/":
                return redirect("/")
            return  # 让 index() 处理向导页渲染
        # 正常鉴权
        if not config.DASHBOARD_PASSWORD:
            return
        if session.get("authed"):
            return
        # API Key 认证 (X-API-Key header 或 Authorization: Bearer)
        api_key = request.headers.get("X-API-Key") or ""
        if not api_key:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                api_key = auth_header[7:]
        if api_key and api_key == config.API_KEY:
            return
        if request.path.startswith("/api/"):
            return jsonify({"error": "Unauthorized"}), 401
        return redirect("/login")
