#!/bin/bash
# ==============================================================================
# ComfyUI Dashboard Bootstrap (v1.0)
#
# 最小化启动脚本 — 只做一件事：让 Dashboard 跑起来
# 所有配置和部署逻辑都在 Dashboard 向导中完成
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
echo "  ComfyUI Dashboard Bootstrap v1.0"
echo "  $(date)"
echo "================================================="

# 路径准备
ln -snf /workspace /root/workspace 2>/dev/null || true
touch ~/.no_auto_tmux 2>/dev/null || true

# SSH 修复 (Vast.ai 需要)
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    mkdir -p /run/sshd && ssh-keygen -A 2>/dev/null || true
fi
pgrep -x sshd >/dev/null || /usr/sbin/sshd 2>/dev/null || true

# ── Python 3.13 ──
if ! command -v python3.13 >/dev/null 2>&1; then
    echo "  -> 安装 Python 3.13..."
    apt-get update -qq
    apt-get install -y --no-install-recommends software-properties-common
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -qq
    apt-get install -y python3.13 python3.13-venv python3.13-dev
fi

PYTHON_BIN="python3.13"
$PYTHON_BIN -m ensurepip --upgrade 2>/dev/null || true
$PYTHON_BIN -m pip install --upgrade pip -q

# ── Node.js + PM2 ──
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

# ── Dashboard 依赖 ──
echo "  -> 安装 Dashboard 依赖..."
# --ignore-installed: 避免系统包 (如 blinker) 的 uninstall-no-record-file 错误
$PYTHON_BIN -m pip install --no-cache-dir --ignore-installed flask psutil flask-cors requests -q 2>/dev/null || true

# ── Cloudflared (Tunnel) ──
# 很多实例公网端口映射不可靠, Tunnel 是可靠访问 Dashboard 的前提
if ! command -v cloudflared >/dev/null 2>&1; then
    echo "  -> 安装 Cloudflared..."
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq
    apt-get install -y cloudflared
fi

# ── 下载 Dashboard 文件 ──
DASHBOARD_DIR="/workspace/ComfyCarry"
REPO_URL="https://raw.githubusercontent.com/vvb7456/ComfyCarry/main"

mkdir -p "$DASHBOARD_DIR"
for f in workspace_manager.py dashboard.html dashboard.js setup_wizard.html favicon.ico; do
    if [ ! -f "$DASHBOARD_DIR/$f" ] || [ "${FORCE_UPDATE:-false}" = "true" ]; then
        echo "  -> 下载 $f..."
        wget -q -O "$DASHBOARD_DIR/$f" "$REPO_URL/$f" || true
    fi
done

# Write version info
COMMIT_HASH=$(wget -qO- "https://api.github.com/repos/vvb7456/ComfyCarry/commits/main" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null || true)
cat > "$DASHBOARD_DIR/.version" <<EOF
version=v2.4
branch=main
commit=${COMMIT_HASH}
EOF

# ── 启动 Dashboard ──
pm2 delete dashboard 2>/dev/null || true

if [ -f "$DASHBOARD_DIR/workspace_manager.py" ]; then
    pm2 start "$PYTHON_BIN" --name dashboard \
        --interpreter none \
        --log /workspace/dashboard.log \
        --time \
        -- "$DASHBOARD_DIR/workspace_manager.py" 5000
    pm2 save 2>/dev/null || true
else
    echo "❌ Dashboard 文件下载失败，请检查网络连接"
    exit 1
fi

# ── CF Tunnel (可选 — 让向导页可通过 Tunnel 域名访问) ──
# 如果设置了 CF_TUNNEL_TOKEN 环境变量，bootstrap 阶段就启动 tunnel
# 这样即使公网端口不通，也能通过 tunnel 域名访问 Dashboard 向导
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
echo "  ✅ Dashboard 已启动！"
echo ""
echo "  请访问以下地址完成部署向导："
echo "  → http://localhost:5000"
echo ""
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
    echo "  → 可通过你的 Cloudflare Tunnel 域名访问"
fi
echo "  → 公网端口请在 Vast.ai/RunPod 面板查看"
echo "================================================="
