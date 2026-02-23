#!/bin/bash
# ==============================================================================
# ComfyCarry Bootstrap (v1.0)
#
# 最小化启动脚本 — 只做一件事：让 ComfyCarry 跑起来
# 所有配置和部署逻辑都在 ComfyCarry 向导中完成
#
# 用法:
#   wget -qO- https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh | bash
# ==============================================================================

set -e
set -o pipefail

LOG_FILE="/workspace/setup.log"
mkdir -p /workspace
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  ComfyCarry Bootstrap v1.0"
echo "  $(date)"
echo "================================================="

# 路径准备
ln -snf /workspace /root/workspace 2>/dev/null || true
touch ~/.no_auto_tmux 2>/dev/null || true

# ── 预构建镜像检测 ──
PREBUILT=false
if [ -f /opt/.comfycarry-prebuilt ]; then
    PREBUILT=true
    echo "  -> ✅ 预构建镜像, 跳过依赖安装"
fi

# SSH 修复 (Vast.ai 需要)
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    mkdir -p /run/sshd && ssh-keygen -A 2>/dev/null || true
fi
# vast.ai 在同物理机重建实例时可能复用旧 authorized_keys (属主错误 → sshd 拒绝认证)
if [ -f /root/.ssh/authorized_keys ]; then
    chown root:root /root/.ssh/authorized_keys 2>/dev/null || true
    chmod 600 /root/.ssh/authorized_keys 2>/dev/null || true
fi
pgrep -x sshd >/dev/null || /usr/sbin/sshd 2>/dev/null || true

# ── Python ──
if [ "$PREBUILT" = true ]; then
    PYTHON_BIN=python3
else
    # 优先 3.12 (wheel 在 3.12 上编译验证)
    if command -v python3.12 >/dev/null 2>&1; then
        PYTHON_BIN="python3.12"
    else
        echo "  -> 安装 Python 3.12..."
        apt-get update -qq
        apt-get install -y --no-install-recommends software-properties-common
        add-apt-repository -y ppa:deadsnakes/ppa
        apt-get update -qq
        apt-get install -y python3.12 python3.12-venv python3.12-dev
        PYTHON_BIN="python3.12"
    fi
    echo "  -> 使用 Python: $PYTHON_BIN"
    $PYTHON_BIN -m ensurepip --upgrade 2>/dev/null || true
    $PYTHON_BIN -m pip install --upgrade pip -q
fi

# ── Node.js + PM2 ──
if [ "$PREBUILT" = true ]; then
    echo "  -> Node.js/PM2 已预装, 跳过"
else
    if ! command -v node >/dev/null 2>&1; then
        echo "  -> 安装 Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi

    if ! command -v pm2 >/dev/null 2>&1; then
        echo "  -> 安装 PM2..."
        npm install -g pm2
        pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
    fi
fi

# ── ComfyCarry 依赖 ──
if [ "$PREBUILT" = true ]; then
    echo "  -> ComfyCarry 依赖已预装, 跳过"
else
    echo "  -> 安装 ComfyCarry 依赖..."
    # --ignore-installed: 避免系统包 (如 blinker) 的 uninstall-no-record-file 错误
    $PYTHON_BIN -m pip install --no-cache-dir --ignore-installed flask psutil flask-cors requests websocket-client -q 2>/dev/null || true
fi

# ── Cloudflared (Tunnel) ──
if [ "$PREBUILT" = true ]; then
    echo "  -> Cloudflared 已预装, 跳过"
else
    # 很多实例公网端口映射不可靠, Tunnel 是可靠访问 ComfyCarry 的前提
    if ! command -v cloudflared >/dev/null 2>&1; then
        echo "  -> 安装 Cloudflared..."
        mkdir -p --mode=0755 /usr/share/keyrings
        curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
        echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
        apt-get update -qq
        apt-get install -y cloudflared
    fi
fi

# ── 下载 ComfyCarry 文件 ──
DASHBOARD_DIR="/workspace/ComfyCarry"
REPO_OWNER="vvb7456"
REPO_NAME="ComfyCarry"
BRANCH="main"

mkdir -p "$DASHBOARD_DIR"

