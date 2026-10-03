"""
所有模块共同依赖的基础层，不引入 Flask 依赖。
"""

import json
import logging
import os
import re
import secrets
import threading
from pathlib import Path

log = logging.getLogger(__name__)

APP_VERSION = "v0.8.5"

# 本地文件地址显式使用 {workspace}、{ComfyUI} 或系统绝对路径。
# 用 `or` 而非 get 的默认值: 环境变量传空串时 Path("").resolve() 会解析成
# 当前工作目录, 所有状态文件 (.dashboard_env / .sync_rules.json / DB) 都会
# 落错地方
WORKSPACE_DIR = os.path.abspath(os.environ.get("WORKSPACE_DIR") or "/workspace")
WORKSPACE_ROOT = Path(WORKSPACE_DIR).resolve()
COMFYUI_DIR = os.path.abspath(os.environ.get("COMFYUI_DIR") or os.path.join(WORKSPACE_DIR, "ComfyUI"))
COMFYUI_URL = os.environ.get("COMFYUI_URL") or "http://localhost:8188"
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根目录
CONFIG_FILE = Path(SCRIPT_DIR) / ".civitai_config.json"
try:
    MANAGER_PORT = int(os.environ.get("MANAGER_PORT") or 5000)
except (ValueError, TypeError):
    MANAGER_PORT = 5000

MEILI_URL = "https://search.civitai.com/multi-search"
MEILI_BEARER = "8c46eb2508e21db1e9828a97968d91ab1ca1caa5f70a00e88a2ba1e286603b61"

class FilePathError(ValueError):
    def __init__(self, key: str, **params):
        self.key = key
        self.params = params
        super().__init__(key)


def normalize_file_path(raw) -> str:
    """规范化地址但保留根标记；禁止隐含根目录及越过标记根的 ..。"""
    if not isinstance(raw, str) or not raw.strip():
        raise FilePathError("path_required")
    value = raw.strip()
    if "\x00" in value:
        raise FilePathError("path_invalid")
    for marker in ("{workspace}", "{ComfyUI}"):
        if value == marker or value.startswith(marker + "/"):
            parts = []
            for part in value[len(marker):].split("/"):
                if not part or part == ".":
                    continue
                if part == "..":
                    if not parts:
                        raise FilePathError("path_outside", root=marker)
                    parts.pop()
                else:
                    parts.append(part)
            return marker + ("/" + "/".join(parts) if parts else "")
    if not os.path.isabs(value):
        raise FilePathError("path_invalid")
    return os.path.normpath("/" + value.lstrip("/"))


def resolve_file_path(raw) -> Path:
    """统一解析本地文件地址。保留软链接位置，访问范围由调用模块校验。"""
    value = normalize_file_path(raw)
    for marker, root in (("{workspace}", WORKSPACE_ROOT), ("{ComfyUI}", Path(COMFYUI_DIR))):
        if value == marker or value.startswith(marker + "/"):
            return root / value[len(marker):].lstrip("/")
    return Path(value)


def resolve_workspace_path(
    raw, *, allow_root: bool = True
) -> tuple[Path | None, tuple[str, dict] | None]:
    """同步范围为工作目录及 ComfyUI 目录；保留挂载到外部卷的软链接。"""
    try:
        target = resolve_file_path(raw)
    except FilePathError as exc:
        return None, (exc.key, exc.params)
    roots = (WORKSPACE_ROOT, Path(COMFYUI_DIR))
    if not any(target.is_relative_to(root) for root in roots):
        return None, ("path_outside", {"root": "{workspace}, {ComfyUI}"})
    if not allow_root and target == WORKSPACE_ROOT:
        return None, ("path_is_root", {"root": normalize_file_path(raw)})
    return target, None


COMFYUI_PATH = "{ComfyUI}"

DASHBOARD_ENV_FILE = WORKSPACE_ROOT / ".dashboard_env"


