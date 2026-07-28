"""下载前文件头探针 — 在 classify_file 返回 MANUAL 时用一次 HTTP Range 请求
判定文件应落哪个目录。

设计权威: docs/DOWNLOAD_PROBE_CONVERGENCE_SPEC.md。

触发条件 (仅在 MANUAL 分支内):
    .safetensors / .sft + model_type == "Checkpoint" → checkpoints vs diffusion_models
    .gguf + 任意 model_type                            → unet_gguf vs clip_gguf

HTTP 实现要点 (全部为实测踩坑结果, 缺一即失败, 见 docs/DOWNLOAD_PROBE_CONVERGENCE_SPEC.md):
    1. token 用 query 参数, 不用 Authorization 头。跟随 307 到 R2 预签名 URL 时
       绝不能带 Authorization —— S3 判双重鉴权返 400。
    2. Range: bytes=0-1048575, 但不依赖 206 (44% 响应返 200 忽略 Range)。
       流式读满约 1MB 主动断开, 两种响应码都能拿到头部。
    3. 超时 8 秒。
    4. 不做任何限流规避 (不复用预签名 URL、不加限速器、不做配额管理)。

错误处理 (只有两条, 不加别的):
    401 → ProbeAuthError (调用方 toast 且不创建下载任务)
    其它任何失败 (超时/解析失败/非预期格式/网络错) → ProbeError (调用方落回 MANUAL)
"""

import io
import logging
import struct

import requests
import requests as http_requests  # http_requests 供测试 stub 替换调用对象

from ..utils import parse_safetensors_header
from .arch_detect import detect_packaging

logger = logging.getLogger(__name__)

# 探针读取的字节数。safetensors header 实测 max=358KB, 1MB 覆盖全部样本。
# GGUF metadata 段也在此范围内 (8 个样本均在 512KB 内)。
_PROBE_BYTES = 1_048_576  # 1 MiB
_PROBE_TIMEOUT = 8  # 秒


class ProbeAuthError(Exception):
    """探针收到 401 —— 文件需付费或无权限下载。

    调用方应 toast 且**不创建下载任务** (探针是 preflight, 在建任务前拦住)。
    """


class ProbeError(Exception):
    """探针的其它任何失败 (超时/网络错/非预期格式/解析失败)。

    调用方应原样落回现有 409 + DownloadDirModal 流程 (等于改造前, 零回归)。
    """


# ── HTTP 探针 ─────────────────────────────────────────────────────────────────

def probe_download_url(url: str, timeout: int = _PROBE_TIMEOUT) -> bytes:
    """对下载 URL 发一次 Range 请求, 流式读满约 1MB 头部后断开。

    token 必须已在 URL query 参数里 (由 civitai_resolver 拼接), 本函数**不**带
    Authorization 头 —— 跟随 307 到 R2 预签名 URL 时带 auth 会触发 S3 双重鉴权 400。

    401 → 抛 ProbeAuthError。
    其它失败 → 抛 ProbeError (附带原因, 仅供日志)。
    成功 → 返回文件头部字节 (长度 <= _PROBE_BYTES)。

    实测 44% 的响应返 200 忽略 Range (返整个文件)。本实现流式读到 _PROBE_BYTES
    即主动 close 连接, 两种响应码都只取头部。
    """
    headers = {"Range": f"bytes=0-{_PROBE_BYTES - 1}"}
    try:
        # stream=True + iter_content 手动累积到上限即 break, 触发 requests
        # 关闭底层连接 (resp.close 在 finally 显式调用)。allow_redirects=True
        # 时 requests 默认不会把 Authorization 头带向跨 host 的重定向, 但我们
        # 压根没设 Authorization, 所以无此风险。
        resp = http_requests.get(
            url, headers=headers, timeout=timeout, stream=True, allow_redirects=True,
        )
    except requests.RequestException as e:
        raise ProbeError(f"探针请求失败: {e}") from e

    try:
        if resp.status_code == 401:
            raise ProbeAuthError("该文件需付费或无权限下载 (401)")
        # 403 也视为鉴权问题 —— Civitai 对 Early Access 付费文件可能返 403。
        # 真正的付费文件在 resolve 阶段已被 availability 检测拦截, 探针遇到
        # 403 多为 token 失效, 落回 MANUAL 让用户重试是更稳妥的行为。
        # 这里不特殊处理 403, 让它走 ProbeError 路径。
        if resp.status_code >= 400:
            raise ProbeError(f"探针 HTTP {resp.status_code}")

        buf = bytearray()
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            buf.extend(chunk)
            if len(buf) >= _PROBE_BYTES:
                break
        return bytes(buf[:_PROBE_BYTES])
    except ProbeAuthError:
        raise
    except ProbeError:
        raise
    except Exception as e:
        raise ProbeError(f"探针读取失败: {e}") from e
    finally:
        resp.close()


