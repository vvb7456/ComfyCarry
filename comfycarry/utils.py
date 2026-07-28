"""
ComfyCarry — 通用工具函数
"""

import hashlib
import json
import struct
import subprocess

from .config import CONFIG_FILE


def _get_api_key():
    """获取 CivitAI API Key"""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text()).get("api_key", "")
        except Exception:
            return ""
    return ""


def _run_cmd(cmd, timeout=10):
    """运行 shell 命令并返回输出"""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception as e:
        return f"Error: {e}"


def _sha256_file(filepath):
    """计算文件完整 SHA256 (CivitAI 需要完整文件哈希)"""
    sha = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                sha.update(chunk)
        return sha.hexdigest().upper()
    except Exception:
        return None


def read_safetensors_metadata(filepath: str) -> dict:
    """读取 safetensors 文件的 __metadata__ 字典。

    仅读取 header 部分 (前 8 字节 + header JSON)，不加载权重数据。
    返回空 dict 表示文件不含 metadata 或解析失败。
    """
    try:
        with open(filepath, "rb") as f:
            header_len = struct.unpack("<Q", f.read(8))[0]
            if header_len <= 0 or header_len > 100_000_000:
                return {}
            raw = f.read(header_len)
        header = json.loads(raw)
        meta = header.get("__metadata__")
        return meta if isinstance(meta, dict) else {}
    except Exception:
        return {}


# safetensors header 大小上界: 实测 p50=97KB / p90=197KB / max=358KB
# (docs/DOWNLOAD_PROBE_CONVERGENCE_SPEC.md §7)。400MB 是防御性上界, 远大于
# 任何真实 header 但能挡住损坏文件/随机字节误判成天文数字的情况。
_SAFETENSORS_HEADER_MAX = 400 * 1024 * 1024


def parse_safetensors_header(data: bytes) -> dict:
    """从字节流前缀解析 safetensors header, 返回完整 header dict。

    与 read_safetensors_metadata 不同: 本函数接受**字节流** (下载前探针拉到的
    文件头), 且返回**完整 header** (含 tensor keys + shapes), 而非仅 __metadata__。
    探针据此调用 arch_detect.detect_packaging 判定整合包/拆分件。

    data 应至少包含前 8 字节 (header_len) + 完整 header JSON。若 data 不足
    (header 跨越探针读取的 1MB 边界), 返回空 dict —— 调用方可发第二次 Range
    请求补齐, 或直接落回 MANUAL。

    返回空 dict 表示任何解析失败 (字节不足 / 非 safetensors / header 越界 /
    JSON 损坏)。调用方应将空结果视为「判不出」, 不做猜测性推断。
    """
    if len(data) < 8:
        return {}
    try:
        header_len = struct.unpack("<Q", data[:8])[0]
    except struct.error:
        return {}
    if header_len <= 0 or header_len > _SAFETENSORS_HEADER_MAX:
        return {}
    # 字节不足: header 跨越已读取的边界, 无法完整解析。
    if 8 + header_len > len(data):
        return {}
    try:
        header = json.loads(data[8:8 + header_len])
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    if not isinstance(header, dict):
        return {}
    return header
