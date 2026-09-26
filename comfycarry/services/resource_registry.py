"""
ComfyCarry — Resource Registry

资源级状态管理层, 位于 download_engine (任务级) 和前端之间.

ResourceKey 格式:
  source:model_id:version_id
  例: civitai:12345:67890

ResourceState 状态机 (只描述**下载流程**, 不描述磁盘现状):
  absent → submit_pending → downloading → paused → verifying → absent
  downloading/paused/verifying → failed
  downloading/paused → cancelled → absent

「文件在不在磁盘上」不由本表回答 —— 唯一真相是磁盘 (models 表)。
本表只回答「下载流程走到哪一步」。刻意不设 installed/deleted: 它们记录的是
"下载任务成功过" / "文件曾经在过" 这类历史事件, 文件被删后无法自愈, 而
没有任何消费方需要这个历史信息 —— 可用性一律问磁盘, 不问历史。
"""

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

logger = logging.getLogger(__name__)


class ResourceState(str, Enum):
    """**持久化**的下载流程状态 (只描述流程, 不描述磁盘)。"""
    ABSENT = "absent"
    SUBMIT_PENDING = "submit_pending"
    DOWNLOADING = "downloading"
    PAUSED = "paused"
    VERIFYING = "verifying"
    FAILED = "failed"
    CANCELLED = "cancelled"


# 对外报告的**派生**状态 (不落库, 每次按磁盘现状算出, 因此永不过期):
#   installed — 磁盘上有该文件 (可用性问磁盘, 不问历史)
DERIVED_INSTALLED = "installed"

# 进行中的流程态 —— 它们优先于「磁盘现状」的判定 (正在下载不该显示成已删除)
PROCESS_STATES = {
    ResourceState.SUBMIT_PENDING.value,
    ResourceState.DOWNLOADING.value,
    ResourceState.PAUSED.value,
    ResourceState.VERIFYING.value,
    ResourceState.FAILED.value,
}


