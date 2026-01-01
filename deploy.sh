#!/bin/bash

# ==============================================================================
# RunPod ComfyUI 自动化部署脚本 (v3.1 Final)
# 核心特性:
#   1. 架构自适应: 自动识别 Blackwell(sm_120)/Ada/Ampere 并优化编译参数
#   2. 稳健部署: 采用 "先跑通(Vanilla) -> 后加速(Hot-Swap)" 策略
#   3. 极速推理: 集成 SageAttention V2 (Wan2.1 专用) + Torch 2.x
#   4. 新增特性: 放大模型自动下载 / 修正工作流路径 / Tmux鼠标支持
# ==============================================================================

set -e # 遇到错误退出
set -o pipefail

LOG_FILE="/workspace/setup.log"
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  RunPod ComfyUI 部署脚本 (v3.1 SageAttention版)"
echo "  机器架构: $(uname -m)"
echo "  开始时间: $(date)"
echo "================================================="

# =================================================
# 1. 变量检查与特性开关
# =================================================
echo "--> [1/8] 初始化配置..."

# 1.1 Rclone (同步功能)
if [ -n "$RCLONE_CONF_BASE64" ] && [ -n "$R2_REMOTE_NAME" ]; then
    ENABLE_SYNC=true
    echo "✅ 启用 Rclone 云同步。"
else
    ENABLE_SYNC=false
    echo "ℹ️ 未检测到 Rclone 配置，跳过同步。"
fi

# 1.2 CivitAI (模型下载)
if [ -n "$CIVITAI_TOKEN" ]; then
    ENABLE_CIVITDL=true
    echo "✅ 启用 CivitAI 自动下载。"
else
    ENABLE_CIVITDL=false
    echo "ℹ️ 未检测到 CivitAI Token，跳过 CivitDL。"
fi

# 1.3 插件列表 (支持环境变量注入，否则使用默认)
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
        # 推荐：Wan2.1 必备的节点 (SageAttention 包装器或 KJNodes)
        "https://github.com/kijai/ComfyUI-KJNodes"
    )
else
    IFS=',' read -r -a PLUGIN_URLS <<< "$PLUGIN_URLS"
fi


# =================================================
# 2. 基础系统环境
# =================================================
echo "--> [2/8] 安装系统依赖..."

# 配置 Tmux 鼠标支持 (v3.1 新增)
echo "set -g mouse on" > ~/.tmux.conf
echo "✅ Tmux 鼠标支持已开启。"

# 解锁 PIP
[ -f "/usr/lib/python3.12/EXTERNALLY-MANAGED" ] && rm /usr/lib/python3.12/EXTERNALLY-MANAGED
export PIP_BREAK_SYSTEM_PACKAGES=1

# 安装 APT 包
apt-get update -qq
apt-get install -y --no-install-recommends \
    aria2 rclone tmux jq screen git git-lfs ffmpeg \
    libgl1 libglib2.0-0 libsm6 libxext6 ninja-build build-essential python3-dev

git lfs install
echo "✅ 系统环境就绪。"


# =================================================
# 3. ComfyUI 核心安装与健康检查
# =================================================
echo "--> [3/8] 安装 ComfyUI (Vanilla Mode)..."

cd /workspace
git clone https://github.com/comfyanonymous/ComfyUI.git
cd /workspace/ComfyUI

# 安装基础依赖 (确保 torchsde, einops 等被正确安装)
echo "  -> 安装 requirements.txt..."
pip install --no-cache-dir -r requirements.txt

# 试运行 (Health Check)
echo "  -> 执行首次启动检查..."
python main.py --listen 127.0.0.1 --port 8188 > /tmp/comfy_boot.log 2>&1 &
COMFY_PID=$!

# 轮询日志直到看到启动成功信息
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
    echo "❌ 致命错误: ComfyUI 无法启动。日志如下:"
    cat /tmp/comfy_boot.log
    kill $COMFY_PID 2>/dev/null || true
    exit 1
