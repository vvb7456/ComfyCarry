"""
后台运行模式 — 单例服务 (纯内存)

一个进程内只有一个后台会话。worker 线程每秒轮询 ComfyUI /queue,
队列空 + 上一轮已落地时 deepcopy 快照 → submit_generation → 等下一轮。
不订阅 bridge 事件 (bridge 在 queue.Full 时静默踢订阅者, 会把 worker
永久挂死)。

state/epoch/stats 三者读写全部走同一把 _lock。
停机一律 state='idle' + 写 stop_reason, 不退避不重试。
worker 直接调 submit_generation(), 不自调面板 HTTP (面板有登录鉴权)。
"""

import copy
import logging
import threading
import time

import psutil
import requests

from ..config import COMFYUI_DIR, COMFYUI_URL

logger = logging.getLogger(__name__)

# ── 模块级单例状态 ──────────────────────────────────────────────────────────
_lock = threading.Lock()

_state: str = "idle"                       # 'idle' | 'running'
_snapshot: dict | None = None              # start 时冻结的 payload (原始, 未经改写)
_policy: dict = {"max_iterations": 0,     # 0 = 无限 (默认)
                 "min_free_disk_gb": 10}  # 硬约束, 不可关
_stats: dict = {"iteration": 0,
                "started_at": 0.0,
                "last_prompt_id": ""}
_stop_reason: dict | None = None          # None | {"code": str, "detail": str}
_epoch: int = 0                           # 每次 start/stop +1, 掐掉 in-flight 提交

_worker_thread: threading.Thread | None = None


# ── 停机 code (六个值, 严格使用) ───────────────────────────────────────────
# max_reached  达上限 (正常结束, UI 绿色✓)
# disk_low     输出盘剩余 < min_free_disk_gb
# file_missing 模型/输入图不存在
# exec_error   ComfyUI 执行报错 / 提交返回 4xx 5xx
# comfy_offline ComfyUI 连不上
# user_stopped 用户主动停止 (不显示停机条)

_POLL_INTERVAL = 1.0  # 秒, /queue 轮询间隔

# 上一轮 prompt_id 在 /history 里连续查不到多久后判定为「历史已丢失」并停机。
# 典型成因是 ComfyUI 被 OOM kill 后由 pm2 拉起 —— 服务恢复在线但内存历史清空。
# 这种情况绝大多数会先被 _comfy_online() 的离线探测捕获 (ComfyUI 重启要数秒,
# 而这里每秒探一次), 此处是兜底: 宁可按定稿约束停机, 也不要静默空转。
_HISTORY_MISSING_TIMEOUT = 60.0  # 秒


# ── 内部: 加锁读写的薄封装 ──────────────────────────────────────────────────

def _set_stop(code: str, detail: str = "") -> None:
    """写 stop_reason + state=idle (已持有 _lock 的内部路径不重复加锁)"""
    global _state, _stop_reason
    _state = "idle"
    _stop_reason = {"code": code, "detail": detail}


def _check_prompt(prompt_id: str) -> tuple[str, str]:
    """
    检查上一轮 prompt_id 的落地情况, 返回 (状态, detail):
      'waiting' — 仍在排队/执行, 继续等
      'landed'  — 已成功完成
      'error'   — ComfyUI 执行报错
      'missing' — /history 里查无此条目 (ComfyUI 重启后内存历史清空)

    'missing' 必须与 'waiting' 分开: 队列也空 + ComfyUI 在线 + 条目查不到,
    三者同时成立时 worker 会永久空转且不报错。由调用方对该状态计时兜底。

    ComfyUI /history/{id} 形如
      {pid: {"prompt": [...], "outputs": {...},
             "status": {"status_str": "success"|"error",
                        "completed": bool,
                        "messages": [["execution_error", {...}], ...]}}}
    旧版本 ComfyUI 可能没有 status 段, 故保留 outputs 非空的兜底判据。
    连不上视为 'waiting', 由 comfy_offline 停机分支统一处理。
    """
    if not prompt_id:
        return "landed", ""
    try:
        r = requests.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=5)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return "waiting", ""

    entry = data.get(prompt_id, {})
    if not entry:
        return "missing", ""

    status = entry.get("status") or {}
    if status.get("status_str") == "error" or (
        status.get("completed") is False and status.get("messages")
    ):
        # 从 messages 里挖出节点异常原文供 UI 展示
        detail = ""
        for msg in status.get("messages") or []:
            if isinstance(msg, (list, tuple)) and len(msg) >= 2 \
                    and msg[0] == "execution_error" and isinstance(msg[1], dict):
                detail = str(msg[1].get("exception_message", "")) or detail
                break
        return "error", detail or "ComfyUI 执行报错"

    if status.get("completed") is True or entry.get("outputs"):
        return "landed", ""
    return "waiting", ""


def _queue_busy() -> bool:
    """ComfyUI /queue 是否有运行中或排队中任务"""
    try:
        r = requests.get(f"{COMFYUI_URL}/queue", timeout=5)
        r.raise_for_status()
        q = r.json()
    except Exception:
        return False
    return bool(q.get("queue_running")) or bool(q.get("queue_pending"))


