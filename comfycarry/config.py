"""
ComfyCarry — 共享配置、常量、配置文件读写工具

所有模块共同依赖的基础层，不引入 Flask 依赖。
"""

import json
import logging
import os
import secrets
import threading
from pathlib import Path

log = logging.getLogger(__name__)

# ── 版本号 (唯一源) ──────────────────────────────────────────
APP_VERSION = "v0.5.4"

# ── 核心路径常量 ─────────────────────────────────────────────
# 面板的路径约定: 对外 (UI / 规则数据 / 文件 API) 一律用 "workspace 根相对路径",
# 即前导 "/" 代表 WORKSPACE_DIR 而非文件系统根。真实绝对路径只在后端内部出现,
# 由 resolve_workspace_path() 统一换算。
# 用 `or` 而非 get 的默认值: 环境变量传空串时 Path("").resolve() 会解析成
# 当前工作目录, 所有状态文件 (.dashboard_env / .sync_rules.json / DB) 都会
# 落错地方
WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR") or "/workspace"
WORKSPACE_ROOT = Path(WORKSPACE_DIR).resolve()
COMFYUI_DIR = os.environ.get("COMFYUI_DIR") or os.path.join(WORKSPACE_DIR, "ComfyUI")
COMFYUI_URL = os.environ.get("COMFYUI_URL") or "http://localhost:8188"
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根目录
CONFIG_FILE = Path(SCRIPT_DIR) / ".civitai_config.json"
try:
    MANAGER_PORT = int(os.environ.get("MANAGER_PORT") or 5000)
except (ValueError, TypeError):
    MANAGER_PORT = 5000

# CivitAI 搜索代理
MEILI_URL = "https://search.civitai.com/multi-search"
MEILI_BEARER = "8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61"

# ── workspace 路径约定换算 ───────────────────────────────────
def workspace_relative(real) -> str:
    """真实绝对路径 → workspace 根相对路径 ("/ComfyUI/output")。

    不在 workspace 内的路径原样返回 (调用方自行决定是否展示)。
    """
    norm = os.path.normpath(str(real))
    base = str(WORKSPACE_ROOT)
    if norm == base:
        return "/"
    if norm.startswith(base + os.sep):
        return "/" + norm[len(base) + 1:]
    return norm


def resolve_workspace_path(
    raw, *, allow_root: bool = True
) -> tuple[Path | None, tuple[str, dict] | None]:
    """workspace 根相对路径 → 真实绝对路径, 并校验未越界。

    接受三种写法, 结果一致:
    - "/ComfyUI/models"           — 面板约定 (前导 / 即 workspace 根)
    - "ComfyUI/models"            — 不带前导 /
    - "/workspace/ComfyUI/models" — 真实绝对路径 (兼容既有调用方)

    仅做字符串规范化, 不解析符号链接 —— models/ 之类目录常被部署脚本
    symlink 到外部卷, resolve() 会把这类合法目标误判为越界。".." 逃逸
    仍会被 normpath 折叠后拦下。

    Returns:
        (Path, None) 成功 / (None, (i18n key, params)) 失败。

        错误不返回文案而是 key + 插值参数 —— 这些错误会经 API 原样送到面板,
        由前端按 `sync.err.<key>` 翻译 (与 _sync_log 的 key+params 同一套路)。
    """
    s = str(raw or "").strip()
    if not s:
        return None, ("path_required", {})

    base = str(WORKSPACE_ROOT)
    norm = os.path.normpath(s)
    if os.path.isabs(norm) and (norm == base or norm.startswith(base + os.sep)):
        target = norm
    else:
        target = os.path.normpath(os.path.join(base, norm.lstrip(os.sep)))

    if target != base and not target.startswith(base + os.sep):
        return None, ("path_outside", {"root": WORKSPACE_DIR})
    if not allow_root and target == base:
        return None, ("path_is_root", {"root": WORKSPACE_DIR})
    return Path(target), None


