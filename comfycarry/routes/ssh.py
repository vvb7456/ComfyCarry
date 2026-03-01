"""
ComfyCarry — SSH 管理路由

管理容器 sshd 服务、公钥、Root 密码

- /api/ssh/status   — SSH 状态概览
- /api/ssh/keys     — 公钥列表 / 添加 / 删除
- /api/ssh/password — 设置 Root 密码
- /api/ssh/start    — 启动 sshd
- /api/ssh/stop     — 停止 sshd
- /api/ssh/restart  — 重启 sshd
- /api/ssh/logs      — 历史日志
- /api/ssh/logs/stream — SSE 实时日志流
"""

import json
import os
import re
import subprocess
import tempfile

from flask import Blueprint, Response, jsonify, request

from ..config import _get_config, _set_config

bp = Blueprint("ssh", __name__)

AUTHORIZED_KEYS_FILE = os.path.expanduser("~/.ssh/authorized_keys")
SSHD_CONFIG_FILE = "/etc/ssh/sshd_config"
SSHD_LOG_FILE = "/var/log/sshd.log"


def restore_ssh_config():
    """
    Dashboard 启动时从 .dashboard_env 恢复 SSH 配置。
    - 恢复 ssh_keys → authorized_keys
    - 恢复 ssh_password → chpasswd + PasswordAuthentication + PermitRootLogin
    """
    import logging
    log = logging.getLogger("ssh")

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

    # ── 恢复密码 ──
    saved_pw = _get_config("ssh_password", "")
    if saved_pw:
        code, _, err = _run(f"echo 'root:{saved_pw}' | chpasswd", timeout=5)
        if code == 0:
            _set_sshd_password_auth(True)
            log.info("SSH: 从配置恢复 root 密码 + 启用密码认证")
        else:
            log.warning(f"SSH: 恢复密码失败: {err}")

    # ── 重启 sshd 以应用配置 (使用 -E 日志) ──
    if saved_keys or saved_pw:
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


def _sshd_running():
    """检查 sshd 是否运行, 返回 (running, pid)"""
    code, out, _ = _run("pgrep -x sshd | head -1")
    if code == 0 and out:
        try:
            return True, int(out.splitlines()[0])
        except ValueError:
            return True, None
    return False, None


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
    """修改 sshd_config 的 PasswordAuthentication 和 PermitRootLogin"""
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

        # PermitRootLogin — 设置密码时需要允许 root 密码登录
        if enable:
            content, count = re.subn(
                r"^#?\s*PermitRootLogin\s+\S+",
                "PermitRootLogin yes",
                content, flags=re.MULTILINE
            )
            if count == 0:
                content = content.rstrip() + "\nPermitRootLogin yes\n"

        with open(SSHD_CONFIG_FILE, "w") as f:
            f.write(content)
        return True
    except Exception:
        return False


def _do_restart_sshd():
    """重启 sshd 服务 (带日志文件输出)"""
    _run("kill $(pgrep -x sshd) 2>/dev/null", timeout=3)
    _run("mkdir -p /run/sshd", timeout=2)
    code, _, err = _run(f"/usr/sbin/sshd -E {SSHD_LOG_FILE}", timeout=5)
    return code == 0


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
        "pw_sync": bool(_get_config("ssh_pw_sync", False)),
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
        return jsonify({"error": "未提供公钥"}), 400

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
        return jsonify({"error": "未指定 fingerprint"}), 400

    keys = _load_authorized_keys()
    original_count = len(keys)
    keys = [k for k in keys if k["fingerprint"] != fingerprint]

    if len(keys) == original_count:
        return jsonify({"error": "未找到匹配的公钥"}), 404

    _save_keys_to_file(keys)
    _persist_keys_to_config(keys)

    # 重新加载
    keys = _load_authorized_keys()
    keys = _mark_key_source(keys)
    safe_keys = [{
        "type": k["type"], "fingerprint": k["fingerprint"],
        "comment": k["comment"], "source": k["source"],
    } for k in keys]

    return jsonify({"keys": safe_keys, "deleted": True})


