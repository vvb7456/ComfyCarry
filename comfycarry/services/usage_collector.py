"""Durable network counter samples independent of dashboard and heartbeat cadence."""

import fcntl
import logging
from pathlib import Path
import time
from uuid import uuid4

if __package__:
    from .management_agent import AgentClient
else:
    from management_agent import AgentClient

log = logging.getLogger(__name__)


def network_sample():
    interface = Path("/sys/class/net/eth0")
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    # Field 22 follows a comm field which can itself contain spaces and parentheses.
    pid1_start = Path("/proc/1/stat").read_text().rsplit(")", 1)[1].split()[19]
    identity = ":".join((boot, pid1_start, interface.joinpath("ifindex").read_text().strip(),
                         interface.joinpath("address").read_text().strip()))
    rx = int(interface.joinpath("statistics/rx_bytes").read_text())
    tx = int(interface.joinpath("statistics/tx_bytes").read_text())
    return identity, rx, tx, int(time.clock_gettime(time.CLOCK_BOOTTIME) * 1000)


class UsageCollector(AgentClient):
    def sample(self, reader=network_sample):
        if not self.enabled or not self.identity or self._get("revoked"):
            return False
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            # Keep the original event until acknowledged; the next raw counter includes the gap.
            if self.db.execute("SELECT 1 FROM outbox WHERE endpoint='usage'").fetchone():
                return False
            identity, rx, tx, uptime = reader()
            changed = (identity != self._get("usage_identity")
                       or rx < int(self._get("usage_rx", "0"))
                       or tx < int(self._get("usage_tx", "0"))
                       or uptime < int(self._get("usage_uptime", "0")))
            if changed:
                self._set("usage_epoch", uuid4())
                self._set("usage_seq", -1)
                self._set("usage_base_uptime", uptime)
            seq = int(self._get("usage_seq", "-1")) + 1
            self._enqueue("usage", {"boot_id": self._get("usage_epoch"), "seq": seq,
                                    "reported_rx_bytes": rx, "reported_tx_bytes": tx,
                                    "running_ms": uptime - int(self._get("usage_base_uptime"))})
            for key, value in (("identity", identity), ("rx", rx), ("tx", tx), ("uptime", uptime), ("seq", seq)):
                self._set(f"usage_{key}", value)
        return True

    def run(self):
        if not self.enabled or not self.identity:
            return
        database = self.db.execute("PRAGMA database_list").fetchone()[2]
        with open(database + ".usage.lock", "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            next_sample = 0
            while not self._get("revoked"):
                if time.monotonic() >= next_sample:
                    try:
                        self.sample()
                    except (OSError, ValueError, IndexError):
                        log.warning("网卡计数读取失败，保留原计数等待下次采集")
                    next_sample = time.monotonic() + 10
                self.flush(endpoint="usage")
                time.sleep(1)


if __name__ == "__main__":
    client = UsageCollector()
    try:
        client.run()
    finally:
        client.close()