# ComfyUI 目录的 workspace 根相对形式 ("/ComfyUI") — 同步模板等对外文案用
# rstrip: COMFYUI_DIR 恰为 workspace 根时避免拼出 "//models"
COMFYUI_REL = workspace_relative(COMFYUI_DIR).rstrip("/")

# ── 持久化配置 (.dashboard_env) ──────────────────────────────
DASHBOARD_ENV_FILE = WORKSPACE_ROOT / ".dashboard_env"


def _load_config():
    """从 .dashboard_env 加载全部配置"""
    if DASHBOARD_ENV_FILE.exists():
        try:
            return json.loads(DASHBOARD_ENV_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log.warning(f"[config] .dashboard_env JSON 损坏, 将使用默认值: {e}")
        except Exception as e:
            log.warning(f"[config] 读取 .dashboard_env 失败: {e}")
    return {}


def _save_config(data):
    """写入 .dashboard_env"""
    DASHBOARD_ENV_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


_config_lock = threading.Lock()


def _get_config(key, default=""):
    """读取单个配置值 (线程安全)"""
    with _config_lock:
        return _load_config().get(key, default)


def _set_config(key, value):
    """写入单个配置值 (线程安全)"""
    with _config_lock:
        data = _load_config()
        data[key] = value
        _save_config(data)


# 公开别名 (供 deploy_engine 等外部模块使用)
set_config = _set_config
get_config = _get_config


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


# ── API Key (用于自动化/脚本调用) ────────────────────────────
def _load_api_key():
    """从 .dashboard_env 读 api_key, 不存在则生成并保存"""
    existing = _get_config("api_key")
    if existing:
        return existing
    new_key = f"cc-{secrets.token_hex(24)}"
    _set_config("api_key", new_key)
    return new_key


def _save_api_key(key):
    _set_config("api_key", key)


API_KEY = _load_api_key()


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
    "style_models": "models/style_models",
    "ipadapter": "models/ipadapter",
    "instantid": "models/instantid",
    "hypernetworks": "models/hypernetworks",
    "gligen": "models/gligen",
    "photomaker": "models/photomaker",
    "pulid": "models/pulid",
    "diffusers": "models/diffusers",
    "diffusion_models": "models/diffusion_models",
    "text_encoders": "models/text_encoders",
    "unet_gguf": "models/unet_gguf",
    "clip_gguf": "models/clip_gguf",
    "onnx": "models/onnx",
    "latent_upscale_models": "models/upscale_models",
    "vae_approx": "models/vae_approx",
    "configs": "models/configs",
    # 第三方节点常用目录
    "ultralytics": "models/ultralytics",
    "ultralytics_bbox": "models/ultralytics/bbox",
    "ultralytics_segm": "models/ultralytics/segm",
    "sams": "models/sams",
    "animatediff_models": "models/animatediff_models",
    "animatediff_motion_lora": "models/animatediff_motion_lora",
    "mmdets_bbox": "models/mmdets/bbox",
    "mmdets_segm": "models/mmdets/segm",
    "reactor": "models/reactor",
    "insightface": "models/insightface",
    "facerestore_models": "models/facerestore_models",
    "aura-sr": "models/Aura-SR",
    "lbw_models": "models/lbw_models",
    "intrinsic_loras": "models/intrinsic_loras",
    # CivitAI 模型类型对应目录
    "wildcards": "wildcards",
    "poses": "models/poses",
    "workflows": "user",
}

MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"}


# ── Extra Model Paths (extra_model_paths.yaml 解析) ──────────
_extra_model_paths_cache = None
_extra_model_paths_mtime = 0.0
_extra_model_paths_lock = threading.Lock()


