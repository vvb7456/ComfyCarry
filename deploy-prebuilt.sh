#!/bin/bash

# ==============================================================================
# RunPod ComfyUI 自动化部署脚本 (v5.0 预构建镜像版)
# 
# 适用于预装好所有依赖的自定义 Docker 镜像:
#   - ghcr.io/<用户>/comfyui-runpod:cu130-py313-fa3
#
# 预装内容 (无需再安装):
#   ✓ Python 3.13 + PyTorch 2.10.0 (CUDA 13.0)
#   ✓ FlashAttention-3 3.0.0b1 + SageAttention-3 1.0.0
#   ✓ ComfyUI + 15 个常用插件
#   ✓ Node.js 20.x + PM2
#   ✓ rclone, aria2, ffmpeg 等工具
#
# 本脚本只做:
#   1. 环境变量配置
#   2. 更新 ComfyUI 和插件到最新版 (可选)
#   3. Rclone 云资产同步 - R2 (workflow/loras/wildcards)
#   4. 启动服务
#   5. Output 云端同步 - OneDrive / Google Drive (可选)
#   6. 后台模型下载 (可选)
#
# 预计启动时间: 2-5 分钟 (取决于同步内容)
# ==============================================================================

set -e
set -o pipefail

LOG_FILE="/workspace/setup.log"
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  RunPod ComfyUI 部署脚本 (v5.0 预构建镜像版)"
echo "  机器架构: $(uname -m) | 开始时间: $(date)"
echo "================================================="

START_TIME=$(date +%s)

# =================================================
# 1. 变量检查与特性开关
# =================================================
echo "--> [1/5] 初始化配置..."

ln -snf /workspace /root/workspace 2>/dev/null || true
touch ~/.no_auto_tmux

# Python 环境 (镜像已预装)
export PYTHON_BIN="python3.13"
export PIP_BIN="$PYTHON_BIN -m pip"

# 0. 重启 Jupyter 使用自定义 Token（优先执行）
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

# 1.1 更新开关 (默认关闭以加速启动)
UPDATE_COMFYUI=${UPDATE_COMFYUI:-false}
UPDATE_PLUGINS=${UPDATE_PLUGINS:-false}

# 1.2 从 URL 下载 Rclone 配置文件
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

# 1.3 R2 资产同步控制
R2_SYNC_WORKFLOWS=${R2_SYNC_WORKFLOWS:-true}
R2_SYNC_LORAS=${R2_SYNC_LORAS:-true}
R2_SYNC_WILDCARDS=${R2_SYNC_WILDCARDS:-true}

if [ "$ENABLE_R2_SYNC" = true ]; then
    echo "  R2 资产同步: Workflows=$R2_SYNC_WORKFLOWS | Loras=$R2_SYNC_LORAS | Wildcards=$R2_SYNC_WILDCARDS"
fi

# 1.4 Civicomfy (模型下载)
if [ -n "$CIVITAI_TOKEN" ] && [ -n "$ALL_MODEL_IDS" ]; then
    ENABLE_CIVICOMFY=true
    echo "✅ 启用 Civicomfy 模型下载。"
else
    ENABLE_CIVICOMFY=false
fi


# =================================================
# 2. SSH 服务 & Cloudflare Tunnel
# =================================================
echo "--> [2/5] 启动辅助服务..."

# 修复 SSH
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    mkdir -p /run/sshd && ssh-keygen -A
fi
! pgrep -x "sshd" > /dev/null && /usr/sbin/sshd

# Cloudflare Tunnel (需要额外安装)
if [ -n "$CLOUDFLARED_TOKEN" ]; then
    if ! command -v cloudflared >/dev/null 2>&1; then
        echo "  -> 安装 Cloudflared..."
        mkdir -p --mode=0755 /usr/share/keyrings
        curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
        echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
        apt-get update -qq && apt-get install -y cloudflared
    fi
fi

# Workspace Manager (Dashboard) - 提前启动
echo "  -> 安装 Dashboard 依赖..."
$PIP_BIN install --no-cache-dir flask psutil flask-cors requests -q 2>/dev/null || true