# ── GGUF 字节流解析 ───────────────────────────────────────────────────────────
# 复用 arch_detect._detect_arch_gguf 的解析逻辑思路, 但改为接受字节流而非文件路径,
# 并提取 general.architecture + tensor 名集合供探针判定。

_GGUF_MAGIC = 0x46554747  # "GGUF" little-endian

# ComfyUI-GGUF (city96) loader.py IMG_ARCH_LIST —— 扩散主干架构白名单。
# 来源: https://github.com/city96/ComfyUI-GGUF/blob/main/loader.py
#   IMG_ARCH_LIST = {"flux", "sd1", "sdxl", "sd3", "aura", "hidream", "cosmos",
#                    "ltxv", "hyvid", "wan", "lumina2", "qwen_image"}
# 与 arch_detect._GGUF_ARCH_MAP 同源 (后者是 Civitai 实测出现的子集)。
# 本表用完整 city96 列表以覆盖未来可能出现的架构。
_GGUF_IMG_ARCH_LIST = frozenset({
    "flux", "sd1", "sdxl", "sd3", "aura", "hidream", "cosmos",
    "ltxv", "hyvid", "wan", "lumina2", "qwen_image",
})

# 扩散主干 tensor 名锚点 (正向判据, 命中即判 unet_gguf)。
# double_blocks / single_blocks / img_in / joint_blocks 这四个是 DiT 系扩散主干
# 的高度特异命名, 文本编码器不会出现。
_DIFFUSION_TENSOR_MARKERS = (
    "double_blocks",
    "single_blocks",
    "img_in",
    "joint_blocks",
)


class GGUFHeaderInfo:
    """GGUF 头解析结果。

    arch: general.architecture 的值 (无则为 None)
    tensor_names: tensor 名集合 (已剥离 model.diffusion_model. 前缀)
    """

    __slots__ = ("arch", "tensor_names")

    def __init__(self, arch, tensor_names):
        self.arch = arch
        self.tensor_names = tensor_names


def _gguf_read_string(buf: io.BytesIO) -> str:
    """读取 GGUF length-prefixed UTF-8 字符串。"""
    length_bytes = buf.read(8)
    if len(length_bytes) < 8:
        raise ValueError("GGUF string length truncated")
    length = struct.unpack("<Q", length_bytes)[0]
    if length > 1_000_000:
        raise ValueError("GGUF string too long")
    raw = buf.read(length)
    if len(raw) < length:
        raise ValueError("GGUF string truncated")
    return raw.decode("utf-8", errors="replace")


def _gguf_skip_value(buf: io.BytesIO, vtype: int) -> None:
    """跳过一个 GGUF metadata value (不解析内容)。"""
    _FIXED_SIZES = {
        0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1,
        10: 8, 11: 8, 12: 8,
    }
    if vtype in _FIXED_SIZES:
        if buf.read(_FIXED_SIZES[vtype]) is None:
            pass
    elif vtype == 8:  # STRING
        _gguf_read_string(buf)
    elif vtype == 9:  # ARRAY
        arr_type_bytes = buf.read(4)
        if len(arr_type_bytes) < 4:
            raise ValueError("GGUF array type truncated")
        arr_type = struct.unpack("<I", arr_type_bytes)[0]
        arr_len_bytes = buf.read(8)
        if len(arr_len_bytes) < 8:
            raise ValueError("GGUF array length truncated")
        arr_len = struct.unpack("<Q", arr_len_bytes)[0]
        for _ in range(arr_len):
            _gguf_skip_value(buf, arr_type)
    else:
        raise ValueError(f"Unknown GGUF value type: {vtype}")


