#!/bin/bash

# ==============================================================================
# RunPod ComfyUI 自动化部署脚本 (v3.2 CivitDL Parallel)
# 核心特性:
#   1. 架构自适应: 自动识别 Blackwell/Ada/Ampere 并优化编译参数
#   2. 智能下载: 整合 CivitDL 批量下载 + 自动分类 (Sorter) + 免交互 Token
#   3. 极速推理: 集成 SageAttention V2 (Wan2.1 专用) + Torch 2.4+
#   4. 目录清洗: 自动将模型分流至 checkpoints/loras/vae 等正确目录
# ==============================================================================

set -e # 遇到错误退出
set -o pipefail

LOG_FILE="/workspace/setup.log"
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  RunPod ComfyUI 部署脚本 (v3.2 CivitDL版)"
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
# 只要有 Token 或者有 ID 列表，就启用下载工具
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
# 2. 基础系统环境
# =================================================
echo "--> [2/8] 安装系统依赖..."

echo "set -g mouse on" > ~/.tmux.conf

# 解锁 PIP
[ -f "/usr/lib/python3.12/EXTERNALLY-MANAGED" ] && rm /usr/lib/python3.12/EXTERNALLY-MANAGED
export PIP_BREAK_SYSTEM_PACKAGES=1

# 安装 APT 包
apt-get update -qq
apt-get install -y --no-install-recommends \
    aria2 rclone tmux jq screen git git-lfs ffmpeg \
    cuda-toolkit libgl1 libglib2.0-0 libsm6 libxext6 ninja-build build-essential python3-dev

git lfs install


# =================================================
# 3. ComfyUI 核心安装与健康检查
# =================================================
echo "--> [3/8] 安装 ComfyUI (Vanilla Mode)..."

cd /workspace
git clone https://github.com/comfyanonymous/ComfyUI.git
cd /workspace/ComfyUI

echo "  -> 安装 requirements.txt..."
pip install --no-cache-dir -r requirements.txt

# 试运行 (Health Check)
echo "  -> 执行首次启动检查..."
python main.py --listen 127.0.0.1 --port 8188 > /tmp/comfy_boot.log 2>&1 &
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
    echo "❌ 致命错误: ComfyUI 无法启动。"
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

pip install --no-cache-dir ninja xformers

# 修复 PyTorch CUDA 版本检查
TORCH_CPP_EXT=$(python -c "import torch.utils.cpp_extension as t; print(t.__file__)")
sed -i 's/raise RuntimeError(CUDA_MISMATCH_MESSAGE/print("⚠️ [Auto-Fix] Ignoring CUDA Mismatch: " + CUDA_MISMATCH_MESSAGE/g' "$TORCH_CPP_EXT"

# 获取算力并编译 SageAttention
COMPUTE_CAP=$(python -c "import torch; print(f'{torch.cuda.get_device_capability()[0]}.{torch.cuda.get_device_capability()[1]}')")
echo "     当前 GPU 算力: sm_${COMPUTE_CAP}"
export TORCH_CUDA_ARCH_LIST="${COMPUTE_CAP}"
export MAX_JOBS=8

cd /workspace
git clone https://github.com/thu-ml/SageAttention.git
cd SageAttention
pip install . --no-build-isolation || echo "⚠️ SageAttention 编译失败(非致命)。"

pip install --no-cache-dir flash-attn --no-build-isolation
pip install --upgrade --no-cache-dir torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cu124


# =================================================
# 5. 插件安装
# =================================================
echo "--> [5/8] 安装插件..."
cd /workspace/ComfyUI/custom_nodes

for plugin in "${PLUGIN_URLS[@]}"; do
    plugin=$(echo "$plugin" | xargs)
    if [ -n "$plugin" ]; then
        git clone "$plugin" || echo "⚠️ 克隆失败: $plugin"
    fi
done

echo "  -> 安装插件依赖..."
find /workspace/ComfyUI/custom_nodes -name "requirements.txt" -type f -print0 | while IFS= read -r -d $'\0' file; do
    pip install --no-cache-dir -r "$file" || echo "⚠️ 依赖警告: $file"
done


# =================================================
# 6. 配置工具 (CivitDL & Rclone)
# =================================================
echo "--> [6/8] 配置工具..."

# 6.1 Rclone
if [ "$ENABLE_SYNC" = true ]; then
    mkdir -p ~/.config/rclone
    echo "$RCLONE_CONF_BASE64" | base64 -d > ~/.config/rclone/rclone.conf
    chmod 600 ~/.config/rclone/rclone.conf
fi

