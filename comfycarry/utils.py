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
