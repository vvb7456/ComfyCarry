"""
ComfyCarry — Flask Application Factory

创建并配置 Flask app, 注册所有 Blueprint。
"""

import json
import os
import sys

from flask import Flask
from flask_cors import CORS

from . import config as cfg
from .config import (
    CONFIG_FILE, MANAGER_PORT,
    _load_session_secret,
)
from .utils import _get_api_key
from .auth import auth_bp, register_auth_middleware

# Route Blueprints
from .routes import system, tunnel, models, comfyui, plugins, settings, sync, setup, frontend

# Services
from .services.comfyui_bridge import get_bridge
from .services.sync_engine import (
    _load_sync_rules, start_sync_worker, set_app_logger,
)


def create_app():
    """Flask app factory"""
    app = Flask(__name__, static_folder=None)
    CORS(app)

    app.secret_key = _load_session_secret()
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    # ── 注册 Blueprints ──────────────────────────────────
    app.register_blueprint(auth_bp)
    app.register_blueprint(system.bp)
    app.register_blueprint(tunnel.bp)
    app.register_blueprint(models.bp)
    app.register_blueprint(comfyui.bp)
    app.register_blueprint(plugins.bp)
    app.register_blueprint(settings.bp)
    app.register_blueprint(sync.bp)
    app.register_blueprint(setup.bp)
    app.register_blueprint(frontend.bp)

    # ── 全局认证中间件 ───────────────────────────────────
    register_auth_middleware(app)

    # ── 绑定 logger 到 sync engine ──────────────────────
    set_app_logger(app.logger)

    return app


def main():
    """入口函数 — 启动 Flask 应用"""
    app = create_app()

    port = int(sys.argv[1]) if len(sys.argv) > 1 else MANAGER_PORT

    # 从环境变量导入 API Key
    if os.environ.get("CIVITAI_TOKEN") and not _get_api_key():
        CONFIG_FILE.write_text(json.dumps({"api_key": os.environ["CIVITAI_TOKEN"]}))
        print(f"  📝 已从环境变量 CIVITAI_TOKEN 导入 API Key")

    # 启动 ComfyUI WS Bridge
    get_bridge()

    # 启动 watch worker
    rules = _load_sync_rules()
    watch_rules = [r for r in rules
                   if r.get("trigger") == "watch" and r.get("enabled", True)]
    if watch_rules:
        start_sync_worker()
        print(f"  ☁️  Sync Worker 已启动 ({len(watch_rules)} 条监控规则)")

    print(f"\n{'='*50}")
    print(f"  🖥️  ComfyCarry v2.4 (Modular)")
    print(f"  访问地址: http://localhost:{port}")
    print(f"  ComfyUI:  {cfg.COMFYUI_DIR}")
    print(f"{'='*50}\n")

    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()
