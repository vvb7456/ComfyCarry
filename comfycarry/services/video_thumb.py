"""
ComfyCarry — 视频首帧缩略图服务

为历史/预览面板提供视频产物的首帧 webp 缩略图, 用 ffmpeg 抽帧落盘缓存。

设计要点:
- 部署镜像预装 ffmpeg 二进制, 本模块用 subprocess 调用, 不依赖 python av/moviepy。
- 缓存目录: <COMFYUI_DIR>/output/.video_thumbs (与产物同分区, 容器重启不丢; ComfyUI
  本身不会扫 output 下的隐藏目录当产物)。陈旧判定: 缓存键含源文件 size+mtime, 源文件
  被覆盖重写后缓存自动失效 (用新的缓存文件名)。
- 源文件定位: 参数与 ComfyUI /view 对齐 (filename/subfolder/type), 解析为
  {COMFYUI_DIR}/{type}/{subfolder}/{filename}; 路径穿越防护用 realpath 必须位于
  {COMFYUI_DIR}/{type} 之下。本地读不到时, 回退到经 ComfyUI /view 拉取到临时文件再抽帧
  (兼容 ComfyUI 在远端部署)。
- 并发: 同一缓存键的抽帧用进程内锁去重; 多 worker 进程下用 os.O_EXCL 原子创建
  占位文件兜底 (此处实现进程内 + 原子写, 跨进程留 .lock 文件名约定)。
- 失败: ffmpeg 非视频/抽帧失败/超时 → 返回明确错误 (HTTP 400/415/502), 不抛 500 堆栈。
"""

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from ..config import COMFYUI_DIR, COMFYUI_URL

logger = logging.getLogger(__name__)

# 缓存根: 与 ComfyUI output 同分区, 重启不丢; 隐藏目录不进 ComfyUI 产物扫描
THUMB_CACHE_DIR = Path(COMFYUI_DIR) / "output" / ".video_thumbs"

# ffmpeg 抽帧超时 (秒): 5s 720p mp4 抽首帧实测 <2s, 留余量
FFMPEG_TIMEOUT = 30

# 进程内并发去重锁 (按缓存键)。
# 面板是长驻进程, 每个新视频文件都会新建一把锁 —— 无淘汰会让字典随产物数量单调增长。
# 用「超过上限时清掉当前无人持有的锁」做惰性回收: 正在被持有的锁必须保留 (否则并发去重
# 失效), 空闲锁丢弃后下次访问会重建, 无正确性影响。
_extract_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_LOCKS_SOFT_LIMIT = 512


def _get_lock(key: str) -> threading.Lock:
    """获取 (或创建) 某缓存键专属的进程内锁, 防止同文件并发重复抽帧。"""
    with _locks_guard:
        lk = _extract_locks.get(key)
        if lk is None:
            if len(_extract_locks) >= _LOCKS_SOFT_LIMIT:
                # 惰性回收空闲锁 (acquire 成功即说明无人持有, 立刻释放并丢弃)
                for k in [k for k, v in _extract_locks.items() if k != key and v.acquire(blocking=False)]:
                    _extract_locks[k].release()
                    del _extract_locks[k]
            lk = threading.Lock()
            _extract_locks[key] = lk
        return lk


def _resolve_local_path(filename: str, subfolder: str, img_type: str) -> Path | None:
    """把 ComfyUI /view 风格参数解析为本地绝对路径, 做路径穿越防护。

    返回 Path (已 realpath 规范化且确认存在) 或 None (本地不存在/越界)。
    越界路径不区分"不存在"与"越界", 统一返回 None, 避免泄露文件系统结构。
    """
    if not filename:
        return None
    img_type = (img_type or "output").strip() or "output"
    # ComfyUI 仅 output/temp/input 三类, 限制白名单
    if img_type not in ("output", "temp", "input"):
        return None
    subfolder = (subfolder or "").strip()
    # 禁止绝对路径与 .. 穿越
    if subfolder.startswith("/") or subfolder.startswith("\\"):
        return None

    base_dir = Path(COMFYUI_DIR) / img_type
    candidate = base_dir / subfolder / filename
    try:
        real = candidate.resolve()
    except (OSError, RuntimeError):
        return None
    base_real = base_dir.resolve()
    # 必须严格位于 base_real 之下 (base_real 本身也允许, 即 subfolder 为空)
    try:
        real.relative_to(base_real)
    except ValueError:
        return None
    # 去掉 symlink 段后再次确认 (resolve 已含 symlink 展开, 二次保险)
    if not str(real).startswith(str(base_real)):
        return None
    if not real.is_file():
        return None
    return real


