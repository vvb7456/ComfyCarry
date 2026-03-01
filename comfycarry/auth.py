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
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
/* ── 深色主题 (默认) ── */
:root{--l-bg:#06060c;--l-card:rgba(18,18,30,.75);--l-card-bd:rgba(124,92,252,.15);--l-input-bg:rgba(10,10,18,.7);--l-input-bd:#2a2a3e;--l-t1:#e8e8f0;--l-t3:#68688a;--l-orb-op:.15;--l-shadow:rgba(0,0,0,.4)}
/* ── 浅色主题 ── */
@media(prefers-color-scheme:light){
:root{--l-bg:#f0f0f5;--l-card:rgba(255,255,255,.82);--l-card-bd:rgba(124,92,252,.18);--l-input-bg:rgba(245,245,250,.9);--l-input-bd:#d0d0e0;--l-t1:#1a1a2e;--l-t3:#888;--l-orb-op:.1;--l-shadow:rgba(0,0,0,.08)}
}
body{font-family:'IBM Plex Sans','IBM Plex Sans SC',-apple-system,sans-serif;background:var(--l-bg);color:var(--l-t1);min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:clamp(15px,1.1vw,21px);overflow:hidden}
/* 背景动画 */
.bg{position:fixed;inset:0;z-index:0;overflow:hidden}
.bg .orb{position:absolute;border-radius:50%;filter:blur(80px);opacity:var(--l-orb-op);animation:drift 20s ease-in-out infinite}
.bg .orb:nth-child(1){width:400px;height:400px;background:#7c5cfc;top:-10%;left:-5%;animation-delay:0s}
.bg .orb:nth-child(2){width:350px;height:350px;background:#e879f9;bottom:-10%;right:-5%;animation-delay:-7s}
.bg .orb:nth-child(3){width:300px;height:300px;background:#38bdf8;top:50%;left:60%;animation-delay:-14s}
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}25%{transform:translate(30px,-40px) scale(1.05)}50%{transform:translate(-20px,30px) scale(.95)}75%{transform:translate(40px,20px) scale(1.02)}}
/* 卡片 */
.card{position:relative;z-index:1;background:var(--l-card);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--l-card-bd);border-radius:20px;padding:clamp(36px,3.5vw,56px);width:clamp(360px,28vw,440px);max-width:92vw;box-shadow:0 8px 32px var(--l-shadow)}
/* Logo */
.logo{text-align:center;margin-bottom:clamp(28px,2.5vw,40px)}
.logo h1{font-size:clamp(1.6rem,2vw,2.1rem);font-weight:700;background:linear-gradient(135deg,#7c5cfc,#e879f9);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-.5px}
/* 输入框 */
.input-wrap{position:relative;margin-bottom:clamp(18px,1.5vw,24px)}
.input-wrap .ms.input-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:20px;color:var(--l-t3);font-variation-settings:'FILL' 0,'wght' 300,'GRAD' 0,'opsz' 20;pointer-events:none}
.input-wrap input{width:100%;padding:clamp(11px,1.2vw,16px) 44px;background:var(--l-input-bg);color:var(--l-t1);border:1px solid var(--l-input-bd);border-radius:12px;font-size:clamp(.9rem,1vw,1.05rem);font-family:inherit;transition:border-color .2s,box-shadow .2s}
.input-wrap input:focus{border-color:#7c5cfc;outline:none;box-shadow:0 0 0 3px rgba(124,92,252,.12)}
.input-wrap .toggle-pw{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;line-height:1;color:var(--l-t3);opacity:.6;transition:opacity .15s}
.input-wrap .toggle-pw:hover{opacity:1}
.toggle-pw .ms{font-size:20px;font-variation-settings:'FILL' 0,'wght' 300,'GRAD' 0,'opsz' 20}
/* 按钮 */
.btn-login{width:100%;padding:clamp(11px,1.2vw,16px);background:linear-gradient(135deg,#7c5cfc,#9078ff);color:#fff;border:none;border-radius:12px;font-size:clamp(.9rem,1vw,1.05rem);cursor:pointer;font-weight:600;font-family:inherit;transition:opacity .15s,transform .1s;letter-spacing:.3px}
.btn-login:hover{opacity:.9}
.btn-login:active{transform:scale(.98)}
/* 错误提示 */
.err{color:#f87171;font-size:clamp(.8rem,.85vw,.92rem);text-align:center;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:4px}
.err:empty{display:none}
.err .ms{font-size:16px;font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 16}
input::-ms-reveal,input::-ms-clear,input::-webkit-credentials-auto-fill-button{display:none}
</style></head>
<body>
<div class="bg"><div class="orb"></div><div class="orb"></div><div class="orb"></div></div>
<div class="card">
    <div class="logo">
        <h1>ComfyCarry</h1>
    </div>
    <form method="POST" action="/login">
        <div class="err" id="err">__ERR__</div>
        <div class="input-wrap">
            <span class="ms material-symbols-outlined input-icon">lock</span>
            <input name="password" id="pw" type="password" placeholder="输入访问密码" autofocus>
            <button type="button" class="toggle-pw" onclick="const i=document.getElementById('pw');const h=i.type==='password';i.type=h?'text':'password';this.querySelector('.ms').textContent=h?'visibility_off':'visibility'" tabindex="-1">
                <span class="ms material-symbols-outlined">visibility</span>
            </button>
        </div>
        <button type="submit" class="btn-login">登录</button>
    </form>
</div>
</body></html>"""


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return Response(LOGIN_PAGE.replace("__ERR__", ""), mimetype="text/html")
    pw = request.form.get("password", "")
    if pw == config.DASHBOARD_PASSWORD:
        session["authed"] = True
        return redirect("/")
    return Response(LOGIN_PAGE.replace("__ERR__", '<span class="ms material-symbols-outlined">error</span> 密码错误'), mimetype="text/html")


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
