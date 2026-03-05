"""
ComfyCarry — 通用下载引擎 (aria2c JSON-RPC)

所有文件下载统一入口:
- HuggingFace 模型 (AuraSR、SAM 等)
- CivitAI 模型 (Phase B)
- 任意直链 URL

架构:
  aria2c 以 RPC daemon 模式运行 (127.0.0.1:6800)
  download_engine 通过 JSON-RPC 提交/查询/取消下载
  每个下载任务有唯一 download_id, 映射到 aria2c 的 GID
"""

import json
import logging
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Callable, Optional

import requests as http_requests  # 避免与 flask.request 冲突

logger = logging.getLogger(__name__)

# ── aria2c RPC 配置 ──────────────────────────────────────────────────────────
_RPC_HOST = "127.0.0.1"
_RPC_PORT = 6800
_RPC_URL = f"http://{_RPC_HOST}:{_RPC_PORT}/jsonrpc"
_RPC_SECRET = "comfycarry"  # 内部通信, 不需要高安全性

# aria2c 连接参数
_ARIA2_CONNECTIONS = 16     # 每个任务的连接数 (-x)
_ARIA2_SPLIT = 16           # 分片数 (-s)
_ARIA2_MAX_CONCURRENT = 5   # 最大并发下载数

# 进度轮询间隔 (秒)
_POLL_INTERVAL = 1.0