fi

kill $COMFY_PID
wait $COMFY_PID 2>/dev/null || true


# =================================================
# 4. 加速组件注入 (SageAttention & FlashAttn)
# =================================================
echo "--> [4/8] 注入高性能加速组件..."

# 4.1 基础加速库
pip install --no-cache-dir ninja
# 安装 xformers (这会自动拉取最新兼容的 torch，升级当前环境)
pip install --no-cache-dir xformers

# 4.2 SageAttention 智能编译 (Wan2.1 核心优化)
echo "  -> 正在检测 GPU 架构以适配 SageAttention..."
# 获取当前 GPU 算力 (如 8.6, 8.9, 12.0)
COMPUTE_CAP=$(python -c "import torch; print(f'{torch.cuda.get_device_capability()[0]}.{torch.cuda.get_device_capability()[1]}')")
echo "     当前 GPU 算力: sm_${COMPUTE_CAP}"

# 设置编译目标架构，防止在老卡上编译出非法指令，或在新卡上未开启优化
export TORCH_CUDA_ARCH_LIST="${COMPUTE_CAP}"
export MAX_JOBS=8  # 加速编译

echo "  -> 从源码编译 SageAttention V2..."
cd /workspace
# 克隆官方仓库 (通常 release 包滞后，源码最稳)
git clone https://github.com/thu-ml/SageAttention.git
cd SageAttention
# 使用 --no-build-isolation 确保使用系统中的 Torch 和 Ninja
pip install . --no-build-isolation || echo "⚠️ SageAttention 编译失败(非致命)，将回退至标准 Attention。"

# 4.3 Flash Attention
echo "  -> 安装 Flash Attention..."
pip install --no-cache-dir flash-attn --no-build-isolation

# 4.4 补齐 Vision/Audio (适配 Torch 升级后的版本)
echo "  -> 补齐 Torch 配套组件..."
pip install --upgrade --no-cache-dir \
    torchvision \
    torchaudio \
    --extra-index-url https://download.pytorch.org/whl/cu124

echo "✅ 加速环境注入完成 (SageAttention + xformers + FlashAttn)。"


# =================================================
# 5. 插件安装
# =================================================
echo "--> [5/8] 安装插件..."
cd /workspace/ComfyUI/custom_nodes

for plugin in "${PLUGIN_URLS[@]}"; do
    plugin=$(echo "$plugin" | xargs)
    if [ -n "$plugin" ]; then
        repo_name=$(basename "$plugin" .git)
        echo "  -> 克隆: $repo_name"
        git clone "$plugin" || echo "⚠️ 克隆失败: $plugin"
    fi
done

echo "  -> 安装插件依赖..."
find /workspace/ComfyUI/custom_nodes -name "requirements.txt" -type f -print0 | while IFS= read -r -d $'\0' file; do
    pip install --no-cache-dir -r "$file" || echo "⚠️ 依赖警告: $file"
done


# =================================================
# 6. 配置下载工具
# =================================================
echo "--> [6/8] 配置工具..."

if [ "$ENABLE_SYNC" = true ]; then
    mkdir -p ~/.config/rclone
    echo "$RCLONE_CONF_BASE64" | base64 -d > ~/.config/rclone/rclone.conf
    chmod 600 ~/.config/rclone/rclone.conf
fi

if [ "$ENABLE_CIVITDL" = true ]; then
    pip install civitdl
fi


# =================================================
# 7. 资源下载
# =================================================
echo "--> [7/8] 下载资源..."

# Checkpoints (支持 Model ID 或 Version ID)
if [ "$ENABLE_CIVITDL" = true ] && [ -n "$CHECKPOINT_IDS" ]; then
    echo "  -> 下载 Checkpoints..."
    IFS=',' read -r -a CP_IDS <<< "$CHECKPOINT_IDS"
    for id in "${CP_IDS[@]}"; do
        civitdl "$id" /workspace/ComfyUI/models/checkpoints/ -k "$CIVITAI_TOKEN" || echo "⚠️ 下载失败 ID: $id"
    done
