#!/usr/bin/env bash
set -Eeuo pipefail

INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/content}"
export COMFYUI_DIR="${COMFYUI_DIR:-$WORKSPACE_DIR/ComfyUI}"
export DRIVE_MOUNT="${DRIVE_MOUNT:-true}"
export DRIVE_DIR="${DRIVE_DIR:-ComfyCarry}"
export DRIVE_ROOT="${DRIVE_ROOT:-$WORKSPACE_DIR/drive/MyDrive}"
export DEV_RELEASE="${DEV_RELEASE:-false}"
if [[ "${DEV_RELEASE,,}" =~ ^(1|true|yes|on)$ ]] || [[ "${RELEASE_CHANNEL:-}" == "dev" ]]; then
    export COMFYCARRY_RELEASE_TAG="${COMFYCARRY_RELEASE_TAG:-dev-latest}"
fi
export COMFYCARRY_RUNTIME=colab
export COMFYCARRY_PYTHON="$(command -v python3)"
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export HF_HOME="${HF_HOME:-$WORKSPACE_DIR/.cache/huggingface}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$WORKSPACE_DIR/.cache/uv}"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_ROOT_USER_ACTION=ignore
export PIP_CONSTRAINT="$WORKSPACE_DIR/.comfycarry-constraints.txt"
export UV_CONSTRAINT="$PIP_CONSTRAINT"
# SAM2 构建会导入 torch，使用运行时已有的 CUDA 环境。
export PIP_NO_BUILD_ISOLATION=0
export PYTHONUNBUFFERED=1
export MAX_JOBS="${MAX_JOBS:-2}"
if [[ -z ${PUBLIC_TUNNEL+x} ]] && [[ -f "$WORKSPACE_DIR/.dashboard_env" ]]; then
    PUBLIC_TUNNEL=$(python3 - "$WORKSPACE_DIR/.dashboard_env" <<'PY'
import json
import sys
from pathlib import Path
state = json.loads(Path(sys.argv[1]).read_text())
print("0" if state.get("tunnel_mode") == "custom" else "1")
PY
)
fi
export PUBLIC_TUNNEL="${PUBLIC_TUNNEL:-1}"
# Colab 的全局 Jupyter 配置引用其专用 Python 包，应用 Jupyter 不应加载它。
export JUPYTER_NO_CONFIG=1
export JUPYTER_DATA_DIR="$WORKSPACE_DIR/.comfycarry-jupyter/data"
export JUPYTER_RUNTIME_DIR="$WORKSPACE_DIR/.comfycarry-jupyter/runtime"
export COMFYCARRY_JUPYTER_CONFIG="$WORKSPACE_DIR/.comfycarry-jupyter/jupyter_server_config.json"
export IPYTHONDIR="$WORKSPACE_DIR/.comfycarry-jupyter/ipython"

export PATH="$CUDA_HOME/bin:$PATH"
mkdir -p "$WORKSPACE_DIR"
exec 9>"$WORKSPACE_DIR/.comfycarry-install.lock"
if ! flock -n 9; then
    echo "另一个 ComfyCarry 安装任务正在运行。" >&2
    exit 1
fi
exec > >(tee -a "$WORKSPACE_DIR/colab-install.log") 2>&1
trap 'echo "安装失败：第 $LINENO 行。日志：$WORKSPACE_DIR/colab-install.log" >&2' ERR

say() { echo "==> $*"; }
download() { curl --fail --location --retry 3 --connect-timeout 30 "$1" -o "$2"; }

