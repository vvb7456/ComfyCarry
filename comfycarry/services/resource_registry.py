"""
ComfyCarry — Resource Registry

资源级状态管理层, 位于 download_engine (任务级) 和前端之间.

职责:
  - 为每个下载资源维护 ResourceState (用户视角状态)
  - 接收任务状态变化并推进资源状态
  - 下载完成后执行文件验证 (verifying → installed)
  - 向全局 SSE 流推送资源/任务事件
  - 提供 snapshot API 供前端初始化
  - 每次状态变更同步写入 SQLite (通过 download_store)
  - 启动时从 DB 恢复状态

ResourceKey 格式:
  source:model_id:version_id
  例: civitai:12345:67890

ResourceState 状态机:
  absent → submit_pending → downloading → paused → verifying → installed
  downloading/paused/verifying → failed
  downloading/paused → cancelled → absent
  installed → absent (文件被删除时)
"""

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class ResourceState(str, Enum):
    """资源级状态 (用户视角)"""
    ABSENT = "absent"
    SUBMIT_PENDING = "submit_pending"
    DOWNLOADING = "downloading"
    PAUSED = "paused"
    VERIFYING = "verifying"
    INSTALLED = "installed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ResourceView:
    """资源快照视图"""
    resource_key: str
    source: str
    model_id: str
    version_id: str
    state: ResourceState
    active_task_id: str = ""
    last_error: str = ""
    updated_at: float = field(default_factory=time.time)
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "resource_key": self.resource_key,
            "source": self.source,
            "model_id": self.model_id,
            "version_id": self.version_id,
            "state": self.state.value,
            "active_task_id": self.active_task_id,
            "last_error": self.last_error,
            "updated_at": self.updated_at,
            "meta": self.meta,
        }


