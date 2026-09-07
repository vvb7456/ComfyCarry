"""
ComfyCarry — SSH 管理路由

管理容器 sshd 服务、公钥、Root 密码

- /api/ssh/status        — SSH 状态概览
- /api/ssh/keys          — 公钥列表 / 添加 / 删除
- /api/ssh/password-follow — SSH 密码跟随面板密码 开关 (spec §5.1)
- /api/ssh/start         — 启动 sshd
- /api/ssh/stop          — 停止 sshd
- /api/ssh/restart       — 重启 sshd
- /api/ssh/logs          — 历史日志
- /api/ssh/logs/stream   — SSE 实时日志流
"""

import logging
import os
import re
import subprocess
import tempfile
import time

from flask import Blueprint, Response, jsonify, request

from .. import config as cfg
from ..config import _get_config, _set_config

log = logging.getLogger("ssh")

bp = Blueprint("ssh", __name__)

AUTHORIZED_KEYS_FILE = os.path.expanduser("~/.ssh/authorized_keys")
SSHD_CONFIG_FILE = "/etc/ssh/sshd_config"
SSHD_LOG_FILE = "/workspace/sshd.log"


# ====================================================================
# 响应文案 —— 一律 key + params, 由前端翻译 (i18n/locales/*/ssh.json)
#
# /api/ssh/* 的唯一消费方是面板前端, 所以这里不再回传中文成品文案:
# 回传中文的话英文 locale 下 toast 里会直接冒出中文。契约与 sync 路由的
# _err 完全一致, 前端 apiErrorText() / t() 负责渲染。前端缺条目时会原样
# 显示 key, 开发期一眼可见。
# ====================================================================
def _err(key: str, status: int = 400, /, *, _extra: dict | None = None, **params):
    """错误响应。前端按 `ssh.err.<key>` 翻译; _extra 是响应体的附加顶层字段。

    形参位置化 (`/`): 插值参数里有 key / status 这种名字, 不然会和
    函数自己的形参撞车。
    `_extra` 反过来只能用关键字传 (`*` 右边): 它要是位置化, 关键字写法会被
    `**params` 静默吞掉, 顶层字段丢失。
    """
    body = {"error_key": f"ssh.err.{key}", "error_params": params}
    if _extra:
        body.update(_extra)
    return jsonify(body), status


def _ok(key: str, /, **extra):
    """成功响应。前端按 `ssh.msg.<key>` 翻译 message_key。"""
    body = {"ok": True, "message_key": f"ssh.msg.{key}"}
    params = extra.pop("params", None)
    if params:
        body["message_params"] = params
    body.update(extra)
    return jsonify(body)