@dataclass
class ResourceView:
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
    def __init__(self):
        self._resources: dict[str, ResourceView] = {}
        self._lock = threading.Lock()
        # 全局事件队列: 所有连接的 SSE 客户端监听此队列
        self._event_listeners: list = []
        self._event_lock = threading.Lock()
        self._snapshot_version = 0

    def _persist(self, resource: ResourceView) -> None:
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
                    # 用 i18n key 而非硬编码中文: 前端对 error 做 translate-if-key,
                    # 找不到 key 时原样显示 (兼容 aria2/civitai 自由文本错误)
                    error = "models.err.dl_interrupted"
                else:
                    error = row.get("last_error", "")

                try:
                    state = ResourceState(state_str)
                except ValueError:
                    state = ResourceState.ABSENT
                # 存量行的 installed 归一为 absent: 该值已退场, 且「在不在」
                # 一律问磁盘 (容器无状态, 不做迁移, 读时归一即可)。
                if state_str == "installed":
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
                    error = "models.err.dl_interrupted"
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

    @staticmethod
    def make_key(source: str, model_id: str, version_id: str) -> str:
        return f"{source}:{model_id}:{version_id}"

    @staticmethod
    def parse_key(key: str) -> tuple[str, str, str]:
        parts = key.split(":", 2)
        if len(parts) != 3:
            raise ValueError(f"Invalid resource key: {key}")
        return parts[0], parts[1], parts[2]

    def submit_pending(self, source: str, model_id: str, version_id: str,
                       meta: dict | None = None) -> ResourceView:
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

            # 刻意不因「曾经下过」而短路: 文件可能在下载后被删除, 是否已有
            # 一律由调用方按磁盘现状判断 (routes 侧的 existed 分支)。
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
        self._emit_resource(resource)
        return resource

    def task_submitted(self, source: str, model_id: str, version_id: str,
                       task_id: str) -> ResourceView | None:
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
        self._emit_resource(resource)
        return resource

    def task_paused(self, source: str, model_id: str, version_id: str) -> None:
        self._transition(source, model_id, version_id, ResourceState.PAUSED)

    def task_resumed(self, source: str, model_id: str, version_id: str) -> None:
        self._transition(source, model_id, version_id, ResourceState.DOWNLOADING)

    def task_complete(self, source: str, model_id: str, version_id: str,
                      save_dir: str, filename: str) -> None:
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if not resource:
                return
            resource.state = ResourceState.VERIFYING
            resource.updated_at = time.time()
            self._bump_version()

        self._persist(resource)
        self._emit_resource(resource)

        def _verify():
            dest = os.path.join(save_dir, filename)
            verified = (
                os.path.isfile(dest)
                and os.path.getsize(dest) > 0
                and not os.path.isfile(dest + ".aria2")
            )
            # 校验通过 → absent (流程结束, 无进行中状态)。刻意不写 installed:
            # 「文件在不在」由磁盘回答, 见 resolve_state。
            if verified:
                self._transition(source, model_id, version_id, ResourceState.ABSENT)
            else:
                self._transition(source, model_id, version_id, ResourceState.FAILED,
                                 error="文件验证失败")

        threading.Thread(target=_verify, daemon=True, name="dl-verify").start()

    def task_failed(self, source: str, model_id: str, version_id: str,
                    error: str = "") -> None:
        self._transition(source, model_id, version_id, ResourceState.FAILED, error=error)

    def task_cancelled(self, source: str, model_id: str, version_id: str) -> None:
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if resource:
                resource.state = ResourceState.ABSENT
                resource.updated_at = time.time()
                self._bump_version()
        if resource:
            self._persist(resource)
            self._emit_resource(resource)

    def mark_installed(self, source: str, model_id: str, version_id: str,
                       meta: dict | None = None,
                       emit: bool = False) -> None:
        """记录「提交时文件已存在」这一情况, 作为下载史。

        语义已收窄: 不再表示「文件在磁盘上」(那是磁盘的事), 只表示
        「本资源有过一次成功/已存在的提交」。保留名字以免调用方大改,
        但**读取方不应据此判断可用性** (用 resolve_state)。
        """
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            if resource:
                if resource.state == ResourceState.ABSENT and resource.meta:
                    return
                resource.state = ResourceState.ABSENT
                resource.updated_at = time.time()
                if meta:
                    resource.meta = {**resource.meta, **meta}
            else:
                resource = ResourceView(
                    resource_key=key,
                    source=source,
                    model_id=model_id,
                    version_id=version_id,
                    state=ResourceState.ABSENT,
                    meta=meta or {},
                )
                self._resources[key] = resource
            self._bump_version()
            self._persist(resource)
            if emit:
                self._emit_resource(resource)

    def resolve_state(self, source: str, model_id: str, version_id: str,
                      file_exists: Callable[[], bool]) -> str:
        """综合「流程态」与「磁盘现状」得出对外状态。

        - 进行中的流程态 (含 failed) 直接返回 —— 它们回答"下载在干什么"。
        - 否则看磁盘: 文件在 → installed (可用就是在磁盘上), 不在 → absent。

        只问磁盘, 不问历史: 「曾经下过、现在没了」与「从没下过」对消费方
        没有任何行为差异 (都要重新下载), 不必区分, 故不设 deleted。
        """
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            resource = self._resources.get(key)
            state = resource.state.value if resource else None

        if state is None:
            # 内存里没有 → 查库 (重启后内存为空, 但历史要保留)
            try:
                from . import download_store as store
                row = store.get_resource(key)
                state = row.get("state", "") if row else ""
            except Exception:
                state = ""

        if state in PROCESS_STATES:
            return state
        # 磁盘现状优先于历史: 在磁盘上就是可用 (这是"已下载"的唯一判据)
        if file_exists():
            return DERIVED_INSTALLED
        return ResourceState.ABSENT.value

    def get_resource(self, source: str, model_id: str,
                     version_id: str) -> ResourceView | None:
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            return self._resources.get(key)

    def get_state(self, source: str, model_id: str,
                  version_id: str) -> str:
        key = self.make_key(source, model_id, version_id)
        with self._lock:
            r = self._resources.get(key)
            return r.state.value if r else ResourceState.ABSENT.value

    def get_snapshot(self) -> dict:
        from .download_engine import get_engine
        engine = get_engine()

        live_tasks = engine.list_tasks()
        live_ids = {t["download_id"] for t in live_tasks}

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

        # 资源状态 = 「磁盘现状」⊕「进行中的流程态」。
        #   1) 磁盘上现存的来源模型 → installed (唯一真相, 由 models 表派生)
        #   2) 内存里的进行中流程态 (downloading/paused/... ) 覆盖之
        # 没有第三条: 「曾经下过但现在不在磁盘上」不产生条目 —— 它与「从没下过」
        # 在行为上完全等价, 多一个状态只会多一套要维护的分支与文案。
        # installed 是派生值, 不落库, 因此不会过期。
        resources = disk_resource_keys()
        with self._lock:
            for key, r in self._resources.items():
                if r.state.value in PROCESS_STATES:
                    resources[key] = r.to_dict()
                elif key in resources:
                    continue
            version = self._snapshot_version

        return {
            "tasks": live_tasks,
            "resources": resources,
            "version": version,
            "server_time": time.time(),
        }

    def add_listener(self, listener) -> None:
        with self._event_lock:
            self._event_listeners.append(listener)

    def remove_listener(self, listener) -> None:
        with self._event_lock:
            try:
                self._event_listeners.remove(listener)
            except ValueError:
                pass

    def _emit(self, event_type: str, data: dict) -> None:
        event = {"type": event_type, "data": data, "time": time.time()}
        with self._event_lock:
            listeners = list(self._event_listeners)
        for listener in listeners:
            try:
                listener(event)
            except Exception as e:
                logger.debug(f"[resource_registry] 事件推送失败: {e}")

    def emit_task_event(self, event_type: str, task_data: dict) -> None:
        self._emit(event_type, task_data)

    def _emit_resource(self, resource: ResourceView) -> None:
        """推送资源事件 —— 发送**派生后**的对外状态。

        不能直接发持久化的 state: 校验通过后持久值是 absent (流程结束), 而
        对外应表达「磁盘上有了」= installed。若发 absent, 前端的下载按钮会在
        进度走完后跳回「下载」(它等的是 installed)。
        事件与快照必须表达同一套语义, 否则每个消费方都要额外拉快照兜底。
        """
        payload = resource.to_dict()
        if resource.state.value not in PROCESS_STATES:
            try:
                payload["state"] = self.resolve_state(
                    resource.source, resource.model_id, resource.version_id,
                    source_file_exists(resource.source, resource.model_id,
                                       resource.version_id),
                )
            except Exception as e:
                logger.debug(f"[resource_registry] 派生事件状态失败: {e}")
        self._emit("resource.updated", payload)

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
        self._emit_resource(resource)

    def _bump_version(self) -> None:
        self._snapshot_version += 1


