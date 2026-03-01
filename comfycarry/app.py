"""
ComfyCarry — Flask Application Factory

创建并配置 Flask app, 注册所有 Blueprint。
"""

import json
import os
import subprocess
import sys

from flask import Flask
from flask_cors import CORS

from . import config as cfg
from .config import (
    CONFIG_FILE, MANAGER_PORT,
    _load_session_secret, _get_config,
)
from .utils import _get_api_key
from .auth import auth_bp, register_auth_middleware

# Route Blueprints
from .routes import system, tunnel, models, comfyui, plugins, settings, sync, setup, frontend, jupyter, ssh
from .routes.ssh import restore_ssh_config

# Services
from .services.comfyui_bridge import get_bridge
from .services.deploy_engine import _detect_python
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
    app.register_blueprint(jupyter.bp)
    app.register_blueprint(ssh.bp)
    app.register_blueprint(frontend.bp)

    # ── 全局认证中间件 ───────────────────────────────────
    register_auth_middleware(app)

    # ── 绑定 logger 到 sync engine ──────────────────────
    set_app_logger(app.logger)

    return app


def _restore_comfyui(log):
    """容器重启后自动恢复 ComfyUI 进程.

    条件: setup 已完成 + ComfyUI 目录存在 + comfy 进程未运行
    """
    # 检查 setup 是否已完成
    setup_state_file = os.path.join("/workspace", ".setup_state.json")
    try:
        with open(setup_state_file) as f:
            state = json.load(f)
        if not state.get("deploy_completed"):
            return
    except (FileNotFoundError, json.JSONDecodeError):
        return

    # 检查 ComfyUI 目录是否存在
    comfy_dir = cfg.COMFYUI_DIR
    if not os.path.isdir(comfy_dir):
        return

    # 检查 comfy 进程是否已在运行
    try:
        r = subprocess.run(
            "pm2 jlist",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0:
            procs = json.loads(r.stdout)
            for p in procs:
                if p.get("name") == "comfy":
                    return  # 已存在 (running 或 stopped 都不干预)
    except Exception:
        pass

    # 获取保存的启动参数
    saved_args = _get_config("comfyui_args", "")
    if not saved_args:
        saved_args = "--listen 0.0.0.0 --port 8188"

    py = _detect_python()
    try:
        cmd = (
            f'cd {comfy_dir} && pm2 start {py} --name comfy '
            f'--interpreter none --log /workspace/comfy.log --time '
            f'--restart-delay 3000 --max-restarts 10 '
            f'-- main.py {saved_args}'
        )
        subprocess.run(cmd, shell=True, timeout=30)
        subprocess.run("pm2 save 2>/dev/null || true", shell=True, timeout=5)
        log.info(f"ComfyUI 已自动恢复 (args: {saved_args})")
    except Exception as e:
        log.warning(f"ComfyUI 自动恢复失败: {e}")


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

    # 恢复 SSH 配置
    restore_ssh_config()

    # 恢复 ComfyUI (如果 setup 已完成、ComfyUI 已安装、但进程未运行)
    _restore_comfyui(app.logger)

    # 恢复公共 Tunnel (如果之前是公共模式, 恢复状态而非重新注册)
    if cfg.get_config("tunnel_mode") == "public":
        try:
            from .services.public_tunnel import PublicTunnelClient
            client = PublicTunnelClient()
            result = client.restore()
            if result.get("ok"):
                print(f"  🌐 公共 Tunnel 已恢复: {result.get('random_id', '?')}")
            else:
                print(f"  ⚠️  公共 Tunnel 恢复失败: {result.get('error', '未知')}")
        except Exception as e:
            print(f"  ⚠️  公共 Tunnel 恢复失败: {e}")

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
