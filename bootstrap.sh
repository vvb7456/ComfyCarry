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

export WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
export COMFYUI_DIR="${COMFYUI_DIR:-$WORKSPACE_DIR/ComfyUI}"
LOG_FILE="$WORKSPACE_DIR/setup.log"
mkdir -p "$WORKSPACE_DIR"
exec &> >(tee -a "$LOG_FILE")

echo "================================================="
echo "  ComfyCarry Bootstrap v1.0"
echo "  $(date)"
echo "================================================="

ln -snf "$WORKSPACE_DIR" /root/workspace 2>/dev/null || true
touch ~/.no_auto_tmux 2>/dev/null || true

if [ ! -f /opt/.comfycarry-prebuilt ]; then
    echo "  未检测到 ComfyCarry 预构建镜像"
    echo "  请使用官方预构建镜像: erocraft/comfycarry"
fi
PYTHON_BIN=python3

# SSH 已由 entrypoint.sh 处理 (SSH Key + sshd)

echo "  -> Python: $PYTHON_BIN"

echo "  -> Node.js/PM2 已预装"

echo "  -> ComfyCarry 依赖已预装"

echo "  -> Cloudflared 已预装"

# 更新源: 托管开通使用主控下发并已校验的固定部署包 (COMFYCARRY_BUNDLE_DIR),
# 自托管仍从 GitHub latest Release (完整部署包, 由 release.yml 发布) 更新 ——
# main 分支 push 不影响已部署实例, commit 与 release 解耦。
DASHBOARD_DIR="$WORKSPACE_DIR/ComfyCarry"
REPO_OWNER="vvb7456"
REPO_NAME="ComfyCarry"
RELEASE_ASSET="comfycarry-dist.tar.gz"
LATEST_RELEASE_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"

mkdir -p "$DASHBOARD_DIR"

BUNDLE_DIR="${COMFYCARRY_BUNDLE_DIR:-}"
BUNDLE_ID=""
if [ -n "$BUNDLE_DIR" ]; then
    BUNDLE_ID=$(python3 - "$BUNDLE_DIR" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
value = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["content_sha256"]
if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
    sys.exit("托管部署包缺少有效版本摘要")
print(value)
PY
)
fi

if [ -n "$BUNDLE_DIR" ]; then
    DEPLOYED_ID=""
    [ -f "$DASHBOARD_DIR/.bundle-id" ] && DEPLOYED_ID=$(cat "$DASHBOARD_DIR/.bundle-id" 2>/dev/null || true)

    # 同一定位包重复启动不覆盖工作区: 仅首次或包身份变化时复制, 保留用户
    # 向导/配置等本地文件 (cp 合并, 不删除包外文件)。
    if [ ! -f "$DASHBOARD_DIR/workspace_manager.py" ] || [ "$DEPLOYED_ID" != "$BUNDLE_ID" ] || [ "${FORCE_UPDATE:-false}" = "true" ]; then
        echo "  -> 复制托管部署包 (bundle=${BUNDLE_ID:0:12})..."
        for _item in comfycarry comfycarry_ws_broadcast data; do
            if [ -e "$BUNDLE_DIR/$_item" ]; then
                cp -r "$BUNDLE_DIR/$_item" "$DASHBOARD_DIR/"
            fi
        done
        for _item in workspace_manager.py favicon.ico; do
            if [ -f "$BUNDLE_DIR/$_item" ]; then
                cp -f "$BUNDLE_DIR/$_item" "$DASHBOARD_DIR/$_item"
            fi
        done
        if [ -d "$BUNDLE_DIR/static/dist" ]; then
            mkdir -p "$DASHBOARD_DIR/static/dist"
            cp -r "$BUNDLE_DIR/static/dist/." "$DASHBOARD_DIR/static/dist/"
        fi
        if [ -f "$BUNDLE_DIR/.version" ]; then
            cp -f "$BUNDLE_DIR/.version" "$DASHBOARD_DIR/.version"
        elif [ ! -f "$DASHBOARD_DIR/.version" ]; then
            printf 'version=unknown\nbranch=\ncommit=\nmanaged=true\ndirty=true\nbundle_sha256=%s\n' "$BUNDLE_ID" > "$DASHBOARD_DIR/.version"
        fi
        printf '%s\n' "$BUNDLE_ID" > "$DASHBOARD_DIR/.bundle-id"
        echo "  ComfyCarry 文件已更新"
    else
        echo "  -> 托管部署包未变化, 保留现有文件 (设置 FORCE_UPDATE=true 强制覆盖)"
    fi
