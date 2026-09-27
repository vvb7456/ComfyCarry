"""最小就绪接口 (托管开通交付验收用)。

GET /api/provisioning/readiness — 200/503 + 三字段 (ready/wizard_available/
instance_id), 供管理端经 tunnel_urls.dashboard 探活。契约样本
(protocol-v1.json readiness 节) 定义字段与状态码, 上报依赖
PROVISIONING_TOKEN + MANAGEMENT_API_URL + PROVISIONING_INSTANCE_ID 由
services/management_agent (主控后续模块) 统一接线; 本模块只读环境变量判定。
"""

import os
import re
import uuid

from flask import Blueprint, jsonify

from .. import config

bp = Blueprint("provisioning", __name__)

_INSTANCE_ID_ENV = "PROVISIONING_INSTANCE_ID"


def _instance_id() -> str | None:
    raw = (os.environ.get(_INSTANCE_ID_ENV) or "").strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        return None


def _reporting_env_complete() -> bool:
    return all(
        (os.environ.get(name) or "").strip()
        for name in ("PROVISIONING_TOKEN", "MANAGEMENT_API_URL")
    )


def _identity_valid() -> bool:
    return _instance_id() is not None


def _template_usable(name: str) -> bool:
    """实际下发的模板存在且其声明的全部 /assets 引用文件真实存在。

    dist 模板经 Vite 哈希文件名引用 (frontend.py 按文件名直接下发), 任一
    缺失即入口 JS/CSS 无法加载, "启动 UI 可用"不成立。
    """
    from ..routes.frontend import DIST_DIR

    dist = DIST_DIR
    template = dist / name
    if not template.is_file():
        return False
    try:
        html = template.read_text(encoding="utf-8")
    except OSError:
        return False
    refs = re.findall(r'(?:src|href)="(/assets/[^"?]+)"', html)
    if not refs:
        return False
    return all((dist / ref.lstrip("/")).is_file() for ref in refs)


def _entry_ui_usable() -> bool:
    """启动 UI 可交付 = index 路由真实可响应 200。

    部署前 index 下发 wizard.html (向导入口), 部署后下发 index.html (主面
    板) —— wizard_available 的产品含义是"可交付启动 UI 可用"而非"必须仍
    处于向导" (主控场景 D-07: 客户未完成向导不得撤销交付), 因此按当前
    setup 阶段校验 index 实际会下发的那个模板, 并真实调用 index 路由。
    """
    from ..routes.frontend import index

    template = "wizard.html" if not config._is_setup_complete() else "index.html"
    if not _template_usable(template):
        return False
    try:
        resp = index()
        return getattr(resp, "status_code", 0) == 200
    except Exception:
        return False


def _default_ready_dependency() -> dict:
    wizard_available = _entry_ui_usable()
    return {
        "ready": _reporting_env_complete() and _identity_valid() and wizard_available,
        "wizard_available": wizard_available,
    }


_ready_dependency = _default_ready_dependency


def set_ready_dependency(fn) -> None:
    """注入就绪依赖: fn() -> {"ready": bool, "wizard_available": bool}。

    测试接点 (protocol-v1 client_targets.readiness_dependency_seam);
    生产路径用默认实现。
    """
    global _ready_dependency
    _ready_dependency = fn


def clear_ready_dependency() -> None:
    global _ready_dependency
    _ready_dependency = _default_ready_dependency


@bp.route("/api/provisioning/readiness", methods=["GET"])
def readiness():
    state = _ready_dependency() or {}
    ready = bool(state.get("ready"))
    wizard_available = bool(state.get("wizard_available"))
    if ready and not wizard_available:
        # 就绪以入口 UI 可用为前提, 不输出依赖注入未保证的自洽组合
        ready = False
    body = {
        "ready": ready,
        "wizard_available": wizard_available,
        "instance_id": _instance_id(),
    }
    return jsonify(body), (200 if ready else 503)