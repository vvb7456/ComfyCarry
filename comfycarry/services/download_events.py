"""下载事件广播；资源视图由任务和现存文件派生，不另存状态。"""

import logging
import os
import threading
import time

from ..db import db

log = logging.getLogger(__name__)


def file_on_disk(path: str) -> bool:
    try:
        return os.path.isfile(path) and os.path.getsize(path) > 0 and not os.path.isfile(path + ".aria2")
    except OSError:
        return False


def task_resource(task: dict) -> dict | None:
    meta = task["meta"]
    source, model_id, version_id = (str(meta.get(key, "")) for key in ("source", "model_id", "version_id"))
    if not source or not model_id:
        return None
    state = {"queued": "downloading", "active": "downloading", "paused": "paused", "failed": "failed"}.get(task["status"])
    if state is None:
        state = "installed" if file_on_disk(os.path.join(task["save_dir"], task["filename"])) else "absent"
    return {"resource_key": f"{source}:{model_id}:{version_id}", "state": state,
            "active_task_id": task["download_id"], "last_error": task["error"]}


def get_snapshot() -> dict:
    from .download_engine import get_engine

    tasks = get_engine().list_tasks()
    resources = {}
    for row in db.fetch_all(
        "SELECT source_type, source_model_id, source_version_id, real_path FROM models "
        "WHERE source_model_id != ''"
    ):
        if file_on_disk(row["real_path"]):
            key = f"{row['source_type']}:{row['source_model_id']}:{row['source_version_id']}"
            resources[key] = {"resource_key": key, "state": "installed", "active_task_id": ""}
    for task in sorted(tasks, key=lambda t: t["created_at"]):
        resource = task_resource(task)
        if resource:
            key = resource["resource_key"]
            if resource["state"] != "absent" or key not in resources:
                resources[key] = resource
    return {"tasks": tasks, "resources": resources, "server_time": time.time()}


_listeners = set()
_lock = threading.Lock()


def add_listener(listener):
    with _lock:
        _listeners.add(listener)


def remove_listener(listener):
    with _lock:
        _listeners.discard(listener)


def emit_task_event(event_type: str, task: dict):
    events = [{"type": event_type, "data": task, "time": time.time()}]
    if event_type == "task.updated" and (resource := task_resource(task)):
        events.append({"type": "resource.updated", "data": resource, "time": time.time()})
    with _lock:
        listeners = tuple(_listeners)
    for listener in listeners:
        for event in events:
            try:
                listener(event)
            except Exception:
                log.exception("下载事件推送失败")
