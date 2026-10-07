#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${COMFYCARRY_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/content}"
export COMFYUI_DIR="${COMFYUI_DIR:-$WORKSPACE_DIR/ComfyUI}"
export COMFYCARRY_RUNTIME=colab
export COMFYCARRY_PYTHON="$WORKSPACE_DIR/.comfycarry-venv/bin/python"
export VIRTUAL_ENV="$WORKSPACE_DIR/.comfycarry-venv"
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export HF_HOME="${HF_HOME:-$WORKSPACE_DIR/.cache/huggingface}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$WORKSPACE_DIR/.cache/uv}"
export VIRTUALENV_OVERRIDE_APP_DATA="$WORKSPACE_DIR/.cache/virtualenv"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_ROOT_USER_ACTION=ignore
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

BIN_DIR="$WORKSPACE_DIR/.comfycarry-bin"
export PATH="$VIRTUAL_ENV/bin:$BIN_DIR:$PATH"
mkdir -p "$WORKSPACE_DIR" "$BIN_DIR"
exec 9>"$WORKSPACE_DIR/.comfycarry-install.lock"
if ! flock -n 9; then
    echo "另一个 ComfyCarry 安装任务正在运行。" >&2
    exit 1
fi
exec > >(tee -a "$WORKSPACE_DIR/colab-install.log") 2>&1
trap 'echo "安装失败：第 $LINENO 行。日志：$WORKSPACE_DIR/colab-install.log" >&2' ERR

say() { echo "==> $*"; }
download() { curl --fail --location --retry 3 --connect-timeout 30 "$1" -o "$2"; }
package_installed() { [[ $(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null) == installed ]]; }

say "检查 Colab 现有基础环境"
command -v nvidia-smi >/dev/null
nvidia-smi --query-gpu=name,driver_version,compute_cap --format=csv,noheader
for tool in git curl wget jq ffmpeg cmake make g++ sshd nvcc node npm; do
    if command -v "$tool" >/dev/null; then
        echo "  复用 $tool：$(command -v "$tool")"
    fi
done

# 这些包不在 Wizard 的 apt 清单里；编译 Python 扩展与 MediaPipe 需要它们。
packages=()
for package in ca-certificates wget gnupg gawk tar gzip \
    python3.12 python3.12-dev python3.12-venv cmake pkg-config \
    libjpeg-dev libpng-dev libtiff-dev libffi-dev libssl-dev libnuma-dev \
    libxrender1 libportaudio2 openssh-server passwd procps iproute2 unzip rsync; do
    if [[ "$package" == cmake ]] && command -v cmake >/dev/null; then continue; fi
    if ! package_installed "$package"; then packages+=("$package"); fi
