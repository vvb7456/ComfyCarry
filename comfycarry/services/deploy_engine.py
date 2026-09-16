"""
ComfyCarry — 部署执行引擎

_run_deploy() 及其所有辅助函数。
在 Setup Wizard 触发部署后，由后台线程运行。
"""

import json
import os
import selectors
import shlex
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

DEPLOY_LOG_FILE = "/workspace/deploy.log"

from ..config import (
    COMFYUI_DIR, CONFIG_FILE, DEFAULT_PLUGINS,
    SYNC_RULE_TEMPLATES,
    SYNC_RULE_DIRECTIONS, SYNC_RULE_METHODS, SYNC_RULE_TRIGGERS,
    REMOTE_ROOT_DIR_KEY, join_remote_path,
    _load_setup_state, _save_setup_state,
    _save_dashboard_password,
    _RCLONE_TOKEN_RE,
    resolve_workspace_path, workspace_relative,
)
from .comfyui_params import DEFAULT_COMFYUI_ARGS
from .sync_engine import (
    _load_sync_rules, _save_sync_rules, _run_sync_rule,
    start_sync_worker,
)


# ── 共享状态 ─────────────────────────────────────────────────
_deploy_thread = None
_deploy_log_lines = []
_deploy_log_lock = threading.Lock()
_deploy_lock = threading.Lock()


def get_deploy_thread():
    return _deploy_thread


def get_deploy_log_slice(start):
    with _deploy_log_lock:
        return _deploy_log_lines[start:], len(_deploy_log_lines)


# ── 辅助函数 ─────────────────────────────────────────────────

def _is_cf_tunnel_online() -> bool:
    """检查当前活跃 cloudflared PM2 进程是否在线"""
    from .cf_runtime import active_cf_name
    name = active_cf_name()
    try:
        r = subprocess.run(
            "pm2 jlist 2>/dev/null", shell=True,
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            import json as _json
            for p in _json.loads(r.stdout):
                if p.get("name") == name:
                    return p.get("pm2_env", {}).get("status") == "online"
    except Exception:
        pass
    return False


def _detect_image_type():
    """检测镜像类型: prebuilt / unsupported"""
    if Path("/opt/.comfycarry-prebuilt").exists():
        return "prebuilt"
    return "unsupported"


def _read_prebuilt_info():
    """读取预构建镜像的元信息 (JSON)"""
    marker = Path("/opt/.comfycarry-prebuilt")
    if marker.exists():
        try:
            import json as _json
            return _json.loads(marker.read_text(encoding="utf-8"))
        except Exception:
            return {"version": "unknown"}
    return None


def _detect_python():
    """动态检测可用的 Python (优先 3.12, wheel 在 3.12 上编译验证)"""
    for cmd in ["python3.12", "python3", "python"]:
        if shutil.which(cmd):
            return cmd
    return "python3"


def _detect_gpu_info():
    """检测 GPU 信息"""
    info = {"name": "", "cuda_cap": "", "vram_gb": 0}
    py = _detect_python()
    try:
        # total_memory (torch >=2.9), 旧版本用 total_mem
        r = subprocess.run(
            f'{py} -c "import torch; d=torch.cuda.get_device_properties(0); '
            'mem=d.total_memory if hasattr(d,\'total_memory\') else d.total_mem; '
            'print(f\\"{d.name}|{d.major}.{d.minor}|{mem / 1073741824:.1f}\\")"',
            shell=True, capture_output=True, text=True, timeout=15
        )
        if r.returncode == 0 and "|" in r.stdout:
            parts = r.stdout.strip().split("|")
            info["name"] = parts[0]
            info["cuda_cap"] = parts[1]
            info["vram_gb"] = float(parts[2])
    except Exception:
        pass
    return info


def _deploy_log(msg, level="info"):
    """向 SSE 推送一行日志并写入文件"""
    now_str = datetime.now().strftime("%H:%M:%S")
    entry = {"type": "log", "level": level, "msg": msg,
             "time": now_str}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)
        
    try:
        with open(DEPLOY_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{now_str}] [{level.upper()}] {msg}\n")
    except Exception:
        pass