# 下载 Dashboard 文件（如果不存在）
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
    echo "✅ Cloudflare Tunnel 已启动 (Dashboard + ComfyUI + Jupyter 均可通过 Tunnel 访问)"
fi
pm2 save 2>/dev/null || true

echo "📍 Dashboard & Tunnel 已就绪，后续步骤将在 Dashboard 中可见"


# =================================================
# 3. ComfyUI 更新 (可选)
# =================================================
echo "--> [3/5] 检查 ComfyUI 状态..."

cd /workspace

# 如果 main.py 不存在，从镜像复制 ComfyUI 核心文件
if [ ! -f /workspace/ComfyUI/main.py ]; then
    echo "  -> 首次启动，从镜像复制 ComfyUI..."
    mkdir -p /workspace/ComfyUI
    cp -r /opt/ComfyUI/* /workspace/ComfyUI/
    echo "  ✓ ComfyUI 已复制到 /workspace"
fi

cd /workspace/ComfyUI

# 更新 ComfyUI (可选)
if [ "$UPDATE_COMFYUI" = true ]; then
    echo "  -> 更新 ComfyUI 到最新版本..."
    git pull --ff-only || echo "⚠️ Git pull 失败，使用现有版本"
    $PIP_BIN install --no-cache-dir -r requirements.txt -q
fi

# 更新插件 (可选)
if [ "$UPDATE_PLUGINS" = true ]; then
    echo "  -> 更新所有插件..."
    find /workspace/ComfyUI/custom_nodes -maxdepth 1 -type d -name ".git" -execdir git pull --ff-only \; 2>/dev/null || true
    find /workspace/ComfyUI/custom_nodes -name "requirements.txt" -type f -print0 | while IFS= read -r -d $'\0' file; do
        $PIP_BIN install --no-cache-dir -r "$file" -q 2>/dev/null || true
    done
fi

# 额外插件安装 (可选)
if [ -n "$PLUGIN_URLS" ]; then
    echo "  -> 安装额外插件..."
    IFS=',' read -r -a PLUGIN_ARRAY <<< "$PLUGIN_URLS"
    for plugin_url in "${PLUGIN_ARRAY[@]}"; do
        plugin_url=$(echo "$plugin_url" | xargs)  # 去除空格
        [ -z "$plugin_url" ] && continue
        
        plugin_name=$(basename "$plugin_url" .git)
        echo "    ✓ $plugin_name"
        
        cd /workspace/ComfyUI/custom_nodes
        if [ ! -d "$plugin_name" ]; then
            git clone --depth 1 "$plugin_url" 2>/dev/null || echo "      ✗ 克隆失败"
        fi
        
        # 安装依赖
        if [ -f "$plugin_name/requirements.txt" ]; then
            $PIP_BIN install --no-cache-dir -r "$plugin_name/requirements.txt" -q 2>/dev/null || true
        fi
    done
    cd /workspace/ComfyUI
fi

echo "✅ ComfyUI 就绪。"


# =================================================
# 4. Rclone 资产同步
# =================================================
echo "--> [4/5] 同步云端资产..."

if [ "$ENABLE_R2_SYNC" = true ]; then
    [ "$R2_SYNC_WORKFLOWS" = true ] && {
        echo "  -> 同步工作流..."
        rclone sync "${R2_REMOTE_NAME}:comfyui-assets/workflow" /workspace/ComfyUI/user/default/workflows/ -P
    }
    [ "$R2_SYNC_LORAS" = true ] && {
        echo "  -> 同步 LoRA..."
        rclone sync "${R2_REMOTE_NAME}:comfyui-assets/loras" /workspace/ComfyUI/models/loras/ -P
    }
    [ "$R2_SYNC_WILDCARDS" = true ] && {
        echo "  -> 同步通配符..."
        rclone sync "${R2_REMOTE_NAME}:comfyui-assets/wildcards" /workspace/ComfyUI/custom_nodes/comfyui-dynamicprompts/wildcards/ -P
    }
    echo "✅ 资产同步完成。"
else
    echo "ℹ️ 跳过资产同步。"
fi

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
echo "✅ jtoken 命令已安装"


# =================================================
# 5. 启动服务
# =================================================
echo "--> [5/5] 启动 ComfyUI 服务..."

# 注: pm2 进程已在 Step 2 中初始化 (dashboard + tunnel)
# 下面只追加 ComfyUI 及同步服务

# Output 云端同步 (OneDrive / Google Drive)
if [ -n "$ONEDRIVE_REMOTE_NAME" ] || [ -n "$GDRIVE_REMOTE_NAME" ]; then
cat <<EOF > /workspace/cloud_sync.sh
#!/bin/bash
SOURCE_DIR="/workspace/ComfyUI/output"

echo "--- Cloud Sync Service Started ---"
echo "  OneDrive: ${ONEDRIVE_REMOTE_NAME:-未配置}"
echo "  Google Drive: ${GDRIVE_REMOTE_NAME:-未配置}"

while true; do
    FOUND_FILES=\$(find "\$SOURCE_DIR" -type f -mmin +0.5 \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.mp4" -o -iname "*.webp" \) ! -path '*/.*' -print -quit)
    
    if [ -n "\$FOUND_FILES" ]; then
        TIME=\$(date '+%H:%M:%S')
        echo "[\$TIME] New files detected. Syncing..."
        
