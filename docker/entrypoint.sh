#!/bin/bash
# ==============================================================================
# ComfyUI Docker 入口脚本 (v3.1)
#
# 最小化入口 — SSH + 环境持久化 + bootstrap.sh + 保活
# 应用逻辑由 bootstrap.sh 接管 (托管开通用 COMFYCARRY_BUNDLE_DIR 包内脚本,
# 自托管从 GitHub 获取)
# ==============================================================================

export WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
export COMFYUI_DIR="${COMFYUI_DIR:-$WORKSPACE_DIR/ComfyUI}"
mkdir -p "$WORKSPACE_DIR"

# ── 固定部署包 (托管开通): 先用包内当前独立脚本覆盖 /opt ──
# 镜像里的 /opt 脚本属于构建时快照, 托管启动必须与本次校验过的包一致。
COMFYCARRY_BUNDLE_DIR="${COMFYCARRY_BUNDLE_DIR:-}"
if [ -n "$COMFYCARRY_BUNDLE_DIR" ]; then
    [ -d "$COMFYCARRY_BUNDLE_DIR" ] || { echo "托管部署包目录不存在" >&2; exit 1; }
    for _pair in \
        "comfycarry/services/management_agent.py:/opt/comfycarry-management-agent.py" \
        "comfycarry/services/management_agent.py:/opt/management_agent.py" \
        "comfycarry/services/usage_collector.py:/opt/comfycarry-usage-collector.py" \
        "comfycarry/services/system_monitor.py:/opt/system_monitor.py"; do
        _src="${COMFYCARRY_BUNDLE_DIR}/${_pair%%:*}"
        _dst="${_pair##*:}"
        if [ -f "$_src" ]; then
            install -m 0644 "$_src" "$_dst" || exit 1
        else
            echo "托管部署包缺少 $_src" >> "$WORKSPACE_DIR/setup.log"
            exit 1
        fi
    done
fi

# Vast.ai: SSH_PUBLIC_KEY / RunPod: PUBLIC_KEY
SSH_KEY="${SSH_PUBLIC_KEY:-${PUBLIC_KEY:-}}"
if [ -n "$SSH_KEY" ]; then
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    echo "$SSH_KEY" > /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    chown root:root /root/.ssh/authorized_keys
fi

mkdir -p /run/sshd
[ ! -f /etc/ssh/ssh_host_rsa_key ] && ssh-keygen -A 2>/dev/null || true
# 清除云平台注入的 SSH Banner (vast.ai / RunPod)
: > /etc/banner 2>/dev/null || true
/usr/sbin/sshd -E "$WORKSPACE_DIR/sshd.log" 2>/dev/null || true

# ── 环境变量持久化 (SSH session 可见) ──
env >> /etc/environment 2>/dev/null || true

AGENT=/opt/comfycarry-management-agent.py
report_failure() {
    echo "启动失败: $1" >> "$WORKSPACE_DIR/setup.log"
    python3 "$AGENT" event --stage FAILED --error-code "$1" --log-file "$WORKSPACE_DIR/setup.log" || true
}
if python3 "$AGENT" enabled; then
    python3 "$AGENT" event --stage ENV_INITIALIZING || true
    pm2 start "$AGENT" --name management-agent --interpreter python3 \
        --log "$WORKSPACE_DIR/management-agent.log" --merge-logs --restart-delay 5000 -- run
    pm2 start /opt/comfycarry-usage-collector.py --name usage-collector --interpreter python3 \
        --log "$WORKSPACE_DIR/usage-collector.log" --merge-logs --restart-delay 5000
fi

# ── Bootstrap (托管模式用包内脚本; 自托管可通过 -v 覆盖 /tmp/bootstrap.sh) ──
BOOTSTRAP_ERROR=BOOTSTRAP_UNAVAILABLE
BOOTSTRAP_SCRIPT=/tmp/bootstrap.sh
if [ -n "$COMFYCARRY_BUNDLE_DIR" ]; then
    # 托管开通必须使用同一校验包内的 bootstrap.sh, 不请求 GitHub main/latest。
    BOOTSTRAP_SCRIPT="$COMFYCARRY_BUNDLE_DIR/bootstrap.sh"
    if [ ! -s "$BOOTSTRAP_SCRIPT" ]; then
        report_failure "$BOOTSTRAP_ERROR"
        echo "托管部署包缺少 bootstrap.sh: $BOOTSTRAP_SCRIPT"
    fi
elif [ ! -f /tmp/bootstrap.sh ]; then
    echo "==> 下载 bootstrap.sh..."
    if ! wget -q --timeout=30 --tries=2 -O /tmp/bootstrap.sh \
        https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh 2>> "$WORKSPACE_DIR/setup.log"; then
        rm -f /tmp/bootstrap.sh
        BOOTSTRAP_ERROR=BOOTSTRAP_DOWNLOAD_FAILED
    fi
fi

if [ -s "$BOOTSTRAP_SCRIPT" ]; then
    bash "$BOOTSTRAP_SCRIPT"
    if [ "$?" -ne 0 ]; then
        report_failure BOOTSTRAP_FAILED
    fi
else
    report_failure "$BOOTSTRAP_ERROR"
    echo "bootstrap.sh 不可用, 请手动运行:"
    echo "  wget -qO- https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh | bash"
fi

exec sleep infinity