def _install_sa2(py, cuda_cap):
    """从预装 wheel 安装 SageAttention-2"""
    # 精确匹配
    wheel_map = {
        "8.0": "sm80", "8.6": "sm86", "8.9": "sm89",
        "9.0": "sm90", "10.0": "sm100", "12.0": "sm120"
    }
    wheel_suffix = wheel_map.get(cuda_cap)

    # 向下兼容: 同代未知小版本
    if not wheel_suffix and cuda_cap:
        try:
            major = int(cuda_cap.split(".")[0])
            minor = int(cuda_cap.split(".")[1]) if "." in cuda_cap else 0
        except (ValueError, IndexError):
            _deploy_log(f"无法解析 CUDA Cap: {cuda_cap}", "warn")
            return
        if major == 8:
            wheel_suffix = "sm80" if minor <= 0 else "sm86" if minor <= 6 else "sm89"
        elif major == 9:
            wheel_suffix = "sm90"
        elif major == 10:
            wheel_suffix = "sm100"
        elif major == 12:
            wheel_suffix = "sm120"

    if not wheel_suffix:
        _deploy_log(f"未知 GPU 架构 {cuda_cap}, 跳过 SA2", "warn")
        return

    whl_src = Path(f"/opt/wheels/sa2/sageattention-2.2.0-cp312-cp312-linux_x86_64_{wheel_suffix}.whl")
    if not whl_src.exists():
        _deploy_log(f"SA2 wheel 不存在: {whl_src}", "warn")
        return

    # wheel 文件名必须符合 PEP 427, 复制后改名为标准格式
    tmp_whl = "/tmp/sageattention-2.2.0-cp312-cp312-linux_x86_64.whl"
    shutil.copy2(str(whl_src), tmp_whl)

    _deploy_log(f"安装 SA2 ({wheel_suffix})...")
    _deploy_exec(f'{py} -m pip install "{tmp_whl}" --no-deps --no-cache-dir',
                 label=f"pip install SA2-{wheel_suffix}")
    _deploy_exec(f'rm -f "{tmp_whl}"')
    _deploy_log(f"SageAttention-2 ({wheel_suffix}) 安装完成", "success")


def _deploy_step(name):
    """标记一个部署步骤开始"""
    entry = {"type": "step", "name": name,
             "time": datetime.now().strftime("%H:%M:%S")}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)


def _deploy_exec(cmd, timeout=600, label="", env=None):
    """执行命令, 实时推送输出 (带真正的超时保护)。

    cmd 传 str 走 shell, 传 list 直接 execve —— 含用户输入的命令请传 list,
    shell 拼接下参数里的引号/分号会逃逸成命令注入。
    """
    if label:
        _deploy_log(f"$ {label}")
    proc = None
    try:
        proc = subprocess.Popen(
            cmd, shell=isinstance(cmd, str), stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, bufsize=1, env=env,
        )
        deadline = time.time() + timeout
        sel = selectors.DefaultSelector()
        sel.register(proc.stdout, selectors.EVENT_READ)
        timed_out = False
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                timed_out = True
                break
            events = sel.select(timeout=min(remaining, 2.0))
            if events:
                line = proc.stdout.readline()
                if not line:
                    break  # EOF
                line = line.rstrip()
                if line:
                    _deploy_log(line, "output")
            # 即使没有 events (sel 超时), 也检查进程是否已退出
            if proc.poll() is not None:
                # 读取残留输出
                for line in proc.stdout:
                    line = line.rstrip()
                    if line:
                        _deploy_log(line, "output")
                break
        sel.close()
        if timed_out:
            _deploy_log(f"命令超时 ({timeout}s), 强制终止", "warn")
            proc.kill()
            proc.stdout.close()
            proc.wait(timeout=5)
            return False
        proc.wait(timeout=10)
        if proc.returncode != 0:
            _deploy_log(f"命令退出码: {proc.returncode}", "warn")
        return proc.returncode == 0
    except Exception as e:
        _deploy_log(f"执行失败: {e}", "error")
        if proc:
            try:
                proc.kill()
                proc.stdout.close()
                proc.wait(timeout=5)
            except Exception:
                pass
        return False


def _step_done(step_key):
    """检查某个部署步骤是否在上次尝试中已完成"""
    state = _load_setup_state()
    return step_key in state.get("deploy_steps_completed", [])


def _mark_step_done(step_key):
    """标记步骤完成并持久化"""
    state = _load_setup_state()
    completed = state.get("deploy_steps_completed", [])
    if step_key not in completed:
        completed.append(step_key)
    state["deploy_steps_completed"] = completed
    _save_setup_state(state)


# ── 部署启动 ─────────────────────────────────────────────────

def start_deploy(state_dict):
    """启动部署线程 (由 setup 路由调用)"""
    global _deploy_thread
    with _deploy_lock:
        if _deploy_thread and _deploy_thread.is_alive():
            return False, "部署已在进行中"

        with _deploy_log_lock:
            _deploy_log_lines.clear()

        _deploy_thread = threading.Thread(
            target=_run_deploy, args=(dict(state_dict),), daemon=True
        )
        _deploy_thread.start()
    return True, "部署已启动"


# ── 主部署流程 ───────────────────────────────────────────────

