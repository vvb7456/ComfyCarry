#!/bin/bash
# ==============================================================================
# ComfyUI Docker 入口脚本 (v3.0)
#
# 最小化入口 — SSH + bootstrap.sh + 保活
# 所有应用逻辑由 bootstrap.sh (从 GitHub 获取) 接管
# ==============================================================================

# ── SSH (容器基础功能, 即使 bootstrap 失败也要可 SSH 访问) ──
mkdir -p /run/sshd
[ ! -f /etc/ssh/ssh_host_rsa_key ] && ssh-keygen -A 2>/dev/null || true
# 清除云平台注入的 SSH Banner (vast.ai / RunPod)
: > /etc/banner 2>/dev/null || true
/usr/sbin/sshd 2>/dev/null || true

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