EOF

    # OneDrive 同步块（仅在配置时写入）
    if [ -n "$ONEDRIVE_REMOTE_NAME" ]; then
cat <<EOF >> /workspace/cloud_sync.sh
        # OneDrive 同步
        rclone move "\$SOURCE_DIR" "${ONEDRIVE_REMOTE_NAME}:ComfyUI_Transfer" \\
            --min-age "30s" \\
            --filter "+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}" \\
            --filter "- .*/**" \\
            --filter "- *" \\
            --transfers 4 -v && echo "[\$TIME] OneDrive sync completed"
        
EOF
    fi

    # Google Drive 同步块（仅在配置时写入）
    if [ -n "$GDRIVE_REMOTE_NAME" ]; then
cat <<EOF >> /workspace/cloud_sync.sh
        # Google Drive 同步
        rclone move "\$SOURCE_DIR" "${GDRIVE_REMOTE_NAME}:ComfyUI_Transfer" \\
            --min-age "30s" \\
            --filter "+ *.{png,jpg,jpeg,webp,gif,mp4,mov,webm}" \\
            --filter "- .*/**" \\
            --filter "- *" \\
            --transfers 4 -v && echo "[\$TIME] Google Drive sync completed"
        
EOF
    fi

cat <<EOF >> /workspace/cloud_sync.sh
    fi
    sleep 10
done
EOF
    chmod +x /workspace/cloud_sync.sh
    pm2 start /workspace/cloud_sync.sh --name sync --log /workspace/sync.log
    echo "✅ 云端同步服务已启动 (OneDrive: $([ -n "$ONEDRIVE_REMOTE_NAME" ] && echo '✓' || echo '✗') | Google Drive: $([ -n "$GDRIVE_REMOTE_NAME" ] && echo '✓' || echo '✗'))"
fi

# 启动 ComfyUI
cd /workspace/ComfyUI
pm2 start $PYTHON_BIN --name comfy \
    --interpreter none \
    --log /workspace/comfy.log \
    --time \
    --restart-delay 3000 \
    --max-restarts 10 \
    -- main.py --listen 0.0.0.0 --port 8188 --use-pytorch-cross-attention --fast --disable-xformers

# Cloudflare Tunnel & Dashboard 已在 Step 2 启动

pm2 save
echo "✅ ComfyUI 已启动！"


