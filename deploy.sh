#!/bin/bash

# ==============================================================================
# RunPod ComfyUI 自动化部署脚本 (v4.5 极速启动完全版)
# 核心特性:
#   1. 架构自适应: 自动识别 Blackwell/Hopper/Ada 并优化加速组件
#   2. Wheel 预装: 优先使用预编译的 FA3/SA3 Wheel，大幅缩短 GPU 浪费时间
#   3. UI 优先: 核心环境就绪后立即启动 ComfyUI，模型下载在后台并行
#   4. 完整校验: 保留首次启动 Health Check，确保环境百分之百可用
# ==============================================================================

set -e # 遇到错误退出
set -o pipefail

LOG_FILE="/workspace/setup.log"
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  RunPod ComfyUI 部署脚本 (v4.5 完全版)"
echo "  机器架构: $(uname -m) | 开始时间: $(date)"
echo "================================================="

# =================================================
# 1. 变量检查与特性开关
# =================================================
echo "--> [1/8] 初始化配置..."

ln -snf /workspace /root/workspace

# 1.1 Rclone (同步功能)
if [ -n "$RCLONE_CONF_BASE64" ] && [ -n "$R2_REMOTE_NAME" ]; then
    ENABLE_SYNC=true
    echo "✅ 启用 Rclone 云同步。"
else
    ENABLE_SYNC=false
    echo "ℹ️ 未检测到 Rclone 配置，跳过同步。"
fi

# 1.2 CivitAI (模型下载)
if [ -n "$CIVITAI_TOKEN" ] || [ -n "$ALL_MODEL_IDS" ] || [ -n "$CHECKPOINT_IDS" ]; then
    ENABLE_CIVITDL=true
    echo "✅ 启用 CivitDL 智能下载。"
else
    ENABLE_CIVITDL=false
fi

# 1.3 插件列表
if [ -z "$PLUGIN_URLS" ]; then
    PLUGIN_URLS=(
        "https://github.com/ltdrdata/ComfyUI-Manager"
        "https://github.com/Fannovel16/comfyui_controlnet_aux"
        "https://github.com/ltdrdata/ComfyUI-Impact-Pack"
        "https://github.com/yolain/ComfyUI-Easy-Use"
        "https://github.com/crystian/ComfyUI-Crystools"
        "https://github.com/ssitu/ComfyUI_UltimateSDUpscale"
        "https://github.com/adieyal/comfyui-dynamicprompts"
        "https://github.com/weilin9999/WeiLin-Comfyui-Tools"
        "https://github.com/GreenLandisaLie/AuraSR-ComfyUI"
        "https://github.com/ltdrdata/was-node-suite-comfyui"
        "https://github.com/weilin9999/WeiLin-ComfyUI-prompt-all-in-one"
        "https://github.com/kijai/ComfyUI-KJNodes"
    )
else
    IFS=',' read -r -a PLUGIN_URLS <<< "$PLUGIN_URLS"
fi


# =================================================
# 2. 系统环境初始化
# =================================================
echo "--> [2/8] 配置系统基础环境..."

# 修复 SSH 问题
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    mkdir -p /run/sshd && ssh-keygen -A
fi
! pgrep -x "sshd" > /dev/null && /usr/sbin/sshd

# 配置 Tmux
echo "set -g mouse on" > ~/.tmux.conf
touch ~/.no_auto_tmux

# 安装必要依赖 (保持原脚本依赖列表)
apt-get update -qq
apt-get install -y --no-install-recommends \
    software-properties-common git git-lfs aria2 rclone jq \
    ffmpeg libgl1 libglib2.0-0 libsm6 libxext6 build-essential

# Python 3.13 准备（SageAttention3 需要）
if ! command -v python3.13 >/dev/null 2>&1; then
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -qq
    apt-get install -y python3.13 python3.13-venv python3.13-distutils python3.13-dev
fi

export PYTHON_BIN="python3.13"
export PIP_BIN="$PYTHON_BIN -m pip"

# 将系统默认 python 指向 3.13，避免后续依赖调用旧版
PY313_BIN=$(command -v python3.13)
ln -sf "$PY313_BIN" /usr/local/bin/python
ln -sf "$PY313_BIN" /usr/bin/python || true

# 环境路径与基础工具升级
export PATH="/usr/local/bin:$PATH"
$PYTHON_BIN -m ensurepip --upgrade
$PIP_BIN install --upgrade pip setuptools packaging ninja