def _run_deploy(config):
    """主部署流程 — 在后台线程运行"""
    from .. import config as cfg

    PY = _detect_python()
    _deploy_log(f"使用 Python: {PY}")

    try:
        # 清空/初始化部署日志文件
        try:
            with open(DEPLOY_LOG_FILE, "w", encoding="utf-8") as f:
                f.write(f"=== ComfyUI Deploy Process Started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        except Exception:
            pass

        _step_system_deps(config, PY)
        _step_tunnel(config)
        _step_rclone(config)
        _step_ssh(config)
        _step_check_pytorch(PY)
        _step_install_comfyui(PY)
        _step_accelerators(config, PY)
        _step_plugins(config, PY)
        _step_sync_assets(config)
        _step_start_services(config, cfg, PY)

    except Exception as e:
        _deploy_log(f"部署失败: {e}", "error")
        import traceback
        _deploy_log(traceback.format_exc(), "error")
        try:
            state = _load_setup_state()
            state["deploy_error"] = str(e)
            # deploy_started 必须保持 True —— 它是失败会话可恢复的标记:
            # wizard_draft 懒恢复 / setup.state 的失败判定都依赖它;
            # 置 False 会让快照凭据在重试时被空草稿覆盖 (凭据丢失)
            _save_setup_state(state)
        except Exception:
            pass


# ── 部署步骤 ─────────────────────────────────────────────────

def _step_system_deps(config, PY):
    """STEP 1: 系统依赖"""
    PIP = f"{PY} -m pip"
    if _step_done("system_deps"):
        _deploy_step("install_deps_skip")
    else:
        _deploy_step("install_deps")
        _deploy_log("正在安装系统依赖包...")
        _deploy_exec(
            "apt-get update -qq && "
            "apt-get install -y --no-install-recommends "
            "git git-lfs aria2 rclone jq curl ffmpeg libgl1 "
            "libglib2.0-0 libsm6 libxext6 build-essential",
            timeout=300, label="apt-get install"
        )
        py_bin = shutil.which(PY) or ""
        if py_bin:
            _deploy_exec(f'ln -sf "{py_bin}" /usr/local/bin/python && '
                         f'ln -sf "{py_bin}" /usr/bin/python || true')
        _deploy_exec(f'{PIP} install --upgrade pip setuptools packaging ninja -q',
                     label="pip upgrade")
        _mark_step_done("system_deps")


def _step_tunnel(config):
    """STEP 2: Cloudflare Tunnel"""
    import base64 as _b64
    tunnel_mode = config.get("tunnel_mode", "")
    cf_api_token = config.get("cf_api_token", "")
    cf_domain = config.get("cf_domain", "")

    if tunnel_mode == "public":
        _deploy_step("setup_public_tunnel")
        # 已由 bootstrap 或之前部署启用时跳过
        from comfycarry.config import get_config as _gc_rt
        if _gc_rt("tunnel_mode", "") == "public":
            _deploy_log("公共 Tunnel 已通过环境变量启用，跳过重复配置", "success")
            return
        try:
            from comfycarry.services.public_tunnel import PublicTunnelClient, PublicTunnelError
            from comfycarry.config import set_config as _sc
            # 保存自定义子域名 (register() 会读取)
            pub_subdomain = config.get("public_tunnel_subdomain", "")
            if pub_subdomain:
                _sc("public_tunnel_subdomain", pub_subdomain)
            client = PublicTunnelClient()
            result = client.register()
            _deploy_log(f"公共 Tunnel 已启用: {result.get('random_id', '?')}", "success")
            urls = result.get("urls", {})
            for name, url in urls.items():
                _deploy_log(f"  {name}: {url}")
        except PublicTunnelError as e:
            _deploy_log(f"公共 Tunnel 启用失败: {e}", "warn")
        except Exception as e:
            _deploy_log(f"公共 Tunnel 异常: {e}", "warn")
    elif cf_api_token and cf_domain:
        _deploy_step("setup_cf_tunnel")
        from comfycarry.services.tunnel_manager import TunnelManager, CFAPIError, get_default_services
        from comfycarry.config import set_config as _sc, get_config as _gc

        cf_subdomain = config.get("cf_subdomain", "") or _gc("cf_subdomain", "")
        if not cf_subdomain:
            _deploy_log("自定义隧道需要子域名 (CF_SUBDOMAIN)，已跳过隧道配置", "error")
            return
        mgr = TunnelManager(cf_api_token, cf_domain, cf_subdomain)

        try:
            ok, info = mgr.validate_token()
            if not ok:
                _deploy_log(f"CF Token 问题: {info['message']}", "warn")
            else:
                _deploy_log(f"CF 账户: {info.get('account_name', '?')}")

                # 构建服务列表: 默认 + 后缀覆盖 + 自定义
                raw_overrides = _gc("cf_suffix_overrides", "")
                raw_custom = _gc("cf_custom_services", "")
                suffix_overrides = {}
                custom_services = []
                try:
                    if raw_overrides:
                        suffix_overrides = json.loads(raw_overrides)
                    if raw_custom:
                        custom_services = json.loads(raw_custom)
                except Exception:
                    pass
                services = []
                for svc in get_default_services():
                    s = dict(svc)
                    orig = s.get("suffix", "")
                    if orig in suffix_overrides:
                        s["suffix"] = suffix_overrides[orig]
                    services.append(s)
                services.extend(custom_services)

                result = mgr.ensure(services)
                _deploy_log(f"Tunnel 已就绪: {mgr.subdomain}.{cf_domain}", "success")
                for name, url in result["urls"].items():
                    _deploy_log(f"  {name}: {url}")

                # 保存实际使用的 subdomain
                _sc("cf_api_token", cf_api_token)
                _sc("cf_domain", cf_domain)
                _sc("cf_subdomain", mgr.subdomain)

                # 启动 cloudflared (如已在运行则跳过, 避免断开 SSE)
                if _is_cf_tunnel_online():
                    _deploy_log("cloudflared 已在运行，跳过重启 (ingress 已通过 API 更新)", "success")
                elif mgr.start_cloudflared(result["tunnel_token"]):
                    _deploy_log("cloudflared 已启动", "success")
                else:
                    _deploy_log("cloudflared 启动失败", "warn")

        except CFAPIError as e:
            _deploy_log(f"Tunnel 配置失败: {e}", "warn")
        except Exception as e:
            _deploy_log(f"Tunnel 异常: {e}", "warn")
    else:
        _deploy_step("setup_tunnel_skip")


def _step_rclone(config):
    """STEP 3: Rclone conf 落地 (仅导入链路: method='base64', conf 内容来自
    导入 JSON 配置 / 设置页导入; wizard 的凭据走 wizard_remotes, 见 _step_sync_assets)"""
    import base64 as _b64
    rclone_method = config.get("rclone_config_method", "skip")
    rclone_value = config.get("rclone_config_value", "")
    if rclone_method != "base64" or not rclone_value:
        return
    _deploy_step("setup_rclone")
    _deploy_exec("mkdir -p ~/.config/rclone")
    _deploy_log("从 Base64 解码 rclone.conf...")
    try:
        conf_text = _b64.b64decode(rclone_value).decode("utf-8")
        Path.home().joinpath(".config/rclone/rclone.conf").write_text(
            conf_text, encoding="utf-8"
        )
    except Exception as e:
        _deploy_log(f"Base64 解码失败: {e}", "error")
    _deploy_exec("chmod 600 ~/.config/rclone/rclone.conf")
    _deploy_exec("rclone listremotes", label="检测 remotes")


def _step_ssh(config):
    """STEP 3.5: SSH 配置 (密码跟随 + 公钥)"""
    ssh_pw_follow = bool(config.get("ssh_pw_follow", False))
    ssh_keys = config.get("ssh_keys", [])
    if not ssh_pw_follow and not ssh_keys:
        return
    _deploy_step("setup_ssh")
    from comfycarry.config import set_config as _sc2

    # 跟随开启: 复用 ssh 路由的应用逻辑 (chpasswd + 开密码认证 + 重启 sshd
    # + 落 ssh_pw_follow 标志)。注意面板密码在 _step_start_services 末尾才
    # 写入 cfg.DASHBOARD_PASSWORD, 此时必须把向导收集的密码显式传入。
    sshd_restarted = False
    if ssh_pw_follow:
        from ..routes.ssh import _apply_password_follow
        ok, err, extra = _apply_password_follow(
            True, password=config.get("password") or None
        )
        if ok:
            # 重启结果以 helper 实际返回为准, 失败时末尾统一补一次重启
            sshd_restarted = bool(extra and extra.get("sshd_restarted"))
            _deploy_log("SSH Root 密码已同步面板密码", "success")
        else:
            _deploy_log(f"SSH 密码跟随设置失败 ({err['error_key']})", "warn")

    if ssh_keys and isinstance(ssh_keys, list):
        ak_file = os.path.expanduser("~/.ssh/authorized_keys")
        os.makedirs(os.path.dirname(ak_file), exist_ok=True)
        existing = set()
        try:
            with open(ak_file, "r") as f:
                existing = {l.strip() for l in f if l.strip()}
        except FileNotFoundError:
            pass
        added = 0
        # 追加前确保原文件以换行结尾 —— 镜像预置的 key 常无末尾换行, 直接 append 会把
        # 新 key 粘在它尾部拼成畸形行, 导致该行所有 key 全部失效 (实测踩到过)。
        from ..routes.ssh import _ensure_trailing_newline
        _ensure_trailing_newline(ak_file)
        with open(ak_file, "a") as f:
            for key in ssh_keys:
                key = key.strip()
                if key and key not in existing:
                    f.write(key + "\n")
                    existing.add(key)
                    added += 1
        os.chmod(ak_file, 0o600)
        _sc2("ssh_keys", ssh_keys)
        _deploy_log(f"SSH 公钥已添加 ({added} 个新增, 共 {len(ssh_keys)} 个)", "success")

    # 重启 sshd 使配置生效 (跟随分支成功时内部已重启过, 不必重复)
    if not sshd_restarted:
        from ..routes.ssh import _do_restart_sshd
        _do_restart_sshd()
    _deploy_log("sshd 已重启", "success")


def _step_check_pytorch(PY):
    """STEP 4: 检查预装 PyTorch"""
    _deploy_step("check_pytorch")
    _deploy_exec(
        f'{PY} -c "import torch; print(f\\"PyTorch {{torch.__version__}} '
        f'CUDA {{torch.version.cuda}}\\")"'
    )


def _step_install_comfyui(PY):
    """STEP 5: ComfyUI 安装 + 健康检查"""
    if _step_done("comfyui_install"):
        _deploy_step("install_comfyui_skip")
        _deploy_step("health_check_skip")
        return

    _deploy_step("install_comfyui")
    if not Path("/workspace/ComfyUI/main.py").exists():
        _deploy_log("从镜像复制 ComfyUI...")
        _deploy_exec("mkdir -p /workspace/ComfyUI && "
                     "cp -a /opt/ComfyUI/. /workspace/ComfyUI/")
    else:
        _deploy_log("ComfyUI 已存在, 跳过复制")

    # 健康检查
    _deploy_step("health_check")

    # 确保端口 8188 未被占用 (可能有旧进程残留)
    _deploy_exec(
        "pm2 delete comfy 2>/dev/null || true; "
        "pkill -9 -f 'main.py.*--port 8188' 2>/dev/null || true; "
        "sleep 1",
        label="清理端口 8188"
    )

    _deploy_log("启动健康检查...")
    _deploy_exec(
        f'cd /workspace/ComfyUI && {PY} main.py --listen 127.0.0.1 '
        f'--port 8188 --disable-all-custom-nodes > /tmp/comfy_boot.log 2>&1 &'
    )
    boot_ok = False
    for i in range(30):
        time.sleep(2)
        try:
            log = Path("/tmp/comfy_boot.log").read_text(errors="ignore")
            if "To see the GUI go to" in log:
                boot_ok = True
                break
        except Exception:
            pass
        _deploy_log(f"等待 ComfyUI 启动... ({i+1}/30)")

    _deploy_exec(
        "pkill -f 'main.py --listen 127.0.0.1 --port 8188 "
        "--disable-all-custom-nodes' 2>/dev/null; sleep 1",
        label="停止检查进程"
    )

    if boot_ok:
        _deploy_log("ComfyUI 健康检查通过", "success")
    else:
        _deploy_log("ComfyUI 健康检查失败!", "error")
        try:
            err = Path("/tmp/comfy_boot.log").read_text(errors="ignore")[-500:]
            _deploy_log(f"最后日志: {err}", "error")
        except Exception:
            pass
    _mark_step_done("comfyui_install")


def _step_accelerators(config, PY):
    """STEP 6: 加速组件 (FA2/SA2)"""
    want_fa2 = config.get("install_fa2", False)
    want_sa2 = config.get("install_sa2", False)
    if not want_fa2 and not want_sa2:
        _deploy_step("install_attn_user_skip")
        return
    if _step_done("accelerators"):
        _deploy_step("install_attn_skip")
        return

    parts = []
    if want_fa2: parts.append("FA2")
    if want_sa2: parts.append("SA2")
    _deploy_step(f"install_attn:{'/'.join(parts)}")
    _deploy_log("检测 GPU 架构...")
    gpu_info = _detect_gpu_info()
    cuda_cap = gpu_info.get("cuda_cap", "")
    _deploy_log(f"GPU: {gpu_info.get('name', '?')} | CUDA Cap: {cuda_cap}")

    if want_fa2:
        _deploy_log("验证 FlashAttention-2...")
        _deploy_exec(
            f'{PY} -c "import flash_attn; '
            f'print(f\\"FA2 v{{flash_attn.__version__}}\\")"',
            label="检查 FA2"
        )
    if want_sa2:
        if cuda_cap:
            _install_sa2(PY, cuda_cap)
        else:
            _deploy_log("未检测到 GPU, 跳过 SA2", "warn")

    _deploy_log("加速组件安装完成", "success")
    _mark_step_done("accelerators")


def _step_plugins(config, PY):
    """STEP 7: 插件安装"""
    PIP = f"{PY} -m pip"
    _deploy_step("install_plugins")
    plugins = [p for p in config.get("plugins", []) if p]
    _deploy_log("检查额外插件...")
    for url in plugins:
        if url == "comfycarry_ws_broadcast":
            continue
        name = url.rstrip("/").split("/")[-1].replace(".git", "")
        if not Path(f"/workspace/ComfyUI/custom_nodes/{name}").exists():
            _deploy_log(f"安装新插件: {name}")
            _deploy_exec(
                f'cd /workspace/ComfyUI/custom_nodes && '
                f'git clone {shlex.quote(url)} || true', timeout=60
            )

    _deploy_log("安装插件依赖...")
    _deploy_exec(
        f'find /workspace/ComfyUI/custom_nodes -name "requirements.txt" -type f '
        f'-exec {PIP} install --no-cache-dir -r {{}} \\; 2>&1 || true',
        timeout=600, label="pip install plugin deps"
    )

    # Install comfycarry_ws_broadcast plugin (WS event broadcast for Dashboard)
    _deploy_log("安装 ComfyCarry WS 广播插件...")
    broadcast_src = Path(__file__).resolve().parent.parent.parent / "comfycarry_ws_broadcast"
    broadcast_dst = Path("/workspace/ComfyUI/custom_nodes/comfycarry_ws_broadcast")
    if broadcast_src.exists():
        if broadcast_dst.exists():
            shutil.rmtree(broadcast_dst)
        shutil.copytree(broadcast_src, broadcast_dst)
        _deploy_log("comfycarry_ws_broadcast 插件已安装", "success")
    else:
        _deploy_log("comfycarry_ws_broadcast 源目录不存在, 跳过", "warn")


def _expand_wizard_rules(config, wizard_sync_rules) -> list[dict]:
    """把向导勾选展开为规则列表。

    项两种形态:
    - 预设:   {template_id: 'tpl-*', remote, method?(覆盖, 上传输出的移动/保留),
               entry_names?(前端创建时固化的本地化规则名, 缺省用后端兜底名)}
    - 自定义: {template_id: 'custom', remote, name, direction, method, trigger,
               remote_path, local_path, filters?}

    预设远程路径 = 该存储的同步文件夹 (root_dir) + 预设相对路径; S3 再前置
    bucket 作为首段 (rclone s3 路径首段即 bucket)。
    自定义规则保持原样 —— remote_path 原样使用, 不套同步文件夹。
    """
    tpl_map = {t["id"]: t for t in SYNC_RULE_TEMPLATES}
    # remote → bucket / 同步文件夹前缀表 (wizard_remotes 的凭据在服务端)
    bucket_map: dict[str, str] = {}
    root_map: dict[str, str] = {}
    for wr in config.get("wizard_remotes", []):
        if not isinstance(wr, dict):
            continue
        wr_name = str(wr.get("name", ""))
        root = str(wr.get("root_dir") or "").strip()
        if root:
            root_map[wr_name] = root
        if wr.get("type") == "s3":
            bucket = str((wr.get("params") or {}).get("bucket") or "").strip()
            if bucket:
                bucket_map[wr_name] = bucket

    ts = int(time.time())
    new_rules: list[dict] = []
    for i, wr in enumerate(wizard_sync_rules):
        if not isinstance(wr, dict):
            continue
        remote = str(wr.get("remote", "") or "")
        if not _RCLONE_TOKEN_RE.match(remote):
            _deploy_log(f"跳过非法 remote 名: {remote!r}", "warn")
            continue
        tpl_id = str(wr.get("template_id", "") or "")

        if tpl_id == "custom":
            rule = _custom_rule_from_wizard(wr, remote, i, ts)
            if rule:
                new_rules.append(rule)
            continue

        tpl = tpl_map.get(tpl_id)
        if not tpl:
            _deploy_log(f"跳过未知预设: {tpl_id!r}", "warn")
            continue
        entry_names = wr.get("entry_names")
        entry_names = entry_names if isinstance(entry_names, list) else []
        bucket = bucket_map.get(remote)
        root_dir = root_map.get(remote)
        if not root_dir:
            _deploy_log(f"存储 {remote!r} 缺少同步文件夹, 预设路径将不含该层", "warn")
        for j, entry in enumerate(tpl.get("entries", [])):
            # bucket 是 S3 的存储根, 同步文件夹在其内, 预设相对路径再往后拼
            remote_path = join_remote_path(bucket, root_dir, entry.get("remote_path"))
            # 本地化名: 前端创建时固化; 缺位回退后端兜底名
            ename = entry_names[j] if j < len(entry_names) and str(entry_names[j]).strip() else entry.get("name", "")
            new_rules.append({
                "id": f"wizard-{tpl_id}-{j}-{ts}",
                "name": str(ename),
                "remote": remote,
                "remote_path": remote_path,
                "local_path": str(entry.get("local_path", "")),
                "direction": tpl.get("direction", "pull"),
                "method": wr.get("method") or entry.get("method", "copy"),
                "trigger": entry.get("trigger", "deploy"),
                "enabled": True,
                "filters": entry.get("filters", []),
            })
    return new_rules


def _custom_rule_from_wizard(wr: dict, remote: str, idx: int, ts: int) -> dict | None:
    """自定义向导规则 → 规则 (local_path 越界/枚举校验, 非法整条跳过并 warn)。"""
    local_path = str(wr.get("local_path", "") or "")
    target, err = resolve_workspace_path(local_path, allow_root=False) if local_path else (None, ("path_required", {}))
    if err:
        _deploy_log(f"跳过自定义规则 (本地路径非法 {local_path!r}: {err[0]})", "warn")
        return None
    name = str(wr.get("name", "") or "").strip()
    remote_path = str(wr.get("remote_path", "") or "").strip()
    if not remote_path:
        _deploy_log(f"跳过自定义规则 {name!r} (远程路径为空)", "warn")
        return None
    direction = wr.get("direction", "pull")
    method = wr.get("method", "copy")
    trigger = wr.get("trigger", "manual")
    if (direction not in SYNC_RULE_DIRECTIONS or method not in SYNC_RULE_METHODS
            or trigger not in SYNC_RULE_TRIGGERS):
        _deploy_log(f"跳过自定义规则 {name!r} (direction/method/trigger 取值非法)", "warn")
        return None
    filters = wr.get("filters", [])
    filters = [str(f) for f in filters if isinstance(f, str)] if isinstance(filters, list) else []
    return {
        "id": f"wizard-custom-{idx}-{ts}",
        "name": name or f"rule-{idx}",
        "remote": remote,
        "remote_path": remote_path,
        "local_path": workspace_relative(target),
        "direction": direction,
        "method": method,
        "trigger": trigger,
        "enabled": True,
        "filters": filters,
    }


def _step_sync_assets(config):
    """STEP 8: 执行 deploy 同步规则"""
    rclone_method = config.get("rclone_config_method", "skip")
    rclone_value = config.get("rclone_config_value", "")

    has_rclone_conf = (rclone_method != "skip" and bool(rclone_value))
    wizard_remotes = config.get("wizard_remotes", [])

    if not has_rclone_conf and not wizard_remotes:
        _deploy_log("未配置 Rclone, 跳过资产同步")
        return

    _deploy_step("sync_assets")

    for wr in wizard_remotes:
        wr_name = str(wr.get("name", ""))
        wr_type = str(wr.get("type", ""))
        wr_root = str(wr.get("root_dir") or "").strip()
        wr_params = wr.get("params", {}) or {}
        if not (wr_name and wr_type):
            continue
        if not (_RCLONE_TOKEN_RE.match(wr_name) and _RCLONE_TOKEN_RE.match(wr_type)):
            _deploy_log(f"跳过非法 Remote 名/类型: {wr_name!r} {wr_type!r}", "warn")
            continue
        if not wr_root:
            _deploy_log(f"存储 {wr_name!r} 缺少同步文件夹", "warn")
        # --non-interactive 必须: OAuth 类型 (onedrive/drive) 即使带了 token,
        # 交互模式也会进 authorize 流程在 127.0.0.1:53682 起 webserver 等回调
        # (容器里浏览器打不开, 直接挂死到超时)。dashboard remote/create 同此参数。
        cmd = ["rclone", "config", "create", wr_name, wr_type, "--non-interactive"]
        for k, v in wr_params.items():
            if not v or k == REMOTE_ROOT_DIR_KEY:
                continue
            # key 会作为独立 argv 元素, 但 "--flag=x" 形态会被 rclone 当选项解析
            if not _RCLONE_TOKEN_RE.match(str(k)):
                _deploy_log(f"跳过非法参数名: {k!r}", "warn")
                continue
            cmd.append(f"{k}={v}")
        # 同步文件夹随 conf 一起落盘 (rclone 保存未知键, 运行时不报错)
        if wr_root:
            cmd.append(f"{REMOTE_ROOT_DIR_KEY}={wr_root}")
        _deploy_exec(cmd, label=f"创建 Remote: {wr_name}")

    rules = _load_sync_rules()
    if not rules and not config.get("_imported_sync_rules"):
        wizard_sync_rules = config.get("wizard_sync_rules", [])
        if wizard_sync_rules:
            new_rules = _expand_wizard_rules(config, wizard_sync_rules)
            if new_rules:
                _save_sync_rules(new_rules)
                _deploy_log(f"根据向导配置创建了 {len(new_rules)} 条同步规则")
                rules = new_rules

    deploy_rules = [r for r in rules
                    if r.get("trigger") == "deploy" and r.get("enabled", True)]
    if deploy_rules:
        for rule in deploy_rules:
            name = rule.get("name", rule.get("id", "?"))
            _deploy_log(f"执行: {name}...")
            # _run_sync_rule 返回 (ok, stats) —— 直接判元组恒为真, 失败会被吞掉
            ok, _stats = _run_sync_rule(rule)
            if not ok:
                _deploy_log(f"{name} 未完全成功, 继续", "warn")
        _deploy_log("资产同步完成", "success")
    else:
        _deploy_log("没有 deploy 同步规则, 跳过")


def _step_start_services(config, cfg, PY):
    """STEP 10: 启动服务 + 完成"""
    _deploy_step("start_services")

    # watch worker 的启动只看规则本身: conf 可能来自 base64 导入, remote
    # 也可能来自 wizard_remotes (OAuth 链路), 不能用 conf 有无做代理判断
    rules = _load_sync_rules()
    watch_rules = [r for r in rules
                   if r.get("trigger") == "watch" and r.get("enabled", True)]
    if watch_rules:
        start_sync_worker()
        _deploy_log(f"Sync Worker 已启动 ({len(watch_rules)} 条监控规则)", "success")

    civitai_token = config.get("civitai_token", "")
    if civitai_token:
        CONFIG_FILE.write_text(json.dumps({"api_key": civitai_token}))
        _deploy_log("CivitAI API Key 已保存")

    _deploy_log("启动 ComfyUI 主服务...")
    # 验证 FA2/SA2 实际安装结果，据此设置 attention 参数
    from comfycarry.config import set_config
    want_fa2 = config.get("install_fa2", False)
    want_sa2 = config.get("install_sa2", False)
    fa2_ok = False
    sa2_ok = False
    if want_fa2:
        r = subprocess.run(
            f'{PY} -c "import flash_attn"',
            shell=True, capture_output=True, text=True, timeout=10
        )
        fa2_ok = r.returncode == 0
        if not fa2_ok:
            _deploy_log("FlashAttention-2 导入验证失败，回退到 PyTorch SDPA", "warn")
    if want_sa2:
        r = subprocess.run(
            f'{PY} -c "import sageattention"',
            shell=True, capture_output=True, text=True, timeout=10
        )
        sa2_ok = r.returncode == 0
        if not sa2_ok:
            _deploy_log("SageAttention-2 导入验证失败，回退到 PyTorch SDPA", "warn")
    set_config("installed_fa2", fa2_ok)
    set_config("installed_sa2", sa2_ok)

    attn_flag = "--use-pytorch-cross-attention"
    if fa2_ok:
        attn_flag = "--use-flash-attention"
    elif sa2_ok:
        attn_flag = "--use-sage-attention"
    # --preview-method 必须显式给出: ComfyUI 默认 NoPreviews, 漏掉就没有实时预览
    comfy_args = (f"{DEFAULT_COMFYUI_ARGS} {attn_flag} "
                  f"--fast --disable-xformers")

    # 创建 ControlNet 预处理输出子目录
    _deploy_exec("mkdir -p /workspace/ComfyUI/input/openpose /workspace/ComfyUI/input/canny /workspace/ComfyUI/input/depth")

    _deploy_exec("pm2 delete comfy 2>/dev/null || true")
    # 清掉 pm2 注入的日志路径环境变量 (见 log_service.clean_pm2_env)
    from .log_service import clean_pm2_env
    _deploy_exec(
        f'cd /workspace/ComfyUI && pm2 start {PY} --name comfy '
        f'--interpreter none --log /workspace/comfy.log --merge-logs --time '
        f'--restart-delay 3000 --max-restarts 10 '
        f'-- main.py {comfy_args}',
        env=clean_pm2_env(),
    )

    _deploy_exec("pm2 save 2>/dev/null || true")

    # 持久化 ComfyUI 启动参数 (容器重启后可恢复)
    set_config("comfyui_args", comfy_args)

    # 完成
    _deploy_step("deploy_done")

    new_pw = config.get("password", "")
    if new_pw:
        cfg.DASHBOARD_PASSWORD = new_pw
        _save_dashboard_password(new_pw)
        _deploy_log("ComfyCarry 密码已更新并保存")

    state = _load_setup_state()
    state["deploy_completed"] = True
    state["deploy_error"] = ""
    # 仅当最终回退到 SDPA 时才记录警告 (FA2 可用时 SA2 失败不算回退)
    attn_warnings = []
    if (want_fa2 or want_sa2) and not fa2_ok and not sa2_ok:
        if want_fa2:
            attn_warnings.append("FlashAttention-2")
        if want_sa2:
            attn_warnings.append("SageAttention-2")
    state["attn_install_warnings"] = attn_warnings
    # 部署成功后不再保留向导 remote 凭据快照；失败/重试期间才需要它。
    state["wizard_remotes"] = []
    # 保留 deploy_steps_completed — reinitialize 需要据此跳过已完成的耗时步骤
    _save_setup_state(state)
    from . import wizard_draft
    wizard_draft.reset()

    gpu_info = _detect_gpu_info()
    _deploy_log(
        f"部署完成! GPU: {gpu_info.get('name', '?')} | "
        f"CUDA: {gpu_info.get('cuda_cap', '?')}",
        "success",
    )
    _deploy_log("请刷新页面进入 ComfyCarry")
