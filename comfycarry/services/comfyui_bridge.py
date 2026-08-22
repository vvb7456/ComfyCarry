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
import logging
import queue
import struct
import base64
import threading
import time
import uuid

import requests
import websocket  # websocket-client

from ..config import COMFYUI_URL

logger = logging.getLogger(__name__)


class ComfyWSBridge:
    """Maintains a WebSocket connection to ComfyUI and broadcasts events via SSE."""

    # ComfyUI protocol.py BinaryEventTypes (见 _on_binary 注释)
    PREVIEW_IMAGE = 1
    PREVIEW_IMAGE_WITH_METADATA = 4

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

    @property
    def client_id(self):
        return self._client_id

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
                logger.info(f"[bridge] WS connecting → {url}")
                self._ws = websocket.WebSocketApp(
                    url,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                    on_open=self._on_open,
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                logger.warning(f"[bridge] WS run_forever exception: {e}")
            if self._running:
                logger.info("[bridge] WS disconnected, retrying in 3s...")
                time.sleep(3)

    def _on_open(self, ws):
        logger.info("[bridge] WS connected ✓")
        self._broadcast({"type": "ws_connected"})

    def _on_error(self, ws, error):
        logger.warning(f"[bridge] WS error: {error}")

    def _on_close(self, ws, close_status_code=None, close_msg=None):
        logger.info(f"[bridge] WS closed (code={close_status_code})")
        self._broadcast({"type": "ws_disconnected"})
        # WS 断连时如有执行中状态，清除并通知前端
        if self._exec_info:
            self._broadcast({"type": "execution_interrupted", "data": {
                "prompt_id": self._exec_info.get("prompt_id"),
            }})
            self._exec_info = None
            self._last_progress = None

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

    def _on_binary(self, message):
        """ComfyUI 二进制帧 → preview_image 事件。

        帧格式 (ComfyUI protocol.py BinaryEventTypes):
          [4字节 event_type][payload]
          1 PREVIEW_IMAGE               payload = [4字节 image_type][图像字节]
          2 UNENCODED_PREVIEW_IMAGE     (服务端内部用, 不会上线)
          3 TEXT                        payload = UTF-8 文本, **不是图像**
          4 PREVIEW_IMAGE_WITH_METADATA payload = [4字节 json长度][json][图像字节]
                                        json: node_id / prompt_id / display_node_id ...
        旧实现把 3 当成"带元数据的预览图"并按 message[8:] 切片: 收到 TEXT 帧会把一段
        文本当 JPEG 塞给前端 (破图), 真的 type=4 帧则被整帧丢弃。
        """
        try:
            if len(message) <= 8:
                return
            event_type = struct.unpack('>I', message[0:4])[0]
            meta = None
            if event_type == self.PREVIEW_IMAGE:
                img_bytes = message[8:]          # 跳过 image_type 字段
            elif event_type == self.PREVIEW_IMAGE_WITH_METADATA:
                mlen = struct.unpack('>I', message[4:8])[0]
                if len(message) < 8 + mlen:
                    return
                try:
                    meta = json.loads(message[8:8 + mlen].decode('utf-8'))
                except Exception:
                    meta = None
                img_bytes = message[8 + mlen:]
            else:
                return  # TEXT 及未知类型: 不是预览图
            if not img_bytes:
                return
            mime = 'image/png' if img_bytes[:4] == b'\x89PNG' else 'image/jpeg'
            data = {"b64": base64.b64encode(img_bytes).decode('ascii'), "mime": mime}
            # 元数据帧才有归属信息 (需 feature_flags 协商, 目前未协商 → 恒为 None)
            if isinstance(meta, dict):
                for k in ("node_id", "prompt_id", "display_node_id"):
                    if meta.get(k) is not None:
                        data[k] = meta[k]
            self._broadcast({"type": "preview_image", "data": data}, droppable=True)
        except Exception:
            pass

    def _on_message(self, ws, message):
        """处理 ComfyUI WebSocket 消息 — 使用原生事件信号追踪执行状态"""
        if isinstance(message, bytes):
            self._on_binary(message)
            return
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            msg_data = data.get("data", {})

            # ── 队列状态 (广播事件，所有客户端都会收到) ──
            if msg_type == "status":
                self._last_status = msg_data
                # WS 重连后 ComfyUI 发送 status — 如果队列空但有残留执行状态，清除
                if self._exec_info:
                    queue_info = msg_data.get("status", {})
                    queue_remaining = queue_info.get("exec_info", {}).get("queue_remaining", -1)
                    if queue_remaining == 0:
                        self._exec_info = None
                        self._last_progress = None
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
                enriched = dict(msg_data)
                if self._exec_info:
                    enriched["prompt_id"] = self._exec_info.get("prompt_id", "")
                self._broadcast({"type": "execution_cached", "data": enriched})

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
                    # Enrich with node class name + prompt_id
                    enriched = dict(msg_data)
                    if self._exec_info:
                        if node_id in self._exec_info.get("node_names", {}):
                            enriched["class_type"] = self._exec_info["node_names"][node_id]
                        enriched["prompt_id"] = self._exec_info.get("prompt_id", "")
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
                if self._exec_info:
                    self._last_progress["prompt_id"] = self._exec_info.get("prompt_id", "")
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
                    self._exec_info = None  # 置 None 防止 executing(node=None) 再次触发
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

            # ── ComfyUI-Manager 队列事件 (插件装/卸/更新进度) ──
            # Manager 经 send_sync(sid=None) 广播, bridge 天然在收件人之列,
            # 无需 ws_broadcast 插件。转发为下划线命名与其他事件风格一致。
            elif msg_type == "cm-queue-status":
                self._broadcast({"type": "cm_queue_status", "data": msg_data})

        except Exception:
            pass

    # 队列水位: 超过这条线就开始丢预览帧 (见 _broadcast)
    _QUEUE_MAX = 200
    _DROP_WATERMARK = 100

    def subscribe(self):
        """Add a new SSE subscriber and return (sub_id, queue)."""
        sub_id = str(uuid.uuid4())
        q = queue.Queue(maxsize=self._QUEUE_MAX)
        with self._lock:
            self._subscribers[sub_id] = q
            # 在锁内复制快照 — 防止 WS 线程 (_on_close) 并发清空 _exec_info
            snap_status = dict(self._last_status) if self._last_status else None
            snap_exec = dict(self._exec_info) if self._exec_info else None
            snap_progress = dict(self._last_progress) if self._last_progress else None
        # 发送当前缓存状态给新订阅者 — 完整快照以支持页面刷新后恢复
        if snap_status:
            q.put({"type": "status", "data": snap_status})
        if snap_exec:
            # 验证执行是否真的还在跑（防止陈旧快照）
            try:
                r = requests.get(f"{self._http_url}/queue", timeout=3)
                if r.ok:
                    data = r.json()
                    running_ids = {
                        item[1] for item in data.get("queue_running", [])
                        if len(item) >= 2
                    }
                    if snap_exec["prompt_id"] not in running_ids:
                        with self._lock:
                            self._exec_info = None
                            self._last_progress = None
                        snap_exec = None
                        snap_progress = None
            except Exception:
                pass
        if snap_exec:
            # 发送完整执行快照，包含所有已执行/已缓存节点
            nodes_state = snap_exec.get("nodes", {})
            executed = [nid for nid, st in nodes_state.items() if st in ("running", "done")]
            cached = [nid for nid, st in nodes_state.items() if st == "cached"]
            q.put({"type": "execution_snapshot", "data": {
                "prompt_id": snap_exec.get("prompt_id"),
                "start_time": snap_exec.get("start_time"),
                "node_names": snap_exec.get("node_names", {}),
                "executed_nodes": executed,
                "cached_nodes": cached,
                "current_node": snap_exec.get("current_node"),
            }})
        if snap_progress:
            q.put({"type": "progress", "data": snap_progress})
        return sub_id, q

    def unsubscribe(self, sub_id):
        with self._lock:
            self._subscribers.pop(sub_id, None)

    def _broadcast(self, event, droppable=False):
        """向所有 SSE 订阅者派发事件。

        droppable=True 的事件 (预览帧) 在队列吃紧时直接丢弃 —— 预览帧是一次性的,
        丢一帧无害, 但它体积大 (base64 后几十~上百 KB)、频率高, 是唯一能把队列
        顶满的东西。执行事件不可丢: 丢了状态机就错乱。

        队列真的满了也**不再摘除订阅者**: 摘除后 SSE 生成器毫不知情, 会继续
        每 30s 吐 keepalive, 连接不断、EventSource 不报错、前端不重连 —— 整条
        事件流静默变哑。改为投递 stream_overflow 让前端主动重连。
        """
        with self._lock:
            for sid, q in list(self._subscribers.items()):
                if droppable and q.qsize() >= self._DROP_WATERMARK:
                    continue
                try:
                    q.put_nowait(event)
                except queue.Full:
                    try:
                        q.get_nowait()          # 挤掉最旧的一条, 给信号让路
                        q.put_nowait({"type": "stream_overflow"})
                    except (queue.Empty, queue.Full):
                        pass


# ── 全局单例 ─────────────────────────────────────────────────
_bridge_instance = None


def get_bridge():
    """获取全局 ComfyWSBridge 实例 (懒初始化)"""
    global _bridge_instance
    if _bridge_instance is None:
        _bridge_instance = ComfyWSBridge(COMFYUI_URL)
        _bridge_instance.start()
    return _bridge_instance