else
# 拉取一次 latest Release 元数据, 下载地址与 .version 共用 (限流 60 req/h, 不要重复请求)
RELEASE_JSON=$(wget -qO- "$LATEST_RELEASE_API" 2>/dev/null || true)

if [ ! -f "$DASHBOARD_DIR/workspace_manager.py" ] || [ "${FORCE_UPDATE:-false}" = "true" ]; then
    echo "  -> 下载 ComfyCarry (latest Release)..."
    DIST_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
try:
    rel = json.load(sys.stdin)
    for a in rel.get('assets', []):
        if a.get('name') == '${RELEASE_ASSET}':
            print(a.get('browser_download_url', ''))
            break
except Exception:
    pass
" 2>/dev/null || true)

    if [ -n "$DIST_URL" ]; then
        TMP_TAR="/tmp/comfycarry_dist.tar.gz"
        TMP_EXTRACT="/tmp/comfycarry_extract"

        wget -q -O "$TMP_TAR" "$DIST_URL"
        rm -rf "$TMP_EXTRACT"
        mkdir -p "$TMP_EXTRACT"
        tar xzf "$TMP_TAR" -C "$TMP_EXTRACT"

        # 部署包顶层目录为 comfycarry/, 内容直接覆盖到面板根
        EXTRACTED="${TMP_EXTRACT}/comfycarry"
        if [ -d "$EXTRACTED" ]; then
            cp -r "$EXTRACTED/." "$DASHBOARD_DIR/"
            echo "  ComfyCarry 文件已更新"
        else
            echo "  部署包结构异常, 请检查 Release asset"
        fi

        rm -rf "$TMP_TAR" "$TMP_EXTRACT"
    else
        echo "  未找到 latest Release (${RELEASE_ASSET}), 请检查是否已发布 Release"
    fi
else
    echo "  -> ComfyCarry 文件已存在，跳过下载 (设置 FORCE_UPDATE=true 强制更新)"
fi

# Write version info (从 latest Release 元数据读取)
# 注意: target_commitish 是分支名而非 SHA; 真实 commit 用 /commits/<tag>
# (对 lightweight/annotated tag 均解析到其指向的 commit, 同 update.py Step 6)
RELEASE_TAG=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tag_name',''))" 2>/dev/null || true)
COMMIT_HASH=""
if [ -n "$RELEASE_TAG" ]; then
    COMMIT_HASH=$(wget -qO- "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${RELEASE_TAG}" 2>/dev/null | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('sha', ''))
except Exception:
    pass
" 2>/dev/null || true)
fi
APP_VERSION=$(python3 -c "import re, sys; m=re.search(r'APP_VERSION\s*=\s*\"([^\"]+)\"', open(sys.argv[1]).read()); print(m.group(1) if m else 'unknown')" "$DASHBOARD_DIR/comfycarry/config.py" 2>/dev/null || echo "unknown")
cat > "$DASHBOARD_DIR/.version" <<EOF
version=${RELEASE_TAG:-$APP_VERSION}
branch=
commit=${COMMIT_HASH}
EOF
fi

# CF Tunnel (可选 — 必须在 Dashboard 启动前完成, 避免双重注册)
if [ -f /opt/comfycarry-management-agent.py ]; then
    python3 /opt/comfycarry-management-agent.py event --stage SERVICE_STARTING || true
fi
_TUNNEL_DASHBOARD_URL=""
if "$PYTHON_BIN" -c "import sys; sys.path.insert(0, sys.argv[1]); from comfycarry.services.managed_tunnel import is_managed; sys.exit(0 if is_managed() else 1)" "$DASHBOARD_DIR"; then
    _TUNNEL_DASHBOARD_URL=$("$PYTHON_BIN" -c "import sys; sys.path.insert(0, sys.argv[1]); from comfycarry.services.managed_tunnel import ensure_connected; print(ensure_connected()['urls']['dashboard'])" "$DASHBOARD_DIR")