def _fetch_via_comfyui_view(filename: str, subfolder: str, img_type: str,
                           dest: Path) -> bool:
    """本地路径不可用时, 经 ComfyUI /view 拉取文件到 dest (临时文件)。

    仅 output/temp/input 三类有效。返回是否成功。失败不抛异常。
    """
    try:
        import requests
        params = {"filename": filename, "type": img_type}
        if subfolder:
            params["subfolder"] = subfolder
        resp = requests.get(f"{COMFYUI_URL}/view", params=params,
                            timeout=60, stream=True)
        if resp.status_code != 200:
            logger.warning("video_thumb: ComfyUI /view 返回 %s for %s/%s",
                           resp.status_code, subfolder, filename)
            return False
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
        return True
    except Exception as e:
        logger.warning("video_thumb: 经 ComfyUI /view 拉取失败 %s/%s: %s",
                       subfolder, filename, e)
        return False


def _video_exts() -> set[str]:
    """视为视频的扩展名集合 (小写)。"""
    return {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".gif"}


def is_video_filename(filename: str) -> bool:
    """扩展名兜底判定: 视频扩展名视为视频。"""
    return Path(filename).suffix.lower() in _video_exts()


def _cache_key(src_path: Path) -> str:
    """根据源文件绝对路径 + size + mtime 生成缓存文件名 (防陈旧)。

    同名文件被覆盖重写后 mtime/size 变化 → 新缓存键 → 不命中旧缓存 → 重抽。
    """
    try:
        st = src_path.stat()
        sig = f"{src_path.as_posix()}|{st.st_size}|{int(st.st_mtime)}"
    except OSError:
        sig = src_path.as_posix()
    h = hashlib.sha1(sig.encode("utf-8")).hexdigest()[:24]
    return f"{src_path.stem}_{h}.webp"


def _run_ffmpeg_extract(src: Path, dest: Path) -> tuple[bool, str]:
    """用 ffmpeg 抽首帧转 webp, 写入 dest (临时文件 → 原子 rename)。

    返回 (ok, message)。失败时不残留临时文件。
    """
    tmp_out = dest.with_suffix(dest.suffix + ".tmp")
    # -y 覆盖; -i 输入; -frames:v 1 只取一帧; -vf scale 限制长边 480 缩略
    # 选 webp 编码, 质量 80
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-frames:v", "1",
        "-vf", "scale='min(480,iw)':-2",
        "-c:v", "webp",
        "-quality", "80",
        "-f", "webp",
        str(tmp_out),
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=FFMPEG_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        _safe_remove(tmp_out)
        return False, f"ffmpeg 抽帧超时 ({FFMPEG_TIMEOUT}s)"
    except FileNotFoundError:
        return False, "ffmpeg 未安装"
    except Exception as e:
        _safe_remove(tmp_out)
        return False, f"ffmpeg 调用异常: {e}"

    if proc.returncode != 0 or not tmp_out.is_file():
        _safe_remove(tmp_out)
        stderr_tail = (proc.stderr or "")[-400:] if proc.stderr else ""
        # ffmpeg 对非视频文件典型 stderr: "Invalid data found when processing input"
        msg = "ffmpeg 抽帧失败"
        if proc.stderr:
            low = proc.stderr.lower()
            if "invalid data found" in low or "no such file" in low:
                msg = "文件不是有效的视频或无法解码"
            elif "moov atom" in low or "end of file" in low:
                msg = "视频文件损坏或不完整"
        return False, f"{msg}"

    # 原子 rename (同分区, tmp 与 dest 同目录)
    try:
        os.replace(tmp_out, dest)
    except OSError as e:
        _safe_remove(tmp_out)
        return False, f"写入缓存失败: {e}"
    return True, ""