def _load_config():
    if DASHBOARD_ENV_FILE.exists():
        try:
            return json.loads(DASHBOARD_ENV_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log.warning(f"[config] .dashboard_env JSON 损坏, 将使用默认值: {e}")
        except Exception as e:
            log.warning(f"[config] 读取 .dashboard_env 失败: {e}")
    return {}


def _save_config(data):
    DASHBOARD_ENV_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


_config_lock = threading.Lock()


def _get_config(key, default=""):
    with _config_lock:
        return _load_config().get(key, default)


def _set_config(key, value):
    with _config_lock:
        data = _load_config()
        data[key] = value
        _save_config(data)


# 公开别名 (供 deploy_engine 等外部模块使用)
set_config = _set_config
get_config = _get_config


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


def _load_api_key():
    existing = _get_config("api_key")
    if existing:
        return existing
    new_key = f"cc-{secrets.token_hex(24)}"
    _set_config("api_key", new_key)
    return new_key


def _save_api_key(key):
    _set_config("api_key", key)


API_KEY = _load_api_key()


def _load_session_secret():
    """从 .dashboard_env 读 session_secret, 不存在则生成并保存"""
    existing = _get_config("session_secret")
    if existing:
        return existing
    new_secret = secrets.token_hex(32)
    _set_config("session_secret", new_secret)
    return new_secret


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
    "seedvr2": "models/SEEDVR2",
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
            paths = [p.strip() for p in value.strip().splitlines() if p.strip()]
            for p in paths:
                if p.startswith("#"):
                    continue
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
    """加载 Setup Wizard 状态 (部署快照)。

    快照字段分两类:
    - 状态机: deploy_started/completed/error/steps_completed (进程重启后
      恢复部署视图/失败重试/跳过耗时步骤)
    - 部署计划: deploy 提交时写入, deploy_engine 逐字段消费
    无草稿字段 —— 向导会话态在内存 (services/wizard_draft.py)。
    """
    defaults = {
        "password": "",
        "cf_api_token": "",
        "cf_domain": "",
        "cf_subdomain": "",
        "civitai_token": "",
        "plugins": [p["url"] for p in DEFAULT_PLUGINS],
        "install_fa2": False,
        "install_sa2": False,
        "deploy_started": False,
        "deploy_completed": False,
        "deploy_error": "",
        "deploy_steps_completed": [],
    }
    # 幽灵 key 兼容清除: 旧版本写过的字段不再有任何读取, 加载时直接丢弃
    _ghost_keys = {"completed", "cloudflared_token", "image_type", "deploy_log"}
    with _setup_state_lock:
        if SETUP_STATE_FILE.exists():
            try:
                state = json.loads(SETUP_STATE_FILE.read_text(encoding="utf-8"))
                for k in _ghost_keys:
                    state.pop(k, None)
                for k, v in defaults.items():
                    if k not in state:
                        state[k] = v
                return state
            except Exception:
                pass
        return defaults


def _save_setup_state(state):
    with _setup_state_lock:
        SETUP_STATE_FILE.write_text(
            json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8"
        )


def _is_setup_complete():
    if not SETUP_STATE_FILE.exists():
        if (Path(COMFYUI_DIR) / "main.py").exists():
            return True
        return False
    state = _load_setup_state()
    return state.get("deploy_completed", False)


RCLONE_CONF = Path(os.path.expanduser("~/.config/rclone/rclone.conf"))
SYNC_RULES_FILE = WORKSPACE_ROOT / ".sync_rules.json"
SYNC_SETTINGS_FILE = WORKSPACE_ROOT / ".sync_settings.json"

# 同步规则字段的合法取值 —— routes/sync 的规则保存校验与
# deploy_engine 的向导规则展开共用, 避免两处各存一份逐渐漂移。
SYNC_RULE_DIRECTIONS = ("pull", "push")
SYNC_RULE_METHODS = ("copy", "sync", "move")
SYNC_RULE_TRIGGERS = ("manual", "deploy", "watch")

# 与远程存储绑定的同步文件夹 —— 存进 rclone.conf 的保留配置键。
# rclone 会原样保存未知键且运行时忽略 (与 s3 的 bucket 参数同样做法),
# 因此不必为它新增 DB 表/元数据文件, remote 删除/改名自然跟随 conf。
# 对外一律以顶层 `root_dir` 暴露, 不混进凭据参数 params。
REMOTE_ROOT_DIR_KEY = "cc_root_dir"


def normalize_remote_root_dir(raw) -> tuple[str | None, str | None]:
    """校验 remote 的同步文件夹。返回 (值, None) 或 (None, i18n key)。

    同步文件夹是预设规则路径的锚点 (预设相对路径会拼在它之后), 因此必须
    非空, 且不能是存储根 (空/`.`/`/`); 含 `..` 段也拒绝, 免得锚点被越出。
    """
    value = str(raw or "").strip()
    segments = [seg for seg in value.split("/") if seg not in ("", ".")]
    if not segments or any(seg == ".." for seg in segments):
        return None, "remote_root_required"
    return value, None


def join_remote_path(*parts) -> str:
    """把非空的路径段用 `/` 拼接 (用于 bucket + root_dir + 预设相对路径)。

    仅去掉各段首尾斜杠; 首段若以 `/` 开头则保留前导斜杠, 以免把 sftp 的
    绝对路径误改成 home 相对路径。
    """
    clean = [str(p).strip() for p in parts if str(p or "").strip()]
    if not clean:
        return ""
    joined = "/".join(seg.strip("/") for seg in clean)
    return "/" + joined if clean[0].startswith("/") else joined


# 预设 = 一组规则 (entries): direction 在预设级, 其余字段在 entry 级。
# 文案: name_key / desc_key 由前端翻译 (卡片与规则名); name 是后端兜底,
# 规则名在创建时由前端以当前语言固化落库 (规则名是用户可编辑字段,
# 不能存 i18n key)。
# 预设的 remote_path 是「同步文件夹之后」的相对路径 (models/workflows/...)。
# 展开时前置这份存储的同步文件夹 (root_dir), S3 再前置 bucket 作为首段
# (rclone s3 路径首段即 bucket)。同步文件夹没有固定默认值, 由用户在连接
# 存储时选择。
SYNC_RULE_TEMPLATES = [
    {
        "id": "tpl-pull-models",
        "name": "下载模型", "name_key": "sync.preset.pull_models.name",
        "desc_key": "sync.preset.pull_models.desc",
        "direction": "pull",
        "entries": [
            {"name": "模型", "name_key": "sync.preset.entry.models",
             "local_path": f"{COMFYUI_PATH}/models", "remote_path": "models",
             "method": "copy", "trigger": "deploy"},
        ],
    },
    {
        "id": "tpl-pull-misc",
        "name": "下载工作流与素材", "name_key": "sync.preset.pull_misc.name",
        "desc_key": "sync.preset.pull_misc.desc",
        "direction": "pull",
        "entries": [
            {"name": "工作流", "name_key": "sync.preset.entry.workflows",
             "local_path": f"{COMFYUI_PATH}/user/default/workflows", "remote_path": "workflows",
             "method": "copy", "trigger": "deploy"},
            {"name": "Wildcards", "name_key": "sync.preset.entry.wildcards",
             "local_path": f"{COMFYUI_PATH}/wildcards", "remote_path": "wildcards",
             "method": "copy", "trigger": "deploy"},
            {"name": "Input 素材", "name_key": "sync.preset.entry.input",
             "local_path": f"{COMFYUI_PATH}/input", "remote_path": "input",
             "method": "copy", "trigger": "deploy"},
        ],
    },
    {
        "id": "tpl-push-models",
        "name": "备份模型", "name_key": "sync.preset.push_models.name",
        "desc_key": "sync.preset.push_models.desc",
        "direction": "push",
        "entries": [
            {"name": "模型", "name_key": "sync.preset.entry.push_models",
             "local_path": f"{COMFYUI_PATH}/models", "remote_path": "models",
             "method": "copy", "trigger": "manual"},
        ],
    },
    {
        "id": "tpl-push-misc",
        "name": "备份工作流与素材", "name_key": "sync.preset.push_misc.name",
        "desc_key": "sync.preset.push_misc.desc",
        "direction": "push",
        "entries": [
            {"name": "工作流", "name_key": "sync.preset.entry.push_workflows",
             "local_path": f"{COMFYUI_PATH}/user/default/workflows", "remote_path": "workflows",
             "method": "copy", "trigger": "manual"},
            {"name": "Wildcards", "name_key": "sync.preset.entry.push_wildcards",
             "local_path": f"{COMFYUI_PATH}/wildcards", "remote_path": "wildcards",
             "method": "copy", "trigger": "manual"},
            {"name": "Input 素材", "name_key": "sync.preset.entry.push_input",
             "local_path": f"{COMFYUI_PATH}/input", "remote_path": "input",
             "method": "copy", "trigger": "manual"},
        ],
    },
    {
        "id": "tpl-push-output",
        "name": "上传输出（移动）", "name_key": "sync.preset.push_output.name",
        "desc_key": "sync.preset.push_output.desc",
        "direction": "push",
        "entries": [
            {"name": "输出", "name_key": "sync.preset.entry.push_output",
             "local_path": f"{COMFYUI_PATH}/output", "remote_path": "output",
             "method": "move", "trigger": "watch",
             "filters": ["+ *.{png,jpg,jpeg,webp,gif,bmp,tiff,tif,mp4,mov,webm,mkv,avi}", "- .*/**", "- *"]},
        ],
    },
    {
        "id": "tpl-push-output-copy",
        "name": "上传输出（保留本地）", "name_key": "sync.preset.push_output_copy.name",
        "desc_key": "sync.preset.push_output_copy.desc",
        "direction": "push",
        "entries": [
            {"name": "输出", "name_key": "sync.preset.entry.push_output",
             "local_path": f"{COMFYUI_PATH}/output", "remote_path": "output",
             "method": "copy", "trigger": "watch",
             "filters": ["+ *.{png,jpg,jpeg,webp,gif,bmp,tiff,tif,mp4,mov,webm,mkv,avi}", "- .*/**", "- *"]},
        ],
    },
]

# rclone remote 名 / 类型 / 配置键的合法字符集
_RCLONE_TOKEN_RE = re.compile(r'^[a-zA-Z0-9_-]+$')

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
        "fields": [
            {"key": "client_id", "label": "Client ID", "type": "text",
             "help": "可选。rclone 共享 client_id 将于 2026 年退役, 建议自建: https://rclone.org/drive/#making-your-own-client_id"},
            {"key": "client_secret", "label": "Client Secret", "type": "text",
             "help": "与 Client ID 配套, 见 https://rclone.org/drive/#making-your-own-client_id"},
            {"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
             "help": "在本地执行 <code>rclone authorize \"drive\"</code> 获取 token JSON"},
        ],
    },
    "dropbox": {
        "label": "Dropbox", "oauth": True,
        "fields": [{"key": "token", "label": "OAuth Token", "type": "textarea", "required": True,
                     "help": "在本地执行 <code>rclone authorize \"dropbox\"</code> 获取 token JSON"}],
    },
}


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


def _load_instance_label() -> str:
    """读取已配置的实例标签 (子域名 / 自定义名), 无则空字符串。"""
    for key in ("instance_label", "cf_subdomain", "public_tunnel_subdomain"):
        val = _get_config(key)
        if val:
            return val
    return ""


INSTANCE_LABEL = _load_instance_label()
