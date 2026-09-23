#!/bin/bash
# ==============================================================================
# ComfyUI Docker 入口脚本 (v3.1)
#
# 最小化入口 — SSH + 环境持久化 + bootstrap.sh + 保活
# 所有应用逻辑由 bootstrap.sh (从 GitHub 获取) 接管
# ==============================================================================

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
/usr/sbin/sshd -E /workspace/sshd.log 2>/dev/null || true

# ── 环境变量持久化 (SSH session 可见) ──
env >> /etc/environment 2>/dev/null || true

AGENT=/opt/comfycarry-management-agent.py
report_failure() {
    echo "启动失败: $1" >> /workspace/setup.log
    python3 "$AGENT" event --stage FAILED --error-code "$1" --log-file /workspace/setup.log || true
}
if python3 "$AGENT" enabled; then
    python3 "$AGENT" event --stage ENV_INITIALIZING || true
    pm2 start "$AGENT" --name management-agent --interpreter python3 \
        --log /workspace/management-agent.log --merge-logs --restart-delay 5000 -- run
    pm2 start /opt/comfycarry-usage-collector.py --name usage-collector --interpreter python3 \
        --log /workspace/usage-collector.log --merge-logs --restart-delay 5000
fi

# ── Bootstrap (可通过 docker run -v bootstrap.sh:/tmp/bootstrap.sh 挂载覆盖) ──
BOOTSTRAP_ERROR=BOOTSTRAP_UNAVAILABLE
if [ ! -f /tmp/bootstrap.sh ]; then
    echo "==> 下载 bootstrap.sh..."
    if ! wget -q --timeout=30 --tries=2 -O /tmp/bootstrap.sh \
        https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh 2>> /workspace/setup.log; then
        rm -f /tmp/bootstrap.sh
        BOOTSTRAP_ERROR=BOOTSTRAP_DOWNLOAD_FAILED
    fi
fi

if [ -s /tmp/bootstrap.sh ]; then
    bash /tmp/bootstrap.sh
    if [ "$?" -ne 0 ]; then
        report_failure BOOTSTRAP_FAILED
    fi
else
    report_failure "$BOOTSTRAP_ERROR"
    echo "bootstrap.sh 不可用, 请手动运行:"
    echo "  wget -qO- https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh | bash"
fi

exec sleep infinity