def get_extra_model_paths() -> dict[str, list[str]]:
    """解析 ComfyUI 的 extra_model_paths.yaml，返回 {category: [abs_path, ...]}

    格式示例:
        a111:
            base_path: /mnt/models/
            checkpoints: models/Stable-diffusion
            loras: |
                models/Lora
                models/LyCORIS

    返回: {"checkpoints": ["/mnt/models/models/Stable-diffusion"], "loras": ["/mnt/models/models/Lora", ...]}
    """
    global _extra_model_paths_cache, _extra_model_paths_mtime

    yaml_path = os.path.join(COMFYUI_DIR, "extra_model_paths.yaml")
    if not os.path.isfile(yaml_path):
        return {}

    try:
        mtime = os.path.getmtime(yaml_path)
    except OSError:
        return {}

    with _extra_model_paths_lock:
        if _extra_model_paths_cache is not None and mtime == _extra_model_paths_mtime:
            return _extra_model_paths_cache

    try:
        import yaml
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception:
        return {}

    if not isinstance(data, dict):
        return {}

    result: dict[str, list[str]] = {}
    for _section_name, section in data.items():
        if not isinstance(section, dict):
            continue
        base_path = section.get("base_path", "")
        for key, value in section.items():
            if key in ("base_path", "is_default"):
                continue
            if not isinstance(value, str):
                continue
            # value 可以是单行路径或多行（用 | 分隔）
            paths = [p.strip() for p in value.strip().splitlines() if p.strip()]
            for p in paths:
                # 如果 p 以 # 开头是注释
                if p.startswith("#"):
                    continue
                # 去掉行内注释
                p = p.split("#")[0].strip()
                if not p:
                    continue
                abs_p = os.path.join(base_path, p) if base_path and not os.path.isabs(p) else p
                abs_p = os.path.expanduser(abs_p)
                if key not in result:
                    result[key] = []
                result[key].append(abs_p)

    with _extra_model_paths_lock:
        _extra_model_paths_cache = result
        _extra_model_paths_mtime = mtime
    return result

# ── Setup Wizard ─────────────────────────────────────────────
SETUP_STATE_FILE = WORKSPACE_ROOT / ".setup_state.json"

DEFAULT_PLUGINS = [
    {"url": "https://github.com/ltdrdata/ComfyUI-Manager", "name": "ComfyUI-Manager", "required": True},
    {"url": "comfycarry_ws_broadcast", "name": "ComfyCarry WS Broadcast", "required": True},
    {"url": "https://github.com/Fannovel16/comfyui_controlnet_aux", "name": "ControlNet Aux"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Impact-Pack", "name": "Impact Pack"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Impact-Subpack", "name": "Impact Subpack"},
    {"url": "https://github.com/yolain/ComfyUI-Easy-Use", "name": "Easy Use"},
    {"url": "https://github.com/crystian/ComfyUI-Crystools", "name": "Crystools"},
    {"url": "https://github.com/ssitu/ComfyUI_UltimateSDUpscale", "name": "Ultimate SD Upscale"},
    {"url": "https://github.com/adieyal/comfyui-dynamicprompts", "name": "Dynamic Prompts"},
    {"url": "https://github.com/GreenLandisaLie/AuraSR-ComfyUI", "name": "AuraSR"},
    {"url": "https://github.com/ltdrdata/was-node-suite-comfyui", "name": "WAS Node Suite"},
    {"url": "https://github.com/kijai/ComfyUI-KJNodes", "name": "KJNodes"},
    {"url": "https://github.com/BenjaMITM/Enhanced-Civicomfy", "name": "Enhanced Civicomfy", "required": True},
    {"url": "https://github.com/pythongosssss/ComfyUI-WD14-Tagger", "name": "WD14 Tagger"},
    {"url": "https://github.com/rgthree/rgthree-comfy", "name": "rgthree"},
    {"url": "https://github.com/ltdrdata/ComfyUI-Inspire-Pack", "name": "Inspire Pack"},
    {"url": "https://github.com/pythongosssss/ComfyUI-Custom-Scripts", "name": "Custom Scripts"},
    {"url": "https://github.com/city96/ComfyUI-GGUF", "name": "GGUF"},
    {"url": "https://github.com/cubiq/ComfyUI_IPAdapter_plus", "name": "IPAdapter Plus"},
    {"url": "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite", "name": "Video Helper Suite"},
    {"url": "https://github.com/cubiq/ComfyUI_essentials", "name": "Essentials"},
    {"url": "https://github.com/1038lab/ComfyUI-RMBG", "name": "RMBG"},
]