def _safe_remove(p: Path) -> None:
    try:
        if p.exists():
            p.unlink()
    except OSError:
        pass


def get_video_thumbnail(filename: str, subfolder: str = "",
                        img_type: str = "output"
                        ) -> tuple[bytes | None, str | None, int]:
    """获取视频首帧 webp 缩略图。

    参数与 ComfyUI /view 对齐 (filename/subfolder/type)。

    返回 (webp_bytes, error_message, http_status):
      成功: (bytes, None, 200)
      失败: (None, msg, status)  status ∈ {400, 404, 415, 500, 502}
    """
    if not filename:
        return None, "缺少 filename 参数", 400

    # 参数净化 (防注入到日志/路径计算)
    filename = os.path.basename(filename)
    if subfolder:
        subfolder = subfolder.strip().lstrip("/").lstrip("\\")
    img_type = (img_type or "output").strip() or "output"

    local_path = _resolve_local_path(filename, subfolder, img_type)

    # 本地不可达 → 尝试经 ComfyUI /view 拉到临时文件再抽帧
    remote_temp: Path | None = None
    if local_path is None:
        tmpdir = Path(tempfile.gettempdir())
        remote_temp = tmpdir / f"_vthumb_dl_{os.getpid()}_{filename}"
        if not _fetch_via_comfyui_view(filename, subfolder, img_type, remote_temp):
            _safe_remove(remote_temp)
            # 无法区分"文件不存在"与"ComfyUI 不可达", 统一报 404 语义
            return None, "无法定位视频文件 (本地不存在或 ComfyUI 不可达)", 404
        local_path = remote_temp

    assert local_path is not None

    # 扩展名兜底: 非视频扩展名直接拒绝 (ffmpeg 也会失败, 但提前给出明确错误)
    if not is_video_filename(filename):
        _safe_remove(remote_temp) if remote_temp else None
        return None, f"文件不是视频 ({filename})", 415

    # 缓存键基于源文件 size+mtime (本地文件); 远端拉取的临时文件用路径签名
    if remote_temp is not None:
        # 远端临时文件: 用临时文件自身 stat 做键, 但每次都新建临时文件 → 永不命中
        # 改为: 远端场景仍写缓存, 但键基于 filename+subfolder+type 的内容哈希
        sig = f"remote|{filename}|{subfolder}|{img_type}"
        h = hashlib.sha1(sig.encode("utf-8")).hexdigest()[:24]
        cache_name = f"{Path(filename).stem}_{h}.webp"
    else:
        cache_name = _cache_key(local_path)

    # 确保缓存目录存在
    try:
        THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        _safe_remove(remote_temp) if remote_temp else None
        return None, f"无法创建缓存目录: {e}", 500

    cache_path = THUMB_CACHE_DIR / cache_name

    # 命中缓存: 直接返回
    if cache_path.is_file():
        try:
            data = cache_path.read_bytes()
            _safe_remove(remote_temp) if remote_temp else None
            return data, None, 200
        except OSError:
            pass  # 缓存读取失败, 降级重抽

    # 进程内去重锁 (同一缓存键串行化)
    lock = _get_lock(cache_name)
    with lock:
        # double-check (持锁后再查一次)
        if cache_path.is_file():
            try:
                data = cache_path.read_bytes()
                _safe_remove(remote_temp) if remote_temp else None
                return data, None, 200
            except OSError:
                pass

        ok, msg = _run_ffmpeg_extract(local_path, cache_path)
        _safe_remove(remote_temp) if remote_temp else None
        if not ok:
            # 抽帧失败时清理可能残留的损坏缓存
            _safe_remove(cache_path)
            status = 415 if "不是" in msg or "损坏" in msg else 502
            return None, msg, status
        try:
            data = cache_path.read_bytes()
            return data, None, 200
        except OSError as e:
            return None, f"读取缩略图缓存失败: {e}", 500