# 统一安装 torch 2.9.1 (CUDA 12.8) 以匹配 Py3.13
TORCH_INDEX="https://download.pytorch.org/whl/cu128"
$PIP_BIN install --no-cache-dir torch==2.9.1 --index-url "$TORCH_INDEX"

# Rclone 配置文件注入 (提前注入，以便后续拉取 Wheel)
if [ "$ENABLE_SYNC" = true ]; then
    mkdir -p ~/.config/rclone
    echo "$RCLONE_CONF_BASE64" | base64 -d > ~/.config/rclone/rclone.conf
    chmod 600 ~/.config/rclone/rclone.conf
fi

echo "✅ 系统环境就绪: $($PYTHON_BIN --version)"


# =================================================
# 3. ComfyUI 安装与首次启动健康检查
# =================================================
echo "--> [3/8] 安装 ComfyUI (Vanilla Mode)..."

cd /workspace
if [ -d /workspace/ComfyUI ]; then
    rm -rf /workspace/ComfyUI
fi
git clone https://github.com/comfyanonymous/ComfyUI.git
cd /workspace/ComfyUI

echo "  -> 安装基础 requirements.txt..."
$PIP_BIN install --no-cache-dir -r requirements.txt

# --- 保留原脚本健康检查逻辑 ---
echo "  -> 执行首次启动环境自检..."
$PYTHON_BIN main.py --listen 127.0.0.1 --port 8188 > /tmp/comfy_boot.log 2>&1 &
COMFY_PID=$!

MAX_RETRIES=30
BOOT_SUCCESS=false
for ((i=1; i<=MAX_RETRIES; i++)); do
    if grep -q "To see the GUI go to" /tmp/comfy_boot.log; then
        echo "✅ ComfyUI 基础环境启动成功。"
        BOOT_SUCCESS=true
        break
    fi
    sleep 2
done

if [ "$BOOT_SUCCESS" = false ]; then
    echo "❌ 致命错误: ComfyUI 基础环境无法启动。"
    cat /tmp/comfy_boot.log
    kill $COMFY_PID 2>/dev/null || true
    exit 1
fi
kill $COMFY_PID
wait $COMFY_PID 2>/dev/null || true


# =================================================
# 4. 加速组件注入 (Wheel 优先 + 源码回退)
# =================================================
echo "--> [4/8] 注入加速组件 (FA3 & SA3)..."

CUDA_CAP_MAJOR=$($PYTHON_BIN -c "import torch; print(torch.cuda.get_device_capability()[0])" 2>/dev/null)
PY_VER=$($PYTHON_BIN -c "import sys; print(f'cp{sys.version_info.major}{sys.version_info.minor}')")

mkdir -p /workspace/prebuilt_wheels
if [ -n "$RCLONE_CONF_BASE64" ]; then
    echo "  -> 正在从 R2 检索预编译 Wheel..."
    rclone copy "${R2_REMOTE_NAME}:comfyui-assets/wheels/" /workspace/prebuilt_wheels/ -P || echo "⚠️ 未能拉取预编译包"
fi

# 4.1 FlashAttention 安装
if [ "$CUDA_CAP_MAJOR" -ge 9 ]; then
    FA_WHEEL="/workspace/prebuilt_wheels/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl"
    if [ -f "$FA_WHEEL" ] && $PIP_BIN install "$FA_WHEEL"; then
        FA_INSTALL_TYPE="Pre-built Wheel (abi3)"
    else
        echo "⚠️ Wheel 缺失或不兼容，开始源码编译 FA3..."
        cd /workspace && git clone https://github.com/Dao-AILab/flash-attention.git
        cd flash-attention/hopper && MAX_JOBS=8 $PYTHON_BIN setup.py install
        cd /workspace && rm -rf flash-attention
        FA_INSTALL_TYPE="Source Compiled (Hopper/Blackwell)"
    fi
else
    $PIP_BIN install --no-cache-dir flash-attn --no-build-isolation
    FA_INSTALL_TYPE="Standard Install (FA2)"
fi

# 4.2 SageAttention 安装
if [ "$CUDA_CAP_MAJOR" -ge 10 ]; then
    SA_WHEEL=$(ls /workspace/prebuilt_wheels/sageattn3-1.0.0-${PY_VER}-*.whl 2>/dev/null | head -n 1)
    if [ -n "$SA_WHEEL" ] && $PIP_BIN install "$SA_WHEEL"; then
        SA_INSTALL_TYPE="Pre-built Wheel ($PY_VER)"
    else
        echo "⚠️ $PY_VER Wheel 缺失，开始源码编译 SA3..."
        cd /workspace && git clone https://github.com/thu-ml/SageAttention.git
        cd SageAttention/sageattention3_blackwell && $PYTHON_BIN setup.py install
        cd /workspace && rm -rf SageAttention
        SA_INSTALL_TYPE="Source Compiled (Blackwell Native)"
    fi
