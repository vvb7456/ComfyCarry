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

# ── 预构建镜像校验 ──
if [ ! -f /opt/.comfycarry-prebuilt ]; then
    echo "  ⚠️  未检测到 ComfyCarry 预构建镜像"
    echo "  请使用官方预构建镜像: ghcr.io/vvb7456/comfyui-runpod"
fi
PYTHON_BIN=python3

# SSH 已由 entrypoint.sh 处理 (SSH Key + sshd)

# ── Python ──
# 预构建镜像已含 Python 3.12
echo "  -> Python: $PYTHON_BIN"

# ── Node.js + PM2 ──
echo "  -> Node.js/PM2 已预装"

# ── ComfyCarry 依赖 ──
echo "  -> ComfyCarry 依赖已预装"

# ── Cloudflared (Tunnel) ──
echo "  -> Cloudflared 已预装"

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

# ── JupyterLab (基础镜像已预装, 通过 PM2 管理) ──
pm2 delete jupyter 2>/dev/null || true
pm2 start jupyter-lab --name jupyter \
    --interpreter none \
    --log /workspace/jupyter.log --time \
    -- --ip=0.0.0.0 --port=8888 --no-browser --allow-root \
    --ServerApp.root_dir=/workspace \
    --ServerApp.language=zh_CN
pm2 save 2>/dev/null || true
echo "  ✅ JupyterLab 已启动 (port 8888)"

# ── CF Tunnel (可选 — 让向导页可通过 Tunnel 域名访问) ──
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_DOMAIN:-}" ]; then
    echo "  -> 检测到 CF 配置, 启动 Tunnel..."
    $PYTHON_BIN -c "
import sys, os
sys.path.insert(0, '$DASHBOARD_DIR')
from comfycarry.services.tunnel_manager import TunnelManager

mgr = TunnelManager(
    api_token=os.environ['CF_API_TOKEN'],
    domain=os.environ['CF_DOMAIN'],
    subdomain=os.environ.get('CF_SUBDOMAIN', '')
)

try:
    result = mgr.ensure()
    mgr.start_cloudflared(result['tunnel_token'])
    print(f'  ✅ Tunnel 已启动: {mgr.subdomain}.{mgr.domain}')
except Exception as e:
    print(f'  ⚠️ Tunnel 启动失败: {e}')
" 2>&1 | tee -a /workspace/setup.log
fi

echo ""
echo "================================================="
echo "  ✅ ComfyCarry 已启动！"
echo ""
echo "  请访问以下地址完成部署向导："
echo "  → http://localhost:5000"
echo ""
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_DOMAIN:-}" ]; then
    echo "  → 可通过你的 Cloudflare Tunnel 域名访问"
fi
echo "  → 公网端口请在 Vast.ai/RunPod 面板查看"
echo "================================================="