class DownloadStatus(str, Enum):
    """下载状态枚举"""
    QUEUED = "queued"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DownloadTask:
    """下载任务元数据"""
    download_id: str
    url: str
    save_dir: str
    filename: str
    gid: str = ""
    status: DownloadStatus = DownloadStatus.QUEUED
    total_bytes: int = 0
    completed_bytes: int = 0
    speed: int = 0  # bytes/sec
    progress: float = 0.0  # 0-100
    error: str = ""
    created_at: float = field(default_factory=time.time)
    completed_at: float = 0.0
    # 调用方自定义 metadata (如 model_type, source 等)
    meta: dict = field(default_factory=dict)
    # 下载完成时的回调 (在 poll 线程中调用, 签名: callback(task))
    on_complete: Callable | None = field(default=None, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        d.pop("on_complete", None)
        return d


class DownloadEngine:
    """通用下载引擎 — aria2c JSON-RPC 封装"""

    def __init__(self):
        self._tasks: dict[str, DownloadTask] = {}  # download_id → task
        self._lock = threading.Lock()
        self._aria2_proc: subprocess.Popen | None = None
        self._poller_thread: threading.Thread | None = None
        self._running = False
        self._rpc_id = 0

    # ── 生命周期 ─────────────────────────────────────────────────────────────

    def start(self):
        """启动 aria2c RPC daemon + 状态轮询线程"""
        if self._running:
            return

        self._start_aria2_daemon()
        self._running = True
        self._poller_thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="dl-engine-poller",
        )
        self._poller_thread.start()
        logger.info("[download_engine] 引擎已启动")

    def stop(self):
        """关闭引擎"""
        self._running = False
        if self._aria2_proc:
            try:
                self._rpc_call("aria2.shutdown")
            except Exception:
                pass
            try:
                self._aria2_proc.terminate()
                self._aria2_proc.wait(timeout=5)
            except Exception:
                try:
                    self._aria2_proc.kill()
                except Exception:
                    pass
            self._aria2_proc = None
        logger.info("[download_engine] 引擎已停止")

    def _start_aria2_daemon(self):
        """启动 aria2c RPC daemon 进程"""
        # 先检查是否已有 aria2c RPC 在运行
        if self._is_rpc_alive():
            logger.info("[download_engine] aria2c RPC 已在运行")
            return

        cmd = [
            "aria2c",
            "--enable-rpc=true",
            f"--rpc-listen-port={_RPC_PORT}",
            f"--rpc-secret={_RPC_SECRET}",
            "--rpc-listen-all=false",
            f"--max-concurrent-downloads={_ARIA2_MAX_CONCURRENT}",
            "--auto-file-renaming=false",
            "--allow-overwrite=false",
            "--console-log-level=warn",
            "--file-allocation=falloc",
            "--continue=true",
            "--daemon=false",  # 前台运行, 由我们管理
        ]

        # 代理支持
        proxy = (
            os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
            or os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
            or ""
        )
        if proxy:
            cmd.append(f"--all-proxy={proxy}")

        try:
            self._aria2_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            # 等待 RPC 就绪
            for _ in range(30):
                time.sleep(0.2)
                if self._is_rpc_alive():
                    logger.info("[download_engine] aria2c RPC daemon 已就绪")
                    return
            logger.error("[download_engine] aria2c RPC 启动超时")
        except FileNotFoundError:
            logger.error("[download_engine] aria2c 未安装")
        except Exception as e:
            logger.error(f"[download_engine] 启动 aria2c 失败: {e}")

    def _is_rpc_alive(self) -> bool:
        """检查 RPC 是否可用"""
        try:
            r = self._rpc_call("aria2.getVersion")
            return "version" in r
        except Exception:
            return False

    # ── JSON-RPC 通信 ────────────────────────────────────────────────────────

    def _rpc_call(self, method: str, params: list | None = None) -> dict:
        """发送 JSON-RPC 2.0 请求"""
        self._rpc_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": str(self._rpc_id),
            "method": method,
            "params": [f"token:{_RPC_SECRET}"] + (params or []),
        }
        resp = http_requests.post(_RPC_URL, json=payload, timeout=5)
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"aria2 RPC error: {data['error']}")
        return data.get("result", {})

    # ── 公共 API ─────────────────────────────────────────────────────────────

    def submit(
        self,
        url: str,
        save_dir: str,
        filename: str,
        meta: dict | None = None,
        headers: dict | None = None,
        on_complete: Callable | None = None,
    ) -> DownloadTask:
        """
        提交下载任务.

        Args:
            url: 下载 URL
            save_dir: 保存目录 (绝对路径)
            filename: 保存文件名
            meta: 自定义元数据
            headers: 额外 HTTP 请求头 (如 Authorization)
            on_complete: 下载完成后的回调 (签名: callback(task))

        Returns:
            DownloadTask 对象
        """
        download_id = f"dl-{uuid.uuid4().hex[:12]}"

        # 创建目录
        os.makedirs(save_dir, exist_ok=True)

        # 去重：检查是否已有相同 filename+save_dir 的活跃/排队任务
        with self._lock:
            for existing in self._tasks.values():
                if (existing.filename == filename
                        and existing.save_dir == save_dir
                        and existing.status in (
                            DownloadStatus.ACTIVE,
                            DownloadStatus.QUEUED,
                        )):
                    logger.info(
                        f"[download_engine] 跳过重复下载: {filename} "
                        f"(已有任务 {existing.download_id})"
                    )
                    return existing

        # 检查文件是否已存在且完整 (非空 + 无 .aria2 控制文件)
        # 返回 task 供调用方使用，但不加入 _tasks 列表（不显示在下载管理中）
        dest = os.path.join(save_dir, filename)
        aria2_ctrl = dest + ".aria2"
        if (os.path.isfile(dest)
                and os.path.getsize(dest) > 0
                and not os.path.isfile(aria2_ctrl)):
            task_meta = dict(meta or {})
            task_meta["existed"] = True
            task = DownloadTask(
                download_id=download_id,
                url=url,
                save_dir=save_dir,
                filename=filename,
                status=DownloadStatus.COMPLETE,
                progress=100.0,
                completed_at=time.time(),
                meta=task_meta,
                on_complete=on_complete,
            )
            task.total_bytes = os.path.getsize(dest)
            task.completed_bytes = task.total_bytes
            logger.info(
                f"[download_engine] 文件已存在, 跳过下载: {filename}"
            )
            self._fire_on_complete(task)
            return task

        # 删除空文件 (之前失败遗留)
        if os.path.isfile(dest) and os.path.getsize(dest) == 0:
            try:
                os.remove(dest)
            except OSError:
                pass

        # aria2c addUri 参数
        options = {
            "dir": save_dir,
            "out": filename,
            "max-connection-per-server": str(_ARIA2_CONNECTIONS),
            "split": str(_ARIA2_SPLIT),
            "min-split-size": "4M",
            "file-allocation": "none",
            "auto-file-renaming": "false",
            "allow-overwrite": "false",
        }

        # 自定义请求头
        if headers:
            header_list = [f"{k}: {v}" for k, v in headers.items()]
            options["header"] = header_list

        task = DownloadTask(
            download_id=download_id,
            url=url,
            save_dir=save_dir,
            filename=filename,
            meta=meta or {},
            on_complete=on_complete,
        )

        try:
            gid = self._rpc_call("aria2.addUri", [[url], options])
            task.gid = gid
            task.status = DownloadStatus.ACTIVE
        except Exception as e:
            task.status = DownloadStatus.FAILED
            task.error = str(e)
            logger.error(f"[download_engine] 提交下载失败: {e}")

        with self._lock:
            self._tasks[download_id] = task

        logger.info(
            f"[download_engine] 提交下载 {download_id}: "
            f"{filename} → {save_dir}"
        )
        return task

    def cancel(self, download_id: str) -> bool:
        """取消下载任务 (支持 active / queued / paused 状态)"""
        with self._lock:
            task = self._tasks.get(download_id)
            if not task:
                return False
            if task.status not in (
                DownloadStatus.QUEUED,
                DownloadStatus.ACTIVE,
                DownloadStatus.PAUSED,
            ):
                return False

        if task.gid:
            try:
                # 先尝试 unpause (aria2c 要求先 unpause 才能 remove paused 任务)
                if task.status == DownloadStatus.PAUSED:
                    try:
                        self._rpc_call("aria2.unpause", [task.gid])
                    except Exception:
                        pass
                self._rpc_call("aria2.forceRemove", [task.gid])
            except Exception:
                try:
                    self._rpc_call("aria2.remove", [task.gid])
                except Exception as e:
                    logger.warning(f"[download_engine] 取消 RPC 调用失败: {e}")

        with self._lock:
            task.status = DownloadStatus.CANCELLED
            task.completed_at = time.time()

        # 清理临时文件
        self._cleanup_partial(task)

        # 取消的任务直接从列表中移除 (用户主动行为, 无需保留历史)
        with self._lock:
            self._tasks.pop(download_id, None)

        logger.info(f"[download_engine] 已取消 {download_id}")
        return True

    def pause(self, download_id: str) -> bool:
        """暂停下载任务 (aria2c 支持断点续传)"""
        with self._lock:
            task = self._tasks.get(download_id)
            if not task:
                return False
            if task.status not in (DownloadStatus.QUEUED, DownloadStatus.ACTIVE):
                return False

        if task.gid:
            try:
                self._rpc_call("aria2.pause", [task.gid])
            except Exception as e:
                logger.warning(f"[download_engine] 暂停 RPC 调用失败: {e}")
                return False

        with self._lock:
            task.status = DownloadStatus.PAUSED

        logger.info(f"[download_engine] 已暂停 {download_id}")
        return True

    def resume(self, download_id: str) -> bool:
        """恢复已暂停的下载任务"""
        with self._lock:
            task = self._tasks.get(download_id)
            if not task:
                return False
            if task.status != DownloadStatus.PAUSED:
                return False

        if task.gid:
            try:
                self._rpc_call("aria2.unpause", [task.gid])
            except Exception as e:
                logger.warning(f"[download_engine] 恢复 RPC 调用失败: {e}")
                return False

        with self._lock:
            task.status = DownloadStatus.ACTIVE

        logger.info(f"[download_engine] 已恢复 {download_id}")
        return True

    def get_task(self, download_id: str) -> DownloadTask | None:
        """获取单个任务"""
        with self._lock:
            return self._tasks.get(download_id)

    def list_tasks(self) -> list[dict]:
        """获取所有任务列表"""
        with self._lock:
            return [t.to_dict() for t in self._tasks.values()]

    def check_file(self, save_dir: str, filename: str) -> dict:
        """
        检查文件是否存在 + 是否有活跃下载.
        Returns: {installed: bool, downloading: bool, download_id: str|None}
        """
        dest = os.path.join(save_dir, filename)
        file_exists = os.path.isfile(dest) and os.path.getsize(dest) > 0
        aria2_partial = os.path.isfile(dest + ".aria2")

        downloading = False
        active_id = None
        with self._lock:
            for task in self._tasks.values():
                if (task.save_dir == save_dir and task.filename == filename
                        and task.status in (DownloadStatus.QUEUED, DownloadStatus.ACTIVE, DownloadStatus.PAUSED)):
                    downloading = True
                    active_id = task.download_id
                    break

        # 文件存在 + 无活跃下载 + 无 .aria2 控制文件 = 已安装
        installed = file_exists and not downloading and not aria2_partial

        return {
            "installed": installed,
            "downloading": downloading,
            "download_id": active_id,
        }

    def check_files(self, file_specs: list[dict]) -> list[dict]:
        """
        批量检查多个文件.

        Args:
            file_specs: [{"save_dir": "...", "filename": "..."}, ...]

        Returns:
            [{"installed": bool, "downloading": bool, "download_id": str|None}, ...]
        """
        return [
            self.check_file(spec["save_dir"], spec["filename"])
            for spec in file_specs
        ]

    def clear_completed(self):
        """清除已完成/失败/已取消的任务"""
        with self._lock:
            to_remove = [
                did for did, t in self._tasks.items()
                if t.status in (
                    DownloadStatus.COMPLETE,
                    DownloadStatus.FAILED,
                    DownloadStatus.CANCELLED,
                )
            ]
            for did in to_remove:
                del self._tasks[did]
        return len(to_remove)

    def clear_task(self, download_id: str):
        """移除单个任务记录"""
        with self._lock:
            self._tasks.pop(download_id, None)

    # ── 状态轮询 ─────────────────────────────────────────────────────────────

    def _poll_loop(self):
        """后台线程: 定期轮询 aria2c 状态并更新任务"""
        while self._running:
            try:
                self._sync_all_tasks()
            except Exception as e:
                logger.debug(f"[download_engine] 轮询异常: {e}")
            time.sleep(_POLL_INTERVAL)

    def _sync_all_tasks(self):
        """同步所有活跃/排队任务的状态"""
        with self._lock:
            active_tasks = [
                t for t in self._tasks.values()
                if t.status in (DownloadStatus.QUEUED, DownloadStatus.ACTIVE, DownloadStatus.PAUSED)
                and t.gid
            ]

        for task in active_tasks:
            try:
                status = self._rpc_call(
                    "aria2.tellStatus",
                    [task.gid, [
                        "status", "totalLength", "completedLength",
                        "downloadSpeed", "errorCode", "errorMessage",
                    ]],
                )
                self._update_task(task, status)
            except Exception:
                # GID 可能已过期 (下载完成后 aria2c 清理)
                # 检查文件是否已存在, 且大小与已知 total_bytes 匹配
                dest = os.path.join(task.save_dir, task.filename)
                if os.path.isfile(dest):
                    file_size = os.path.getsize(dest)
                    # 只有文件非空, 且 (无已知总大小 或 大小匹配) 时才标记完成
                    if file_size > 0 and (
                        task.total_bytes == 0 or file_size >= task.total_bytes
                    ):
                        with self._lock:
                            task.status = DownloadStatus.COMPLETE
                            task.progress = 100.0
                            task.completed_bytes = file_size
                            task.completed_at = time.time()
                        self._fire_on_complete(task)

    def _fire_on_complete(self, task: DownloadTask):
        """安全地触发完成回调"""
        if task.on_complete:
            try:
                task.on_complete(task)
            except Exception as e:
                logger.error(f"[download_engine] on_complete 回调异常: {e}")
            finally:
                task.on_complete = None  # 只触发一次

    def _update_task(self, task: DownloadTask, status: dict):
        """根据 aria2c tellStatus 结果更新任务"""
        aria2_status = status.get("status", "")
        total = int(status.get("totalLength", 0))
        completed = int(status.get("completedLength", 0))
        speed = int(status.get("downloadSpeed", 0))
        fire_complete = False

        with self._lock:
            task.total_bytes = total
            task.completed_bytes = completed
            task.speed = speed

            if total > 0:
                task.progress = round(completed / total * 100, 1)
            elif completed > 0:
                task.progress = 0  # 未知总大小

            if aria2_status == "active":
                task.status = DownloadStatus.ACTIVE
            elif aria2_status == "waiting":
                task.status = DownloadStatus.QUEUED
            elif aria2_status == "paused":
                task.status = DownloadStatus.PAUSED
            elif aria2_status == "complete":
                task.status = DownloadStatus.COMPLETE
                task.progress = 100.0
                task.completed_at = time.time()
                fire_complete = True
            elif aria2_status == "error":
                task.status = DownloadStatus.FAILED
                error_code = status.get("errorCode", "")
                error_msg = status.get("errorMessage", "")
                task.error = f"[{error_code}] {error_msg}" if error_code else error_msg
                # 授权失败 — 追加友好提示
                if error_code == "24" and task.meta.get("source") == "civitai":
                    task.error += " — 请在设置页配置 CivitAI API Key 后重试"
                task.completed_at = time.time()
                self._cleanup_partial(task)
            elif aria2_status == "removed":
                if task.status != DownloadStatus.CANCELLED:
                    task.status = DownloadStatus.CANCELLED
                    task.completed_at = time.time()

        if fire_complete:
            self._fire_on_complete(task)

    def _cleanup_partial(self, task: DownloadTask):
        """清理失败/取消的临时文件和部分下载"""
        dest = os.path.join(task.save_dir, task.filename)
        aria2_file = dest + ".aria2"
        for f in (dest, aria2_file):
            try:
                if os.path.isfile(f):
                    os.remove(f)
                    logger.debug(f"[download_engine] 已清理: {f}")
            except OSError:
                pass


# ── 全局单例 ─────────────────────────────────────────────────────────────────
_engine: DownloadEngine | None = None


def get_engine() -> DownloadEngine:
    """获取全局下载引擎实例"""
    global _engine
    if _engine is None:
        _engine = DownloadEngine()
        _engine.start()
    return _engine


def shutdown_engine():
    """关闭全局引擎 (Flask 退出时调用)"""
    global _engine
    if _engine:
        _engine.stop()
        _engine = None