done
if (( ${#packages[@]} )); then
    say "补齐基础环境缺失包：${packages[*]}"
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
    export PATH="$VIRTUAL_ENV/bin:$BIN_DIR:/usr/bin:$PATH"
    rm -f "$node_setup"
fi
if ! command -v pm2 >/dev/null; then
    say "安装 PM2"
    npm install -g pm2
fi

if ! command -v cloudflared >/dev/null; then
    say "安装 Cloudflared"
    download https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 "$BIN_DIR/cloudflared"
    chmod 755 "$BIN_DIR/cloudflared"
fi

# Wizard 的存储配置页面在部署开始前就调用 rclone；私有路径避免后续 apt 安装旧版覆盖它。
if ! command -v rclone >/dev/null; then
    say "安装 Wizard 配置页面需要的 Rclone"
    rclone_tmp=$(mktemp -d)
    download https://downloads.rclone.org/rclone-current-linux-amd64.zip "$rclone_tmp/rclone.zip"
    unzip -q "$rclone_tmp/rclone.zip" -d "$rclone_tmp"
    rclone_binary=$(find "$rclone_tmp" -mindepth 2 -name rclone -type f -print -quit)
    install -m 755 "$rclone_binary" "$BIN_DIR/rclone"
    rm -f "$rclone_tmp/rclone.zip"
fi

if [[ ! -x "$COMFYCARRY_PYTHON" ]]; then
    say "创建 Python 3.12 应用环境，不改动 Colab 的内核 Python"
    /usr/bin/python3.12 -m venv --system-site-packages "$VIRTUAL_ENV"
fi
"$COMFYCARRY_PYTHON" -m pip install --upgrade pip 'setuptools<81' wheel Cython
export PIP_CONSTRAINT="$SOURCE_DIR/scripts/colab-constraints.txt"
export UV_CONSTRAINT="$PIP_CONSTRAINT"
export PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cu130
# SAM2 等节点的构建脚本会导入已安装的 torch，不能另建未配置 CUDA 的构建环境。
export PIP_NO_BUILD_ISOLATION=0

say "准备 Wizard 不负责安装的 PyTorch"
"$COMFYCARRY_PYTHON" -m pip install torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 \
    --index-url https://download.pytorch.org/whl/cu130
"$COMFYCARRY_PYTHON" - <<'PY'
import os
import torch

if not torch.cuda.is_available():
    raise SystemExit("应用环境不能使用 CUDA")
capability = torch.cuda.get_device_capability()
if capability < (7, 5):
    raise SystemExit("GPU 计算能力必须至少为 7.5")
value = torch.randn(16, 16, device="cuda")
value @ value
torch.cuda.synchronize()
print(f"Python 应用环境：torch={torch.__version__} CUDA={torch.version.cuda} GPU={torch.cuda.get_device_name(0)}")
PY
export TORCH_CUDA_ARCH_LIST=$("$COMFYCARRY_PYTHON" -c 'import torch; print("%d.%d" % torch.cuda.get_device_capability())')

if ! "$CUDA_HOME/bin/nvcc" --version | grep -q 'release 13\.0'; then
    say "补齐与项目 cu130 软件栈匹配的 CUDA 编译链"
    if ! apt-cache show cuda-minimal-build-13-0 >/dev/null 2>&1; then
        cuda_keyring=$(mktemp --suffix=.deb)
        download https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb "$cuda_keyring"
        dpkg -i "$cuda_keyring"
        rm -f "$cuda_keyring"
    fi
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends cuda-minimal-build-13-0
    export CUDA_HOME=/usr/local/cuda-13.0
    export PATH="$CUDA_HOME/bin:$PATH"
    "$CUDA_HOME/bin/nvcc" --version
fi

say "准备 /opt/ComfyUI 主体，工作区复制和插件安装仍由 Wizard 完成"
if [[ ! -f /opt/ComfyUI/main.py ]]; then
    COMFYUI_REF="${COMFYUI_REF:-$(git ls-remote --refs --tags https://github.com/Comfy-Org/ComfyUI.git 'v*' | awk -F/ '{print $NF}' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)}"
    git clone --depth 1 --branch "$COMFYUI_REF" https://github.com/Comfy-Org/ComfyUI.git /opt/ComfyUI
fi
"$COMFYCARRY_PYTHON" -m pip install -r /opt/ComfyUI/requirements.txt

say "补齐 Dashboard、Jupyter 和未被节点 requirements 声明的镜像依赖"
"$COMFYCARRY_PYTHON" -m pip install --no-build-isolation -r "$SOURCE_DIR/scripts/colab-requirements.txt"

gpu_cap=$("$COMFYCARRY_PYTHON" -c 'import torch; a,b=torch.cuda.get_device_capability(); print(a*10+b)')
if (( gpu_cap >= 80 )); then
    say "安装 Wizard 只负责验证的 FlashAttention-2"
    fa_wheel="$WORKSPACE_DIR/.cache/flash_attn-2.8.3-cp312-cp312-linux_x86_64.whl"
    mkdir -p "$(dirname "$fa_wheel")"
    if [[ ! -f "$fa_wheel" ]]; then
        download https://github.com/vvb7456/ComfyCarry/releases/download/wheels-v1/flash_attn-2.8.3-cp312-cp312-linux_x86_64.whl "$fa_wheel"
    fi
    printf '%s  %s\n' 59ea923cbbaed5528e0550246e8bd48dad885372d78a1dc9e072ea658ac77112 "$fa_wheel" | sha256sum -c -
    "$COMFYCARRY_PYTHON" -m pip install --no-deps "$fa_wheel"
    "$COMFYCARRY_PYTHON" -c 'import flash_attn; print(f"FlashAttention-2 {flash_attn.__version__}")'
else
    say "计算能力 7.5：沿用项目默认 Attention，不安装不适用的 FA2"
fi

say "准备 SA2 wheel，安装及架构选择留给 Wizard"
mkdir -p /opt/wheels/sa2
while read -r arch digest; do
    wheel="sageattention-2.2.0-cp312-cp312-linux_x86_64_${arch}.whl"
    if [[ ! -f "/opt/wheels/sa2/$wheel" ]]; then
        download "https://github.com/vvb7456/ComfyCarry/releases/download/wheels-v1/$wheel" "/opt/wheels/sa2/$wheel"
    fi
    printf '%s  %s\n' "$digest" "/opt/wheels/sa2/$wheel" | sha256sum -c -
done <<'WHEELS'
sm80 2e93a587b39817367bb4340ab3e500fd19d4df95069a73dfad80e3614eb52aec
sm86 9c83c79b94aa0442177dc4b1a502c96587f764ff49c0add84b2ab9ee51caa707
sm89 b7895c614e9efebcf2d6373593239b18a206d663055538a5261e466cc8ec81b3
sm90 cb12ae89a247c5d7bea3799ce63a2bad07b2633d4436ba4f5d32b7cd361c0276
sm100 26e6105944ff68476801375e85b2f204943eddfc1b4c7b48cea998f4f78d9a88
sm120 62d8dfbfba684152208960456adae3a980e35657b5ced9922bd7bbf36153a433
WHEELS

say "构建与当前后端一致的前端"
if [[ -f "$SOURCE_DIR/frontend/package.json" ]]; then
    (
        cd "$SOURCE_DIR/frontend"
        npm ci
        bash build-fonts.sh
        npm run build
    )
fi
test -s "$SOURCE_DIR/static/dist/index.html"
test -s "$SOURCE_DIR/static/dist/wizard.html"

"$COMFYCARRY_PYTHON" - <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import flask, flask_cors, websocket, dynamicprompts
import openai, anthropic, google.genai, jupyterlab
import torch

info = {
    "version": "colab", "runtime": "colab", "plugins_preinstalled": False,
    "python": f"{sys.version_info.major}.{sys.version_info.minor}",
    "torch": torch.__version__, "cuda_toolkit": torch.version.cuda,
    "fa2": torch.cuda.get_device_capability() >= (8, 0),
    "sa2_archs": ["sm80", "sm86", "sm89", "sm90", "sm100", "sm120"],
    "build_date": datetime.now(timezone.utc).isoformat(),
}
Path("/opt/.comfycarry-prebuilt").write_text(json.dumps(info, indent=2))
extensions = {}
for path in (Path(sys.prefix) / "etc/jupyter/jupyter_server_config.d").glob("*.json"):
    extensions.update(json.loads(path.read_text()).get("ServerApp", {}).get("jpserver_extensions", {}))
jupyter_config = Path(os.environ["COMFYCARRY_JUPYTER_CONFIG"])
jupyter_config.parent.mkdir(parents=True, exist_ok=True)
jupyter_config.write_text(json.dumps({"ServerApp": {"jpserver_extensions": extensions}}, indent=2))
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
print("基础运行环境检查通过；插件和实际部署留给 Wizard。")
PY

# bootstrap/PM2 的后续进程需要同一套 PATH、Python、编译和依赖约束。
env_file="$WORKSPACE_DIR/.comfycarry-colab-env"
umask 077
{
    for key in WORKSPACE_DIR COMFYUI_DIR COMFYCARRY_RUNTIME COMFYCARRY_PYTHON VIRTUAL_ENV \
        CUDA_HOME HF_HOME UV_CACHE_DIR VIRTUALENV_OVERRIDE_APP_DATA PATH PIP_CONSTRAINT \
        UV_CONSTRAINT PIP_EXTRA_INDEX_URL PIP_NO_BUILD_ISOLATION MAX_JOBS TORCH_CUDA_ARCH_LIST \
        PUBLIC_TUNNEL JUPYTER_NO_CONFIG JUPYTER_DATA_DIR JUPYTER_RUNTIME_DIR COMFYCARRY_JUPYTER_CONFIG IPYTHONDIR; do
        printf 'export %s=%q\n' "$key" "${!key}"
    done
} > "$env_file"

mkdir -p /run/sshd
ssh-keygen -A
# 保留 Colab 自带的 2222 监听，另补项目 Tunnel 和 SSH 页面约定的 22 端口。
if ! /usr/sbin/sshd -T | grep '^listenaddress .*:22$' >/dev/null; then
    printf '\nPort 22\nListenAddress 127.0.0.1:22\n' >> /etc/ssh/sshd_config
fi
/usr/sbin/sshd -t
if ! "$COMFYCARRY_PYTHON" -c 'import socket; socket.create_connection(("127.0.0.1", 22), timeout=2).close()' 2>/dev/null; then
    /usr/sbin/sshd -E "$WORKSPACE_DIR/sshd.log" 9>&-
fi
for pair in management_agent.py:comfycarry-management-agent.py usage_collector.py:comfycarry-usage-collector.py system_monitor.py:system_monitor.py; do
    install -m 644 "$SOURCE_DIR/comfycarry/services/${pair%%:*}" "/opt/${pair##*:}"
done
install -m 644 "$SOURCE_DIR/comfycarry/services/management_agent.py" /opt/management_agent.py

say "启动 ComfyCarry，继续使用原有 Wizard 完成配置和部署"
bash "$SOURCE_DIR/bootstrap.sh" 9>&-
"$COMFYCARRY_PYTHON" - <<'PY'
import os
import time
import requests

url = f"http://127.0.0.1:{os.environ.get('MANAGER_PORT', '5000')}/api/version"
for _ in range(60):
    try:
        response = requests.get(url, timeout=3)
        response.raise_for_status()
        print("ComfyCarry 已就绪，请打开上方项目 Tunnel 地址完成 Wizard。")
        break
    except requests.RequestException:
        time.sleep(1)
else:
    raise SystemExit("Dashboard 未就绪，请检查 dashboard.log")
PY