def restore_ssh_config():
    """
    Dashboard 启动时从 .dashboard_env 恢复 SSH 配置。
    - 恢复 ssh_keys → authorized_keys
    - 按 ssh_pw_follow 语义恢复密码状态 (spec §5.1):
        follow=true  → root 密码同步为当前面板密码 + 密码认证开启
        follow=false → 密码认证关闭 (公钥 root 登录不受影响)
    """
    # ── 恢复公钥 ──
    saved_keys = _get_config("ssh_keys", [])
    if saved_keys and isinstance(saved_keys, list):
        os.makedirs(os.path.dirname(AUTHORIZED_KEYS_FILE), exist_ok=True)
        # 加载已有 key (用 raw 字符串去重)
        existing_raw = set()
        try:
            with open(AUTHORIZED_KEYS_FILE, "r") as f:
                existing_raw = {l.strip() for l in f if l.strip() and not l.startswith("#")}
        except FileNotFoundError:
            pass

        # 只恢复有效且不重复的 key
        added = 0
        new_lines = []
        for key in saved_keys:
            key = key.strip()
            if not key or key in existing_raw:
                continue
            parsed = _parse_key_line(key, strict=True)
            if not parsed:
                log.warning(f"SSH: 跳过无效配置 key: {key[:50]}")
                continue
            new_lines.append(key)
            existing_raw.add(key)
            added += 1

        if new_lines:
            # 镜像预置的 key 可能没有末尾换行, 直接 append 会与之粘成一行 (两个 key 一起失效)
            _ensure_trailing_newline(AUTHORIZED_KEYS_FILE)
            with open(AUTHORIZED_KEYS_FILE, "a") as f:
                for line in new_lines:
                    f.write(line + "\n")
            os.chmod(AUTHORIZED_KEYS_FILE, 0o600)
            log.info(f"SSH: 从配置恢复 {added} 个公钥")

        # 清理 .dashboard_env 中的无效 key
        valid_saved = [k for k in saved_keys if _parse_key_line(k.strip(), strict=True)]
        if len(valid_saved) < len(saved_keys):
            _set_config("ssh_keys", valid_saved)
            log.info(f"SSH: 清理了 {len(saved_keys) - len(valid_saved)} 个无效配置 key")

    # ── 恢复密码跟随状态 ──
    # ssh_pw_follow 是三态: None(从未配置) / True / False。仅当显式设置过开关
    # 才动 sshd_config —— 全新实例保持镜像默认配置, 避免把从未配置过 SSH 的
    # 容器默认密码登录给关掉。
    follow_raw = _get_config("ssh_pw_follow", None)
    pw_applied = False
    if follow_raw is not None:
        if bool(follow_raw):
            # 跟随模式: root 密码 = 当前面板密码 (启动时加载值; 运行期改密由
            # settings.py 的改密钩子即时同步)
            if not cfg.DASHBOARD_PASSWORD:
                log.warning("SSH: 面板密码为空, 跳过 chpasswd (跟随模式)")
            elif chpasswd_root(cfg.DASHBOARD_PASSWORD):
                log.info("SSH: root 密码已同步面板密码 (跟随模式)")
            else:
                log.warning("SSH: chpasswd 同步面板密码失败 (跟随模式)")
            _set_sshd_password_auth(True)
        else:
            # 非跟随: 确保密码登录关闭 (PermitRootLogin=prohibit-password,
            # 公钥 root 登录不受影响)
            _set_sshd_password_auth(False)
        pw_applied = True

    # ── 重启 sshd 以应用配置 (使用 -E 日志) ──
    if saved_keys or pw_applied:
        _do_restart_sshd()
        log.info("SSH: 已重启 sshd 以应用恢复的配置")


# ── 工具函数 ──────────────────────────────────────────────────

def _run(cmd, timeout=5):
    """运行 shell 命令, 返回 (returncode, stdout, stderr)"""
    try:
        r = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except Exception as e:
        return -1, "", str(e)


def chpasswd_root(password):
    """用 chpasswd 设置 root 密码, 返回是否成功。供本模块与 settings.py 改密钩子复用。

    必须 argv 列表 + stdin 传密码, 不得走 shell 拼接: 旧实现 f-string 拼
    `echo 'root:{pw}' | chpasswd`, 密码含单引号/反引号/$ 时会被 shell 解释,
    轻则设置失败重则注入执行。列表形式 + input= 让密码完全不过 shell。
    """
    try:
        r = subprocess.run(
            ["chpasswd"],
            input=f"root:{password}",
            text=True,
            capture_output=True,
            timeout=5,
        )
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError) as e:
        log.warning(f"SSH: chpasswd 执行失败: {e}")
        return False


def _sshd_running():
    """检查 sshd listener 是否运行, 返回 (running, pid)"""
    for proc in _list_sshd_processes():
        if "Z" in proc["stat"]:
            continue
        if "[listener]" in proc["args"]:
            return True, proc["pid"]

    # 兜底: 只要存在非僵尸 sshd 进程, 也视为运行中
    for proc in _list_sshd_processes():
        if "Z" not in proc["stat"]:
            return True, proc["pid"]

    return False, None


def _list_sshd_processes():
    """列出 sshd 进程, 返回 [{pid, stat, args}, ...]"""
    code, out, _ = _run("ps -o pid=,stat=,args= -C sshd", timeout=3)
    if code != 0 or not out:
        return []

    procs = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        procs.append({
            "pid": pid,
            "stat": parts[1],
            "args": parts[2],
        })
    return procs


def _active_sshd_pids():
    """返回所有非僵尸 sshd 进程 PID"""
    return [proc["pid"] for proc in _list_sshd_processes() if "Z" not in proc["stat"]]