else
    cd /workspace && git clone https://github.com/thu-ml/SageAttention.git
    cd SageAttention && $PIP_BIN install . --no-build-isolation
    cd /workspace && rm -rf SageAttention
    SA_INSTALL_TYPE="Source Compiled (SA2 General)"
fi

rm -rf /workspace/prebuilt_wheels
echo "✅ 加速组件安装完成。"


# =================================================
# 5. 插件安装
# =================================================
echo "--> [5/8] 安装自定义节点插件..."
cd /workspace/ComfyUI/custom_nodes

for plugin in "${PLUGIN_URLS[@]}"; do
    plugin=$(echo "$plugin" | xargs)
    if [ -n "$plugin" ]; then
        git clone "$plugin" || echo "⚠️ 克隆失败: $plugin"
    fi
done

echo "  -> 批量安装插件依赖..."
find /workspace/ComfyUI/custom_nodes -name "requirements.txt" -type f -print0 | while IFS= read -r -d $'\0' file; do
    $PIP_BIN install --no-cache-dir -r "$file" || echo "⚠️ 依赖安装警告: $file"
done
echo "✅ 插件环境构建完成。"


# =================================================
# 6. Rclone 核心数据同步 (Workflows/Loras/Wildcards)
# =================================================
echo "--> [6/8] 同步核心资产 (启动前必备)..."

if [ "$ENABLE_SYNC" = true ]; then
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/workflow" /workspace/ComfyUI/user/default/workflows/ -P
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/loras" /workspace/ComfyUI/models/loras/ -P
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/wildcards" /workspace/ComfyUI/custom_nodes/comfyui-dynamicprompts/wildcards/ -P
    echo "✅ 核心资产同步完成。"
fi


# =================================================
# 7. 启动服务 (正式运行)
# =================================================
echo "--> [7/8] 启动 ComfyUI 服务..."

# 启动 OneDrive 同步后台服务 (如果开启)
if [ "$ENABLE_SYNC" = true ]; then
cat <<EOF > /workspace/onedrive_sync.sh
#!/bin/bash
SOURCE_DIR="/workspace/ComfyUI/output"
REMOTE_PATH="${ONEDRIVE_REMOTE_NAME}:ComfyUI_Transfer"

echo "--- Sync Service Started ---"
echo "Watching: \$SOURCE_DIR"
echo "Target:   \$REMOTE_PATH"

while true; do
    # 检查是否有超过 30 秒未变动的文件
    FOUND_FILES=\$(find "\$SOURCE_DIR" -type f -mmin +0.5 ! -path '*/.*' -print -quit)

    if [ -n "\$FOUND_FILES" ]; then
        TIME=\$(date '+%H:%M:%S')
        echo "[\$TIME] New files detected. Uploading..."

        rclone move "\$SOURCE_DIR" "\$REMOTE_PATH" \\
            --min-age "30s" \\
            --exclude ".*/**" \\
            --ignore-existing \\
            --transfers 4 \\
            --stats-one-line \\
            -v

        if [ \$? -eq 0 ]; then
            echo "[\$TIME] Upload Success."
        else
            echo "[\$TIME] Upload Failed or Partial."
        fi
    fi
    sleep 10
done
EOF
    chmod +x /workspace/onedrive_sync.sh
    tmux has-session -t sync 2>/dev/null && tmux kill-session -t sync
    tmux new-session -d -s sync "/workspace/onedrive_sync.sh"
    echo "✅ 后台同步服务已启动 (Tmux: sync)"
fi

# 启动 ComfyUI
tmux has-session -t comfy 2>/dev/null && tmux kill-session -t comfy
tmux new-session -d -s comfy
tmux send-keys -t comfy "cd /workspace/ComfyUI && $PYTHON_BIN main.py --listen 0.0.0.0 --port 8188 --use-pytorch-cross-attention --fast --disable-xformers" C-m

echo "✅ ComfyUI 已启动！(Tmux: comfy)"


# =================================================
# 8. 资源下载 (启动后并行下载模型)
# =================================================
echo "--> [8/8] 开始后台大文件下载任务..."

# 8.1 CivitDL 处理

