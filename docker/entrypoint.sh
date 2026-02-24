#!/bin/bash
# ==============================================================================
# ComfyUI Docker 入口脚本 (v3.1)
#
# 最小化入口 — SSH + 环境持久化 + bootstrap.sh + 保活
# 所有应用逻辑由 bootstrap.sh (从 GitHub 获取) 接管
# ==============================================================================

# ── SSH Key 导入 ──
# Vast.ai: SSH_PUBLIC_KEY / RunPod: PUBLIC_KEY
SSH_KEY="${SSH_PUBLIC_KEY:-${PUBLIC_KEY:-}}"
if [ -n "$SSH_KEY" ]; then
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    echo "$SSH_KEY" > /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    chown root:root /root/.ssh/authorized_keys
fi

# ── SSH 启动 ──
mkdir -p /run/sshd
[ ! -f /etc/ssh/ssh_host_rsa_key ] && ssh-keygen -A 2>/dev/null || true
# 清除云平台注入的 SSH Banner (vast.ai / RunPod)
: > /etc/banner 2>/dev/null || true
/usr/sbin/sshd 2>/dev/null || true

# ── 环境变量持久化 (SSH session 可见) ──
env >> /etc/environment 2>/dev/null || true

# ── Bootstrap (可通过 docker run -v bootstrap.sh:/tmp/bootstrap.sh 挂载覆盖) ──
if [ ! -f /tmp/bootstrap.sh ]; then
    echo "==> 下载 bootstrap.sh..."
    wget -qO /tmp/bootstrap.sh \
        https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh 2>/dev/null || true
fi

if [ -f /tmp/bootstrap.sh ]; then
    bash /tmp/bootstrap.sh
else
    echo "⚠️ bootstrap.sh 不可用, 请手动运行:"
    echo "  wget -qO- https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/bootstrap.sh | bash"
fi

# ── 保持容器运行 ──
exec sleep infinity