# =================================================
# 5.5 Civicomfy 模型下载 (后台)
# =================================================
if [ "$ENABLE_CIVICOMFY" = true ]; then
    echo "--> [后台] 开始模型下载..."
    
    # 等待 ComfyUI 完全启动
    sleep 15
    
    # 下载辅助脚本
    [ ! -f /workspace/civicomfy_batch_downloader.py ] && \
        wget -q -O /workspace/civicomfy_batch_downloader.py \
        "https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/civicomfy_batch_downloader.py"
    
    [ ! -f /workspace/auto_generate_csv.py ] && \
        wget -q -O /workspace/auto_generate_csv.py \
        "https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/auto_generate_csv.py"
    
    # 生成模型列表并下载
    if [ -n "$ALL_MODEL_IDS" ]; then
        DOWNLOADED_CSV="/workspace/models_auto_generated.csv"
        
        if $PYTHON_BIN /workspace/auto_generate_csv.py \
            --ids "$ALL_MODEL_IDS" \
            --api-key "$CIVITAI_TOKEN" \
            -o "$DOWNLOADED_CSV"; then
            
            echo "--- 开始批量下载模型 ---"
            
            $PYTHON_BIN /workspace/civicomfy_batch_downloader.py \
                --url "http://localhost:8188" \
                --api-key "$CIVITAI_TOKEN" \
                --csv "$DOWNLOADED_CSV" \
                --wait \
                --timeout 7200 \
                --check-interval 30
            
            echo "✅ 模型下载完成，请检查 pm2 logs comfy"
        fi
    fi
fi


# =================================================
# 6. AuraSR 下载 (后台)
# =================================================
echo "--> [后台] 下载 AuraSR 权重 (日志: /workspace/aurasr_download.log)..."
mkdir -p "/workspace/ComfyUI/models/Aura-SR"
(
    aria2c -x 16 -s 16 --console-log-level=error -d "/workspace/ComfyUI/models/Aura-SR" -o "model.safetensors" \
        "https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true"
    aria2c -x 16 -s 16 --console-log-level=error -d "/workspace/ComfyUI/models/Aura-SR" -o "config.json" \
        "https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true"
) > /workspace/aurasr_download.log 2>&1 &


# =================================================
# 部署报告
# =================================================
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

CUDA_CAP_MAJOR=$($PYTHON_BIN -c "import torch; print(torch.cuda.get_device_capability()[0])" 2>/dev/null || echo "?")
if [ "$CUDA_CAP_MAJOR" -ge 10 ] 2>/dev/null; then
    ARCH_MODE="Blackwell (RTX 5090 / B200)"
elif [ "$CUDA_CAP_MAJOR" -ge 9 ] 2>/dev/null; then
    ARCH_MODE="Hopper (H100 / H200)"
else
    ARCH_MODE="Ada/Ampere (4090 / A100)"
fi

echo "================================================="
echo "  🚀 部署完成！(耗时 ${ELAPSED} 秒)"
echo "  算力架构: $ARCH_MODE"
echo "  服务端口: 8188"
echo "-------------------------------------------------"
echo "  预装加速组件:"
echo "  - FlashAttention-3: 3.0.0b1 ✓"
echo "  - SageAttention-3:  1.0.0 ✓"
echo "-------------------------------------------------"
echo "  R2 资产同步: $([ "$ENABLE_R2_SYNC" = true ] && echo "✓ 已完成" || echo "✗ 未启用")"
echo "  Output 同步:"
[ -n "$ONEDRIVE_REMOTE_NAME" ] && echo "    - OneDrive: ✓ 运行中" || echo "    - OneDrive: ✗ 未配置"
[ -n "$GDRIVE_REMOTE_NAME" ] && echo "    - Google Drive: ✓ 运行中" || echo "    - Google Drive: ✗ 未配置"
echo "  模型下载: $([ "$ENABLE_CIVICOMFY" = true ] && echo "✓ 后台进行中" || echo "✗ 未配置")"
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
echo "    pm2 logs comfy --lines 100  # 查看日志"
echo "    pm2 monit                   # 实时监控"
echo "    pm2 restart comfy           # 重启服务"
echo ""
echo "  🔍 快捷命令:"
echo "    jtoken  # 查看 Jupyter 访问地址和 Token"
echo "================================================="
