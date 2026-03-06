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
    _load_setup_state, _save_setup_state,
    _save_dashboard_password,
)
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
    """检查 cf-tunnel PM2 进程是否在线"""
    try:
        r = subprocess.run(
            "pm2 jlist 2>/dev/null", shell=True,
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            import json as _json
            for p in _json.loads(r.stdout):
                if p.get("name") == "cf-tunnel":
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
            _deploy_log(f"⚠️ 无法解析 CUDA Cap: {cuda_cap}", "warn")
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
        _deploy_log(f"⚠️ 未知 GPU 架构 {cuda_cap}, 跳过 SA2", "warn")
        return

    whl_src = Path(f"/opt/wheels/sa2/sageattention-2.2.0-cp312-cp312-linux_x86_64_{wheel_suffix}.whl")
    if not whl_src.exists():
        _deploy_log(f"⚠️ SA2 wheel 不存在: {whl_src}", "warn")
        return

    # wheel 文件名必须符合 PEP 427, 复制后改名为标准格式
    tmp_whl = "/tmp/sageattention-2.2.0-cp312-cp312-linux_x86_64.whl"
    shutil.copy2(str(whl_src), tmp_whl)

    _deploy_log(f"安装 SA2 ({wheel_suffix})...")
    _deploy_exec(f'{py} -m pip install "{tmp_whl}" --no-deps --no-cache-dir',
                 label=f"pip install SA2-{wheel_suffix}")
    _deploy_exec(f'rm -f "{tmp_whl}"')
    _deploy_log(f"✅ SageAttention-2 ({wheel_suffix}) 安装完成")


def _deploy_step(name):
    """标记一个部署步骤开始"""
    entry = {"type": "step", "name": name,
             "time": datetime.now().strftime("%H:%M:%S")}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)


