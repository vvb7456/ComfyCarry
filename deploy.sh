#!/bin/bash

# ==============================================================================
# RunPod ComfyUI 自动化部署脚本 (v4.6 PM2 版)
# 核心特性:
#   1. 架构自适应: 自动识别 Blackwell/Hopper/Ada 并优化加速组件
#   2. Wheel 预装: 优先使用预编译的 FA3/SA3 Wheel，大幅缩短 GPU 浪费时间
#   3. UI 优先: 核心环境就绪后立即启动 ComfyUI，模型下载在后台并行
#   4. 完整校验: 保留首次启动 Health Check，确保环境百分之百可用
#   5. PM2 管理: 专业进程管理器，提供原生日志体验、自动重启、资源监控
# ==============================================================================

set -e # 遇到错误退出
set -o pipefail

LOG_FILE="/workspace/setup.log"
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  RunPod ComfyUI 部署脚本 (v4.6 PM2 版)"
echo "  机器架构: $(uname -m) | 开始时间: $(date)"
echo "================================================="

# =================================================
# 1. 变量检查与特性开关
# =================================================
echo "--> [1/8] 初始化配置..."

ln -snf /workspace /root/workspace
touch ~/.no_auto_tmux      # 让vast连接ssh时不要自动进入tmux

# 1.1 从 URL 下载 Rclone 配置文件
mkdir -p ~/.config/rclone
ENABLE_R2_SYNC=false

if [ -n "$RCLONE_CONF_URL" ]; then
    echo "  -> 从 URL 下载 rclone.conf..."
    curl -fsSL "$RCLONE_CONF_URL" -o ~/.config/rclone/rclone.conf
    
    if [ $? -eq 0 ] && [ -s ~/.config/rclone/rclone.conf ]; then
        chmod 600 ~/.config/rclone/rclone.conf
        echo "✅ Rclone 配置已下载"
        
        # 自动检测 remote 名称
        R2_REMOTE_NAME=$(grep -E '^\[(r2|.*r2.*)\]' ~/.config/rclone/rclone.conf | head -n1 | tr -d '[]')
        ONEDRIVE_REMOTE_NAME=$(grep -E '^\[(onedrive|.*onedrive.*)\]' ~/.config/rclone/rclone.conf | head -n1 | tr -d '[]')
        GDRIVE_REMOTE_NAME=$(grep -E '^\[(gdrive|.*drive.*)\]' ~/.config/rclone/rclone.conf | head -n1 | tr -d '[]')
        
        # 功能开关（默认启用，可通过环境变量禁用）
        ENABLE_R2=${ENABLE_R2:-true}
        ENABLE_ONEDRIVE=${ENABLE_ONEDRIVE:-true}
        ENABLE_GDRIVE=${ENABLE_GDRIVE:-true}
        
        # 根据开关和配置决定启用哪些功能
        if [ "$ENABLE_R2" = "true" ] && [ -n "$R2_REMOTE_NAME" ]; then
            ENABLE_R2_SYNC=true
        fi
        
        if [ "$ENABLE_ONEDRIVE" != "true" ]; then
            ONEDRIVE_REMOTE_NAME=""
        fi
        
        if [ "$ENABLE_GDRIVE" != "true" ]; then
            GDRIVE_REMOTE_NAME=""
        fi
    else
        echo "❌ URL 下载失败，跳过云同步功能"
    fi
else
    echo "ℹ️ 未设置 RCLONE_CONF_URL，跳过云同步"
fi
# 1.2 R2 同步内容控制 (细粒度开关)
R2_SYNC_WHEELS=${R2_SYNC_WHEELS:-true}      # 预编译包 (推荐启用)
R2_SYNC_WORKFLOWS=${R2_SYNC_WORKFLOWS:-true}  # 工作流
R2_SYNC_LORAS=${R2_SYNC_LORAS:-true}         # LoRA 模型
R2_SYNC_WILDCARDS=${R2_SYNC_WILDCARDS:-true} # 通配符

if [ "$ENABLE_R2_SYNC" = true ]; then
    echo "  R2 同步配置: Wheels=$R2_SYNC_WHEELS | Workflows=$R2_SYNC_WORKFLOWS | Loras=$R2_SYNC_LORAS | Wildcards=$R2_SYNC_WILDCARDS"
