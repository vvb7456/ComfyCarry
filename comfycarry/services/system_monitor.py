"""
SystemMonitor — 后台 daemon 线程采集系统指标，写入模块级缓存。

所有 API 读缓存即时返回，不再在请求路径上执行 subprocess / pynvml。
采集项: GPU (pynvml) + CPU / Memory / Disk / Network (psutil)。
"""

import os
import threading
import time
from typing import Any

_cache: dict[str, Any] = {}
_cache_lock = threading.Lock()
_started = False

POLL_INTERVAL = 2  # 秒


# ====================================================================
# GPU 采集 — pynvml (NVML C library binding, ~0.9ms/call)
# ====================================================================
def _collect_gpu() -> list[dict]:
    gpus: list[dict] = []
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        for i in range(count):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            temp = pynvml.nvmlDeviceGetTemperature(h, 0)
            try:
                power = pynvml.nvmlDeviceGetPowerUsage(h) / 1000
            except Exception:
                power = 0
            try:
                power_limit = pynvml.nvmlDeviceGetPowerManagementLimit(h) / 1000
            except Exception:
                power_limit = 0
            name = pynvml.nvmlDeviceGetName(h)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")
            gpus.append({
                "index": i,
                "name": name,
                "mem_total": mem.total // 1048576,   # MB
                "mem_used": mem.used // 1048576,
                "mem_free": mem.free // 1048576,
                "util": util.gpu,
                "temp": temp,
                "power": round(power, 1),
                "power_limit": round(power_limit, 1),
            })
        pynvml.nvmlShutdown()
    except Exception:
        pass
    return gpus


# ====================================================================
# CPU / Memory / Disk / Network — psutil (~0.03ms total)
# ====================================================================
def _collect_system() -> dict:
    data: dict[str, Any] = {}
    try:
        import psutil

        # CPU
        data["cpu"] = {
            "percent": psutil.cpu_percent(interval=None),
            "cores": psutil.cpu_count(),
        }
        freq = psutil.cpu_freq()
        data["cpu"]["freq"] = freq._asdict() if freq else {}
        load = os.getloadavg()
        data["cpu"]["load"] = {"1m": load[0], "5m": load[1], "15m": load[2]}

        # Memory
        mem = psutil.virtual_memory()
        data["memory"] = {
            "total": mem.total,
            "used": mem.used,
            "available": mem.available,
            "percent": mem.percent,
        }

        # Disk
        path = "/workspace" if os.path.exists("/workspace") else "/"
        disk = psutil.disk_usage(path)
        data["disk"] = {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
            "percent": disk.percent,
            "path": path,
        }

        # Network
        net = psutil.net_io_counters()
        data["network"] = {
            "bytes_sent": net.bytes_sent,
            "bytes_recv": net.bytes_recv,
            "packets_sent": net.packets_sent,
            "packets_recv": net.packets_recv,
        }
    except Exception:
        pass

    # Uptime
    try:
        import subprocess
        data["uptime"] = subprocess.check_output(
            ["uptime", "-p"], timeout=3, text=True
        ).strip()
    except Exception:
        data["uptime"] = ""

    return data


# ====================================================================
# 主循环
# ====================================================================
def _collect_all() -> dict:
    snapshot: dict[str, Any] = {"ts": time.time()}
    snapshot["gpu"] = _collect_gpu()
    snapshot.update(_collect_system())
    return snapshot


def _worker():
    while True:
        try:
            snapshot = _collect_all()
            with _cache_lock:
                _cache.update(snapshot)
        except Exception:
            pass
        time.sleep(POLL_INTERVAL)


def start():
    """启动后台采集线程 (daemon)，幂等"""
    global _started
    if _started:
        return
    _started = True
    # psutil cpu_percent 首次调用返回 0%, 需要预热
    try:
        import psutil
        psutil.cpu_percent()
    except Exception:
        pass
    # 立即采集一次，确保 API 可用时有数据
    try:
        snapshot = _collect_all()
        with _cache_lock:
            _cache.update(snapshot)
    except Exception:
        pass
    t = threading.Thread(target=_worker, daemon=True, name="system-monitor")
    t.start()


def get_stats() -> dict:
    """读取最新缓存快照 (线程安全，<0.01ms)"""
    with _cache_lock:
        return dict(_cache)