if [ ! -f "$DASHBOARD_DIR/workspace_manager.py" ] || [ "${FORCE_UPDATE:-false}" = "true" ]; then
    echo "  -> 下载 ComfyCarry..."
    TARBALL_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.tar.gz"
    TMP_TAR="/tmp/comfycarry_download.tar.gz"
    TMP_EXTRACT="/tmp/comfycarry_extract"

    wget -q -O "$TMP_TAR" "$TARBALL_URL"
    rm -rf "$TMP_EXTRACT"
    mkdir -p "$TMP_EXTRACT"
    tar xzf "$TMP_TAR" -C "$TMP_EXTRACT"

    # 从解压目录复制所需文件
    EXTRACTED="${TMP_EXTRACT}/${REPO_NAME}-${BRANCH}"
    for f in workspace_manager.py dashboard.html setup_wizard.html favicon.ico; do
        [ -f "$EXTRACTED/$f" ] && cp "$EXTRACTED/$f" "$DASHBOARD_DIR/$f"
    done
    # 复制 comfycarry/ Python 包
    if [ -d "$EXTRACTED/comfycarry" ]; then
        rm -rf "$DASHBOARD_DIR/comfycarry"
        cp -r "$EXTRACTED/comfycarry" "$DASHBOARD_DIR/comfycarry"
    fi
    # 复制 static/ 前端模块 (ES Module SPA)
    if [ -d "$EXTRACTED/static" ]; then
        rm -rf "$DASHBOARD_DIR/static"
        cp -r "$EXTRACTED/static" "$DASHBOARD_DIR/static"
    fi
    # 复制 comfycarry_ws_broadcast/ 自定义节点
    if [ -d "$EXTRACTED/comfycarry_ws_broadcast" ]; then
        rm -rf "$DASHBOARD_DIR/comfycarry_ws_broadcast"
        cp -r "$EXTRACTED/comfycarry_ws_broadcast" "$DASHBOARD_DIR/comfycarry_ws_broadcast"
    fi

    rm -rf "$TMP_TAR" "$TMP_EXTRACT"
    echo "  ✅ ComfyCarry 文件已更新"
else
    echo "  -> ComfyCarry 文件已存在，跳过下载 (设置 FORCE_UPDATE=true 强制更新)"
fi

# Write version info
COMMIT_HASH=$(wget -qO- "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${BRANCH}" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null || true)
cat > "$DASHBOARD_DIR/.version" <<EOF
version=v2.4
branch=${BRANCH}
commit=${COMMIT_HASH}
EOF

# ── 启动 ComfyCarry ──
pm2 delete dashboard 2>/dev/null || true

if [ -f "$DASHBOARD_DIR/workspace_manager.py" ]; then
    pm2 start "$PYTHON_BIN" --name dashboard \
        --interpreter none \
        --log /workspace/dashboard.log \
        --time \
        -- "$DASHBOARD_DIR/workspace_manager.py" 5000
    pm2 save 2>/dev/null || true
else
    echo "❌ ComfyCarry 文件下载失败，请检查网络连接"
    exit 1
fi

# ── CF Tunnel (可选 — 让向导页可通过 Tunnel 域名访问) ──
# 如果设置了 CF_TUNNEL_TOKEN 环境变量，bootstrap 阶段就启动 tunnel
# 这样即使公网端口不通，也能通过 tunnel 域名访问 ComfyCarry 向导
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
    echo "  -> 启动 Cloudflare Tunnel..."
    pm2 delete tunnel 2>/dev/null || true
    pm2 start cloudflared --name tunnel \
        --interpreter none \
        --log /workspace/tunnel.log \
        --time \
        -- tunnel run --token "$CF_TUNNEL_TOKEN"
    pm2 save 2>/dev/null || true
    echo "  ✅ Tunnel 已启动，等待连接建立..."
    sleep 3
fi

echo ""
echo "================================================="
echo "  ✅ ComfyCarry 已启动！"
echo ""
echo "  请访问以下地址完成部署向导："
echo "  → http://localhost:5000"
echo ""
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
    echo "  → 可通过你的 Cloudflare Tunnel 域名访问"
fi
echo "  → 公网端口请在 Vast.ai/RunPod 面板查看"
echo "================================================="