fi

# 1.3 Civicomfy (Web UI 模型下载)
if [ -n "$CIVITAI_TOKEN" ] || [ -n "$ALL_MODEL_IDS" ] || [ -n "$CHECKPOINT_IDS" ] || [ -n "$MODEL_CSV_PATH" ]; then
    ENABLE_CIVICOMFY=true
    echo "✅ 启用 Civicomfy 模型下载。"
else
    ENABLE_CIVICOMFY=false
fi

# 1.4 插件列表
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
        "https://github.com/kijai/ComfyUI-KJNodes"
        "https://github.com/BenjaMITM/Enhanced-Civicomfy"
        "https://github.com/pythongosssss/ComfyUI-WD14-Tagger"
        "https://github.com/rgthree/rgthree-comfy"
        "https://github.com/ltdrdata/ComfyUI-Inspire-Pack"
    )
else
    IFS=',' read -r -a PLUGIN_URLS <<< "$PLUGIN_URLS"
fi


# =================================================
# 2. 系统环境初始化
# =================================================
echo "--> [2/8] 配置系统基础环境..."

# 重启 Jupyter 使用自定义 Token（方便 Cloudflare Tunnel 固定配置）
if [ -z "$JUPYTER_TOKEN" ]; then
    # 如果未指定，使用默认固定 Token
    JUPYTER_TOKEN="comfyui-jupyter-default-token-2024"
    echo "  -> 使用默认 Jupyter Token（建议设置环境变量 JUPYTER_TOKEN 自定义）"
else
    echo "  -> 使用自定义 Jupyter Token: ${JUPYTER_TOKEN:0:16}..."
fi

# 停止 Vast/RunPod 自带的 Jupyter
echo "  -> 停止现有 Jupyter 进程..."
pkill -f jupyter-lab 2>/dev/null || true
sleep 2

# 启动自定义配置的 Jupyter Lab
echo "  -> 启动 Jupyter Lab (Token: ${JUPYTER_TOKEN:0:16}...)..."
nohup jupyter-lab \
    --ip=0.0.0.0 \
    --port=8080 \
    --no-browser \
    --ServerApp.token="$JUPYTER_TOKEN" \
    --ServerApp.password='' \
    --ServerApp.allow_remote_access=True \
    --ServerApp.allow_origin='*' \
    --ServerApp.certfile=/etc/instance.crt \
    --ServerApp.keyfile=/etc/instance.key \
    --allow-root \
    > /workspace/jupyter.log 2>&1 &

# 等待 Jupyter 启动
sleep 5
if pgrep -f jupyter-lab > /dev/null; then
    echo "✅ Jupyter Lab 已启动 (端口: 8080, Token: ${JUPYTER_TOKEN:0:16}...)"
    echo "  🔗 访问地址: https://localhost:8080/?token=$JUPYTER_TOKEN"
else
    echo "⚠️ Jupyter Lab 启动失败，检查日志: /workspace/jupyter.log"
fi

# 修复 SSH 问题
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    mkdir -p /run/sshd && ssh-keygen -A
fi
! pgrep -x "sshd" > /dev/null && /usr/sbin/sshd

# 安装必要依赖 (保持原脚本依赖列表)
apt-get update -qq
apt-get install -y --no-install-recommends \
    software-properties-common git git-lfs aria2 rclone jq curl \
    ffmpeg libgl1 libglib2.0-0 libsm6 libxext6 build-essential

# 安装 Cloudflare Tunnel (如果提供了 Token)
if [ -n "$CLOUDFLARED_TOKEN" ]; then
    echo "  -> 检测到 CLOUDFLARED_TOKEN，安装 Cloudflared..."
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq
    apt-get install -y cloudflared
fi

# 安装 Node.js 20.x LTS (PM2 需要)
if ! command -v node >/dev/null 2>&1; then
    echo "  -> 安装 Node.js 20.x LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 安装 PM2 进程管理器
if ! command -v pm2 >/dev/null 2>&1; then
    echo "  -> 安装 PM2 进程管理器..."
    npm install -g pm2
    pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
fi

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