def parse_gguf_header(data: bytes) -> GGUFHeaderInfo | None:
    """从字节流解析 GGUF 头, 返回 general.architecture + tensor 名集合。

    返回 None 表示非 GGUF 或解析失败 (magic 错 / 字节不足 / 结构损坏)。
    调用方应将 None 视为「判不出」, 落回 MANUAL。
    """
    if len(data) < 4:
        return None
    try:
        magic = struct.unpack("<I", data[:4])[0]
        if magic != _GGUF_MAGIC:
            return None
        buf = io.BytesIO(data)
        buf.read(4)  # magic
        buf.read(4)  # version
        tensor_count = struct.unpack("<Q", buf.read(8))[0]
        kv_count = struct.unpack("<Q", buf.read(8))[0]

        arch = None
        for _ in range(kv_count):
            key = _gguf_read_string(buf)
            vtype_bytes = buf.read(4)
            if len(vtype_bytes) < 4:
                return None
            vtype = struct.unpack("<I", vtype_bytes)[0]
            if key == "general.architecture" and vtype == 8:
                arch = _gguf_read_string(buf)
            else:
                _gguf_skip_value(buf, vtype)

        # 读 tensor info (name + n_dims + dims + type + offset)
        tensor_names = set()
        for _ in range(min(tensor_count, 500)):
            name = _gguf_read_string(buf)
            n_dims_bytes = buf.read(4)
            if len(n_dims_bytes) < 4:
                break
            n_dims = struct.unpack("<I", n_dims_bytes)[0]
            # dims (n_dims * 8 bytes) + type (4) + offset (8)
            skip = n_dims * 8 + 4 + 8
            if buf.read(skip) is None:
                pass
            # 剥离 model.diffusion_model. 前缀 (与 arch_detect._detect_arch_gguf 一致)
            if name.startswith("model.diffusion_model."):
                name = name[len("model.diffusion_model."):]
            tensor_names.add(name)

        return GGUFHeaderInfo(arch=arch, tensor_names=tensor_names)
    except (ValueError, struct.error):
        return None


# ── 综合判定 ─────────────────────────────────────────────────────────────────

def classify_from_probe(
    data: bytes,
    ext: str,
    model_type: str,
) -> str | None:
    """根据探针拉到的文件头字节, 判定目标目录。

    Args:
        data: 探针拉到的文件头部字节 (>=1MB 或更少)
        ext: 文件扩展名 (小写, 含点, 如 ".safetensors" / ".gguf")
        model_type: Civitai 条目级 model_type (用于触发条件判断)

    Returns:
        MODEL_DIRS 的 key, 或 None (解析失败 / 非预期格式 → 落回 MANUAL)。

    判定逻辑:
        safetensors + Checkpoint:
            parse_safetensors_header → keys (排除 __metadata__) + shapes
            detect_packaging(keys, shapes) == 'checkpoint' → 'checkpoints'
                                             == 'split'      → 'diffusion_models'
        gguf:
            parse_gguf_header → arch + tensor_names
            arch ∈ _GGUF_IMG_ARCH_LIST 或 tensor_names 命中扩散锚点 → 'unet_gguf'
            否则 → 'clip_gguf'

    detect_packaging 是现成的且已实测无误判, 直接复用。
    """
    mt = (model_type or "").strip().lower()

    if ext in (".safetensors", ".sft"):
        # 触发条件: 仅 model_type == "Checkpoint" 时探测
        if mt != "checkpoint":
            return None
        header = parse_safetensors_header(data)
        if not header:
            return None
        keys = set(k for k in header if k != "__metadata__")
        if not keys:
            return None
        shapes = {}
        for k in keys:
            info = header.get(k)
            if isinstance(info, dict) and "shape" in info:
                shapes[k] = tuple(info["shape"])
        packaging = detect_packaging(keys, shapes)
        return "checkpoints" if packaging == "checkpoint" else "diffusion_models"

    if ext == ".gguf":
        # 触发条件: 任意 model_type
        info = parse_gguf_header(data)
        if info is None:
            return None
        # 正向测扩散主干
        if info.arch and info.arch in _GGUF_IMG_ARCH_LIST:
            return "unet_gguf"
        if any(m in t for m in _DIFFUSION_TENSOR_MARKERS for t in info.tensor_names):
            return "unet_gguf"
        # 其余归 TE (GGUF 是干净的二元判定)
        return "clip_gguf"

    return None
