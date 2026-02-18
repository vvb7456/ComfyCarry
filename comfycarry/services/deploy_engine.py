"""
ComfyCarry — 部署执行引擎

_run_deploy() 及其所有辅助函数。
在 Setup Wizard 触发部署后，由后台线程运行。
"""

import json
import os
import shlex
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from ..config import (
    COMFYUI_DIR, CONFIG_FILE, DEFAULT_PLUGINS,
    SYNC_RULE_TEMPLATES,
    _load_setup_state, _save_setup_state,
    _save_dashboard_password,
)
from ..utils import _get_api_key
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


def get_deploy_log_lines():
    with _deploy_log_lock:
        return list(_deploy_log_lines)


def get_deploy_log_count():
    with _deploy_log_lock:
        return len(_deploy_log_lines)


def get_deploy_log_slice(start):
    with _deploy_log_lock:
        return _deploy_log_lines[start:], len(_deploy_log_lines)


# ── 辅助函数 ─────────────────────────────────────────────────

def _detect_image_type():
    """检测当前环境是 prebuilt 还是 generic 镜像"""
    if Path("/opt/ComfyUI/main.py").exists():
        return "prebuilt"
    return "generic"


def _detect_gpu_info():
    """检测 GPU 信息"""
    info = {"name": "", "cuda_cap": "", "vram_gb": 0}
    try:
        r = subprocess.run(
            'python3.13 -c "import torch; d=torch.cuda.get_device_properties(0); '
            'print(f\\"{d.name}|{d.major}.{d.minor}|{d.total_mem / 1073741824:.1f}\\")"',
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
    """向 SSE 推送一行日志"""
    entry = {"type": "log", "level": level, "msg": msg,
             "time": datetime.now().strftime("%H:%M:%S")}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)


def _deploy_step(name):
    """标记一个部署步骤开始"""
    entry = {"type": "step", "name": name,
             "time": datetime.now().strftime("%H:%M:%S")}
    with _deploy_log_lock:
        _deploy_log_lines.append(entry)


