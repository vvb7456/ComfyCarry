"""
ComfyCarry WS Broadcast — 将 ComfyUI 的定向 WebSocket 事件广播给所有连接

ComfyUI 默认只将执行事件 (progress, executing, executed 等) 发送给
提交 prompt 的那个 client_id。此插件 patch send_json/send_bytes，
使定向事件也被复制到所有其他已连接的 WebSocket 客户端。

这样 Dashboard 的 Bridge（以独立 client_id 连接的观察者）
也能收到完整的执行进度信息。

安装: 放入 ComfyUI/custom_nodes/comfycarry_ws_broadcast/ 即可
无需在工作流中添加任何节点。
"""

import logging
import server

log = logging.getLogger("comfycarry.ws_broadcast")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_patched = False


def _patch_server():
    """Monkey-patch PromptServer 的 send_json 和 send_bytes 实现广播"""
    global _patched
    if _patched:
        return

    srv = server.PromptServer.instance
    if srv is None:
        log.warning("[ComfyCarry] PromptServer.instance is None, skip patch")
        return

    _original_send_json = srv.__class__.send_json
    _original_send_bytes = srv.__class__.send_bytes

    async def patched_send_json(self, event, data, sid=None):
        """发送 JSON 事件: 定向事件同时广播给其他客户端"""
        if sid is not None:
            # 原始定向发送给目标 client
            await _original_send_json(self, event, data, sid)
            # 复制给所有其他已连接的客户端
            message = {"type": event, "data": data}
            for other_sid, ws in list(self.sockets.items()):
                if other_sid != sid:
                    try:
                        await ws.send_json(message)
                    except Exception:
                        pass
        else:
            # 广播事件，保持原始行为
            await _original_send_json(self, event, data, sid)

    async def patched_send_bytes(self, event, data, sid=None):
        """发送二进制事件 (预览图等): 定向事件同时广播给其他客户端"""
        if sid is not None:
            # 原始定向发送给目标 client
            await _original_send_bytes(self, event, data, sid)
            # 复制给所有其他客户端
            message = self.encode_bytes(event, data)
            for other_sid, ws in list(self.sockets.items()):
                if other_sid != sid:
                    try:
                        await ws.send_bytes(message)
                    except Exception:
                        pass
        else:
            await _original_send_bytes(self, event, data, sid)

    srv.__class__.send_json = patched_send_json
    srv.__class__.send_bytes = patched_send_bytes
    _patched = True
    log.info("[ComfyCarry] WS broadcast patch applied — all execution events will be broadcast to all clients")


# === 启动时立即 patch ===
try:
    _patch_server()
except Exception as e:
    log.error(f"[ComfyCarry] Failed to patch WS broadcast: {e}")