_setup_state_lock = threading.Lock()


def _load_setup_state():
    """加载 Setup Wizard 状态"""
    defaults = {
        "completed": False,
        "current_step": 0,
        "image_type": "prebuilt",
        "password": "",
        "cloudflared_token": "",
        "cf_api_token": "",
        "cf_domain": "",
        "cf_subdomain": "",
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
        if (Path(COMFYUI_DIR) / "main.py").exists():
            return True
        return False
    state = _load_setup_state()
    return state.get("deploy_completed", False)


# ── Sync 配置路径 ────────────────────────────────────────────
RCLONE_CONF = Path(os.path.expanduser("~/.config/rclone/rclone.conf"))
SYNC_RULES_FILE = WORKSPACE_ROOT / ".sync_rules.json"
SYNC_SETTINGS_FILE = WORKSPACE_ROOT / ".sync_settings.json"


# ── 同步规则模板 ─────────────────────────────────────────────
SYNC_RULE_TEMPLATES = [
    {"id": "tpl-pull-workflows",  "name": "下载工作流",        "direction": "pull", "remote_path": "ComfyCarry/workflow",    "local_path": f"{COMFYUI_REL}/user/default/workflows", "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-loras",      "name": "下载 LoRA",         "direction": "pull", "remote_path": "ComfyCarry/loras",       "local_path": f"{COMFYUI_REL}/models/loras",           "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-checkpoints","name": "下载 Checkpoints",  "direction": "pull", "remote_path": "ComfyCarry/checkpoints", "local_path": f"{COMFYUI_REL}/models/checkpoints",     "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-controlnet", "name": "下载 ControlNet",   "direction": "pull", "remote_path": "ComfyCarry/controlnet",  "local_path": f"{COMFYUI_REL}/models/controlnet",      "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-embeddings", "name": "下载 Embeddings",   "direction": "pull", "remote_path": "ComfyCarry/embeddings",  "local_path": f"{COMFYUI_REL}/models/embeddings",      "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-vae",        "name": "下载 VAE",          "direction": "pull", "remote_path": "ComfyCarry/vae",         "local_path": f"{COMFYUI_REL}/models/vae",             "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-upscale",    "name": "下载 Upscale",      "direction": "pull", "remote_path": "ComfyCarry/upscale",     "local_path": f"{COMFYUI_REL}/models/upscale_models",  "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-pull-wildcards",  "name": "下载 Wildcards",    "direction": "pull", "remote_path": "ComfyCarry/wildcards",   "local_path": f"{COMFYUI_REL}/wildcards",              "method": "copy", "trigger": "deploy"},
    {"id": "tpl-pull-input",      "name": "下载 Input 素材",   "direction": "pull", "remote_path": "ComfyCarry/input",       "local_path": f"{COMFYUI_REL}/input",                  "method": "copy",  "trigger": "deploy"},
    {"id": "tpl-push-output",     "name": "上传输出 (移动)",    "direction": "push", "remote_path": "ComfyCarry/output",          "local_path": f"{COMFYUI_REL}/output",                 "method": "move",  "trigger": "watch", "watch_interval": 15, "filters": ["+ *.{png,jpg,jpeg,webp,gif,bmp,tiff,tif,mp4,mov,webm,mkv,avi}", "- .*/**", "- *"]},
    {"id": "tpl-push-output-copy","name": "上传输出 (保留本地)","direction": "push", "remote_path": "ComfyCarry/output",          "local_path": f"{COMFYUI_REL}/output",                 "method": "copy",  "trigger": "watch", "watch_interval": 15, "filters": ["+ *.{png,jpg,jpeg,webp,gif,bmp,tiff,tif,mp4,mov,webm,mkv,avi}", "- .*/**", "- *"]},
    {"id": "tpl-push-workflows",  "name": "备份工作流",        "direction": "push", "remote_path": "ComfyCarry/workflow",     "local_path": f"{COMFYUI_REL}/user/default/workflows", "method": "copy",  "trigger": "manual"},
]

# ── Remote 类型表单定义 ──────────────────────────────────────
REMOTE_TYPE_DEFS = {
    "s3": {
        "label": "S3 / Cloudflare R2",
        "fields": [
            {"key": "provider", "label": "Provider", "type": "select", "options": ["Cloudflare", "AWS", "Minio", "DigitalOcean", "Wasabi", "Other"], "default": "Cloudflare"},
            {"key": "access_key_id", "label": "Access Key ID", "type": "text", "required": True},
            {"key": "secret_access_key", "label": "Secret Access Key", "type": "password", "required": True},
            {"key": "endpoint", "label": "Endpoint URL", "type": "text", "required": True, "placeholder": "https://<account_id>.r2.cloudflarestorage.com"},
            {"key": "acl", "label": "ACL", "type": "text", "default": "private"},
        ],
    },
    "sftp": {
        "label": "SFTP",
        "fields": [
            {"key": "host", "label": "Host", "type": "text", "required": True},
            {"key": "port", "label": "Port", "type": "text", "default": "22"},
            {"key": "user", "label": "用户名", "type": "text", "required": True},
            {"key": "pass", "label": "密码", "type": "password"},
            {"key": "key_file", "label": "SSH Key 路径", "type": "text", "placeholder": "~/.ssh/id_rsa"},
        ],
    },
    "webdav": {
        "label": "WebDAV",
        "fields": [
            {"key": "url", "label": "WebDAV URL", "type": "text", "required": True},
            {"key": "user", "label": "用户名", "type": "text"},
            {"key": "pass", "label": "密码", "type": "password"},
            {"key": "vendor", "label": "Vendor", "type": "select", "options": ["other", "nextcloud", "owncloud", "sharepoint"], "default": "other"},
        ],
    },
    "onedrive": {
        "label": "OneDrive", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"onedrive\"</code> 获取 token JSON"}],
    },
    "drive": {
        "label": "Google Drive", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"drive\"</code> 获取 token JSON"}],
    },
    "dropbox": {
        "label": "Dropbox", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"dropbox\"</code> 获取 token JSON"}],
    },
}


# ── Companion (桌面客户端) 配置 ──────────────────────────────
# 面板侧 rclone serve webdav 绑定端口 (经 Flask 反代 /api/companion/dav 暴露)
try:
    COMPANION_DAV_PORT = int(os.environ.get("COMPANION_DAV_PORT") or 8688)
except (ValueError, TypeError):
    COMPANION_DAV_PORT = 8688

# rclone serve webdav 的内容根 — 默认仅暴露 output/ (安全, 不外泄模型)
COMPANION_SERVE_ROOT = os.environ.get(
    "COMPANION_SERVE_ROOT",
    os.path.join(COMFYUI_DIR, "output"),
)

# 已知客户端状态文件 (心跳上报)
COMPANION_CLIENTS_FILE = WORKSPACE_ROOT / ".companion_clients.json"


# ── 实例标签 (尽力取已有实例名配置, 无则空) ─────────────────
def _load_instance_label() -> str:
    """读取已配置的实例标签 (子域名 / 自定义名), 无则空字符串。"""
    for key in ("instance_label", "cf_subdomain", "public_tunnel_subdomain"):
        val = _get_config(key)
        if val:
            return val
    return ""


INSTANCE_LABEL = _load_instance_label()