def _deploy_exec(cmd, timeout=600, label=""):
    """执行 shell 命令, 实时推送输出"""
    if label:
        _deploy_log(f"$ {label}")
    proc = None
    try:
        proc = subprocess.Popen(
            cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                _deploy_log(line, "output")
        proc.wait(timeout=timeout)
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
    import base64 as _b64
    # 导入需要修改的全局变量
    from .. import config as cfg

    PY = "python3.13"
    PIP = f"{PY} -m pip"
    image_type = config.get("image_type", "generic")

    try:
        # STEP 1: 系统依赖
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
            py313 = subprocess.run(
                "command -v python3.13", shell=True,
                capture_output=True, text=True
            ).stdout.strip()
            if py313:
                _deploy_exec(f'ln -sf "{py313}" /usr/local/bin/python && '
                             f'ln -sf "{py313}" /usr/bin/python || true')
            _deploy_exec(f'{PIP} install --upgrade pip setuptools packaging ninja -q',
                         label="pip upgrade")
            _mark_step_done("system_deps")

        # STEP 2: Cloudflare Tunnel
        cf_token = config.get("cloudflared_token", "")
        if cf_token:
            tunnel_pid = subprocess.run(
                "pm2 pid tunnel 2>/dev/null", shell=True,
                capture_output=True, text=True
            ).stdout.strip()
            tunnel_running = tunnel_pid and tunnel_pid != "0" and tunnel_pid.isdigit()
            if tunnel_running:
                _deploy_step("Cloudflare Tunnel (已在运行)")
                _deploy_log("Tunnel 已由 bootstrap 启动，跳过重启以保持连接稳定")
            else:
                _deploy_step("启动 Cloudflare Tunnel")
                _deploy_exec("pm2 delete tunnel 2>/dev/null || true")
                _deploy_exec(
                    f'pm2 start cloudflared --name tunnel -- tunnel run '
                    f'--token {shlex.quote(cf_token)}'
                )
                _deploy_log("Cloudflare Tunnel 已启动")

        # STEP 3: Rclone 配置
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

        # STEP 4: PyTorch
        if image_type == "generic":
            if _step_done("pytorch"):
                _deploy_step("安装 PyTorch ✅ (已完成, 跳过)")
            else:
                _deploy_step("安装 PyTorch")
                TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
                _deploy_log("安装 torch 2.9.1 (CUDA 12.8)...")
                _deploy_exec(
                    f'{PIP} install --no-cache-dir torch==2.9.1 --index-url "{TORCH_INDEX}"',
                    timeout=600, label="pip install torch"
                )
                _deploy_exec(f'{PIP} install --no-cache-dir hf_transfer',
                             label="hf_transfer")
                _mark_step_done("pytorch")
        else:
            _deploy_step("检查预装 PyTorch")
            _deploy_log("预构建镜像 — 跳过 torch 安装")
            _deploy_exec(
                f'{PY} -c "import torch; print(f\\"PyTorch {{torch.__version__}} '
                f'CUDA {{torch.version.cuda}}\\")"'
            )

        # STEP 5: ComfyUI
        if _step_done("comfyui_install"):
            _deploy_step("安装 ComfyUI ✅ (已完成, 跳过)")
            _deploy_step("ComfyUI 健康检查 ✅ (已完成, 跳过)")
        else:
            _deploy_step("安装 ComfyUI")
            if image_type == "prebuilt":
                if not Path("/workspace/ComfyUI/main.py").exists():
                    _deploy_log("从镜像复制 ComfyUI...")
                    _deploy_exec("mkdir -p /workspace/ComfyUI && "
                                 "cp -r /opt/ComfyUI/* /workspace/ComfyUI/")
                else:
                    _deploy_log("ComfyUI 已存在, 跳过复制")
            else:
                if Path("/workspace/ComfyUI").exists():
                    _deploy_exec("rm -rf /workspace/ComfyUI")
                _deploy_log("克隆 ComfyUI 仓库...")
                _deploy_exec(
                    "cd /workspace && git clone https://github.com/comfyanonymous/ComfyUI.git",
                    timeout=120
                )
                _deploy_log("安装 ComfyUI 依赖...")
                _deploy_exec(
                    f"cd /workspace/ComfyUI && {PIP} install --no-cache-dir "
                    f"-r requirements.txt", timeout=300
                )

            # 健康检查
            _deploy_step("ComfyUI 健康检查")
            _deploy_log("启动首次健康检查 (跳过插件加载)...")
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

        # STEP 6: 加速组件
        if image_type == "generic":
            if _step_done("accelerators"):
                _deploy_step("安装加速组件 ✅ (已完成, 跳过)")
            else:
                _deploy_step("安装加速组件 (FA3/SA3)")
                _deploy_log("检测 GPU 架构...")
                gpu_info = _detect_gpu_info()
                cuda_cap = gpu_info.get("cuda_cap", "0.0")
                cuda_major = int(cuda_cap.split(".")[0]) if cuda_cap else 0
                _deploy_log(f"GPU: {gpu_info.get('name', '?')} | CUDA Cap: {cuda_cap}")

                py_ver_tag = subprocess.run(
                    f'{PY} -c "import sys; print(f\\"cp{{sys.version_info.major}}'
                    f'{{sys.version_info.minor}}\\")"',
                    shell=True, capture_output=True, text=True, timeout=5
                ).stdout.strip()

                GH_WHEELS = "https://github.com/vvb7456/ComfyCarry/releases/download/v4.5-wheels"
                _deploy_exec("mkdir -p /workspace/prebuilt_wheels")
                _deploy_exec(
                    f'wget -q -O /workspace/prebuilt_wheels/'
                    f'flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl '
                    f'"{GH_WHEELS}/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl" || true',
                    label="下载 FA3 wheel"
                )
                if py_ver_tag in ("cp313", "cp312"):
                    _deploy_exec(
                        f'wget -q -O /workspace/prebuilt_wheels/'
                        f'sageattn3-1.0.0-{py_ver_tag}-{py_ver_tag}-linux_x86_64.whl '
                        f'"{GH_WHEELS}/sageattn3-1.0.0-{py_ver_tag}-{py_ver_tag}'
                        f'-linux_x86_64.whl" || true',
                        label=f"下载 SA3 wheel ({py_ver_tag})"
                    )

                if cuda_major >= 9:
                    fa_wheel = ("/workspace/prebuilt_wheels/"
                                "flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl")
                    if not _deploy_exec(f'[ -f "{fa_wheel}" ] && {PIP} install "{fa_wheel}"'):
                        _deploy_log("Wheel 不可用, 源码编译 FA3...", "warn")
                        _deploy_exec(
                            f'cd /workspace && git clone '
                            f'https://github.com/Dao-AILab/flash-attention.git && '
                            f'cd flash-attention/hopper && MAX_JOBS=8 {PY} setup.py install && '
                            f'cd /workspace && rm -rf flash-attention',
                            timeout=1200, label="编译 FA3"
                        )
                else:
                    _deploy_exec(
                        f'{PIP} install --no-cache-dir flash-attn --no-build-isolation',
                        timeout=600, label="安装 FA2"
                    )

                if cuda_major >= 10:
                    sa_wheel = (f"/workspace/prebuilt_wheels/sageattn3-1.0.0-"
                                f"{py_ver_tag}-{py_ver_tag}-linux_x86_64.whl")
                    if not _deploy_exec(f'[ -f "{sa_wheel}" ] && {PIP} install "{sa_wheel}"'):
                        _deploy_log("Wheel 不可用, 源码编译 SA3...", "warn")
                        _deploy_exec(
                            f'cd /workspace && git clone '
                            f'https://github.com/thu-ml/SageAttention.git && '
                            f'cd SageAttention/sageattention3_blackwell && '
                            f'{PY} setup.py install && '
                            f'cd /workspace && rm -rf SageAttention',
                            timeout=1200, label="编译 SA3"
                        )
                else:
                    _deploy_exec(
                        f'cd /workspace && git clone '
                        f'https://github.com/thu-ml/SageAttention.git && '
                        f'cd SageAttention && {PIP} install . --no-build-isolation && '
                        f'cd /workspace && rm -rf SageAttention',
                        timeout=600, label="安装 SA2"
                    )

                _deploy_exec("rm -rf /workspace/prebuilt_wheels")
                _deploy_log("✅ 加速组件安装完成")
                _mark_step_done("accelerators")
        else:
            _deploy_step("检查加速组件")
            _deploy_log("预构建镜像 — FA3/SA3 已预装, 跳过")

        # STEP 7: 插件安装
        _deploy_step("安装插件")
        plugins = config.get("plugins", [])
        if image_type == "prebuilt":
            _deploy_log("预构建镜像已含插件, 检查额外插件...")
            for url in plugins:
                name = url.rstrip("/").split("/")[-1].replace(".git", "")
                if not Path(f"/workspace/ComfyUI/custom_nodes/{name}").exists():
                    _deploy_log(f"安装新插件: {name}")
                    _deploy_exec(
                        f'cd /workspace/ComfyUI/custom_nodes && '
                        f'git clone {shlex.quote(url)} || true', timeout=60
                    )
        else:
            _deploy_log(f"安装 {len(plugins)} 个插件...")
            _deploy_exec("mkdir -p /workspace/ComfyUI/custom_nodes")
            for url in plugins:
                name = url.rstrip("/").split("/")[-1].replace(".git", "")
                _deploy_log(f"  克隆 {name}...")
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
            import shutil
            if broadcast_dst.exists():
                shutil.rmtree(broadcast_dst)
            shutil.copytree(broadcast_src, broadcast_dst)
            _deploy_log("✅ comfycarry_ws_broadcast 插件已安装")
        else:
            _deploy_log("⚠️ comfycarry_ws_broadcast 源目录不存在, 跳过")

        # STEP 8: 执行 deploy 同步规则
        if rclone_method != "skip" and rclone_value:
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
                        _deploy_log(f"⚠️ {name} 未完全成功, 继续", "warning")
                _deploy_log("✅ 资产同步完成")
            else:
                _deploy_log("没有 deploy 同步规则, 跳过")
        else:
            _deploy_log("未配置 Rclone, 跳过资产同步")

        # STEP 9: 启动服务
        _deploy_step("启动服务")

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
        _deploy_exec("pm2 delete comfy 2>/dev/null || true")
        _deploy_exec(
            f'cd /workspace/ComfyUI && pm2 start {PY} --name comfy '
            f'--interpreter none --log /workspace/comfy.log --time '
            f'--restart-delay 3000 --max-restarts 10 '
            f'-- main.py --listen 0.0.0.0 --port 8188 '
            f'--use-pytorch-cross-attention --fast --disable-xformers'
        )
        _deploy_exec("pm2 save 2>/dev/null || true")

        # STEP 10: 后台任务
        _deploy_step("后台任务")

        _deploy_log("安装 jtoken 命令...")
        jtoken_script = '''#!/bin/bash
echo '🔍 正在查找 Jupyter 信息...'
JUPYTER_TOKEN=$(ps aux | grep '[j]upyter-lab' | grep -oP 'token=\\K[a-zA-Z0-9-]+' | head -1)
JUPYTER_PORT=$(ps aux | grep '[j]upyter-lab' | grep -oP -- '--port=\\K[0-9]+' | head -1)
if [ -z "$JUPYTER_TOKEN" ]; then echo '❌ Jupyter Lab 未运行'; exit 1; fi
echo "📊 Jupyter Lab: 端口=${JUPYTER_PORT:-未知} Token=$JUPYTER_TOKEN"
if command -v pm2 >/dev/null 2>&1; then
    JUPYTER_DOMAIN=$(pm2 logs tunnel --nostream --lines 100 2>/dev/null | grep -oP 'dest=https://jupyter[^/]+' | head -1 | sed 's/dest=https:\\/\\///')
    [ -n "$JUPYTER_DOMAIN" ] && echo "🌐 https://$JUPYTER_DOMAIN/?token=$JUPYTER_TOKEN"
fi
echo "🔗 http://localhost:${JUPYTER_PORT}/?token=$JUPYTER_TOKEN"
'''
        Path("/usr/local/bin/jtoken").write_text(jtoken_script)
        _deploy_exec("chmod +x /usr/local/bin/jtoken")

        _deploy_log("下载 AuraSR V2...")
        _deploy_exec("mkdir -p /workspace/ComfyUI/models/Aura-SR")
        _deploy_exec(
            'aria2c -x 16 -s 16 '
            '-d "/workspace/ComfyUI/models/Aura-SR" -o "model.safetensors" '
            '"https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors'
            '?download=true"',
            timeout=300, label="AuraSR model.safetensors"
        )
        _deploy_exec(
            'aria2c -x 16 -s 16 '
            '-d "/workspace/ComfyUI/models/Aura-SR" -o "config.json" '
            '"https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json'
            '?download=true"',
            timeout=60, label="AuraSR config.json"
        )

        # 完成
        _deploy_step("部署完成")

        new_pw = config.get("password", "")
        if new_pw:
            cfg.DASHBOARD_PASSWORD = new_pw
            _save_dashboard_password(new_pw)
            _deploy_log("Dashboard 密码已更新并保存")

        state = _load_setup_state()
        state["deploy_completed"] = True
        state["deploy_error"] = ""
        state["deploy_steps_completed"] = []
        _save_setup_state(state)

        gpu_info = _detect_gpu_info()
        _deploy_log(
            f"🚀 部署完成! GPU: {gpu_info.get('name', '?')} | "
            f"CUDA: {gpu_info.get('cuda_cap', '?')}"
        )
        _deploy_log("请刷新页面进入 Dashboard")

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