if [ "$ENABLE_CIVITDL" = true ]; then
    echo "  -> [CivitDL] 正在安装并配置工具..."
    $PIP_BIN install civitdl
    
    # 1. 注入 API Key 配置文件 (完全还原 JSON 字段)
    mkdir -p ~/.config/civitdl
    TOKEN_VAL="${CIVITAI_TOKEN:-}"
    
    cat <<EOF > ~/.config/civitdl/config.json
{
  "version": "1",
  "default": {
    "api_key": "$TOKEN_VAL",
    "sorter": "basic",
    "max_images": 2,
    "nsfw_mode": "2",
    "with_prompt": true,
    "without_model": false,
    "limit_rate": "0",
    "retry_count": 5,
    "pause_time": 2.0,
    "cache_mode": "1",
    "strict_mode": "0",
    "model_overwrite": false,
    "with_color": true
  },
  "sorters": [],
  "aliases": []
}
EOF
    echo "✅ CivitDL 配置文件已注入。"

    cat <<EOF > /workspace/runpod_sorter.py
from civitdl.api.sorter import SorterData
import os

def sort_model(model_dict, version_dict, filename, root_path):
    raw_type = model_dict.get('type', 'unknown')
    m_type = raw_type.lower()
    print(f"  -> [Sorter] 处理: {model_dict.get('name')} | 类型: {raw_type}")

    type_map = {
        "checkpoint": "checkpoints",
        "lora": "loras",
        "locon": "loras",
        "dora": "loras",
        "controlnet": "controlnet",
        "vae": "vae",
        "upscaler": "upscale_models",
        "motionmodule": "animatediff_models"
    }
    
    target_subfolder = type_map.get(m_type, "extras")
    final_dir = os.path.join(root_path, target_subfolder, model_dict.get('name', 'Unknown_Model'))
    
    return SorterData(final_dir, final_dir, final_dir, final_dir)
EOF

    # 3. 整合 ID 并启动下载
    RAW_IDS="${CHECKPOINT_IDS},${CONTROLNET_IDS},${UPSCALER_IDS},${LORA_IDS},${ALL_MODEL_IDS}"
    CLEAN_IDS=$(echo "$RAW_IDS" | tr ',' '\n' | grep -v '^\s*$' | sort -u | tr '\n' ',' | sed 's/,$//')

    if [ -n "$CLEAN_IDS" ]; then
        BATCH_FILE="/workspace/civitai_batch.txt"
        echo "$CLEAN_IDS" > "$BATCH_FILE"
        echo "  -> 启动 CivitDL 批量下载..."
        $PYTHON_BIN -m civitdl "$BATCH_FILE" "/workspace/ComfyUI/models" \
            --sorter "/workspace/runpod_sorter.py" \
            || echo "⚠️ CivitDL 下载出现部分错误"
    fi
fi

# 8.2 AuraSR 下载
echo "  -> [AuraSR] 正在下载 AuraSR V2 权重..."
mkdir -p "/workspace/ComfyUI/models/Aura-SR"
aria2c -x 16 -s 16 --console-log-level=error -d "/workspace/ComfyUI/models/Aura-SR" -o "model.safetensors" "https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true"
aria2c -x 16 -s 16 --console-log-level=error -d "/workspace/ComfyUI/models/Aura-SR" -o "config.json" "https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true"

# --- [修改版 结尾] 最终部署报告 ---
if [ "$CUDA_CAP_MAJOR" -ge 10 ]; then
    ARCH_MODE="Blackwell (RTX 5090 / B200)"
elif [ "$CUDA_CAP_MAJOR" -ge 9 ]; then
    ARCH_MODE="Hopper (H100 / H200)"
else
    ARCH_MODE="Ada/Ampere (4090 / A100 / etc.)"
fi

echo "================================================="
echo "  🚀 部署完成！"
echo "  算力架构: $ARCH_MODE (sm_${CUDA_CAP_MAJOR})"
echo "  服务端口: 8188"
echo "-------------------------------------------------"
echo "  加速组件安装状态:"
echo "  - FlashAttention: $FA_INSTALL_TYPE"
echo "  - SageAttention:  $SA_INSTALL_TYPE"
echo "-------------------------------------------------"
echo "  资产同步: $(if [ "$ENABLE_SYNC" = true ]; then echo "已完成 (R2 -> Local)"; else echo "未启用"; fi)"
echo "  后台同步: $(if [ "$ENABLE_SYNC" = true ]; then echo "运行中 (Tmux: sync)"; else echo "未启用"; fi)"
echo "  模型下载: 请查看主日志确认进度。"
echo "================================================="