# 安装 HuggingFace 加速下载工具
$PIP_BIN install --no-cache-dir hf_transfer

# Workspace Manager (Dashboard) - 提前启动
echo "  -> 安装 Dashboard 依赖..."
$PIP_BIN install --no-cache-dir flask psutil flask-cors requests -q 2>/dev/null || true

DASHBOARD_DIR="/workspace/ComfyUI_RunPod_Sync"
if [ ! -f "$DASHBOARD_DIR/workspace_manager.py" ]; then
    echo "  -> 下载 Dashboard 文件..."
    mkdir -p "$DASHBOARD_DIR"
    for f in workspace_manager.py dashboard.html dashboard.js; do
        wget -q -O "$DASHBOARD_DIR/$f" \
            "https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/$f" 2>/dev/null || true
    done
fi

# 启动 Dashboard & Tunnel (提前，用户可立即查看部署状态)
pm2 delete all 2>/dev/null || true

if [ -f "$DASHBOARD_DIR/workspace_manager.py" ]; then
    pm2 start $PYTHON_BIN --name dashboard \
        --interpreter none \
        --log /workspace/dashboard.log \
        --time \
        -- "$DASHBOARD_DIR/workspace_manager.py" 5000
    echo "✅ Dashboard 已启动 (端口: 5000)"
fi

if [ -n "$CLOUDFLARED_TOKEN" ]; then
    pm2 start cloudflared --name tunnel -- tunnel run --token "$CLOUDFLARED_TOKEN"
    echo "✅ Cloudflare Tunnel 已启动"
fi
pm2 save 2>/dev/null || true
echo "📍 Dashboard & Tunnel 已就绪，后续安装步骤将在 Dashboard 中可见"

# 创建 jtoken 快捷命令脚本
cat > /usr/local/bin/jtoken << 'JTOKEN_EOF'
#!/bin/bash
# 快捷命令：查看 Jupyter 访问地址

echo '🔍 正在查找 Jupyter 信息...'
JUPYTER_TOKEN=$(ps aux | grep '[j]upyter-lab' | grep -oP 'token=\K[a-zA-Z0-9-]+' | head -1)
JUPYTER_PORT=$(ps aux | grep '[j]upyter-lab' | grep -oP -- '--port=\K[0-9]+' | head -1)

if [ -z "$JUPYTER_TOKEN" ]; then
    echo '❌ Jupyter Lab 未运行'
    exit 1
fi

echo ''
echo '📊 Jupyter Lab 信息:'
echo "  端口: ${JUPYTER_PORT:-未知}"
echo "  Token: $JUPYTER_TOKEN"
echo ''

# 尝试获取 Cloudflare Tunnel 域名
if command -v pm2 >/dev/null 2>&1; then
    JUPYTER_DOMAIN=$(pm2 logs tunnel --nostream --lines 100 2>/dev/null | grep -oP 'dest=https://jupyter[^/]+' | head -1 | sed 's/dest=https:\/\///')
    if [ -n "$JUPYTER_DOMAIN" ]; then
        echo '🌐 公网访问地址:'
        echo "  https://$JUPYTER_DOMAIN/?token=$JUPYTER_TOKEN"
        echo ''
    fi
fi

echo '🔗 本地访问地址:'
echo "  http://localhost:${JUPYTER_PORT}/?token=$JUPYTER_TOKEN"
JTOKEN_EOF

chmod +x /usr/local/bin/jtoken

echo "✅ 系统环境就绪: $($PYTHON_BIN --version)"
echo "✅ jtoken 命令已安装 (输入 'jtoken' 查看 Jupyter 访问信息)"


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

# 优先从 GitHub Release 下载预编译包
GITHUB_RELEASE_URL="https://github.com/vvb7456/ComfyUI_RunPod_Sync/releases/download/v4.5-wheels"
echo "  -> 正在从 GitHub Release 下载预编译 Wheel..."

# FlashAttention-3 (abi3 通用版本)
wget -q -O /workspace/prebuilt_wheels/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl \
    "${GITHUB_RELEASE_URL}/flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl" \
    || echo "⚠️ FlashAttention-3 wheel 下载失败"