def _stop_sshd():
    """停止所有非僵尸 sshd 进程, 返回是否已停止"""
    pids = _active_sshd_pids()
    if not pids:
        return True

    _run("kill " + " ".join(str(pid) for pid in pids), timeout=3)
    time.sleep(0.5)

    # 若 listener 仍在, 再强制一次
    still_running, _ = _sshd_running()
    if still_running:
        pids = _active_sshd_pids()
        if pids:
            _run("kill -9 " + " ".join(str(pid) for pid in pids), timeout=3)
            time.sleep(0.3)

    still_running, _ = _sshd_running()
    return not still_running


def _active_connections():
    """SSH 活跃连接数"""
    # 计算 sport = 22 的 ESTABLISHED 连接
    code, out, _ = _run(
        "ss -tn state established '( sport = :22 )' | tail -n +2 | wc -l"
    )
    if code == 0:
        try:
            return int(out)
        except ValueError:
            pass
    return 0


def _parse_sshd_config():
    """解析 sshd_config 中的关键设置"""
    result = {
        "password_auth": True,  # 默认 yes
        "root_login": True,     # 默认 yes
    }
    try:
        with open(SSHD_CONFIG_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or not line:
                    continue
                # PasswordAuthentication
                m = re.match(r"PasswordAuthentication\s+(yes|no)", line, re.I)
                if m:
                    result["password_auth"] = m.group(1).lower() == "yes"
                # PermitRootLogin
                m = re.match(r"PermitRootLogin\s+(\S+)", line, re.I)
                if m:
                    val = m.group(1).lower()
                    result["root_login"] = val in ("yes", "prohibit-password",
                                                   "without-password", "forced-commands-only")
    except FileNotFoundError:
        pass
    return result


def _password_set():
    """检查 root 是否设置了密码"""
    try:
        with open("/etc/shadow", "r") as f:
            for line in f:
                if line.startswith("root:"):
                    parts = line.split(":")
                    pw_hash = parts[1] if len(parts) > 1 else ""
                    # *、!、!! 或空 = 未设置
                    return pw_hash not in ("*", "!", "!!", "")
    except PermissionError:
        # 尝试通过 passwd -S 命令
        code, out, _ = _run("passwd -S root 2>/dev/null")
        if code == 0:
            # 输出格式: root P 2024-01-01 ...  (P=有密码, L=锁定, NP=无密码)
            parts = out.split()
            if len(parts) >= 2:
                return parts[1] == "P"
    return False


def _get_key_fingerprint(key_line):
    """计算 SSH 公钥的指纹"""
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".pub", delete=False) as f:
            f.write(key_line.strip() + "\n")
            f.flush()
            code, out, _ = _run(f"ssh-keygen -lf {f.name}")
            os.unlink(f.name)
            if code == 0 and out:
                # 格式: 256 SHA256:xxxx comment (ED25519)
                parts = out.split()
                if len(parts) >= 2:
                    return parts[1]  # SHA256:...
    except Exception:
        pass
    return ""


def _parse_key_line(line, *, strict=False):
    """解析一行 authorized_keys, 返回 key 信息 dict 或 None.

    Args:
        strict: True 时要求 ssh-keygen 能计算出有效 fingerprint,
                否则返回 None (拒绝 base64 无效的 key).
    """
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    parts = line.split(None, 2)
    if len(parts) < 2:
        return None
    key_type = parts[0]
    # 合法的 key 类型前缀
    valid_types = ("ssh-rsa", "ssh-ed25519", "ssh-dss", "ecdsa-sha2-",
                   "sk-ssh-ed25519", "sk-ecdsa-sha2-")
    if not any(key_type.startswith(t) for t in valid_types):
        return None
    comment = parts[2] if len(parts) > 2 else ""
    fingerprint = _get_key_fingerprint(line)
    if strict and not fingerprint:
        return None
    return {
        "type": key_type,
        "fingerprint": fingerprint,
        "comment": comment,
        "raw": line,
    }


def _load_authorized_keys():
    """读取 authorized_keys, 返回 key 列表"""
    keys = []
    try:
        with open(AUTHORIZED_KEYS_FILE, "r") as f:
            for line in f:
                parsed = _parse_key_line(line)
                if parsed:
                    keys.append(parsed)
    except FileNotFoundError:
        pass
    return keys


def _identify_env_keys():
    """获取环境变量中的 SSH 公钥, 返回原始值集合"""
    env_keys = set()
    for var in ("SSH_PUBLIC_KEY", "PUBLIC_KEY"):
        val = os.environ.get(var, "").strip()
        if val:
            env_keys.add(val)
    return env_keys