elif [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_DOMAIN:-}" ]; then
    if [ -z "${CF_SUBDOMAIN:-}" ]; then
        echo "  -> 错误: 自定义 Tunnel 需要 CF_SUBDOMAIN, 按启动失败处理" >&2
        echo "  Tunnel 启动失败"
    else
        echo "  -> 检测到 CF 配置, 启动 Tunnel..."
        _TUNNEL_DASHBOARD_URL=$("$PYTHON_BIN" -c "
import sys, os
sys.path.insert(0, sys.argv[1])
from comfycarry.services.tunnel_manager import TunnelManager

mgr = TunnelManager(
    api_token=os.environ.get('CF_API_TOKEN', ''),
    domain=os.environ.get('CF_DOMAIN', ''),
    subdomain=os.environ.get('CF_SUBDOMAIN', '')
)

try:
    result = mgr.ensure()
    if not mgr.start_cloudflared(result['tunnel_token']):
        raise RuntimeError('cloudflared 启动失败')
    print(f'https://{mgr.subdomain}.{mgr.domain}')
except Exception as e:
    print('', file=sys.stderr)
    print(f'Tunnel 启动失败: {e}', file=sys.stderr)
" "$DASHBOARD_DIR" 2>/dev/null) || true
            if [ -n "$_TUNNEL_DASHBOARD_URL" ]; then
                echo "  Tunnel 已启动"
            else
                echo "  Tunnel 启动失败"
            fi
        fi
elif [ "${PUBLIC_TUNNEL:-}" = "1" ] || [ "${PUBLIC_TUNNEL:-}" = "true" ]; then
    echo "  -> 检测到 PUBLIC_TUNNEL, 正在注册公共 Tunnel..."
    _TUNNEL_DASHBOARD_URL=$("$PYTHON_BIN" -c "
import sys, os
sys.path.insert(0, sys.argv[1])
from comfycarry.services.public_tunnel import PublicTunnelClient

client = PublicTunnelClient()
try:
    result = client.register()
    if result.get('ok'):
        urls = result.get('urls', {})
        print(urls.get('dashboard', ''))
    else:
        print(f'{result.get(\"error\", \"未知\")}', file=sys.stderr)
except Exception as e:
    print(f'{e}', file=sys.stderr)
" "$DASHBOARD_DIR" 2>/dev/null) || true
    if [ -n "$_TUNNEL_DASHBOARD_URL" ]; then
        echo "  公共 Tunnel 已启用"
    else
        echo "  公共 Tunnel 启用失败"
    fi
fi

pm2 delete dashboard 2>/dev/null || true

if [ -f "$DASHBOARD_DIR/workspace_manager.py" ]; then
    pm2 start "$PYTHON_BIN" --name dashboard \
        --interpreter none \
        --log "$WORKSPACE_DIR/dashboard.log" \
        --merge-logs \
        --time \
        -- "$DASHBOARD_DIR/workspace_manager.py" 5000
    pm2 save 2>/dev/null || true
else
    echo "ComfyCarry 文件下载失败，请检查网络连接"
    exit 1
fi

pm2 delete jupyter 2>/dev/null || true
pm2 start jupyter-lab --name jupyter \
    --interpreter none \
    --log "$WORKSPACE_DIR/jupyter.log" --merge-logs --time \
    -- --ip=0.0.0.0 --port=8888 --no-browser --allow-root \
    --ServerApp.root_dir="$WORKSPACE_DIR" \
    --ServerApp.language=zh_CN
pm2 save 2>/dev/null || true
echo "  JupyterLab 已启动 (port 8888)"

echo ""
echo "================================================="
echo "  ComfyCarry 已启动！"
echo ""
if [ -n "$_TUNNEL_DASHBOARD_URL" ]; then
    echo "  → $_TUNNEL_DASHBOARD_URL"
else
    echo "  → http://localhost:5000"
fi
echo "================================================="