say "复用 Colab 运行时"
say "环境参数: WORKSPACE_DIR=$WORKSPACE_DIR | COMFYUI_DIR=$COMFYUI_DIR"
say "发布通道: DEV_RELEASE=$DEV_RELEASE | RELEASE_CHANNEL=${RELEASE_CHANNEL:-<unset>} | COMFYCARRY_RELEASE_TAG=${COMFYCARRY_RELEASE_TAG:-latest} | FORCE_UPDATE=${FORCE_UPDATE:-false}"
say "存储与隧道: DRIVE_MOUNT=$DRIVE_MOUNT | DRIVE_ROOT=$DRIVE_ROOT (存在=$([[ -d "$DRIVE_ROOT" ]] && echo yes || echo no)) | DRIVE_DIR=$DRIVE_DIR | PUBLIC_TUNNEL=$PUBLIC_TUNNEL"
read -r TORCH_CUDA_ARCH_LIST RUNTIME_WHEEL_TAG < <("$COMFYCARRY_PYTHON" - <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import torch

if not torch.cuda.is_available():
    raise SystemExit("未检测到可用的 CUDA GPU，请先在 Colab 中选择 GPU 运行时。")
major, minor = torch.cuda.get_device_capability()
if (major, minor) < (7, 5):
    raise SystemExit(f"当前 GPU ({torch.cuda.get_device_name(0)}, sm_{major}{minor}) 算力低于 7.5，不支持运行。")
torch_ver = torch.__version__.split('+')[0]
cuda_ver = (torch.version.cuda or '').replace('.', '')
py_tag = f"py{sys.version_info.major}{sys.version_info.minor}"
wheel_tag = f"{py_tag}-torch{torch_ver}-cu{cuda_ver}"
print(
    f"Python {sys.version.split()[0]} ({sys.executable}) / "
    f"PyTorch {torch.__version__} (CUDA {torch.version.cuda or 'unknown'}) / "
    f"GPU {torch.cuda.get_device_name(0)} (sm_{major}{minor}, wheel_tag={wheel_tag})",
    file=sys.stderr,
)
# 后续安装 ComfyUI 和插件时保留原生计算环境。
constraints = []
for name in ('torch', 'torchvision', 'torchaudio', 'triton'):
    try:
        constraints.append(f'{name}=={version(name)}\n')
    except PackageNotFoundError:
        pass
Path(os.environ['PIP_CONSTRAINT']).write_text(''.join(constraints))
info = {
    "version": "colab", "runtime": "colab", "plugins_preinstalled": False,
    "torch": torch.__version__, "cuda_toolkit": torch.version.cuda or "",
    "sa2": False,
    "build_date": datetime.now(timezone.utc).isoformat(),
}
Path("/opt/.comfycarry-prebuilt").write_text(json.dumps(info, indent=2))
jupyter_config = Path(os.environ["COMFYCARRY_JUPYTER_CONFIG"])
jupyter_config.parent.mkdir(parents=True, exist_ok=True)
jupyter_config.write_text(json.dumps({"ServerApp": {"jpserver_extensions": {
    "jupyterlab": True, "jupyter_archive": True, "jupyter_server_terminals": True,
}}}, indent=2))
ipython_config = Path(os.environ["IPYTHONDIR"]) / "profile_default/ipython_config.py"
ipython_config.parent.mkdir(parents=True, exist_ok=True)
# /etc/ipython 的 Colab 配置也会作用于新建的应用内核，用户配置优先覆盖它。
ipython_config.write_text(
    "c = get_config()\n"
    "c.IPKernelApp.kernel_class = 'ipykernel.ipkernel.IPythonKernel'\n"
    "c.InteractiveShellApp.extensions = []\n"
    "c.InteractiveShellApp.exec_lines = []\n"
    "c.InteractiveShellApp.matplotlib = None\n"
)
print(f"{major}.{minor} {wheel_tag}")
PY
)
export TORCH_CUDA_ARCH_LIST
gpu_cap="${TORCH_CUDA_ARCH_LIST/./}"

sed -i '/r2u\.stat\.illinois\.edu/d' /etc/apt/sources.list 2>/dev/null || true
grep -rl 'r2u\.stat\.illinois\.edu' /etc/apt/sources.list.d/ 2>/dev/null | xargs -r rm -f

packages=()
for package in openssh-server rsync libportaudio2 aria2; do
    if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null) != installed ]]; then
        packages+=("$package")
    fi