def _mark_key_source(keys):
    """标记每个 key 的来源 (env / manual / config)"""
    env_keys = _identify_env_keys()
    # 从 .dashboard_env 中恢复的 keys
    config_keys_raw = _get_config("ssh_keys", [])
    config_key_set = set()
    if isinstance(config_keys_raw, list):
        config_key_set = set(config_keys_raw)

    for k in keys:
        raw = k["raw"]
        if raw in env_keys:
            k["source"] = "env"
        elif raw in config_key_set:
            k["source"] = "config"
        else:
            k["source"] = "manual"
    return keys


def _ensure_trailing_newline(path):
    """追加写入前, 确保文件以换行结尾。

    authorized_keys 每行一个 key, 以 append 方式加 key 时必须先确认原文件末尾有换行 ——
    否则新 key 会直接粘在最后一行尾部, 拼成一条畸形行, 导致**该行涉及的所有 key 全部失效**
    (sshd 认不出, ssh-keygen -lf 报 "not a public key file")。

    实测踩到过: 容器镜像预置的 key 无末尾换行, 面板 wizard 追加公钥后两个 key 一起作废。
    容器/镜像预置内容不由我们控制, 故追加方必须自己兜住。
    """
    try:
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            return
        with open(path, "rb") as f:
            f.seek(-1, os.SEEK_END)
            if f.read(1) != b"\n":
                with open(path, "ab") as af:
                    af.write(b"\n")
    except OSError:
        pass


def _save_keys_to_file(keys):
    """将 key 列表写入 authorized_keys"""
    os.makedirs(os.path.dirname(AUTHORIZED_KEYS_FILE), exist_ok=True)
    with open(AUTHORIZED_KEYS_FILE, "w") as f:
        for k in keys:
            f.write(k["raw"] + "\n")
    os.chmod(AUTHORIZED_KEYS_FILE, 0o600)


def _persist_keys_to_config(keys):
    """将当前所有 key 持久化到 .dashboard_env"""
    raw_list = [k["raw"] for k in keys]
    _set_config("ssh_keys", raw_list)


def _set_sshd_password_auth(enable):
    """修改 sshd_config 的 PasswordAuthentication 和 PermitRootLogin

    enable=True : PasswordAuthentication yes + PermitRootLogin yes (允许 root 密码登录)
    enable=False: PasswordAuthentication no + PermitRootLogin prohibit-password
                  —— 关闭密码登录但保留公钥 root 登录, PermitRootLogin 不能
                  一并设成 no, 否则无密码实例会被彻底锁死在 SSH 之外。
    """
    try:
        with open(SSHD_CONFIG_FILE, "r") as f:
            content = f.read()

        new_val = "yes" if enable else "no"

        # PasswordAuthentication
        content, count = re.subn(
            r"^#?\s*PasswordAuthentication\s+\S+",
            f"PasswordAuthentication {new_val}",
            content, flags=re.MULTILINE
        )
        if count == 0:
            content = content.rstrip() + f"\nPasswordAuthentication {new_val}\n"

        # PermitRootLogin — 开启跟随=允许 root 密码登录; 关闭=仅允许公钥登录
        root_val = "yes" if enable else "prohibit-password"
        content, count = re.subn(
            r"^#?\s*PermitRootLogin\s+\S+",
            f"PermitRootLogin {root_val}",
            content, flags=re.MULTILINE
        )
        if count == 0:
            content = content.rstrip() + f"\nPermitRootLogin {root_val}\n"

        with open(SSHD_CONFIG_FILE, "w") as f:
            f.write(content)
        return True
    except Exception:
        return False


def _do_restart_sshd():
    """重启 sshd 服务 (带日志文件输出)"""
    _stop_sshd()
    _run("mkdir -p /run/sshd", timeout=2)
    code, _, err = _run(f"/usr/sbin/sshd -E {SSHD_LOG_FILE}", timeout=5)
    return code == 0