def _deploy_exec(cmd, timeout=600, label=""):
    """执行 shell 命令, 实时推送输出 (带真正的超时保护)"""
    if label:
        _deploy_log(f"$ {label}")
    proc = None
    try:
        proc = subprocess.Popen(
            cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
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
        _deploy_log(f"❌ 部署失败: {e}", "error")
        import traceback
        _deploy_log(traceback.format_exc(), "error")
        try:
            state = _load_setup_state()
            state["deploy_error"] = str(e)
            state["deploy_started"] = False
            _save_setup_state(state)
        except Exception:
            pass


# ── 部署步骤 ─────────────────────────────────────────────────

def _step_system_deps(config, PY):
    """STEP 1: 系统依赖"""
    PIP = f"{PY} -m pip"
    if _step_done("system_deps"):
        _deploy_step("安装系统依赖 ✅ (已完成, 跳过)")
    else:
        _deploy_step("安装系统依赖")
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
        _deploy_step("配置公共 Tunnel")
        try:
            from comfycarry.services.public_tunnel import PublicTunnelClient, PublicTunnelError
            from comfycarry.config import set_config as _sc
            client = PublicTunnelClient()
            result = client.register()
            _deploy_log(f"✅ 公共 Tunnel 已启用: {result.get('random_id', '?')}")
            urls = result.get("urls", {})
            for name, url in urls.items():
                _deploy_log(f"  {name}: {url}")
        except PublicTunnelError as e:
            _deploy_log(f"⚠️ 公共 Tunnel 启用失败: {e}", "warn")
        except Exception as e:
            _deploy_log(f"⚠️ 公共 Tunnel 异常: {e}", "warn")
    elif cf_api_token and cf_domain:
        _deploy_step("配置 Cloudflare Tunnel")
        from comfycarry.services.tunnel_manager import TunnelManager, CFAPIError, get_default_services
        from comfycarry.config import set_config as _sc, get_config as _gc

        cf_subdomain = config.get("cf_subdomain", "")
        mgr = TunnelManager(cf_api_token, cf_domain, cf_subdomain)

        try:
            ok, info = mgr.validate_token()
            if not ok:
                _deploy_log(f"⚠️ CF Token 问题: {info['message']}", "warn")
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
                _deploy_log(f"✅ Tunnel 已就绪: {mgr.subdomain}.{cf_domain}")
                for name, url in result["urls"].items():
                    _deploy_log(f"  {name}: {url}")

                # 保存实际使用的 subdomain
                _sc("cf_api_token", cf_api_token)
                _sc("cf_domain", cf_domain)
                _sc("cf_subdomain", mgr.subdomain)

                # 启动 cloudflared (如已在运行则跳过, 避免断开 SSE)
                if _is_cf_tunnel_online():
                    _deploy_log("✅ cloudflared 已在运行，跳过重启 (ingress 已通过 API 更新)")
                else:
                    mgr.start_cloudflared(result["tunnel_token"])
                    _deploy_log("✅ cloudflared 已启动")

        except CFAPIError as e:
            _deploy_log(f"⚠️ Tunnel 配置失败: {e}", "warn")
        except Exception as e:
            _deploy_log(f"⚠️ Tunnel 异常: {e}", "warn")
    else:
        _deploy_step("Cloudflare Tunnel (跳过)")


def _step_rclone(config):
    """STEP 3: Rclone 配置"""
    import base64 as _b64
    rclone_method = config.get("rclone_config_method", "skip")
    rclone_value = config.get("rclone_config_value", "")
    if rclone_method == "base64_env":
        rclone_method = "base64"
        rclone_value = os.environ.get("RCLONE_CONF_BASE64", "")
    if rclone_method != "skip" and rclone_value:
        _deploy_step("配置 Rclone")
        _deploy_exec("mkdir -p ~/.config/rclone")
        if rclone_method == "url":
            _deploy_log(f"从 URL 下载 rclone.conf...")
            _deploy_exec(f'curl -fsSL {shlex.quote(rclone_value)} -o ~/.config/rclone/rclone.conf')
        elif rclone_method == "base64":
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
    """STEP 3.5: SSH 配置 (密码 + 公钥)"""
    ssh_password = config.get("ssh_password", "")
    ssh_keys = config.get("ssh_keys", [])
    ssh_pw_sync = config.get("ssh_pw_sync", False)
    if not ssh_password and not ssh_keys:
        return
    _deploy_step("配置 SSH 访问")
    from comfycarry.config import set_config as _sc2
    if ssh_pw_sync:
        _sc2("ssh_pw_sync", True)
    if ssh_password:
        code = subprocess.run(
            f"echo 'root:{shlex.quote(ssh_password)}' | chpasswd",
            shell=True, capture_output=True, timeout=5
        ).returncode
        if code == 0:
            _sc2("ssh_password", ssh_password)
            # 启用密码认证
            subprocess.run(
                "sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' "
                "/etc/ssh/sshd_config 2>/dev/null || true",
                shell=True, timeout=5
            )
            subprocess.run(
                "sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' "
                "/etc/ssh/sshd_config 2>/dev/null || true",
                shell=True, timeout=5
            )
            _deploy_log("✅ SSH Root 密码已设置")
        else:
            _deploy_log("⚠️ SSH 密码设置失败", "warn")
    if ssh_keys and isinstance(ssh_keys, list):
        import os
        ak_file = os.path.expanduser("~/.ssh/authorized_keys")
        os.makedirs(os.path.dirname(ak_file), exist_ok=True)
        existing = set()
        try:
            with open(ak_file, "r") as f:
                existing = {l.strip() for l in f if l.strip()}
        except FileNotFoundError:
            pass
        added = 0
        with open(ak_file, "a") as f:
            for key in ssh_keys:
                key = key.strip()
                if key and key not in existing:
                    f.write(key + "\n")
                    existing.add(key)
                    added += 1
        os.chmod(ak_file, 0o600)
        _sc2("ssh_keys", ssh_keys)
        _deploy_log(f"✅ SSH 公钥已添加 ({added} 个新增, 共 {len(ssh_keys)} 个)")
    # 重启 sshd 使配置生效
    subprocess.run(
        "pkill sshd 2>/dev/null; sleep 0.5; "
        "/usr/sbin/sshd -E /var/log/sshd.log 2>/dev/null || true",
        shell=True, timeout=10
    )
    _deploy_log("✅ sshd 已重启")


def _step_check_pytorch(PY):
    """STEP 4: 检查预装 PyTorch"""
    _deploy_step("检查预装 PyTorch")
    _deploy_exec(
        f'{PY} -c "import torch; print(f\\"PyTorch {{torch.__version__}} '
        f'CUDA {{torch.version.cuda}}\\")"'
    )


def _step_install_comfyui(PY):
    """STEP 5: ComfyUI 安装 + 健康检查"""
    if _step_done("comfyui_install"):
        _deploy_step("安装 ComfyUI ✅ (已完成, 跳过)")
        _deploy_step("ComfyUI 健康检查 ✅ (已完成, 跳过)")
        return

    _deploy_step("安装 ComfyUI")
    if not Path("/workspace/ComfyUI/main.py").exists():
        _deploy_log("从镜像复制 ComfyUI...")
        _deploy_exec("mkdir -p /workspace/ComfyUI && "
                     "cp -r /opt/ComfyUI/* /workspace/ComfyUI/")
    else:
        _deploy_log("ComfyUI 已存在, 跳过复制")

    # 健康检查
    _deploy_step("ComfyUI 健康检查")

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
        _deploy_log("✅ ComfyUI 健康检查通过")
    else:
        _deploy_log("❌ ComfyUI 健康检查失败!", "error")
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
        _deploy_step("安装加速组件 ⏭ (用户跳过)")
        return
    if _step_done("accelerators"):
        _deploy_step("安装加速组件 ✅ (已完成, 跳过)")
        return

    parts = []
    if want_fa2: parts.append("FA2")
    if want_sa2: parts.append("SA2")
    _deploy_step(f"安装加速组件 ({'/'.join(parts)})")
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
            _deploy_log("⚠️ 未检测到 GPU, 跳过 SA2", "warn")

    _deploy_log("✅ 加速组件安装完成")
    _mark_step_done("accelerators")


def _step_plugins(config, PY):
    """STEP 7: 插件安装"""
    PIP = f"{PY} -m pip"
    _deploy_step("安装插件")
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
        _deploy_log("✅ comfycarry_ws_broadcast 插件已安装")
    else:
        _deploy_log("⚠️ comfycarry_ws_broadcast 源目录不存在, 跳过")


def _step_sync_assets(config):
    """STEP 8: 执行 deploy 同步规则"""
    rclone_method = config.get("rclone_config_method", "skip")
    rclone_value = config.get("rclone_config_value", "")
    if rclone_method == "base64_env":
        rclone_method = "base64"
        rclone_value = os.environ.get("RCLONE_CONF_BASE64", "")

    if rclone_method == "skip" or not rclone_value:
        _deploy_log("未配置 Rclone, 跳过资产同步")
        return

    _deploy_step("同步云端资产")

    wizard_remotes = config.get("wizard_remotes", [])
    for wr in wizard_remotes:
        wr_name = wr.get("name", "")
        wr_type = wr.get("type", "")
        wr_params = wr.get("params", {})
        if wr_name and wr_type:
            cmd = f'rclone config create "{wr_name}" "{wr_type}"'
            for k, v in wr_params.items():
                if v:
                    cmd += f" {k}={shlex.quote(str(v))}"
            _deploy_exec(cmd, label=f"创建 Remote: {wr_name}")

    rules = _load_sync_rules()
    if not rules and not config.get("_imported_sync_rules"):
        wizard_sync_rules = config.get("wizard_sync_rules", [])
        if wizard_sync_rules:
            tpl_map = {t["id"]: t for t in SYNC_RULE_TEMPLATES}
            new_rules = []
            for wr in wizard_sync_rules:
                tpl_id = wr.get("template_id", "")
                tpl = tpl_map.get(tpl_id)
                if not tpl:
                    continue
                rule = {
                    "id": f"wizard-{tpl_id}-{int(time.time())}",
                    "name": tpl.get("name", ""),
                    "remote": wr.get("remote", ""),
                    "remote_path": wr.get("remote_path", tpl.get("remote_path", "")),
                    "local_path": tpl.get("local_path", ""),
                    "direction": tpl.get("direction", "pull"),
                    "method": tpl.get("method", "copy"),
                    "trigger": tpl.get("trigger", "deploy"),
                    "enabled": True,
                    "filters": tpl.get("filters", []),
                }
                new_rules.append(rule)
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
            ok = _run_sync_rule(rule)
            if not ok:
                _deploy_log(f"⚠️ {name} 未完全成功, 继续", "warn")
        _deploy_log("✅ 资产同步完成")
    else:
        _deploy_log("没有 deploy 同步规则, 跳过")


def _step_start_services(config, cfg, PY):
    """STEP 10: 启动服务 + 完成"""
    _deploy_step("启动服务")

    rclone_method = config.get("rclone_config_method", "skip")
    rclone_value = config.get("rclone_config_value", "")
    if rclone_method == "base64_env":
        rclone_method = "base64"
        rclone_value = os.environ.get("RCLONE_CONF_BASE64", "")

    if rclone_method != "skip" and rclone_value:
        rules = _load_sync_rules()
        watch_rules = [r for r in rules
                       if r.get("trigger") == "watch" and r.get("enabled", True)]
        if watch_rules:
            start_sync_worker()
            _deploy_log(f"✅ Sync Worker 已启动 ({len(watch_rules)} 条监控规则)")

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
            _deploy_log("⚠️ FlashAttention-2 导入验证失败，回退到 PyTorch SDPA", "warn")
    if want_sa2:
        r = subprocess.run(
            f'{PY} -c "import sageattention"',
            shell=True, capture_output=True, text=True, timeout=10
        )
        sa2_ok = r.returncode == 0
        if not sa2_ok:
            _deploy_log("⚠️ SageAttention-2 导入验证失败，回退到 PyTorch SDPA", "warn")
    set_config("installed_fa2", fa2_ok)
    set_config("installed_sa2", sa2_ok)

    attn_flag = "--use-pytorch-cross-attention"
    if fa2_ok:
        attn_flag = "--use-flash-attention"
    elif sa2_ok:
        attn_flag = "--use-sage-attention"
    comfy_args = f"--listen 0.0.0.0 --port 8188 {attn_flag} --fast --disable-xformers"

    # 创建 ControlNet 预处理输出子目录
    _deploy_exec("mkdir -p /workspace/ComfyUI/input/openpose /workspace/ComfyUI/input/canny /workspace/ComfyUI/input/depth")

    _deploy_exec("pm2 delete comfy 2>/dev/null || true")
    _deploy_exec(
        f'cd /workspace/ComfyUI && pm2 start {PY} --name comfy '
        f'--interpreter none --log /workspace/comfy.log --time '
        f'--restart-delay 3000 --max-restarts 10 '
        f'-- main.py {comfy_args}'
    )

    _deploy_exec("pm2 save 2>/dev/null || true")

    # 持久化 ComfyUI 启动参数 (容器重启后可恢复)
    set_config("comfyui_args", comfy_args)

    # 完成
    _deploy_step("部署完成")

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
    # 保留 deploy_steps_completed — reinitialize 需要据此跳过已完成的耗时步骤
    _save_setup_state(state)

    gpu_info = _detect_gpu_info()
    _deploy_log(
        f"🚀 部署完成! GPU: {gpu_info.get('name', '?')} | "
        f"CUDA: {gpu_info.get('cuda_cap', '?')}"
    )
    _deploy_log("请刷新页面进入 ComfyCarry")
