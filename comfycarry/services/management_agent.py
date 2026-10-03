"""Standalone image agent; must run before the application release is available."""

import argparse
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import socket
import sys
import time
from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import requests

log = logging.getLogger(__name__)
STAGES = ("ENV_INITIALIZING", "SERVICE_STARTING", "READY", "FAILED")
MAX_LOG_BYTES = 256 * 1024
SECRET_KEY = re.compile(r"token|password|passwd|api.?key|secret|authorization", re.I)
SECRET_VALUE = re.compile(
    r'''(?i)(\b[\w-]*(?:token|password|passwd|api[_-]?key|secret|authorization)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:bearer\s+)?[^\s,;]+)'''
)


def container_boot_id():
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    # PID 1 的启动时间跨 Agent 重启不变，容器重启后变化。
    start = Path("/proc/1/stat").read_text().rsplit(")", 1)[1].split()[19]
    return hashlib.sha256(f"{boot}:{start}".encode()).hexdigest()


def enabled(environ):
    if not environ.get("PROVISIONING_TOKEN", "").strip():
        return False
    try:
        url = urlsplit(environ.get("MANAGEMENT_API_URL", ""))
        if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password or url.query or url.fragment:
            return False
        if environ.get("PROVISIONING_INSTANCE_ID"):
            UUID(environ["PROVISIONING_INSTANCE_ID"])
        return True
    except ValueError:
        return False