def _apply_password_follow(enabled, *, force=False, password=None):
    """应用「SSH 密码跟随面板密码」开关 (spec §5.1)。

    /api/ssh/password-follow 端点、settings.py 导入配置与部署向导
    _step_ssh 共用本函数。

    返回 (ok, err, extra):
      ok=True  → err=None,
                 extra = {"sshd_restarted": bool, "keys_count": int}
      ok=False → err = {"error_key": str, "error_params": dict, "status": int}
                 (error_key 与 _err 约定一致, 前端按 ssh.err.<key> 翻译)

    enabled=True (开启跟随):
      chpasswd(面板密码) → PasswordAuthentication yes / PermitRootLogin yes
      → 重启 sshd → ssh_pw_follow=true。
      password 为 None 时用 cfg.DASHBOARD_PASSWORD; 部署向导调用时向导收集
      的新密码尚未写入 cfg (改密在 _step_start_services 末尾才执行), 由
      _step_ssh 显式传入。
    enabled=False (关闭密码登录):
      后端硬拦截 (安全边界必须在这里, 前端 confirm 只是 UX —— API 可被直接
      调用绕过): 无有效公钥且未 force → lockout_risk, 不做任何变更。
      执行 PasswordAuthentication no / PermitRootLogin prohibit-password
      (保留公钥 root 登录) → 重启 sshd → ssh_pw_follow=false。
    """
    if enabled:
        pw = password if password is not None else cfg.DASHBOARD_PASSWORD
        if not pw:
            return False, {"error_key": "password_not_set", "error_params": {},
                           "status": 400}, None
        if not chpasswd_root(pw):
            return False, {"error_key": "set_password_failed", "error_params": {},
                           "status": 500}, None
        _set_sshd_password_auth(True)
        restarted = _do_restart_sshd()
        _set_config("ssh_pw_follow", True)
        log.info("SSH: 密码跟随已开启 (root 密码同步面板密码)")
        return True, None, {
            "sshd_restarted": restarted,
            "keys_count": len(_load_authorized_keys()),
        }

    keys_count = len(_load_authorized_keys())
    if keys_count == 0 and not force:
        log.warning("SSH: 拒绝关闭密码登录: 无有效公钥且未 force (lockout 防护)")
        return False, {"error_key": "lockout_risk", "error_params": {},
                       "status": 409}, {"keys_count": 0}
    _set_sshd_password_auth(False)
    restarted = _do_restart_sshd()
    _set_config("ssh_pw_follow", False)
    log.info("SSH: 密码登录已关闭 (公钥登录不受影响)")
    return True, None, {
        "sshd_restarted": restarted,
        "keys_count": keys_count,
    }


# ── API 端点 ──────────────────────────────────────────────────

@bp.route("/api/ssh/status")
def ssh_status():
    """SSH 服务状态概览"""
    running, pid = _sshd_running()
    sshd_cfg = _parse_sshd_config()

    return jsonify({
        "running": running,
        "pid": pid,
        "port": 22,
        "active_connections": _active_connections(),
        "password_auth": sshd_cfg["password_auth"],
        "root_login": sshd_cfg["root_login"],
        "password_set": _password_set(),
        # SSH 密码跟随开关 (spec §5.1), 前端开关初始态用 pw_follow + keys_count
        "pw_follow": bool(_get_config("ssh_pw_follow", False)),
        "keys_count": len(_load_authorized_keys()),
    })


@bp.route("/api/ssh/keys", methods=["GET"])
def ssh_keys_list():
    """列出所有公钥"""
    keys = _load_authorized_keys()
    keys = _mark_key_source(keys)
    # 不返回 raw (太长), 用 fingerprint 标识
    safe_keys = []
    for k in keys:
        safe_keys.append({
            "type": k["type"],
            "fingerprint": k["fingerprint"],
            "comment": k["comment"],
            "source": k["source"],
            "valid": bool(k["fingerprint"]),
        })
    return jsonify({"keys": safe_keys})


