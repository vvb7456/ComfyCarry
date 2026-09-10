"""
ComfyCarry — Setup Wizard 路由

- /api/setup/state           — 向导状态
- /api/setup/wizard_remote   — 向导 remote 凭据 (创建/删除)
- /api/setup/deploy          — 提交部署计划并启动部署
- /api/setup/log_stream      — SSE 部署日志
"""

import json
import os
import threading
import time
from copy import deepcopy

from flask import Blueprint, Response, jsonify, request

from ..config import (
    DEFAULT_PLUGINS, SYNC_RULE_TEMPLATES, REMOTE_TYPE_DEFS,
    SETUP_STATE_FILE, _RCLONE_TOKEN_RE,
    _load_setup_state, _save_setup_state,
    get_config,
)
from ..services.deploy_engine import (
    start_deploy, get_deploy_thread, get_deploy_log_slice,
    _detect_gpu_info, _read_prebuilt_info,
)
from ..services import wizard_draft

bp = Blueprint("setup", __name__)
_deploy_submit_lock = threading.Lock()


# ====================================================================
# 响应文案 —— key + params, 前端按 `<prefix>.<key>` 翻译
# 默认 prefix 为 `setup.err`，deploy 端点保留 `wizard.err`
# ====================================================================
def _err(key: str, status: int = 400, /, *, prefix: str = "setup.err", _extra: dict | None = None, **params):
    """错误响应。前端按 `<prefix>.<key>` 翻译; _extra 是响应体的附加顶层字段。"""
    body = {"error_key": f"{prefix}.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


@bp.route("/api/setup/state")
def api_setup_state():
    """向导状态。无部署进行时, 各 config 字段仅用于 env 预填之外的只读展示;
    前端刷新即从 step 0 重来 (会话外无草稿), 只恢复部署状态机。

    例外: 部署失败会话的凭据计划 (进程没死时在内存, 死了在快照) 需要恢复,
    否则重试部署前 step3/4 无法工作。
    """
    state = _load_setup_state()
    deploy_in_progress = bool(state.get("deploy_started") and not state.get("deploy_completed"))
    # 刷新放弃未提交编辑；恢复时存储凭据和同步规则必须来自同一份计划。
    wizard_draft.reset(state.get("wizard_remotes") if deploy_in_progress else None)

    safe = {k: v for k, v in state.items()}
    safe["rclone_config_value"] = ""
    safe["wizard_remotes"] = _draft_safe()
    safe["plugins_available"] = DEFAULT_PLUGINS
    safe["gpu_info"] = _detect_gpu_info()
    safe["detected_image_type"] = "prebuilt" if _read_prebuilt_info() else "unsupported"
    safe["prebuilt_info"] = _read_prebuilt_info()

    env_vars = {}
    if os.environ.get("DASHBOARD_PASSWORD"):
        env_vars["password"] = os.environ["DASHBOARD_PASSWORD"]
    if os.environ.get("CF_API_TOKEN"):
        env_vars["cf_api_token"] = os.environ["CF_API_TOKEN"]
    if os.environ.get("CF_DOMAIN"):
        env_vars["cf_domain"] = os.environ["CF_DOMAIN"]
    if os.environ.get("CF_SUBDOMAIN"):
        env_vars["cf_subdomain"] = os.environ["CF_SUBDOMAIN"]
    if os.environ.get("CIVITAI_TOKEN"):
        env_vars["civitai_token"] = os.environ["CIVITAI_TOKEN"]
    if os.environ.get("PUBLIC_TUNNEL", "").lower() in ("1", "true"):
        env_vars["public_tunnel"] = True
    safe["env_vars"] = env_vars

    # 运行时 tunnel 状态 (bootstrap 或之前的部署已配置)
    active_tunnel = get_config("tunnel_mode", "")
    if active_tunnel:
        safe["active_tunnel_mode"] = active_tunnel
        if active_tunnel == "public":
            try:
                from ..services.public_tunnel import PublicTunnelClient
                client = PublicTunnelClient()
                safe["active_tunnel_urls"] = client.urls or {}
            except Exception:
                safe["active_tunnel_urls"] = {}

    safe["sync_templates"] = SYNC_RULE_TEMPLATES
    safe["remote_type_defs"] = REMOTE_TYPE_DEFS
    return jsonify(safe)


def _apply_deploy_plan(state, data):
    """部署计划快照: deploy 提交的 config 即唯一持久化时点 (无草稿, 刷新不保留)。

    wizard_remotes 从内存草稿合并, 按前端镜像过滤 (镜像为空 = 未完成的
    remote 一并放弃) —— token 不过前端, 只能由服务端草稿补齐。
    """
    # 保持导入配置但只修改其他字段时，前端没有原始凭据；明确切换为
    # manual/skip 时则不保留。直接重试不经过此函数。
    retained_conf = state.get("rclone_config_value", "") if (
        data.get("rclone_config_method") == "base64"
        and state.get("rclone_config_method") == "base64"
        and not data.get("rclone_config_value")
    ) else ""
    plan_keys = [
        "password",
        "tunnel_mode", "public_tunnel_subdomain",
        "cf_api_token", "cf_domain", "cf_subdomain",
        "rclone_config_method", "rclone_config_value",
        "civitai_token", "plugins",
        "install_fa2", "install_sa2",
        "wizard_sync_rules",
        "_imported_sync_rules", "_imported_sync_rules_count",
        "ssh_keys", "ssh_pw_follow",
        "llm_provider", "llm_api_key", "llm_base_url", "llm_model",
    ]
    for k in plan_keys:
        if k in data:
            state[k] = data[k]
        else:
            state.pop(k, None)
    if retained_conf:
        state["rclone_config_value"] = retained_conf

    mirror = data.get("wizard_remotes") or []
    mirror_names = {r.get("name") for r in mirror if isinstance(r, dict)}
    state["wizard_remotes"] = deepcopy(wizard_draft.mirror_names([n for n in mirror_names if n]))


def _persist_llm_config(data):
    """LLM 配置同步进 dashboard env"""
    if data.get("llm_provider") or data.get("llm_api_key"):
        from ..config import get_config, set_config
        if data.get("llm_provider"):
            set_config("llm_provider", data["llm_provider"])
        if data.get("llm_api_key"):
            set_config("llm_api_key", data["llm_api_key"])
        if "llm_base_url" in data:
            set_config("llm_base_url", data["llm_base_url"])
        if data.get("llm_model"):
            set_config("llm_model", data["llm_model"])
        # Per-provider key persistence
        provider = data.get("llm_provider", "")
        api_key = data.get("llm_api_key", "")
        if provider and api_key:
            keys = get_config("llm_provider_keys", {})
            keys[provider] = {
                "api_key": api_key,
                "model": data.get("llm_model", ""),
                "base_url": data.get("llm_base_url", ""),
            }
            set_config("llm_provider_keys", keys)


def _draft_safe() -> list[dict]:
    """草稿的前端安全投影: 剥离 params (含 OAuth token / access key),
    仅返回名称、类型及恢复路径/驱动器选择所需的非凭据信息。"""
    out = []
    remotes = wizard_draft.get_remotes()
    for r in remotes:
        if not isinstance(r, dict):
            continue
        entry = {"name": r.get("name", ""), "type": r.get("type", "")}
        for key in ("bucket", "drive_id", "drive_type", "team_drive"):
            value = (r.get("params") or {}).get(key)
            if value:
                entry[key] = str(value)
        out.append(entry)
    return out


@bp.route("/api/setup/wizard_remote", methods=["POST"])
def api_setup_wizard_remote():
    """保存向导配置的远程存储。

    草稿编辑不覆盖已提交的部署快照；source_name 用于复用已有连接凭据。
    """
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    rtype = (data.get("type") or "").strip()
    params = data.get("params") or {}
    overwrite = bool(data.get("overwrite"))
    if not isinstance(params, dict):
        params = {}

    if not name or not rtype:
        return _err("name_type_required", 400)
    if not _RCLONE_TOKEN_RE.match(name):
        return _err("remote_name_invalid", 400)
    if not _RCLONE_TOKEN_RE.match(rtype) or rtype not in REMOTE_TYPE_DEFS:
        return _err("remote_type_invalid", 400)

    existing = wizard_draft.find_remote(name)
    if existing and not overwrite:
        return _err("wizard_remote_exists", 400, name=name)

    tdef = REMOTE_TYPE_DEFS.get(rtype, {})
    source_name = (data.get("source_name") or "").strip()
    source = wizard_draft.find_remote(source_name) if source_name else None
    if source_name:
        if not source or source.get("type") != rtype:
            return _err("wizard_remote_source_missing", 409)
        params = {**(source.get("params") or {}), **params}
        params = {k: v for k, v in params.items() if v != ""}
    oauth_used = bool(tdef.get("oauth") and not source_name)
    if oauth_used:
        from .sync import _oauth_session, _oauth_lock, _oauth_check_timeout, clear_oauth_session
        with _oauth_lock:
            _oauth_check_timeout()
            sess = _oauth_session
            phase = sess.get("phase")
            sess_type = sess.get("remote_type")
            token = sess.get("token")
            client_id = sess.get("client_id")
            client_secret = sess.get("client_secret")

        if phase != "done" or sess_type != rtype or not token:
            return _err("oauth_not_ready", 409)

        params = dict(params)
        params["token"] = token
        if client_id:
            params["client_id"] = client_id
        if client_secret:
            params["client_secret"] = client_secret
    else:
        params = dict(params)

    wizard_draft.upsert_remote({
        "name": name,
        "type": rtype,
        "params": params,
    })
    if oauth_used:
        clear_oauth_session()

    return jsonify({"ok": True, "wizard_remotes": _draft_safe()})


@bp.route("/api/setup/wizard_remote/delete", methods=["POST"])
def api_setup_wizard_remote_delete():
    """删除草稿中的存储；已提交的部署计划保持不变。"""
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return _err("name_type_required", 400)

    wizard_draft.remove_remote(name)
    # 幂等: name 不存在也返回剩余列表, 多标签页/本地镜像偏差不报错
    return jsonify({"ok": True, "wizard_remotes": _draft_safe()})


@bp.route("/api/setup/deploy", methods=["POST"])
def api_setup_deploy():
    data = request.get_json(force=True) or {}
    mode = data.get("mode", "normal")
    if mode not in ("normal", "retry"):
        return _err("deploy_mode_invalid", 400, prefix="wizard.err")

    # 先判定运行态，再读写快照。这样重复点击 retry 不会先把旧部署计划清空
    # 或重置其步骤进度。
    with _deploy_submit_lock:
        deploy_thread = get_deploy_thread()
        if deploy_thread and deploy_thread.is_alive():
            return _err("deploy_already_running", 409, prefix="wizard.err")

        state = _load_setup_state()
        if mode == "retry":
            # retry 的请求体刻意不携带前端 config；服务端快照是唯一输入，
            # 以免刷新后空值/安全投影覆盖凭据计划。
            if not (state.get("deploy_started") and not state.get("deploy_completed")):
                return _err("deploy_retry_unavailable", 409, prefix="wizard.err")
        else:
            _apply_deploy_plan(state, data)
            _persist_llm_config(data)
        state["deploy_started"] = True
        state["deploy_completed"] = False
        state["deploy_error"] = ""
        _save_setup_state(state)

        ok, msg = start_deploy(state)
        if not ok:
            return _err("deploy_already_running", 409, prefix="wizard.err")
        # 草稿保留至部署成功，失败后可直接返回修改；retry 只使用上面的快照。
        return jsonify({"ok": True, "message": msg})


@bp.route("/api/setup/log_stream")
def api_setup_log_stream():
    def generate():
        idx = 0
        while True:
            new_lines, total = get_deploy_log_slice(idx)
            idx = total
            for line in new_lines:
                yield f"data: {json.dumps(line, ensure_ascii=False)}\n\n"
            state = _load_setup_state()
            if state.get("deploy_completed"):
                # 确保剩余日志全部发完
                remaining, total2 = get_deploy_log_slice(idx)
                idx = total2
                for line in remaining:
                    yield f"data: {json.dumps(line, ensure_ascii=False)}\n\n"
                done_evt = {'type': 'done', 'success': True}
                # 附带 attention 安装警告 (如有)
                attn_warnings = state.get("attn_install_warnings", [])
                if attn_warnings:
                    done_evt["attn_warnings"] = attn_warnings
                yield f"data: {json.dumps(done_evt, ensure_ascii=False)}\n\n"
                break
            deploy_thread = get_deploy_thread()
            if not deploy_thread or not deploy_thread.is_alive():
                if not state.get("deploy_completed"):
                    error_msg = state.get("deploy_error") or "部署进程异常终止"
                    yield f"data: {json.dumps({'type': 'done', 'success': False, 'msg': error_msg}, ensure_ascii=False)}\n\n"
                break
            time.sleep(0.5)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})