class AgentClient:
    def __init__(self, environ=None, *, transport=None, database=None):
        self.environ = dict(os.environ if environ is None else environ)
        self.enabled = enabled(self.environ)
        self.transport = transport
        self.http = requests.Session() if transport is None else None
        self.db = None
        if not self.enabled:
            return
        self.base_url = self.environ["MANAGEMENT_API_URL"].rstrip("/")
        self.token = self.environ["PROVISIONING_TOKEN"]
        self.identity = self.environ.get("PROVISIONING_INSTANCE_ID")
        if self.identity:
            self.identity = str(UUID(self.identity))
        if database is None:
            # Production identity is injected by procurement; each attempt owns its outbox.
            if not self.identity:
                database = ":memory:"
            else:
                directory = Path(self.environ.get("WORKSPACE_DIR", "/workspace")) / ".comfycarry-agent"
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                database = directory / f"{self.identity}.sqlite3"
        self.db = sqlite3.connect(str(database), timeout=10)
        if str(database) != ":memory:":
            os.chmod(database, 0o600)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL, payload TEXT NOT NULL
            );
        """)

    def close(self):
        if self.db is not None:
            self.db.close()
        if self.http is not None:
            self.http.close()

    def _get(self, key, default=""):
        row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def _set(self, key, value):
        self.db.execute("INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))

    @property
    def heartbeat_interval(self):
        return int(self._get("heartbeat_interval", "10")) if self.enabled else 10

    def redact(self, value):
        if isinstance(value, dict):
            return {key: "[REDACTED]" if SECRET_KEY.search(key) else self.redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        if isinstance(value, str):
            for key, secret in self.environ.items():
                if secret and SECRET_KEY.search(key):
                    value = value.replace(secret, "[REDACTED]")
            return SECRET_VALUE.sub(r"\1[REDACTED]", value)
        return value

    def _enqueue(self, endpoint, body):
        body = {"event_id": str(uuid4()), "timestamp": datetime.now(UTC).isoformat(), **body}
        if self.identity:
            body["instance_id"] = self.identity
        # Heartbeats are snapshots. Coalesce unsent ones, but retain lifecycle events.
        if endpoint in {"heartbeat", "logs"}:
            self.db.execute("DELETE FROM outbox WHERE endpoint=?", (endpoint,))
        self.db.execute("INSERT INTO outbox(endpoint,payload) VALUES (?,?)", (endpoint, json.dumps(body)))

    def report_lifecycle(self, stage, metadata=None, *, send=True):
        if not self.enabled:
            return None
        if stage not in STAGES:
            raise ValueError("Invalid lifecycle stage")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            previous = self._get("stage")
            if not previous or STAGES.index(stage) > STAGES.index(previous):
                self._enqueue("lifecycle", {"stage": stage, "metadata": self.redact(metadata or {})})
                self._set("stage", stage)
        return self.flush() if send else None

    def report_heartbeat(self, stage, uptime_seconds, health=None, *, send=True):
        if not self.enabled:
            return None
        body = {"stage": stage, "uptime_seconds": uptime_seconds, "boot_id": container_boot_id()}
        if health is not None:
            body["health"] = health
        with self.db:
            self._enqueue("heartbeat", body)
        return self.flush() if send else None

    def report_logs(self, stage, error_code, logs, *, send=True, truncated=False):
        if not self.enabled:
            return None
        lines = logs.splitlines()
        content = self.redact("\n".join(lines[-500:])).encode("utf-8")
        body = {"stage": stage, "error_code": error_code, "logs": content[-MAX_LOG_BYTES:].decode("utf-8", errors="ignore"),
                "truncated": truncated or len(lines) > 500 or len(content) > MAX_LOG_BYTES}
        with self.db:
            self._enqueue("logs", body)
        return self.flush() if send else None

    def flush(self, *, endpoint=None):
        if not self.enabled or self._get("revoked") or float(self._get("retry_at", "0")) > time.time():
            return None
        status = None
        rows = self.db.execute("SELECT seq,endpoint,payload FROM outbox WHERE endpoint=? ORDER BY seq", (endpoint,)).fetchall() if endpoint else self.db.execute("SELECT seq,endpoint,payload FROM outbox WHERE endpoint != 'usage' ORDER BY seq").fetchall()
        for seq, endpoint, payload in rows:
            try:
                args = {"headers": {"Authorization": f"Bearer {self.token}"}, "json": json.loads(payload)}
                url = f"{self.base_url}/api/v1/agent/{endpoint}"
                response = (self.transport("POST", url, **args) if self.transport else
                            self.http.post(url, **args, timeout=(3, 7), allow_redirects=False))
                status = response.status_code
                data = response.json() if status == 200 else {}
                if not isinstance(data, dict):
                    raise ValueError("Invalid management acknowledgement")
            except (requests.RequestException, ValueError):
                status, data = None, {}
            with self.db:
                if status in {401, 403}:
                    self._set("revoked", "1")
                    return status
                if status == 200:
                    self.db.execute("DELETE FROM outbox WHERE seq=?", (seq,))
                    interval = data.get("heartbeat_interval_s")
                    if isinstance(interval, int) and 1 <= interval <= 3600:
                        self._set("heartbeat_interval", interval)
                    self._set("retry_delay", 5)
                    self._set("retry_at", 0)
                elif status in {400, 404, 409, 422}:
                    # Invalid protocol must not silently discard a lifecycle transition.
                    self._set("revoked", "1")
                    log.error("管理代理协议被拒绝，停止上报: HTTP %s", status)
                    return status
                else:
                    delay = min(60, int(self._get("retry_delay", "5")))
                    self._set("retry_at", time.time() + delay)
                    self._set("retry_delay", delay * 2)
                    return status
        return status

    def local_ready(self):
        if not self.identity:
            return False
        try:
            port = int(self.environ.get("MANAGER_PORT", "5000"))
            response = self.http.get(f"http://127.0.0.1:{port}/api/provisioning/readiness", timeout=2, allow_redirects=False)
            body = response.json()
            return response.status_code == 200 and isinstance(body, dict) and body.get("ready") is True and body.get("wizard_available") is True and body.get("instance_id") == self.identity
        except (requests.RequestException, ValueError):
            return False

    def collect_health(self):
        # The image carries the same collector as the dashboard, before the Release exists.
        try:
            if __package__:
                from .system_monitor import _collect_all
            else:
                from system_monitor import _collect_all
            stats = _collect_all()
        except Exception:
            log.exception("系统指标采集失败，本次心跳保留未知指标")
            stats = {}
        health = {"dashboard": self.local_ready(), "jupyter": None, "tunnel": None,
                  "disk_used_pct": stats.get("disk", {}).get("percent"),
                  "gpu_visible": True if stats.get("gpu") else None}
        try:
            port = int(self.environ.get("JUPYTER_PORT", "8888"))
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                health["jupyter"] = True
        except (OSError, ValueError):
            health["jupyter"] = False
        try:
            import psutil
            health["tunnel"] = any(process.info.get("name") == "cloudflared"
                                   for process in psutil.process_iter(["name"]))
        except Exception:
            pass
        metrics = {"sampled_at": datetime.now(UTC).isoformat(),
                   "cpu_used_pct": stats.get("cpu", {}).get("percent"),
                   "memory_used_bytes": stats.get("memory", {}).get("used"),
                   "memory_total_bytes": stats.get("memory", {}).get("total"),
                   "gpus": [{"index": gpu["index"], "name": gpu["name"],
                             "used_pct": gpu["util"], "temperature_c": gpu["temp"],
                             "memory_used_mib": gpu["mem_used"], "memory_total_mib": gpu["mem_total"]}
                            for gpu in stats.get("gpu", [])]}
        health["metrics"] = metrics
        return health

    def run(self):
        if not self.enabled or not self.identity:
            return
        database = self.db.execute("PRAGMA database_list").fetchone()[2]
        with open(database + ".lock", "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            started = time.monotonic()
            next_heartbeat = 0
            self.report_lifecycle("ENV_INITIALIZING", send=False)
            while not self._get("revoked"):
                stage = self._get("stage", "ENV_INITIALIZING")
                if stage == "SERVICE_STARTING" and self.local_ready():
                    self.report_lifecycle("READY", send=False)
                    stage = self._get("stage")
                if time.monotonic() >= next_heartbeat:
                    self.report_heartbeat(stage, int(time.monotonic() - started), self.collect_health(), send=False)
                    next_heartbeat = time.monotonic() + self.heartbeat_interval
                self.flush()
                time.sleep(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["run", "event", "enabled"])
    parser.add_argument("--stage", choices=STAGES)
    parser.add_argument("--error-code")
    parser.add_argument("--log-file", type=Path)
    args = parser.parse_args()
    if args.command == "enabled":
        sys.exit(0 if enabled(os.environ) and os.environ.get("PROVISIONING_INSTANCE_ID") else 1)
    client = AgentClient()
    try:
        if not client.enabled:
            return
        if args.command == "run":
            client.run()
        elif args.stage:
            metadata = {"error_code": args.error_code, "error_stage": client._get("stage", "ENV_INITIALIZING")} if args.error_code else {}
            client.report_lifecycle(args.stage, metadata, send=False)
            if args.log_file and args.log_file.is_file():
                with args.log_file.open("rb") as stream:
                    size = args.log_file.stat().st_size
                    stream.seek(max(0, size - MAX_LOG_BYTES))
                    tail = stream.read(MAX_LOG_BYTES).decode("utf-8", errors="replace")
                client.report_logs(args.stage, args.error_code, tail, send=False, truncated=size > MAX_LOG_BYTES)
    finally:
        client.close()


if __name__ == "__main__":
    main()