@bp.route("/api/ssh/keys", methods=["POST"])
def ssh_keys_add():
    """添加公钥 (支持多行)"""
    data = request.get_json(silent=True) or {}
    raw_input = data.get("keys", "").strip()
    if not raw_input:
        return _err("no_key")

    existing = _load_authorized_keys()
    existing_fps = {k["fingerprint"] for k in existing if k["fingerprint"]}

    added = 0
    errors = []
    for line in raw_input.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parsed = _parse_key_line(line, strict=True)
        if not parsed:
            errors.append(f"无效的公钥: {line[:50]}...")
            continue
        if parsed["fingerprint"] in existing_fps:
            errors.append(f"已存在: {parsed['fingerprint']}")
            continue
        existing.append(parsed)
        existing_fps.add(parsed["fingerprint"])
        added += 1

    if added > 0:
        _save_keys_to_file(existing)
        _persist_keys_to_config(existing)

    # 重新加载并标记来源
    keys = _load_authorized_keys()
    keys = _mark_key_source(keys)
    safe_keys = [{
        "type": k["type"], "fingerprint": k["fingerprint"],
        "comment": k["comment"], "source": k["source"],
    } for k in keys]

    result = {"keys": safe_keys, "added": added}
    if errors:
        result["errors"] = errors
    return jsonify(result)


@bp.route("/api/ssh/keys", methods=["DELETE"])
def ssh_keys_delete():
    """删除指定公钥 (按 fingerprint)"""
    data = request.get_json(silent=True) or {}
    fingerprint = data.get("fingerprint", "").strip()
    if not fingerprint:
        return _err("no_fingerprint")

    keys = _load_authorized_keys()
    original_count = len(keys)
    keys = [k for k in keys if k["fingerprint"] != fingerprint]

    if len(keys) == original_count:
        return _err("key_not_found", 404)

    _save_keys_to_file(keys)
    _persist_keys_to_config(keys)

    # 重新加载
    keys = _load_authorized_keys()
    keys = _mark_key_source(keys)
    safe_keys = [{
        "type": k["type"], "fingerprint": k["fingerprint"],
        "comment": k["comment"], "source": k["source"],
    } for k in keys]

    return jsonify({"ok": True, "keys": safe_keys, "deleted": True})


@bp.route("/api/ssh/password-follow", methods=["POST"])
def ssh_pw_follow_toggle():
    """SSH 密码跟随面板密码 开关 (spec §5.1)。

    请求体: {"enabled": bool, "force"?: bool}
    force 仅在 enabled=false 时有意义: 确认无公钥锁死 SSH 的风险。
    """
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("enabled"))
    force = bool(data.get("force"))

    ok, err, extra = _apply_password_follow(enabled, force=force)
    if not ok:
        return _err(err["error_key"], err["status"], **err["error_params"])

    return jsonify({
        "ok": True,
        "password_auth_enabled": enabled,
        "sshd_restarted": extra["sshd_restarted"],
        "keys_count": extra["keys_count"],
    })


@bp.route("/api/ssh/start", methods=["POST"])
def ssh_start():
    """启动 sshd"""
    running, _ = _sshd_running()
    if running:
        return _ok("already_running")

    _run("mkdir -p /run/sshd", timeout=2)
    code, _, err = _run(f"/usr/sbin/sshd -E {SSHD_LOG_FILE}", timeout=5)
    if code != 0:
        return _err("start_failed", 500, detail=err)

    running, pid = _sshd_running()
    return jsonify({"ok": True, "running": running, "pid": pid})


@bp.route("/api/ssh/stop", methods=["POST"])
def ssh_stop():
    """停止 sshd"""
    running, _ = _sshd_running()
    if not running:
        return _ok("not_running")

    stopped = _stop_sshd()
    if not stopped:
        return _err("stop_failed", 500)

    return jsonify({"ok": True, "running": False})


@bp.route("/api/ssh/restart", methods=["POST"])
def ssh_restart():
    """重启 sshd"""
    ok = _do_restart_sshd()
    if not ok:
        return _err("restart_failed", 500)

    running, pid = _sshd_running()
    return jsonify({"ok": True, "running": running, "pid": pid})


@bp.route("/api/ssh/logs")
def ssh_logs():
    """获取 sshd 日志 history (行号游标分页, 读 /workspace/sshd.log)"""
    from ..services.log_service import read_history
    try:
        lines = int(request.args.get("lines", "200"))
    except (ValueError, TypeError):
        lines = 200
    before = request.args.get("before")
    before = int(before) if before and before.isdigit() else None
    return jsonify(read_history(SSHD_LOG_FILE, before=before, lines=lines))


@bp.route("/api/ssh/logs/stream")
def ssh_logs_stream():
    """SSE - sshd 日志实时流 (tail -f /workspace/sshd.log)"""
    from ..services.log_service import stream_tail
    return Response(stream_tail(SSHD_LOG_FILE), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})