# SageAttention-3 (根据 Python 版本选择)
if [ "$PY_VER" = "cp313" ]; then
    wget -q -O /workspace/prebuilt_wheels/sageattn3-1.0.0-cp313-cp313-linux_x86_64.whl \
        "${GITHUB_RELEASE_URL}/sageattn3-1.0.0-cp313-cp313-linux_x86_64.whl" \
        || echo "⚠️ SageAttention-3 (cp313) wheel 下载失败"
elif [ "$PY_VER" = "cp312" ]; then
    wget -q -O /workspace/prebuilt_wheels/sageattn3-1.0.0-cp312-cp312-linux_x86_64.whl \
        "${GITHUB_RELEASE_URL}/sageattn3-1.0.0-cp312-cp312-linux_x86_64.whl" \
        || echo "⚠️ SageAttention-3 (cp312) wheel 下载失败"
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

echo "✅ 自定义节点安装完成。"


# =================================================
# 6. Rclone 核心数据同步 (Workflows/Loras/Wildcards)
# =================================================
echo "--> [6/8] 同步核心资产 (启动前必备)..."

if [ "$ENABLE_R2_SYNC" = true ]; then
    [ "$R2_SYNC_WORKFLOWS" = true ] && rclone sync "${R2_REMOTE_NAME}:comfyui-assets/workflow" /workspace/ComfyUI/user/default/workflows/ -P
    [ "$R2_SYNC_LORAS" = true ] && rclone sync "${R2_REMOTE_NAME}:comfyui-assets/loras" /workspace/ComfyUI/models/loras/ -P
    [ "$R2_SYNC_WILDCARDS" = true ] && rclone sync "${R2_REMOTE_NAME}:comfyui-assets/wildcards" /workspace/ComfyUI/custom_nodes/comfyui-dynamicprompts/wildcards/ -P
    echo "✅ 核心资产同步完成。"
fi


# =================================================
# 7. 启动服务 (正式运行)
# =================================================
echo "--> [7/8] 启动 ComfyUI 服务..."

# 注: pm2 进程已在 Step 2 中初始化 (dashboard + tunnel)
# 下面只追加 ComfyUI 及同步服务

# Output 云端同步服务 (OneDrive / Google Drive)
if [ -n "$ONEDRIVE_REMOTE_NAME" ] || [ -n "$GDRIVE_REMOTE_NAME" ]; then
cat <<EOF > /workspace/cloud_sync.sh
#!/bin/bash
SOURCE_DIR="/workspace/ComfyUI/output"

echo "--- Cloud Sync Service Started ---"
[ -n "$ONEDRIVE_REMOTE_NAME" ] && echo "  OneDrive: \${ONEDRIVE_REMOTE_NAME}:ComfyUI_Transfer"
[ -n "$GDRIVE_REMOTE_NAME" ] && echo "  Google Drive: \${GDRIVE_REMOTE_NAME}:ComfyUI_Transfer"
echo "Watching: \$SOURCE_DIR"

