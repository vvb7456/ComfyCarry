"""
ComfyCarry — ComfyUI WebSocket → SSE 实时事件桥接
"""

import json
import queue
import threading
import time
import uuid

import websocket  # websocket-client

from ..config import COMFYUI_URL


class ComfyWSBridge:
    """Maintains a WebSocket connection to ComfyUI and broadcasts events via SSE."""

    def __init__(self, comfyui_url):
        self._ws_url = comfyui_url.replace("http://", "ws://").replace("https://", "wss://")
        self._client_id = str(uuid.uuid4())
        self._subscribers = {}   # id -> queue.Queue
        self._lock = threading.Lock()
        self._ws = None
        self._running = False
        self._thread = None
        # Latest state cache for new subscribers
        self._last_status = None
        self._last_progress = None
        self._exec_info = {}     # Current execution info

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def _run_loop(self):
        """Reconnect loop — keeps trying to connect to ComfyUI WS."""
        while self._running:
            try:
                url = f"{self._ws_url}/ws?clientId={self._client_id}"
                self._ws = websocket.WebSocketApp(
                    url,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                    on_open=self._on_open,
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception:
                pass
            if self._running:
                time.sleep(3)

    def _on_open(self, ws):
        self._broadcast({"type": "ws_connected"})

    def _on_error(self, ws, error):
        pass

    def _on_close(self, ws, close_status_code=None, close_msg=None):
        self._broadcast({"type": "ws_disconnected"})

    def _on_message(self, ws, message):
        if isinstance(message, bytes):
            return
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            msg_data = data.get("data", {})

            if msg_type == "status":
                q_info = msg_data.get("status", {}).get("exec_info", {})
                q_remaining = q_info.get("queue_remaining", 0)
                old_remaining = (self._last_status or {}).get("status", {}).get(
                    "exec_info", {}).get("queue_remaining", 0)

                if old_remaining == 0 and q_remaining > 0 and not self._exec_info:
                    self._exec_info = {"start_time": time.time()}
                    self._broadcast({"type": "execution_start", "data": {
                        "start_time": self._exec_info["start_time"]
                    }})
                elif q_remaining == 0 and self._exec_info:
                    elapsed = time.time() - self._exec_info.get("start_time", time.time())
                    self._broadcast({"type": "execution_done", "data": {
                        "elapsed": round(elapsed, 1)
                    }})
                    self._exec_info = {}
                    self._last_progress = None

                self._last_status = msg_data
                self._broadcast({"type": "status", "data": msg_data})

            elif msg_type == "crystools.monitor":
                self._broadcast({"type": "monitor", "data": msg_data})

            elif msg_type in ("execution_start", "executing", "progress",
                              "executed", "execution_error", "execution_cached",
                              "execution_success"):
                if msg_type == "progress":
                    val = msg_data.get("value", 0)
                    mx = msg_data.get("max", 1)
                    self._last_progress = {"value": val, "max": mx,
                                           "percent": round(val / mx * 100) if mx > 0 else 0}
                    self._broadcast({"type": "progress", "data": self._last_progress})
                elif msg_type == "execution_error":
                    self._broadcast({"type": "execution_error", "data": msg_data})
                    self._exec_info = {}
                    self._last_progress = None
                else:
                    self._broadcast({"type": msg_type, "data": msg_data})

        except Exception:
            pass

    def subscribe(self):
        """Add a new SSE subscriber and return (sub_id, queue)."""
        sub_id = str(uuid.uuid4())
        q = queue.Queue(maxsize=200)
        with self._lock:
            self._subscribers[sub_id] = q
        if self._last_status:
            q.put({"type": "status", "data": self._last_status})
        if self._exec_info:
            q.put({"type": "executing", "data": self._exec_info})
        if self._last_progress:
            q.put({"type": "progress", "data": self._last_progress})
        return sub_id, q

    def unsubscribe(self, sub_id):
        with self._lock:
            self._subscribers.pop(sub_id, None)

    def _broadcast(self, event):
        with self._lock:
            dead = []
            for sid, q in self._subscribers.items():
                try:
                    q.put_nowait(event)
                except queue.Full:
                    dead.append(sid)
            for sid in dead:
                self._subscribers.pop(sid, None)


# ── 全局单例 ─────────────────────────────────────────────────
_bridge_instance = None


def get_bridge():
    """获取全局 ComfyWSBridge 实例 (懒初始化)"""
    global _bridge_instance
    if _bridge_instance is None:
        _bridge_instance = ComfyWSBridge(COMFYUI_URL)
        _bridge_instance.start()
    return _bridge_instance