done
if (( ${#packages[@]} )); then
    say "安装系统依赖 (${packages[*]})"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends "${packages[@]}"
fi

if ! command -v node >/dev/null || ! command -v npm >/dev/null || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
    say "安装 Node.js 22"
    node_setup=$(mktemp)
    download https://deb.nodesource.com/setup_22.x "$node_setup"
    bash "$node_setup"
    apt-get install -y --no-install-recommends nodejs
    rm -f "$node_setup"
fi
if ! command -v pm2 >/dev/null; then
    say "安装 PM2"
    npm install -g pm2
fi

if ! command -v cloudflared >/dev/null; then
    say "安装 Cloudflared"
    download https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 /usr/local/bin/cloudflared
    chmod 755 /usr/local/bin/cloudflared
fi

# Wizard 的存储配置页面在部署开始前就调用 rclone。
if ! command -v rclone >/dev/null; then
    say "安装 Rclone"
    rclone_tmp=$(mktemp -d)
    download https://downloads.rclone.org/rclone-current-linux-amd64.zip "$rclone_tmp/rclone.zip"
    unzip -q "$rclone_tmp/rclone.zip" -d "$rclone_tmp"
    rclone_binary=$(find "$rclone_tmp" -mindepth 2 -name rclone -type f -print -quit)
    install -m 755 "$rclone_binary" /usr/local/bin/rclone
    rm -rf "$rclone_tmp"
fi

if [[ ! -f "$COMFYUI_DIR/main.py" ]]; then
    COMFYUI_REF="${COMFYUI_REF:-$(git ls-remote --refs --tags https://github.com/Comfy-Org/ComfyUI.git 'v*' | awk -F/ '{print $NF}' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)}"
    say "克隆 ComfyUI (ref=$COMFYUI_REF -> $COMFYUI_DIR)"
    git clone --depth 1 --branch "$COMFYUI_REF" https://github.com/Comfy-Org/ComfyUI.git "$COMFYUI_DIR"
else
    say "检测到已有 ComfyUI ($COMFYUI_DIR)，跳过克隆"
fi

drive_pairs=(
    "models:$COMFYUI_DIR/models"
    "output:$COMFYUI_DIR/output"
    "input:$COMFYUI_DIR/input"
    "workflows:$COMFYUI_DIR/user/default/workflows"
)
if [[ ! "${DRIVE_MOUNT,,}" =~ ^(0|false|no|off)$ ]] && [[ -d "$DRIVE_ROOT" ]]; then
    drive_base="$DRIVE_ROOT/${DRIVE_DIR#/}"
    say "关联 Google Drive 持久化目录 ($drive_base)"
    for pair in "${drive_pairs[@]}"; do
        drive_sub="${pair%%:*}"
        local_dir="${pair#*:}"
        target_dir="$drive_base/$drive_sub"
        mkdir -p "$target_dir" "$(dirname "$local_dir")"
        if [[ -d "$local_dir" && ! -L "$local_dir" ]]; then
            cp -rn "$local_dir/." "$target_dir/" 2>/dev/null || true
            rm -rf "$local_dir"
        fi
        ln -sfn "$target_dir" "$local_dir"
        echo "  -> $local_dir -> $target_dir"
    done
else
    if [[ "${DRIVE_MOUNT,,}" =~ ^(0|false|no|off)$ ]]; then
        say "已禁用 Google Drive 挂载 (DRIVE_MOUNT=$DRIVE_MOUNT)，使用本地目录"
    else
        say "未检测到 Google Drive 挂载目录 ($DRIVE_ROOT)，使用本地目录"
    fi
    for pair in "${drive_pairs[@]}"; do
        local_dir="${pair#*:}"
        if [[ -L "$local_dir" ]]; then
            rm -f "$local_dir"
            mkdir -p "$local_dir"
        fi
    done
fi
say "安装 ComfyUI 和运行依赖"
"$COMFYCARRY_PYTHON" -m pip install \
    -r "$COMFYUI_DIR/requirements.txt" -r "$INSTALLER_DIR/scripts/colab-requirements.txt"

WHEEL_URL=https://github.com/vvb7456/ComfyCarry/releases/download/wheels-py313-torch2.11.0-cu130
if [[ "$RUNTIME_WHEEL_TAG" == "py313-torch2.11.0-cu130" ]]; then
    while read -r arch digest; do
        [[ "$arch" == "sm$gpu_cap" ]] || continue
        say "安装 SageAttention-2 ($arch)"
        sa_wheel="$WORKSPACE_DIR/.cache/sageattention-2.2.0+cu130torch2.11.0.${arch}-cp313-cp313-linux_x86_64.whl"
        mkdir -p "$(dirname "$sa_wheel")"
        if [[ ! -f "$sa_wheel" ]]; then
            download "$WHEEL_URL/$(basename "$sa_wheel")" "$sa_wheel"
        fi
        printf '%s  %s\n' "$digest" "$sa_wheel" | sha256sum -c -
        "$COMFYCARRY_PYTHON" -m pip install --no-deps "$sa_wheel"
    done <<'WHEELS'
sm80 eae6018ba9cb3e2db6a909b6317c45c8edad36b56114e2b0492ffb264e05395d
sm86 88952d2bf104d447dca86204b9fa1f1f49332f177b95202044eff0e8ea117a91
sm89 0ea5c67e5d39d3921f981736db1ede13355a24e4550b7d3e5f209d32c0063138
sm90 17c528976e236b17814e219db60025ba55f7b13d3b7d9186549dc33c0a21cff7
sm100 ad93884995a1661e9641cc47c1abb977cf54b9a1b74418cec8b589941f5d8b1a
sm120 89e726e0ec7d1cd2094d1513daa7877351123956f6e7d2eb48f52d06fc585547
WHEELS
elif (( gpu_cap >= 80 )); then
    say "当前运行时 ($RUNTIME_WHEEL_TAG) 无预编译 SageAttention-2 wheel，跳过预装"
else
    say "当前 GPU (sm$gpu_cap) 算力低于 8.0，跳过 SageAttention-2 预装"
fi
"$COMFYCARRY_PYTHON" - <<'PY'
import importlib.util
import json
from pathlib import Path

prebuilt_path = Path("/opt/.comfycarry-prebuilt")
info = json.loads(prebuilt_path.read_text())
info["sa2"] = importlib.util.find_spec("sageattention") is not None
prebuilt_path.write_text(json.dumps(info, indent=2))
PY

mkdir -p /run/sshd
ssh-keygen -A
# 保留 Colab 自带的 2222 监听，另补项目 Tunnel 和 SSH 页面约定的 22 端口。
if ! /usr/sbin/sshd -T | grep '^port 22$' >/dev/null; then
    printf '\nPort 22\n' >> /etc/ssh/sshd_config
fi
/usr/sbin/sshd -t
if ! "$COMFYCARRY_PYTHON" -c 'import socket; socket.create_connection(("127.0.0.1", 22), timeout=2).close()' 2>/dev/null; then
    /usr/sbin/sshd -E "$WORKSPACE_DIR/sshd.log" 9>&-
fi
say "启动 ComfyCarry"
bash "$INSTALLER_DIR/bootstrap.sh" 9>&-
"$COMFYCARRY_PYTHON" - <<'PY'
import os
import time
import requests

url = f"http://127.0.0.1:{os.environ.get('MANAGER_PORT', '5000')}/api/version"
for _ in range(60):
    try:
        response = requests.get(url, timeout=3)
        response.raise_for_status()
        print("ComfyCarry 已就绪，请打开上方地址完成配置。")
        break
    except requests.RequestException:
        time.sleep(1)
else:
    raise SystemExit("Dashboard 未就绪，请检查 dashboard.log")
PY