while true; do
    # 检查是否有超过 30 秒未变动的图片/视频文件
    FOUND_FILES=\$(find "\$SOURCE_DIR" -type f -mmin +0.5 \\( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.webp" -o -iname "*.gif" -o -iname "*.mp4" -o -iname "*.mov" -o -iname "*.avi" -o -iname "*.webm" -o -iname "*.mkv" \\) ! -path '*/.*' -print -quit)

    if [ -n "\$FOUND_FILES" ]; then
        TIME=\$(date '+%H:%M:%S')
        echo "[\$TIME] New files detected. Syncing..."

        # OneDrive 同步
        if [ -n "$ONEDRIVE_REMOTE_NAME" ]; then
            rclone move "\$SOURCE_DIR" "\${ONEDRIVE_REMOTE_NAME}:ComfyUI_Transfer" \\
                --min-age "30s" \\
                --filter "+ *.{png,jpg,jpeg,webp,gif,mp4,mov,avi,webm,mkv,PNG,JPG,JPEG,WEBP,GIF,MP4,MOV,AVI,WEBM,MKV}" \\
                --filter "- .*/**" \\
                --filter "- _*" \\
                --filter "- *" \\
                --ignore-existing \\
                --transfers 4 \\
                --stats-one-line \\
                -v

            if [ \$? -eq 0 ]; then
                echo "[\$TIME] OneDrive sync completed."
            else
                echo "[\$TIME] OneDrive sync failed or partial."
            fi
        fi
        
        # Google Drive 同步
        if [ -n "$GDRIVE_REMOTE_NAME" ]; then
            rclone move "\$SOURCE_DIR" "\${GDRIVE_REMOTE_NAME}:ComfyUI_Transfer" \\
                --min-age "30s" \\
                --filter "+ *.{png,jpg,jpeg,webp,gif,mp4,mov,avi,webm,mkv,PNG,JPG,JPEG,WEBP,GIF,MP4,MOV,AVI,WEBM,MKV}" \\
                --filter "- .*/**" \\
                --filter "- _*" \\
                --filter "- *" \\
                --ignore-existing \\
                --transfers 4 \\
                --stats-one-line \\
                -v

            if [ \$? -eq 0 ]; then
                echo "[\$TIME] Google Drive sync completed."
            else
                echo "[\$TIME] Google Drive sync failed or partial."
            fi
        fi
    fi
    sleep 10
done
EOF
    chmod +x /workspace/cloud_sync.sh
    pm2 start /workspace/cloud_sync.sh --name sync --log /workspace/sync.log
    echo "✅ 云端同步服务已启动 (OneDrive: $([ -n "$ONEDRIVE_REMOTE_NAME" ] && echo '✓' || echo '✗') | Google Drive: $([ -n "$GDRIVE_REMOTE_NAME" ] && echo '✓' || echo '✗'))"
fi

# 启动 ComfyUI 主服务
cd /workspace/ComfyUI
pm2 start $PYTHON_BIN --name comfy \
    --interpreter none \
    --log /workspace/comfy.log \
    --time \
    --restart-delay 3000 \
    --max-restarts 10 \
    -- main.py --listen 0.0.0.0 --port 8188 --use-pytorch-cross-attention --fast --disable-xformers

# Cloudflare Tunnel & Dashboard 已在 Step 2 启动

# 保存 PM2 配置 (重启后自动恢复)
pm2 save

echo "✅ ComfyUI 已启动！(PM2: comfy)"
echo "  → 等待 20 秒让 ComfyUI 完全启动..."
sleep 20


# =================================================
# 7.5 Civicomfy 自动配置和模型下载 (启动后)
# =================================================
if [ "$ENABLE_CIVICOMFY" = true ]; then
    echo "--> [7.5/8] 配置 Civicomfy 和批量下载模型..."
    
    if [ -z "$CIVITAI_TOKEN" ]; then
        echo "⚠️ 警告: CIVITAI_TOKEN 未设置，跳过 Civicomfy 下载"
    else
        # 下载批量下载脚本（如果本地不存在）
        if [ ! -f /workspace/civicomfy_batch_downloader.py ]; then
            echo "  -> 下载批量下载脚本..."
            wget -q -O /workspace/civicomfy_batch_downloader.py \
                "https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/civicomfy_batch_downloader.py" \
                || echo "⚠️ 脚本下载失败，检查是否已存在"
        fi
        
        # 下载 CSV 自动生成脚本
        if [ ! -f /workspace/auto_generate_csv.py ]; then
            echo "  -> 下载 CSV 自动生成脚本..."
            wget -q -O /workspace/auto_generate_csv.py \
                "https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/auto_generate_csv.py" \
                || echo "⚠️ 脚本下载失败"
        fi
        
        # 安装 Python 脚本依赖
        echo "  -> 安装 requests 库..."
        $PIP_BIN install --no-cache-dir requests >/dev/null 2>&1
        
        # 从环境变量自动生成模型列表
        MODELS_SOURCE=""
        
        if [ -n "$ALL_MODEL_IDS" ]; then
            echo "  -> 从环境变量自动生成模型列表..."
            DOWNLOADED_CSV="/workspace/models_auto_generated.csv"
            
            if $PYTHON_BIN /workspace/auto_generate_csv.py \
                --ids "$ALL_MODEL_IDS" \
                --api-key "$CIVITAI_TOKEN" \
                -o "$DOWNLOADED_CSV"; then
                
                MODELS_SOURCE="--csv $DOWNLOADED_CSV"
                echo "  ✓ 模型列表自动生成成功"
            else
                echo "  ✗ 模型列表生成失败"
            fi
        fi
        
        # 执行下载
        if [ -n "$MODELS_SOURCE" ]; then
            echo "--- 开始批量下载模型（前台等待，可能需要几分钟到几小时） ---"
            
            $PYTHON_BIN /workspace/civicomfy_batch_downloader.py \
                --url "http://localhost:8188" \
                --api-key "$CIVITAI_TOKEN" \
                $MODELS_SOURCE \
                --wait \
                --timeout 7200 \
                --check-interval 30 \
                || echo "⚠️ Civicomfy 模型下载出现错误或超时，但继续执行"
            
            echo "✅ Civicomfy 模型配置和下载完成。"
        else
            echo "ℹ️ 未指定模型列表，跳过自动下载。可通过 Web UI 手动下载。"
        fi
    fi
fi


# =================================================
# 8. 资源下载 (启动后并行下载模型)
# =================================================
echo "--> [8/8] 开始后台大文件下载任务..."

# 注: CivitDL 已由 Civicomfy 的 REST API 方式替代 (更简洁、更无人值守)

# 8.2 AuraSR 下载
echo "  -> [AuraSR] 后台下载 AuraSR V2 权重 (日志: /workspace/aurasr_download.log)..."
mkdir -p "/workspace/ComfyUI/models/Aura-SR"
(
    aria2c -x 16 -s 16 --console-log-level=error -d "/workspace/ComfyUI/models/Aura-SR" -o "model.safetensors" "https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true"
    aria2c -x 16 -s 16 --console-log-level=error -d "/workspace/ComfyUI/models/Aura-SR" -o "config.json" "https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true"
) > /workspace/aurasr_download.log 2>&1 &

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
echo "  资产同步: $(if [ "$ENABLE_R2_SYNC" = true ]; then echo "已完成 (R2 -> Local)"; else echo "未启用"; fi)"
echo "  Output同步:"
[ -n "$ONEDRIVE_REMOTE_NAME" ] && echo "    - OneDrive: ✓ 运行中 (PM2: sync)" || echo "    - OneDrive: ✗ 未配置"
[ -n "$GDRIVE_REMOTE_NAME" ] && echo "    - Google Drive: ✓ 运行中 (PM2: sync)" || echo "    - Google Drive: ✗ 未配置"
echo "  模型下载: 请查看主日志确认进度。"
echo "-------------------------------------------------"

# 自动检测并显示 Jupyter 访问信息
JUPYTER_TOKEN=$(ps aux | grep '[j]upyter-lab' | grep -oP 'token=\K[a-zA-Z0-9-]+' | head -1)
JUPYTER_PORT=$(ps aux | grep '[j]upyter-lab' | grep -oP -- '--port=\K[0-9]+' | head -1)

if [ -n "$JUPYTER_TOKEN" ]; then
    echo "  🔗 Jupyter Lab 访问信息:"
    echo "    Token: $JUPYTER_TOKEN"
    
    # 尝试从 Cloudflare Tunnel 日志中提取 Jupyter 域名
    if [ -n "$CLOUDFLARED_TOKEN" ]; then
        JUPYTER_DOMAIN=$(pm2 logs tunnel --nostream --lines 100 2>/dev/null | grep -oP 'dest=https://jupyter[^/]+' | head -1 | sed 's/dest=https:\/\///')
        if [ -n "$JUPYTER_DOMAIN" ]; then
            echo "    公网访问: https://$JUPYTER_DOMAIN/?token=$JUPYTER_TOKEN"
        fi
    fi
    echo "    本地访问: http://localhost:${JUPYTER_PORT}/?token=$JUPYTER_TOKEN"
    echo ""
fi

echo "  📊 PM2 管理命令:"
echo "    pm2 logs comfy --lines 100  # 查看 ComfyUI 日志"
echo "    pm2 monit                   # 实时监控资源"
echo "    pm2 restart comfy           # 重启服务"
echo "    pm2 status                  # 查看进程状态"
echo ""
echo "  🔍 快捷命令:"
echo "    jtoken  # 查看 Jupyter 访问地址和 Token"
echo "================================================="