_registry: ResourceRegistry | None = None


def source_file_exists(source: str, model_id: str, version_id: str) -> Callable[[], bool]:
    """「这个来源版本的文件现在在磁盘上吗」的判据 —— 查 models 表。

    models 表由扫盘对账维护 (reconcile_model_index), 是磁盘现状的唯一真相;
    它同时保存了来源三元组, 因此能按 (source, model_id, version_id) 反查。
    返回闭包而非布尔: 调用方 (resolve_state) 只在需要时才查, 避免无谓查询。
    """
    def _check() -> bool:
        if not model_id and not version_id:
            return False
        try:
            from ..db import db
            if version_id:
                row = db.fetch_one(
                    "SELECT 1 FROM models WHERE source_model_id = ? AND source_version_id = ? "
                    "LIMIT 1",
                    (str(model_id), str(version_id)),
                )
            else:
                row = db.fetch_one(
                    "SELECT 1 FROM models WHERE source_model_id = ? LIMIT 1",
                    (str(model_id),),
                )
            return row is not None
        except Exception:
            # 查不动就当"不在", 宁可显示可下载也不要误报已下载
            return False

    return _check


def disk_resource_keys() -> dict[str, dict]:
    """磁盘上现存、且带来源标识的模型 → {resource_key: 记录}。

    这是「已下载」的唯一真相: 由 models 表 (扫盘对账维护) 直接派生, 而不是
    从 download_resources 这类过程表推断 —— 后者记录的是下载事件, 文件被删
    后无法自愈 (曾经因此把已删文件误报为已下载)。
    """
    out: dict[str, dict] = {}
    try:
        from ..db import db
        rows = db.fetch_all(
            "SELECT source_type, source_model_id, source_version_id, "
            "real_path, filename, updated_at FROM models "
            "WHERE source_model_id != '' OR source_version_id != ''"
        )
    except Exception as e:
        logger.debug(f"[resource_registry] 读取磁盘来源索引失败: {e}")
        return out

    for row in rows:
        model_id = str(row["source_model_id"] or "")
        version_id = str(row["source_version_id"] or "")
        if not model_id and not version_id:
            continue
        # 与前端契约一致: civitai 用 source_type; 其余按来源标识推断
        source = str(row["source_type"] or "") or "civitai"
        key = ResourceRegistry.make_key(source, model_id, version_id or model_id)
        out[key] = {
            "resource_key": key,
            "source": source,
            "model_id": model_id,
            "version_id": version_id,
            "state": DERIVED_INSTALLED,
            "active_task_id": "",
            "last_error": "",
            "updated_at": row["updated_at"] or 0,
            "meta": {"filename": row["filename"], "real_path": row["real_path"]},
        }
    return out


def get_registry() -> ResourceRegistry:
    global _registry
    if _registry is None:
        _registry = ResourceRegistry()
    return _registry