fi

# ControlNets
if [ "$ENABLE_CIVITDL" = true ] && [ -n "$CONTROLNET_IDS" ]; then
    echo "  -> 下载 ControlNets..."
    IFS=',' read -r -a CN_IDS <<< "$CONTROLNET_IDS"
    for id in "${CN_IDS[@]}"; do
        civitdl "$id" /workspace/ComfyUI/models/controlnet/ -k "$CIVITAI_TOKEN" || echo "⚠️ 下载失败 ID: $id"
    done
fi

# Upscalers (v3.1 新增)
if [ "$ENABLE_CIVITDL" = true ] && [ -n "$UPSCALER_IDS" ]; then
    echo "  -> 下载 Upscalers..."
    IFS=',' read -r -a UP_IDS <<< "$UPSCALER_IDS"
    mkdir -p /workspace/ComfyUI/models/upscale_models
    for id in "${UP_IDS[@]}"; do
        civitdl "$id" /workspace/ComfyUI/models/upscale_models/ -k "$CIVITAI_TOKEN" || echo "⚠️ 下载失败 ID: $id"
    done
fi

# Rclone Sync
if [ "$ENABLE_SYNC" = true ]; then
    echo "  -> 同步 LoRA..."
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/loras" /workspace/ComfyUI/models/loras/ -P --transfers 8
    
    echo "  -> 同步 Workflows (v3.1 路径修正)..."
    # 修正路径: user/default/workflows
    mkdir -p /workspace/ComfyUI/user/default/workflows
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/workflow" /workspace/ComfyUI/user/default/workflows/ -P --transfers 8
fi

# AuraSR
echo "  -> 下载 AuraSR..."
mkdir -p "/workspace/ComfyUI/models/Aura-SR"
wget --quiet -O "/workspace/ComfyUI/models/Aura-SR/model.safetensors" "https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true"
wget --quiet -O "/workspace/ComfyUI/models/Aura-SR/config.json" "https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true"


# =================================================
# 8. 启动服务
# =================================================
echo "--> [8/8] 启动服务..."

# 创建同步脚本
if [ "$ENABLE_SYNC" = true ]; then
cat <<EOF > /workspace/onedrive_sync.sh
#!/bin/bash
SOURCE_DIR="/workspace/ComfyUI/output"
REMOTE_PATH="${ONEDRIVE_REMOTE_NAME}:ComfyUI_Transfer"
CHECK_INTERVAL=10
MIN_AGE="30s"

while true; do
    if find "\$SOURCE_DIR" -type f -not -path '*/.*' -mmin +0.49 2>/dev/null | read; then
        echo "[Sync] 上传中..."
        rclone move "\$SOURCE_DIR" "\$REMOTE_PATH" \
            --min-age "\$MIN_AGE" \
            --exclude ".*/**" \
            --exclude ".ipynb_checkpoints/**" \
            --ignore-existing \
            --transfers 4 \
            --stats-one-line \
            -P
    fi
    sleep \$CHECK_INTERVAL
done
EOF
    chmod +x /workspace/onedrive_sync.sh
    tmux new-session -d -s sync
    tmux send-keys -t sync "/workspace/onedrive_sync.sh" C-m
    echo "✅ 同步服务已启动 (Tmux: sync)"
fi

# 启动 ComfyUI
tmux new-session -d -s comfy
# 监听 0.0.0.0 以允许外部访问
tmux send-keys -t comfy "cd /workspace/ComfyUI && python main.py --listen 0.0.0.0 --port 8188" C-m
echo "✅ ComfyUI 服务已启动 (Tmux: comfy)"

echo "================================================="
echo "  🚀 部署成功！"
echo "  SageAttention 状态: 已尝试为 sm_${COMPUTE_CAP} 编译"
echo "  日志文件: /workspace/setup.log"
echo "================================================="