class ResourceRegistry:
    """资源级状态注册表 — 在 download_engine 之上管理用户视角状态"""

    def __init__(self):
        self._resources: dict[str, ResourceView] = {}
        self._lock = threading.Lock()
        # 全局事件队列: 所有连接的 SSE 客户端监听此队列
        self._event_listeners: list = []
        self._event_lock = threading.Lock()
        self._snapshot_version = 0

    # ── DB 持久化 ────────────────────────────────────────────────────────

    def _persist(self, resource: ResourceView) -> None:
        """将资源状态写入 DB (异步安全、不抛异常)。"""
        try:
            from . import download_store as store
            store.upsert_resource(
                resource_key=resource.resource_key,
                source=resource.source,
                model_id=resource.model_id,
                version_id=resource.version_id,
                state=resource.state.value,
                active_task_id=resource.active_task_id,
                last_error=resource.last_error,
                meta=resource.meta,
                installed_at=resource.updated_at
                    if resource.state == ResourceState.INSTALLED else None,
            )
        except Exception as e:
            logger.warning(f"[resource_registry] DB persist failed: {e}")

    def hydrate_from_db(self) -> int:
        """
        启动时从 DB 恢复资源状态到内存。
        对活跃状态 (downloading/paused/verifying) 标记为 failed (实例重启中断)。
        同时恢复 task 记录到 engine (历史保留, 活跃→failed)。
        返回恢复的资源数。
        """
        try:
            from . import download_store as store
            rows = store.get_all_resources()
        except Exception as e:
            logger.warning(f"[resource_registry] DB hydrate failed: {e}")
            return 0

        count = 0
        with self._lock:
            for row in rows:
                key = row["resource_key"]
                state_str = row.get("state", "absent")
                # 对活跃状态标记为 failed —— 实例重启时 aria2 任务已丢失
                if state_str in ("downloading", "paused", "verifying",
                                 "submit_pending"):
                    state_str = "failed"
                    error = "实例重启中断"
                else:
                    error = row.get("last_error", "")

                try:
                    state = ResourceState(state_str)
                except ValueError:
                    state = ResourceState.ABSENT

                resource = ResourceView(
                    resource_key=key,
                    source=row.get("source", ""),
                    model_id=row.get("model_id", ""),
                    version_id=row.get("version_id", ""),
                    state=state,
                    active_task_id="" if state == ResourceState.FAILED
                        else row.get("active_task_id", ""),
                    last_error=error,
                    updated_at=row.get("updated_at", time.time()),
                    meta=row.get("meta", {}),
                )
                self._resources[key] = resource
                count += 1

            if count:
                self._bump_version()

        # 把恢复后的状态持久化回 DB (主要为了 failed 状态更新)
        for key in list(self._resources.keys()):
            r = self._resources.get(key)
            if r:
                self._persist(r)

        # ── 恢复 task 记录到 engine (活跃→failed, 终态保留) ──
        self._hydrate_tasks_from_db()

        logger.info(f"[resource_registry] 从 DB 恢复 {count} 个资源状态")
        return count

    def _hydrate_tasks_from_db(self) -> int:
        """
        启动时从 DB 恢复 task 到 engine 内存。
        活跃状态 (queued/active/paused) → failed; 终态原样保留。
        返回恢复的 task 数。
        """
        try:
            from . import download_store as store
            from .download_engine import get_engine, DownloadTask, DownloadStatus
            rows = store.get_recent_tasks(limit=500)
        except Exception as e:
            logger.warning(f"[resource_registry] task hydrate failed: {e}")
            return 0

        engine = get_engine()
        restored = 0
        now = time.time()

        with engine._lock:
            for row in rows:
                task_id = row["task_id"]
                if task_id in engine._tasks:
                    continue  # 已有实时任务, 不覆盖

                status_str = row.get("status", "failed")
                # 活跃状态改为 failed (aria2c GID 丢失)
                if status_str in ("queued", "active", "paused"):
                    status_str = "failed"
                    error = "实例重启中断，请重试"
                    completed_at = now
                    # 也更新 DB
                    try:
                        store.upsert_task(
                            task_id=task_id,
                            status="failed",
                            error=error,
                            completed_at=completed_at,
                        )
                    except Exception:
                        pass
                else:
                    error = row.get("error", "")
                    completed_at = row.get("completed_at", 0) or 0

                try:
                    status = DownloadStatus(status_str)
                except ValueError:
                    status = DownloadStatus.FAILED

                task = DownloadTask(
                    download_id=task_id,
                    url=row.get("url", ""),
                    save_dir=row.get("save_dir", ""),
                    filename=row.get("filename", ""),
                    status=status,
                    total_bytes=row.get("total_bytes", 0),
                    completed_bytes=row.get("completed_bytes", 0),
                    progress=row.get("progress", 0),
                    error=error,
                    created_at=row.get("created_at", 0),
                    completed_at=completed_at,
                    meta=row.get("meta", {}),
                )
                engine._tasks[task_id] = task
                restored += 1

        if restored:
            logger.info(f"[resource_registry] 从 DB 恢复 {restored} 个 task 记录")
        return restored

    # ── Key 构造 ─────────────────────────────────────────────────────────

    @staticmethod
    def make_key(source: str, model_id: str, version_id: str) -> str:
        """构造 ResourceKey"""
        return f"{source}:{model_id}:{version_id}"

    @staticmethod
    def parse_key(key: str) -> tuple[str, str, str]:
        """解析 ResourceKey → (source, model_id, version_id)"""
        parts = key.split(":", 2)
        if len(parts) != 3:
            raise ValueError(f"Invalid resource key: {key}")
        return parts[0], parts[1], parts[2]

    # ── 资源生命周期 ─────────────────────────────────────────────────────

    def submit_pending(self, source: str, model_id: str, version_id: str,
                       meta: dict | None = None) -> ResourceView:
        """
        标记资源为 submit_pending (用户刚点击下载, 等待后端确认).
        幂等: 如果资源已在活跃状态, 返回现有资源.
        """
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            existing = self._resources.get(key)
            if existing and existing.state in (
                ResourceState.SUBMIT_PENDING,
                ResourceState.DOWNLOADING,
                ResourceState.PAUSED,
                ResourceState.VERIFYING,
            ):
                return existing

            if existing and existing.state == ResourceState.INSTALLED:
                return existing

            resource = ResourceView(
                resource_key=key,
                source=source,
                model_id=model_id,
                version_id=version_id,
                state=ResourceState.SUBMIT_PENDING,
                meta=meta or {},
            )
            self._resources[key] = resource
            self._bump_version()

        self._persist(resource)
        self._emit("resource.updated", resource.to_dict())
        return resource

    def task_submitted(self, source: str, model_id: str, version_id: str,
                       task_id: str) -> ResourceView | None:
        """
        后端已成功提交 task → 资源从 submit_pending 转为 downloading.
        """
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if not resource:
                # 如果没有 submit_pending 记录 (直接提交场景), 创建一个
                resource = ResourceView(
                    resource_key=key,
                    source=source,
                    model_id=model_id,
                    version_id=version_id,
                    state=ResourceState.DOWNLOADING,
                    active_task_id=task_id,
                )
                self._resources[key] = resource
            else:
                resource.state = ResourceState.DOWNLOADING
                resource.active_task_id = task_id
                resource.updated_at = time.time()
            self._bump_version()

        self._persist(resource)
        self._emit("resource.updated", resource.to_dict())
        return resource

    def task_paused(self, source: str, model_id: str, version_id: str) -> None:
        """任务暂停 → 资源转为 paused"""
        self._transition(source, model_id, version_id, ResourceState.PAUSED)

    def task_resumed(self, source: str, model_id: str, version_id: str) -> None:
        """任务恢复 → 资源转为 downloading"""
        self._transition(source, model_id, version_id, ResourceState.DOWNLOADING)

    def task_complete(self, source: str, model_id: str, version_id: str,
                      save_dir: str, filename: str) -> None:
        """
        任务传输完成 → 资源转为 verifying.
        后台验证文件, 成功则转为 installed.
        """
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if not resource:
                return
            resource.state = ResourceState.VERIFYING
            resource.updated_at = time.time()
            self._bump_version()

        self._persist(resource)
        self._emit("resource.updated", resource.to_dict())

        # 异步验证文件
        def _verify():
            dest = os.path.join(save_dir, filename)
            verified = (
                os.path.isfile(dest)
                and os.path.getsize(dest) > 0
                and not os.path.isfile(dest + ".aria2")
            )
            if verified:
                self._transition(source, model_id, version_id, ResourceState.INSTALLED)
            else:
                self._transition(source, model_id, version_id, ResourceState.FAILED,
                                 error="文件验证失败")

        threading.Thread(target=_verify, daemon=True, name="dl-verify").start()

    def task_failed(self, source: str, model_id: str, version_id: str,
                    error: str = "") -> None:
        """任务失败 → 资源转为 failed"""
        self._transition(source, model_id, version_id, ResourceState.FAILED, error=error)

    def task_cancelled(self, source: str, model_id: str, version_id: str) -> None:
        """任务取消 → 资源转为 absent (取消后回归初始态)"""
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if resource:
                resource.state = ResourceState.ABSENT
                resource.updated_at = time.time()
                self._bump_version()
        if resource:
            self._persist(resource)
            self._emit("resource.updated", resource.to_dict())

    def mark_installed(self, source: str, model_id: str, version_id: str,
                       meta: dict | None = None,
                       emit: bool = False) -> None:
        """
        外部标记资源为 installed (如本地扫描发现的已有文件).
        默认不触发 SSE 事件 (批量操作), 设置 emit=True 可触发.
        """
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if resource:
                if resource.state == ResourceState.INSTALLED:
                    return
                resource.state = ResourceState.INSTALLED
                resource.updated_at = time.time()
            else:
                resource = ResourceView(
                    resource_key=key,
                    source=source,
                    model_id=model_id,
                    version_id=version_id,
                    state=ResourceState.INSTALLED,
                    meta=meta or {},
                )
                self._resources[key] = resource
            self._bump_version()
            self._persist(resource)
            if emit:
                self._emit("resource.updated", resource.to_dict())

    # ── 查询 ─────────────────────────────────────────────────────────────

    def get_resource(self, source: str, model_id: str,
                     version_id: str) -> ResourceView | None:
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            return self._resources.get(key)

    def get_state(self, source: str, model_id: str,
                  version_id: str) -> str:
        """获取资源状态字符串, 不存在则返回 'absent'"""
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            r = self._resources.get(key)
            return r.state.value if r else ResourceState.ABSENT.value

    def get_snapshot(self) -> dict:
        """返回完整快照 (内存活跃任务 + DB 历史任务合并)"""
        from .download_engine import get_engine
        engine = get_engine()

        # 1. 内存中的活跃任务 (实时数据)
        live_tasks = engine.list_tasks()
        live_ids = {t["download_id"] for t in live_tasks}

        # 2. DB 中的近期任务 (历史终态)
        try:
            from . import download_store as store
            db_tasks = store.get_recent_tasks(limit=200)
        except Exception:
            db_tasks = []

        # 3. 合并: 内存优先, DB 补充不在内存里的终态记录
        for row in db_tasks:
            if row["task_id"] not in live_ids:
                live_tasks.append({
                    "download_id": row["task_id"],
                    "url": row.get("url", ""),
                    "save_dir": row.get("save_dir", ""),
                    "filename": row.get("filename", ""),
                    "gid": "",
                    "status": row.get("status", "failed"),
                    "total_bytes": row.get("total_bytes", 0),
                    "completed_bytes": row.get("completed_bytes", 0),
                    "speed": 0,
                    "progress": row.get("progress", 0),
                    "error": row.get("error", ""),
                    "created_at": row.get("created_at", 0),
                    "completed_at": row.get("completed_at", 0),
                    "meta": row.get("meta", {}),
                })

        with self._lock:
            resources = {key: r.to_dict()
                         for key, r in self._resources.items()
                         if r.state != ResourceState.ABSENT}
            version = self._snapshot_version
        return {
            "tasks": live_tasks,
            "resources": resources,
            "version": version,
            "server_time": time.time(),
        }

    # ── 全局 SSE 事件系统 ────────────────────────────────────────────────

    def add_listener(self, listener) -> None:
        """注册 SSE 事件监听器 (callable accepting event dict)"""
        with self._event_lock:
            self._event_listeners.append(listener)

    def remove_listener(self, listener) -> None:
        """移除 SSE 事件监听器"""
        with self._event_lock:
            try:
                self._event_listeners.remove(listener)
            except ValueError:
                pass

    def _emit(self, event_type: str, data: dict) -> None:
        """向所有已注册的 SSE 监听器推送事件"""
        event = {"type": event_type, "data": data, "time": time.time()}
        with self._event_lock:
            listeners = list(self._event_listeners)
        for listener in listeners:
            try:
                listener(event)
            except Exception as e:
                logger.debug(f"[resource_registry] 事件推送失败: {e}")

    def emit_task_event(self, event_type: str, task_data: dict) -> None:
        """推送任务级事件到全局流"""
        self._emit(event_type, task_data)

    # ── 内部辅助 ─────────────────────────────────────────────────────────

    def _transition(self, source: str, model_id: str, version_id: str,
                    new_state: ResourceState, error: str = "") -> None:
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if not resource:
                return
            resource.state = new_state
            resource.last_error = error
            resource.updated_at = time.time()
            self._bump_version()
        self._persist(resource)
        self._emit("resource.updated", resource.to_dict())

    def _bump_version(self) -> None:
        """递增快照版本号 (在 lock 内调用)"""
        self._snapshot_version += 1


# ── 全局单例 ─────────────────────────────────────────────────────────────────
_registry: ResourceRegistry | None = None


def get_registry() -> ResourceRegistry:
    """获取全局 ResourceRegistry 实例"""
    global _registry
    if _registry is None:
        _registry = ResourceRegistry()
    return _registry