@bp.route("/api/ssh/password", methods=["POST"])
def ssh_set_password():
    """设置 Root 密码 (支持同步 ComfyCarry 密码)"""
    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    if not password:
        return jsonify({"error": "密码不能为空"}), 400

    # 同步模式: 使用 ComfyCarry Dashboard 密码
    is_sync = password == "_sync_dashboard_password_"
    if is_sync:
        password = _get_config("password", "")
        if not password:
            return jsonify({"error": "ComfyCarry 密码未设置，无法同步"}), 400

    if len(password) < 4:
        return jsonify({"error": "密码长度至少 4 位"}), 400

    # 设置密码
    code, _, err = _run(
        f"echo 'root:{password}' | chpasswd", timeout=5
    )
    if code != 0:
        return jsonify({"error": f"设置密码失败: {err}"}), 500

    # 持久化密码与同步标志到 .dashboard_env
    _set_config("ssh_password", password)
    _set_config("ssh_pw_sync", is_sync)

    # 确保 PasswordAuthentication + PermitRootLogin 为 yes，并重启 sshd
    _set_sshd_password_auth(True)
    _do_restart_sshd()

    return jsonify({
        "ok": True,
        "password_auth_enabled": True,
        "sshd_restarted": True,
    })


@bp.route("/api/ssh/start", methods=["POST"])
def ssh_start():
    """启动 sshd"""
    running, _ = _sshd_running()
    if running:
        return jsonify({"ok": True, "message": "sshd 已在运行"})

    _run("mkdir -p /run/sshd", timeout=2)
    code, _, err = _run(f"/usr/sbin/sshd -E {SSHD_LOG_FILE}", timeout=5)
    if code != 0:
        return jsonify({"error": f"启动失败: {err}"}), 500

    running, pid = _sshd_running()
    return jsonify({"ok": True, "running": running, "pid": pid})


@bp.route("/api/ssh/stop", methods=["POST"])
def ssh_stop():
    """停止 sshd"""
    running, _ = _sshd_running()
    if not running:
        return jsonify({"ok": True, "message": "sshd 未在运行"})

    code, _, err = _run("kill $(pgrep -x sshd) 2>/dev/null", timeout=5)
    return jsonify({"ok": True, "running": False})


@bp.route("/api/ssh/restart", methods=["POST"])
def ssh_restart():
    """重启 sshd"""
    ok = _do_restart_sshd()
    if not ok:
        return jsonify({"error": "重启 sshd 失败"}), 500

    running, pid = _sshd_running()
    return jsonify({"ok": True, "running": running, "pid": pid})


@bp.route("/api/ssh/logs")
def ssh_logs():
    """获取 sshd 日志 (最后 N 行)"""
    lines = min(int(request.args.get("lines", "200")), 2000)
    try:
        if not os.path.exists(SSHD_LOG_FILE):
            return jsonify({"logs": ""})
        code, out, _ = _run(f"tail -n {lines} {SSHD_LOG_FILE}", timeout=5)
        return jsonify({"logs": out if code == 0 else ""})
    except Exception as e:
        return jsonify({"logs": "", "error": str(e)})


@bp.route("/api/ssh/logs/stream")
def ssh_logs_stream():
    """SSE — sshd 日志实时流 (tail -f)"""
    def generate():
        proc = None
        try:
            # 确保日志文件存在
            if not os.path.exists(SSHD_LOG_FILE):
                with open(SSHD_LOG_FILE, "w"):
                    pass

            proc = subprocess.Popen(
                ["tail", "-n", "50", "-f", SSHD_LOG_FILE],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1
            )
            for line in iter(proc.stdout.readline, ''):
                if not line:
                    break
                line = line.rstrip('\n')
                if not line:
                    continue
                lvl = "info"
                if re.search(r'error|fatal|fail', line, re.I):
                    lvl = "error"
                elif re.search(r'warn|invalid|refused', line, re.I):
                    lvl = "warn"
                elif re.search(r'accepted|session opened|publickey', line, re.I):
                    lvl = "info"
                yield f"data: {json.dumps({'line': line, 'level': lvl}, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            pass
        finally:
            if proc:
                try:
                    proc.kill()
                    proc.stdout.close()
                    proc.wait(timeout=5)
                except Exception:
                    pass

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})
