"""
ComfyCarry — ComfyUI WebSocket → SSE 实时事件桥接

依赖 comfycarry_ws_broadcast 插件将定向 WS 事件广播给所有客户端。
Bridge 使用 ComfyUI 原生事件信号追踪执行状态:
  - execution_start: 执行开始
  - executing (node=null): 执行完成
  - execution_success: 明确成功
  - execution_error: 错误
  - progress: 采样步进
  - progress_state: 全节点进度状态
"""

import json
import queue
import threading
import time
import uuid

import requests
import websocket  # websocket-client

from ..config import COMFYUI_URL


class ComfyWSBridge:
    """Maintains a WebSocket connection to ComfyUI and broadcasts events via SSE."""

    def __init__(self, comfyui_url):
        self._ws_url = comfyui_url.replace("http://", "ws://").replace("https://", "wss://")
        self._http_url = comfyui_url.rstrip("/")
        self._client_id = str(uuid.uuid4())
        self._subscribers = {}   # id -> queue.Queue
        self._lock = threading.Lock()
        self._ws = None
        self._running = False
        self._thread = None
        # State caches
        self._last_status = None
        self._last_progress = None
        self._exec_info = None       # Current execution tracking

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

    def _fetch_node_names(self, prompt_id):
        """从 ComfyUI /queue 获取节点 ID → class_type 映射"""
        try:
            r = requests.get(f"{self._http_url}/queue", timeout=3)
            if r.ok:
                data = r.json()
                # queue_running: [[number, prompt_id, {prompt}, extra_data, ...], ...]
                for item in data.get("queue_running", []):
                    if len(item) >= 3 and item[1] == prompt_id:
                        prompt = item[2]
                        return {
                            nid: ndata.get("class_type", "Unknown")
                            for nid, ndata in prompt.items()
                            if isinstance(ndata, dict)
                        }
        except Exception:
            pass
        return {}

    def _on_message(self, ws, message):
        """处理 ComfyUI WebSocket 消息 — 使用原生事件信号追踪执行状态"""
        if isinstance(message, bytes):
            # Binary: preview images — broadcast as base64
            # 暂时跳过 binary 预览图 (可选未来增强)
            return
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            msg_data = data.get("data", {})

            # ── 队列状态 (广播事件，所有客户端都会收到) ──
            if msg_type == "status":
                self._last_status = msg_data
                self._broadcast({"type": "status", "data": msg_data})

            # ── GPU/CPU 监控 (Crystools 广播) ──
            elif msg_type == "crystools.monitor":
                self._broadcast({"type": "monitor", "data": msg_data})

            # ── 执行开始 (需要 ws_broadcast 插件) ──
            elif msg_type == "execution_start":
                prompt_id = msg_data.get("prompt_id")
                node_names = self._fetch_node_names(prompt_id)
                self._exec_info = {
                    "prompt_id": prompt_id,
                    "start_time": time.time(),
                    "nodes": {},
                    "current_node": None,
                    "node_names": node_names,
                }
                self._last_progress = None
                self._broadcast({"type": "execution_start", "data": {
                    "prompt_id": prompt_id,
                    "start_time": self._exec_info["start_time"],
                    "node_names": node_names,
                }})

            # ── 缓存命中的节点 ──
            elif msg_type == "execution_cached":
                cached_nodes = msg_data.get("nodes", [])
                if self._exec_info:
                    for nid in cached_nodes:
                        self._exec_info["nodes"][nid] = "cached"
                self._broadcast({"type": "execution_cached", "data": msg_data})

            # ── 当前执行节点 / 执行完成 ──
            elif msg_type == "executing":
                node_id = msg_data.get("node")
                if node_id is None:
                    # node=None → 当前 prompt 执行完成
                    if self._exec_info:
                        elapsed = time.time() - self._exec_info.get("start_time", time.time())
                        self._broadcast({"type": "execution_done", "data": {
                            "prompt_id": msg_data.get("prompt_id"),
                            "elapsed": round(elapsed, 1),
                        }})
                        self._exec_info = None
                        self._last_progress = None
                else:
                    # 正在执行特定节点
                    if self._exec_info:
                        self._exec_info["current_node"] = node_id
                        self._exec_info["nodes"][node_id] = "running"
                    # Enrich with node class name
                    enriched = dict(msg_data)
                    if self._exec_info and node_id in self._exec_info.get("node_names", {}):
                        enriched["class_type"] = self._exec_info["node_names"][node_id]
                    self._broadcast({"type": "executing", "data": enriched})

            # ── 节点完成 ──
            elif msg_type == "executed":
                node_id = msg_data.get("node")
                if self._exec_info and node_id:
                    self._exec_info["nodes"][node_id] = "done"
                # 只转发元信息，不包含完整 output (可能很大)
                self._broadcast({"type": "executed", "data": {
                    "node": node_id,
                    "display_node": msg_data.get("display_node"),
                    "prompt_id": msg_data.get("prompt_id"),
                }})

            # ── 采样步进进度 ──
            elif msg_type == "progress":
                val = msg_data.get("value", 0)
                mx = msg_data.get("max", 1)
                self._last_progress = {
                    "value": val, "max": mx,
                    "percent": round(val / mx * 100) if mx > 0 else 0,
                    "node": msg_data.get("node"),
                }
                self._broadcast({"type": "progress", "data": self._last_progress})

            # ── 全节点进度状态快照 ──
            elif msg_type == "progress_state":
                nodes = msg_data.get("nodes", {})
                # 提取简化视图
                summary = {}
                for nid, ndata in nodes.items():
                    summary[nid] = {
                        "state": ndata.get("state", "unknown"),
                        "value": ndata.get("value"),
                        "max": ndata.get("max"),
                    }
                self._broadcast({"type": "progress_state", "data": {
                    "prompt_id": msg_data.get("prompt_id"),
                    "nodes": summary,
                }})

            # ── 执行成功 ──
            elif msg_type == "execution_success":
                if self._exec_info:
                    elapsed = time.time() - self._exec_info.get("start_time", time.time())
                    self._broadcast({"type": "execution_done", "data": {
                        "prompt_id": msg_data.get("prompt_id"),
                        "elapsed": round(elapsed, 1),
                    }})
                    self._exec_info = None
                    self._last_progress = None

            # ── 执行错误 ──
            elif msg_type == "execution_error":
                self._broadcast({"type": "execution_error", "data": {
                    "prompt_id": msg_data.get("prompt_id"),
                    "node_id": msg_data.get("node_id"),
                    "node_type": msg_data.get("node_type"),
                    "exception_message": msg_data.get("exception_message", ""),
                }})
                self._exec_info = None
                self._last_progress = None

            # ── 执行中断 ──
            elif msg_type == "execution_interrupted":
                self._broadcast({"type": "execution_interrupted", "data": msg_data})
                self._exec_info = None
                self._last_progress = None

        except Exception:
            pass

    def subscribe(self):
        """Add a new SSE subscriber and return (sub_id, queue)."""
        sub_id = str(uuid.uuid4())
        q = queue.Queue(maxsize=200)
        with self._lock:
            self._subscribers[sub_id] = q
        # 发送当前缓存状态给新订阅者 — 完整快照以支持页面刷新后恢复
        if self._last_status:
            q.put({"type": "status", "data": self._last_status})
        if self._exec_info:
            # 发送完整执行快照，包含所有已执行/已缓存节点
            nodes_state = self._exec_info.get("nodes", {})
            executed = [nid for nid, st in nodes_state.items() if st in ("running", "done")]
            cached = [nid for nid, st in nodes_state.items() if st == "cached"]
            q.put({"type": "execution_snapshot", "data": {
                "prompt_id": self._exec_info.get("prompt_id"),
                "start_time": self._exec_info.get("start_time"),
                "node_names": self._exec_info.get("node_names", {}),
                "executed_nodes": executed,
                "cached_nodes": cached,
                "current_node": self._exec_info.get("current_node"),
            }})
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
