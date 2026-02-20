"""
ComfyCarry — 共享配置、常量、配置文件读写工具

所有模块共同依赖的基础层，不引入 Flask 依赖。
"""

import json
import os
import secrets
import threading
from pathlib import Path

# ── 核心路径常量 ─────────────────────────────────────────────
COMFYUI_DIR = os.environ.get("COMFYUI_DIR", "/workspace/ComfyUI")
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://localhost:8188")
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根目录
CONFIG_FILE = Path(SCRIPT_DIR) / ".civitai_config.json"
MANAGER_PORT = int(os.environ.get("MANAGER_PORT", 5000))

# CivitAI 搜索代理
MEILI_URL = "https://search.civitai.com/multi-search"
MEILI_BEARER = "8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61"

# ── 持久化配置 (.dashboard_env) ──────────────────────────────
DASHBOARD_ENV_FILE = Path("/workspace/.dashboard_env")


def _load_config():
    """从 .dashboard_env 加载全部配置"""
    if DASHBOARD_ENV_FILE.exists():
        try:
            return json.loads(DASHBOARD_ENV_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_config(data):
    """写入 .dashboard_env"""
    DASHBOARD_ENV_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _get_config(key, default=""):
    """读取单个配置值"""
    return _load_config().get(key, default)


_config_lock = threading.Lock()


def _set_config(key, value):
    """写入单个配置值 (线程安全)"""
    with _config_lock:
        data = _load_config()
        data[key] = value
        _save_config(data)


# ── 密码 ──────────────────────────────────────────────────────
def _load_dashboard_password():
    """优先 .dashboard_env > 环境变量 > 默认值"""
    pw = _get_config("password")
    if pw:
        return pw
    env_pw = os.environ.get("DASHBOARD_PASSWORD", "")
    if env_pw:
        return env_pw
    return "comfy2025"


def _save_dashboard_password(pw):
    _set_config("password", pw)


# 模块级可变变量 — 其他模块通过 config.DASHBOARD_PASSWORD 访问
DASHBOARD_PASSWORD = _load_dashboard_password()


# ── Session Secret (持久化 → 重启不掉线) ─────────────────────
def _load_session_secret():
    """从 .dashboard_env 读 session_secret, 不存在则生成并保存"""
    existing = _get_config("session_secret")
    if existing:
        return existing
    new_secret = secrets.token_hex(32)
    _set_config("session_secret", new_secret)
    return new_secret


# ── 模型目录映射 ─────────────────────────────────────────────
MODEL_DIRS = {
    "checkpoints": "models/checkpoints",
    "loras": "models/loras",
    "controlnet": "models/controlnet",
    "vae": "models/vae",
    "upscale_models": "models/upscale_models",
    "embeddings": "models/embeddings",
    "clip": "models/clip",
    "unet": "models/unet",
    "clip_vision": "models/clip_vision",
}

MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin"}

# ── Setup Wizard ─────────────────────────────────────────────
SETUP_STATE_FILE = Path("/workspace/.setup_state.json")

DEFAULT_PLUGINS = [
    {"url": "https://github.com/ltdrdata/ComfyUI-Manager", "name": "ComfyUI-Manager", "required": True},
    {"url": "comfycarry_ws_broadcast", "name": "ComfyCarry WS Broadcast", "required": True},
    {"url": "https://github.com/Fannovel16/comfyui_controlnet_aux", "name": "ControlNet Aux"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Impact-Pack", "name": "Impact Pack"},
    {"url": "https://github.com/yolain/ComfyUI-Easy-Use", "name": "Easy Use"},
    {"url": "https://github.com/crystian/ComfyUI-Crystools", "name": "Crystools"},
    {"url": "https://github.com/ssitu/ComfyUI_UltimateSDUpscale", "name": "Ultimate SD Upscale"},
    {"url": "https://github.com/adieyal/comfyui-dynamicprompts", "name": "Dynamic Prompts"},
    {"url": "https://github.com/weilin9999/WeiLin-Comfyui-Tools", "name": "WeiLin Tools"},
    {"url": "https://github.com/GreenLandisaLie/AuraSR-ComfyUI", "name": "AuraSR"},
    {"url": "https://github.com/ltdrdata/was-node-suite-comfyui", "name": "WAS Node Suite"},
    {"url": "https://github.com/kijai/ComfyUI-KJNodes", "name": "KJNodes"},
    {"url": "https://github.com/BenjaMITM/Enhanced-Civicomfy", "name": "Enhanced Civicomfy", "required": True},
    {"url": "https://github.com/pythongosssss/ComfyUI-WD14-Tagger", "name": "WD14 Tagger"},
    {"url": "https://github.com/rgthree/rgthree-comfy", "name": "rgthree"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Inspire-Pack", "name": "Inspire Pack"},
]

_setup_state_lock = threading.Lock()


def _load_setup_state():
    """加载 Setup Wizard 状态"""
    defaults = {
        "completed": False,
        "current_step": 0,
        "image_type": "",
        "password": "",
        "cloudflared_token": "",
        "rclone_config_method": "",
        "rclone_config_value": "",
        "civitai_token": "",
        "plugins": [p["url"] for p in DEFAULT_PLUGINS],
        "install_fa2": False,
        "install_sa2": False,
        "deploy_started": False,
        "deploy_completed": False,
        "deploy_error": "",
        "deploy_steps_completed": [],
        "deploy_log": [],
    }
    with _setup_state_lock:
        if SETUP_STATE_FILE.exists():
            try:
                state = json.loads(SETUP_STATE_FILE.read_text(encoding="utf-8"))
                for k, v in defaults.items():
                    if k not in state:
                        state[k] = v
                return state
            except Exception:
                pass
        return defaults


def _save_setup_state(state):
    """保存 Setup Wizard 状态"""
    with _setup_state_lock:
        SETUP_STATE_FILE.write_text(
            json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8"
        )


def _is_setup_complete():
    """检查部署是否已完成"""
    if not SETUP_STATE_FILE.exists():
        if Path("/workspace/ComfyUI/main.py").exists():
            return True
        return False
    state = _load_setup_state()
    return state.get("deploy_completed", False)


# ── Sync 配置路径 ────────────────────────────────────────────
RCLONE_CONF = Path(os.path.expanduser("~/.config/rclone/rclone.conf"))
SYNC_RULES_FILE = Path("/workspace/.sync_rules.json")
SYNC_SETTINGS_FILE = Path("/workspace/.sync_settings.json")


# ── 同步规则模板 ─────────────────────────────────────────────
SYNC_RULE_TEMPLATES = [
    {"id": "tpl-pull-workflows",  "name": "⬇️ 下载工作流",        "direction": "pull", "remote_path": "comfyui-assets/workflow",    "local_path": "user/default/workflows", "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-loras",      "name": "⬇️ 下载 LoRA",         "direction": "pull", "remote_path": "comfyui-assets/loras",       "local_path": "models/loras",           "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-checkpoints","name": "⬇️ 下载 Checkpoints",  "direction": "pull", "remote_path": "comfyui-assets/checkpoints", "local_path": "models/checkpoints",     "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-controlnet", "name": "⬇️ 下载 ControlNet",   "direction": "pull", "remote_path": "comfyui-assets/controlnet",  "local_path": "models/controlnet",      "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-embeddings", "name": "⬇️ 下载 Embeddings",   "direction": "pull", "remote_path": "comfyui-assets/embeddings",  "local_path": "models/embeddings",      "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-vae",        "name": "⬇️ 下载 VAE",          "direction": "pull", "remote_path": "comfyui-assets/vae",         "local_path": "models/vae",             "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-upscale",    "name": "⬇️ 下载 Upscale",      "direction": "pull", "remote_path": "comfyui-assets/upscale",     "local_path": "models/upscale_models",  "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-wildcards",  "name": "⬇️ 下载 Wildcards",    "direction": "pull", "remote_path": "comfyui-assets/wildcards",   "local_path": "custom_nodes/comfyui-dynamicprompts/wildcards", "method": "copy", "trigger": "deploy"},
    {"id": "tpl-pull-input",      "name": "⬇️ 下载 Input 素材",   "direction": "pull", "remote_path": "comfyui-assets/input",       "local_path": "input",                  "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-push-output",     "name": "⬆️ 上传输出 (移动)",    "direction": "push", "remote_path": "ComfyUI_Output",             "local_path": "output",                 "method": "move",  "trigger": "watch", "watch_interval": 15, "filters": ["+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}", "- .*/**", "- *"]},
    {"id": "tpl-push-output-copy","name": "⬆️ 上传输出 (保留本地)","direction": "push", "remote_path": "ComfyUI_Output",             "local_path": "output",                 "method": "copy",  "trigger": "watch", "watch_interval": 15, "filters": ["+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}", "- .*/**", "- *"]},
    {"id": "tpl-push-workflows",  "name": "⬆️ 备份工作流",        "direction": "push", "remote_path": "comfyui-assets/workflow",     "local_path": "user/default/workflows", "method": "copy",  "trigger": "manual"},
]

# ── Remote 类型表单定义 ──────────────────────────────────────
REMOTE_TYPE_DEFS = {
    "s3": {
        "label": "S3 / Cloudflare R2", "icon": "☁️",
        "fields": [
            {"key": "provider", "label": "Provider", "type": "select", "options": ["Cloudflare", "AWS", "Minio", "DigitalOcean", "Wasabi", "Other"], "default": "Cloudflare"},
            {"key": "access_key_id", "label": "Access Key ID", "type": "text", "required": True},
            {"key": "secret_access_key", "label": "Secret Access Key", "type": "password", "required": True},
            {"key": "endpoint", "label": "Endpoint URL", "type": "text", "required": True, "placeholder": "https://<account_id>.r2.cloudflarestorage.com"},
            {"key": "acl", "label": "ACL", "type": "text", "default": "private"},
        ],
    },
    "sftp": {
        "label": "SFTP", "icon": "🖥️",
        "fields": [
            {"key": "host", "label": "Host", "type": "text", "required": True},
            {"key": "port", "label": "Port", "type": "text", "default": "22"},
            {"key": "user", "label": "用户名", "type": "text", "required": True},
            {"key": "pass", "label": "密码", "type": "password"},
            {"key": "key_file", "label": "SSH Key 路径", "type": "text", "placeholder": "~/.ssh/id_rsa"},
        ],
    },
    "webdav": {
        "label": "WebDAV", "icon": "🌐",
        "fields": [
            {"key": "url", "label": "WebDAV URL", "type": "text", "required": True},
            {"key": "user", "label": "用户名", "type": "text"},
            {"key": "pass", "label": "密码", "type": "password"},
            {"key": "vendor", "label": "Vendor", "type": "select", "options": ["other", "nextcloud", "owncloud", "sharepoint"], "default": "other"},
        ],
    },
    "onedrive": {
        "label": "OneDrive", "icon": "📁", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"onedrive\"</code> 获取 token JSON"}],
    },
    "drive": {
        "label": "Google Drive", "icon": "📂", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"drive\"</code> 获取 token JSON"}],
    },
    "dropbox": {
        "label": "Dropbox", "icon": "📦", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"dropbox\"</code> 获取 token JSON"}],
    },
}