# 6.2 CivitDL 安装与配置注入
if [ "$ENABLE_CIVITDL" = true ]; then
    pip install civitdl
    
    # 注入 API Key 到配置文件，绕过交互输入
    mkdir -p ~/.config/civitdl
    
    # 如果 Token 为空，则留空字符串，避免 JSON 语法错误
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
    echo "✅ CivitDL 配置文件已注入 (~/.config/civitdl/config.json)"
fi


# =================================================
# 7. 资源下载 (修正版: 去除后台等待，防止卡死)
# =================================================
echo "--> [7/8] 下载资源..."

# -------------------------------------------------
# 7.1 生成自定义分类器 (Sorter)
# -------------------------------------------------
if [ "$ENABLE_CIVITDL" = true ]; then
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
fi

# -------------------------------------------------
# 7.2 整合 ID 并批量下载
# -------------------------------------------------
RAW_IDS="${CHECKPOINT_IDS},${CONTROLNET_IDS},${UPSCALER_IDS},${LORA_IDS},${ALL_MODEL_IDS}"
CLEAN_IDS=$(echo "$RAW_IDS" | tr ',' '\n' | grep -v '^\s*$' | sort -u | tr '\n' ',' | sed 's/,$//')

if [ "$ENABLE_CIVITDL" = true ] && [ -n "$CLEAN_IDS" ]; then
    BATCH_FILE="/workspace/civitai_batch.txt"
    echo "$CLEAN_IDS" > "$BATCH_FILE"
    
    echo "  -> 启动 CivitDL 批量下载..."
    # 这里的 civitdl 是同步运行的，下载完才会走下一步
    civitdl "$BATCH_FILE" "/workspace/ComfyUI/models" \
        --sorter "/workspace/runpod_sorter.py" \
        || echo "⚠️ CivitDL 下载出现部分错误 (不影响后续启动)"
fi

# -------------------------------------------------
# 7.3 其他资源 (Rclone / AuraSR) - 关键修正点
# -------------------------------------------------
if [ "$ENABLE_SYNC" = true ]; then
    echo "  -> [Sync] 同步 Rclone 数据..."
    # ⚠️ 修正：去掉了 & 和 wait，强制前台运行。
    # 如果 Rclone 卡住，你会直接看到它卡在哪，而不是看着 100% 发呆
    mkdir -p /workspace/ComfyUI/user/default/workflows
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/workflow" /workspace/ComfyUI/user/default/workflows/ -P --transfers 8
    
    # 如果你也同步 LoRA，请取消下面注释（同样去掉了 &）
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/loras" /workspace/ComfyUI/models/loras/ -P --transfers 8
    mkdir -p /workspace/ComfyUI/custom_nodes/comfyui-dynamicprompts/wildcards
    rclone sync "${R2_REMOTE_NAME}:comfyui-assets/wildcards" /workspace/ComfyUI/custom_nodes/comfyui-dynamicprompts/wildcards/ -P --transfers 8
fi

echo "  -> [Download] 下载 AuraSR..."
mkdir -p "/workspace/ComfyUI/models/Aura-SR"

# ⚠️ 修正：改用 aria2c 前台下载，速度快且有进度条
aria2c -x 8 -s 8 --console-log-level=error --summary-interval=1 \
    -d "/workspace/ComfyUI/models/Aura-SR" \
    -o "model.safetensors" \
    "https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true"

aria2c -x 8 -s 8 --console-log-level=error --summary-interval=1 \
    -d "/workspace/ComfyUI/models/Aura-SR" \
    -o "config.json" \
    "https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true"

echo "✅ 资源下载阶段完成。"

# =================================================
# 8. 启动服务
# =================================================
echo "--> [8/8] 启动服务..."

if [ "$ENABLE_SYNC" = true ]; then
cat <<EOF > /workspace/onedrive_sync.sh
#!/bin/bash
SOURCE_DIR="/workspace/ComfyUI/output"
REMOTE_PATH="${ONEDRIVE_REMOTE_NAME}:ComfyUI_Transfer"
while true; do
    if find "\$SOURCE_DIR" -type f -mmin +0.49 2>/dev/null | read; then
        rclone move "\$SOURCE_DIR" "\$REMOTE_PATH" --min-age "30s" --exclude ".*/**" --ignore-existing --transfers 4 -P
    fi
    sleep 10
done
EOF
    chmod +x /workspace/onedrive_sync.sh
    tmux new-session -d -s sync "/workspace/onedrive_sync.sh"
    echo "✅ 同步服务已启动 (Tmux: sync)"
fi

# 启动 ComfyUI
tmux new-session -d -s comfy
tmux send-keys -t comfy "cd /workspace/ComfyUI && python main.py --listen 0.0.0.0 --port 8188" C-m
echo "✅ ComfyUI 服务已启动 (Tmux: comfy)"

echo "================================================="
echo "  🚀 部署完成！"
echo "  模型下载日志: 查看上方输出"
echo "================================================="