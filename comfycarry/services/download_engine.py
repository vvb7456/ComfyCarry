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
from concurrent.futures import ThreadPoolExecutor
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
    # 下载完成时的回调 (在完成工作线程中调用, 签名: callback(task))
    on_complete: Callable | None = field(default=None, repr=False)
    # 下载文件已完成、业务登记尚未提交时锁定用户状态操作。
    completion_in_progress: bool = field(default=False, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        d.pop("on_complete", None)
        d.pop("completion_in_progress", None)
        return d


class DownloadEngine:
    """通用下载引擎 — aria2c JSON-RPC 封装"""

    def __init__(self):
        self._tasks: dict[str, DownloadTask] = {}  # download_id → task
        self._lock = threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self._aria2_proc: subprocess.Popen | None = None
        self._poller_thread: threading.Thread | None = None
        # 完成回调可能需要对数 GB 文件计算 SHA256，或访问远端下载预览图。
        # 单独使用有界线程池，避免阻塞 aria2 状态轮询线程，同时避免每个任务
        # 创建一个无界线程。
        self._completion_executor = ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="dl-completion",
        )
        self._completion_executor_shutdown = False
        self._completion_futures: dict[str, object] = {}
        self._running = False
        self._poller_generation = 0
        self._rpc_id = 0
        # 状态变化回调: callback(task, old_status, new_status)
        self._on_status_change: list[Callable] = []
        # 进度更新回调: callback(task) — 每次 poll 有进度变化时调用
        self._on_progress: list[Callable] = []

    # ── 生命周期 ─────────────────────────────────────────────────────────────

    def start(self):
        """启动 aria2c RPC daemon + 状态轮询线程"""
        with self._lifecycle_lock:
            if self._running:
                return
            # ThreadPoolExecutor 一旦 shutdown 后不可复用；stop/start 同一
            # 实例时必须创建新池，否则完成任务会全部转 FAILED。
            if self._completion_executor_shutdown:
                self._completion_executor = ThreadPoolExecutor(
                    max_workers=4, thread_name_prefix="dl-completion",
                )
                self._completion_executor_shutdown = False

            self._start_aria2_daemon()
            self._poller_generation += 1
            generation = self._poller_generation
            self._running = True
            self._poller_thread = threading.Thread(
                target=self._poll_loop,
                args=(generation,),
                daemon=True,
                name="dl-engine-poller",
            )
            self._poller_thread.start()
        logger.info("[download_engine] 引擎已启动")

    def stop(self):
        """关闭引擎"""
        with self._lifecycle_lock:
            self._running = False
            # 使正在 RPC/sleep 中的旧 poller 失效，避免随后的 start 将它
            # 重新变成第二个轮询线程。
            self._poller_generation += 1
            poller = self._poller_thread

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

            # cancel_futures 不会调用被取消的 worker；为这些任务补终态，
            # 否则 completion_in_progress 会永久锁住任务且 SSE 无终态。
            cancelled: list[tuple[DownloadTask, DownloadStatus]] = []
            with self._lock:
                futures = list(self._completion_futures.items())
            for task_id, future in futures:
                if not future.cancel():
                    continue
                with self._lock:
                    self._completion_futures.pop(task_id, None)
                    task = self._tasks.get(task_id)
                    if (task is None or not task.completion_in_progress
                            or task.status in (
                                DownloadStatus.COMPLETE,
                                DownloadStatus.FAILED,
                                DownloadStatus.CANCELLED,
                            )):
                        continue
                    old_status = task.status
                    task.status = DownloadStatus.FAILED
                    task.error = "引擎停止时取消完成登记"
                    task.completed_at = time.time()
                    task.completion_in_progress = False
                    cancelled.append((task, old_status))

            executor = self._completion_executor
            self._completion_executor_shutdown = True
            try:
                executor.shutdown(wait=False, cancel_futures=True)
            except TypeError:  # Python < 3.9
                executor.shutdown(wait=False)

            # 在生命周期锁内等待旧 poller 退出，阻止 start() 在此期间
            # 创建新 poller。generation 负责最终退出条件，join 只需等待
            # 当前 RPC 轮询返回。
            if poller and poller is not threading.current_thread():
                poller.join(timeout=6)

        for task, old_status in cancelled:
            self._fire_status_change(task, old_status, DownloadStatus.FAILED)
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
            "--enable-http-keep-alive=false",  # 防止跨域重定向复用 TLS 连接导致 403
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

        # ── 原子操作: 去重 + 文件检查 + RPC + 写入, 全部在单个 lock 内 ──
        with self._lock:
            # 去重：同 filename+save_dir 的活跃/排队/暂停任务
            for existing in self._tasks.values():
                if (existing.filename == filename
                        and existing.save_dir == save_dir
                        and existing.status in (
                            DownloadStatus.ACTIVE,
                            DownloadStatus.QUEUED,
                            DownloadStatus.PAUSED,
                        )):
                    logger.info(
                        f"[download_engine] 跳过重复下载: {filename} "
                        f"(已有任务 {existing.download_id})"
                    )
                    return existing

            # 检查文件是否已存在且完整 (非空 + 无 .aria2 控制文件)
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
                # 回调在 lock 外触发 (避免死锁)
                fire_existed = True
                return_task = task
            else:
                fire_existed = False

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

                self._tasks[download_id] = task
                return_task = task

        # 回调在 lock 外触发
        if fire_existed:
            self._fire_on_complete(return_task)

        if not fire_existed:
            logger.info(
                f"[download_engine] 提交下载 {download_id}: "
                f"{filename} → {save_dir}"
            )
        return return_task

    def cancel(self, download_id: str) -> bool:
        """取消下载任务 (支持 active / queued / paused 状态)"""
        with self._lock:
            task = self._tasks.get(download_id)
            if not task:
                return False
            if task.completion_in_progress:
                return False
            if task.status not in (
                DownloadStatus.QUEUED,
                DownloadStatus.ACTIVE,
                DownloadStatus.PAUSED,
            ):
                return False
            was_paused = task.status == DownloadStatus.PAUSED
            gid = task.gid

        if gid:
            try:
                if was_paused:
                    try:
                        self._rpc_call("aria2.unpause", [gid])
                    except Exception:
                        pass
                self._rpc_call("aria2.forceRemove", [gid])
            except Exception:
                try:
                    self._rpc_call("aria2.remove", [gid])
                except Exception as e:
                    logger.warning(f"[download_engine] 取消 RPC 调用失败: {e}")

        with self._lock:
            # 仅在任务仍处于可取消状态时标记 — 防止覆盖 poll 线程已设置的终态
            if (not task.completion_in_progress
                    and task.status in (DownloadStatus.QUEUED, DownloadStatus.ACTIVE, DownloadStatus.PAUSED)):
                old_status = task.status
                task.status = DownloadStatus.CANCELLED
                task.completed_at = time.time()
            else:
                return False

        # 清理临时文件
        self._cleanup_partial(task)

        # 通知状态变化监听器
        self._fire_status_change(task, old_status, DownloadStatus.CANCELLED)

        # 不立即从 _tasks 中移除 — 保留 CANCELLED 状态让 SSE 端读到终态
        # 后续由 clear_completed() 统一清理

        logger.info(f"[download_engine] 已取消 {download_id}")
        return True

    def pause(self, download_id: str) -> bool:
        """暂停下载任务 (aria2c 支持断点续传)"""
        with self._lock:
            task = self._tasks.get(download_id)
            if not task:
                return False
            if task.completion_in_progress:
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
            if (task.completion_in_progress
                    or task.status not in (DownloadStatus.QUEUED, DownloadStatus.ACTIVE)):
                return False
            old_status = task.status
            task.status = DownloadStatus.PAUSED

        self._fire_status_change(task, old_status, DownloadStatus.PAUSED)
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
            if task.completion_in_progress or task.status != DownloadStatus.PAUSED:
                return False
            old_status = task.status
            task.status = DownloadStatus.ACTIVE

        self._fire_status_change(task, old_status, DownloadStatus.ACTIVE)
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
                self._completion_futures.pop(did, None)
        return len(to_remove)

    def clear_task(self, download_id: str):
        """移除单个任务记录"""
        with self._lock:
            self._tasks.pop(download_id, None)
            self._completion_futures.pop(download_id, None)

    # ── 状态轮询 ─────────────────────────────────────────────────────────────

    def _poll_loop(self, generation: int):
        """后台线程: 定期轮询 aria2c 状态并更新任务"""
        while self._running and generation == self._poller_generation:
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
                aria2_partial = dest + ".aria2"
                if os.path.isfile(dest) and not os.path.isfile(aria2_partial):
                    file_size = os.path.getsize(dest)
                    # 只有文件非空, 且 (无已知总大小 或 大小匹配) 时才标记完成
                    if file_size > 0 and (
                        task.total_bytes == 0 or file_size >= task.total_bytes
                    ):
                        with self._lock:
                            if (task.completion_in_progress
                                    or task.status not in (
                                        DownloadStatus.QUEUED,
                                        DownloadStatus.ACTIVE,
                                        DownloadStatus.PAUSED,
                                    )):
                                continue
                            old_status = task.status
                            task.progress = 100.0
                            task.completed_bytes = file_size
                            task.completed_at = time.time()
                            task.completion_in_progress = True
                        self._schedule_completion(task, old_status)

    def _fire_on_complete(self, task: DownloadTask) -> bool:
        """在完成事件广播前触发回调，并返回回调是否成功。"""
        if not task.on_complete:
            return True
        callback = task.on_complete
        try:
            callback(task)
            with self._lock:
                # 只清理本次已经执行的回调。若调用方在回调内替换了回调，
                # 不应误删新回调（通常用于失败后重试）。
                if task.on_complete is callback:
                    task.on_complete = None
            return True
        except Exception as e:
            logger.error(f"[download_engine] on_complete 回调异常: {e}")
            with self._lock:
                if task.meta.get("completion_requires_callback"):
                    task.status = DownloadStatus.FAILED
                    task.error = f"完成下载后的登记失败: {e}"
                    task.completed_at = time.time()
                elif task.on_complete is callback:
                    task.on_complete = None
            return False

    def _schedule_completion(self, task: DownloadTask,
                             old_status: DownloadStatus) -> None:
        """异步执行完成回调，再广播唯一的终态事件。

        ``completion_in_progress`` 已在调用方持锁设置，因此 aria2 的重复
        complete 通知、GID 丢失后的文件探测以及用户操作都不会重复提交回调。
        """
        try:
            # 在任务锁内完成 submit+登记，stop() 不会看到“已置位但尚未
            # 纳入 futures 表”的窄窗口。
            with self._lock:
                future = self._completion_executor.submit(
                    self._complete_task, task, old_status,
                )
                self._completion_futures[task.download_id] = future
        except RuntimeError as e:
            # 引擎停止期间 executor 可能拒绝新任务。不能让任务永远卡在
            # completion_in_progress；将其标记失败并广播终态。
            logger.error(f"[download_engine] 提交完成回调失败: {e}")
            with self._lock:
                task.status = DownloadStatus.FAILED
                task.error = f"完成下载后的登记失败: {e}"
                task.completed_at = time.time()
                task.completion_in_progress = False
                final_status = task.status
            self._fire_status_change(task, old_status, final_status)

    def _complete_task(self, task: DownloadTask,
                       old_status: DownloadStatus) -> None:
        """完成工作线程入口；任何未预期异常都转换为 FAILED。"""
        try:
            self._fire_on_complete(task)
        except Exception as e:  # 防御回调实现之外的线程异常
            logger.exception("[download_engine] 完成处理异常")
            with self._lock:
                task.status = DownloadStatus.FAILED
                task.error = f"完成下载后的登记失败: {e}"
                task.completed_at = time.time()

        with self._lock:
            if task.status != DownloadStatus.FAILED:
                task.status = DownloadStatus.COMPLETE
            task.completion_in_progress = False
            final_status = task.status
            self._completion_futures.pop(task.download_id, None)

        # 回调/登记完成后才广播终态，确保监听方收到 COMPLETE 时 DB 已可读。
        if final_status != old_status:
            self._fire_status_change(task, old_status, final_status)

    def _update_task(self, task: DownloadTask, status: dict):
        """根据 aria2c tellStatus 结果更新任务"""
        aria2_status = status.get("status", "")
        total = int(status.get("totalLength", 0))
        completed = int(status.get("completedLength", 0))
        speed = int(status.get("downloadSpeed", 0))
        fire_complete = False
        old_status = None

        with self._lock:
            if task.status in (
                DownloadStatus.COMPLETE,
                DownloadStatus.FAILED,
                DownloadStatus.CANCELLED,
            ):
                return
            # 完成回调可能正在计算哈希/写入索引；aria2 的迟到状态不应
            # 覆盖“文件已完成”的事实，也不得触发 FAILED 清理文件。
            if task.completion_in_progress:
                return
            old_status = task.status
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
                if not task.completion_in_progress:
                    task.progress = 100.0
                    task.completed_at = time.time()
                    task.completion_in_progress = True
                    fire_complete = True
            elif aria2_status == "error":
                task.status = DownloadStatus.FAILED
                error_code = status.get("errorCode", "")
                error_msg = status.get("errorMessage", "")
                task.error = f"[{error_code}] {error_msg}" if error_code else error_msg
                # CivitAI 下载失败 — 追加友好提示
                if task.meta.get("source") == "civitai":
                    if "status=403" in error_msg or error_code == "24":
                        task.error += " — 该模型可能为 Early Access 付费模型，或需要在设置页配置 CivitAI API Key"
                    elif "status=401" in error_msg:
                        task.error += " — 请在设置页配置 CivitAI API Key 后重试"
                task.completed_at = time.time()
                self._cleanup_partial(task)
            elif aria2_status == "removed":
                if task.status != DownloadStatus.CANCELLED:
                    task.status = DownloadStatus.CANCELLED
                    task.completed_at = time.time()

        # 完成回调先登记业务数据，再向监听器广播终态。
        if fire_complete:
            self._schedule_completion(task, old_status)

        # Fire status change callbacks (outside lock)
        # complete 的终态由完成工作线程在业务回调结束后广播；轮询线程此处
        # 只发送进度，避免回调尚未写入 DB 就提前发送 COMPLETE/FAILED，或产生
        # 重复的终态事件。
        if not fire_complete and task.status != old_status:
            self._fire_status_change(task, old_status, task.status)

        # Fire progress callbacks (outside lock)
        self._fire_progress(task)

    def _fire_status_change(self, task: DownloadTask, old: DownloadStatus,
                            new: DownloadStatus):
        """通知所有状态变化监听器"""
        for cb in self._on_status_change:
            try:
                cb(task, old, new)
            except Exception as e:
                logger.debug(f"[download_engine] status_change 回调异常: {e}")

    def _fire_progress(self, task: DownloadTask):
        """通知所有进度监听器"""
        for cb in self._on_progress:
            try:
                cb(task)
            except Exception as e:
                logger.debug(f"[download_engine] progress 回调异常: {e}")

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