def _disk_low() -> bool:
    """输出盘剩余 < min_free_disk_gb (psutil.disk_usage)"""
    output_dir = COMFYUI_DIR + "/output"
    try:
        usage = psutil.disk_usage(output_dir)
    except Exception:
        return False
    free_gb = usage.free / (1024 ** 3)
    return free_gb < _policy.get("min_free_disk_gb", 10)


def _comfy_online() -> bool:
    """ComfyUI 是否可达"""
    try:
        r = requests.get(f"{COMFYUI_URL}/system_stats", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def _interrupt_comfyui() -> None:
    """POST /interrupt (尽力而为)"""
    try:
        requests.post(f"{COMFYUI_URL}/interrupt", timeout=5)
    except Exception:
        pass


def _clear_queue() -> None:
    """清残留队列 (POST /queue clear)"""
    try:
        requests.post(f"{COMFYUI_URL}/queue", json={"clear": True}, timeout=5)
    except Exception:
        pass


def _delete_prompt(prompt_id: str) -> None:
    """从队列删除指定 prompt_id (epoch 切换后补刀)"""
    if not prompt_id:
        return
    try:
        requests.post(f"{COMFYUI_URL}/queue",
                      json={"delete": [prompt_id]}, timeout=5)
    except Exception:
        pass


# ── worker 循环 ───────────────────────────────────────────────────────────

def _worker_loop(my_epoch: int) -> None:
    """worker 线程主循环。my_epoch = 启动时的 epoch, 变了即退出。"""
    global _stats, _stop_reason, _state
    # 仅 worker 线程读写, 无需加锁: 上一轮 prompt 从 /history 消失的起始时刻
    missing_since: float | None = None
    while True:
        # epoch 变了 → 退出
        with _lock:
            if _epoch != my_epoch:
                return

        # q = GET /queue (1s 一次)
        try:
            online = _comfy_online()
        except Exception:
            online = False
        if not online:
            with _lock:
                if _epoch != my_epoch:
                    return
                _set_stop("comfy_offline", "ComfyUI 不可达")
            return

        if _queue_busy():
            time.sleep(_POLL_INTERVAL)
            continue

        # 上一轮 prompt_id 的落地情况: 未落地 → 等; 执行报错 → 停机;
        # 条目从 /history 消失且持续超时 → 同样停机, 避免永久空转。
        with _lock:
            last_pid = _stats.get("last_prompt_id", "")
        landed, land_detail = _check_prompt(last_pid)
        if landed == "error":
            with _lock:
                if _epoch != my_epoch:
                    return
                _set_stop("exec_error", land_detail)
            return
        if landed == "missing":
            now = time.time()
            if missing_since is None:
                missing_since = now
            elif now - missing_since >= _HISTORY_MISSING_TIMEOUT:
                with _lock:
                    if _epoch != my_epoch:
                        return
                    _set_stop("exec_error",
                              "上一轮任务在 ComfyUI 历史中消失 (ComfyUI 可能已重启)")
                return
            time.sleep(_POLL_INTERVAL)
            continue
        missing_since = None
        if landed != "landed":
            time.sleep(_POLL_INTERVAL)
            continue

        # 磁盘检查 → 不足则停机 (disk_low)
        if _disk_low():
            with _lock:
                if _epoch != my_epoch:
                    return
                _set_stop("disk_low", "输出盘剩余空间不足")
            return

        # 轮次检查 → 达上限则停机 (max_reached)
        with _lock:
            max_iter = _policy.get("max_iterations", 0)
            cur_iter = _stats.get("iteration", 0)
        if max_iter > 0 and cur_iter >= max_iter:
            with _lock:
                if _epoch != my_epoch:
                    return
                _set_stop("max_reached", f"已达轮次上限 {max_iter}")
            return

        # data = deepcopy(snapshot)
        with _lock:
            if _epoch != my_epoch:
                return
            snap = _snapshot
        if snap is None:
            # 快照被清 (不应发生), 安全停机
            with _lock:
                _set_stop("exec_error", "快照为空")
            return
        data = copy.deepcopy(snap)

        # seed 与 hires_seed 都置 -1 (不要自己算随机种子)
        data["seed"] = -1
        data["hires_seed"] = -1

        # ok, resp = submit_generation(data) — 直接调 service
        try:
            from ..services.generate_service import submit_generation
            body, status = submit_generation(data)
        except Exception as e:
            logger.exception("[bg-run] submit_generation 抛异常")
            with _lock:
                if _epoch != my_epoch:
                    return
                _set_stop("exec_error", f"submit_generation 异常: {e}")
            return

        # not ok → 停机 (file_missing / exec_error)
        ok = (status == 200)
        if not ok:
            err_text = ""
            if isinstance(body, dict):
                err_text = str(body.get("error", ""))
            code = "exec_error"
            if status == 503 or "未运行" in err_text:
                code = "comfy_offline"
            elif "未找到" in err_text or "不存在" in err_text or "模型文件" in err_text:
                code = "file_missing"
            with _lock:
                if _epoch != my_epoch:
                    return
                _set_stop(code, err_text)
            return

        prompt_id = ""
        if isinstance(body, dict):
            prompt_id = body.get("prompt_id", "")

        # if epoch 已变 → 对刚拿到的 prompt_id 补 interrupt + queue/delete
        with _lock:
            epoch_changed = (_epoch != my_epoch)

        if epoch_changed:
            _interrupt_comfyui()
            _delete_prompt(prompt_id)
            return

        # stats.iteration += 1
        with _lock:
            _stats["iteration"] = _stats.get("iteration", 0) + 1
            _stats["last_prompt_id"] = prompt_id

        time.sleep(_POLL_INTERVAL)


# ── 对外 API (供 routes 调用) ───────────────────────────────────────────────

def start_session(payload: dict, policy: dict | None = None) -> None:
    """
    冻结快照 + 启动 worker。已在运行 → RuntimeError。
    队列非空由调用方 (routes) 先查 (返回 409), 此处不重复查。
    """
    global _state, _snapshot, _policy, _stats, _stop_reason, _epoch, _worker_thread
    with _lock:
        if _state == "running":
            raise RuntimeError("background session already running")

        _snapshot = copy.deepcopy(payload)
        p = {"max_iterations": 0, "min_free_disk_gb": 10}
        if isinstance(policy, dict):
            if "max_iterations" in policy:
                try:
                    p["max_iterations"] = max(0, int(policy["max_iterations"]))
                except (TypeError, ValueError):
                    pass
            if "min_free_disk_gb" in policy:
                try:
                    p["min_free_disk_gb"] = max(0, int(policy["min_free_disk_gb"]))
                except (TypeError, ValueError):
                    pass
        _policy = p
        _stats = {"iteration": 0, "started_at": time.time(), "last_prompt_id": ""}
        _stop_reason = None
        _epoch += 1
        my_epoch = _epoch
        _state = "running"

        _worker_thread = threading.Thread(
            target=_worker_loop, args=(my_epoch,),
            name="bg-run-worker", daemon=True,
        )
        _worker_thread.start()


def stop_session() -> None:
    """
    三步顺序 (顺序不能反):
      1. epoch += 1 + state=idle + stop_reason={code:user_stopped,...}
         (让 worker 退出循环; worker 不会再提交)
      2. POST /interrupt  (停止当前 ComfyUI 动作)
      3. 清残留队列 (POST /queue clear)
    幂等: 不在 running 时整体退化为无操作。
    ★ 不能在 idle 时也 interrupt/clear —— 那会打断用户手动发起的生成并清空其队列。
      陈旧标签页上残留的「停止」按钮正是这种场景。
    """
    global _state, _stop_reason, _epoch
    was_running = False
    with _lock:
        if _state == "running":
            was_running = True
            _state = "idle"
            # ★ 手动停止不写 stop_reason —— 本来就是用户自己点的, 不需要浮动条
            # 再报一次「已停止」还要他点「知道了」。点停止的那一端弹个 toast 即可。
            _stop_reason = None
            _epoch += 1
    if not was_running:
        return
    _interrupt_comfyui()
    _clear_queue()
    # ★ 不 join worker 线程。stop_session 跑在 Flask 请求线程里, 而 worker 可能正卡在
    #   submit_generation 的 requests.post(timeout=30) 上 —— join 会让「停止」按钮
    #   最长无响应 5 秒, 却换不来任何东西: epoch 已经变了, worker 返回后自己会做
    #   interrupt + queue/delete 补刀, 最终一致由 epoch 保证, 不依赖这里等它退出。


def dismiss_stop_reason() -> None:
    """清除 stop_reason。幂等 (已为 None 时无操作)。"""
    global _stop_reason
    with _lock:
        _stop_reason = None


def snapshot_status() -> dict:
    """
    状态对象 (四个接口统一返回)。字段名一字不差, 没有 images 字段。
    """
    with _lock:
        return {
            "state": _state,
            "iteration": _stats.get("iteration", 0),
            "max_iterations": _policy.get("max_iterations", 0),
            "started_at": _stats.get("started_at", 0.0),
            "stop_reason": (copy.deepcopy(_stop_reason)
                            if _stop_reason is not None else None),
        }


def is_running() -> bool:
    """供 /api/generate/submit 硬闸与 interrupt 联动查询"""
    with _lock:
        return _state == "running"


def is_queue_busy() -> bool:
    """供 start 路由查队列是否非空 (队列非空 → 409)"""
    return _queue_busy()


def get_last_prompt_id() -> str:
    """测试钩子"""
    with _lock:
        return _stats.get("last_prompt_id", "")


def _reset_for_test() -> None:
    """测试专用: 清空全部单例状态 (不触碰 ComfyUI)"""
    global _state, _snapshot, _policy, _stats, _stop_reason, _epoch, _worker_thread
    with _lock:
        _state = "idle"
        _snapshot = None
        _policy = {"max_iterations": 0, "min_free_disk_gb": 10}
        _stats = {"iteration": 0, "started_at": 0.0, "last_prompt_id": ""}
        _stop_reason = None
        _epoch = 0
        _worker_thread = None
