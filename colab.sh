#!/usr/bin/env bash
set -Eeuo pipefail

export WORKSPACE_DIR="${WORKSPACE_DIR:-/content}"
export COMFYUI_DIR="${COMFYUI_DIR:-$WORKSPACE_DIR/ComfyUI}"

if [[ $(id -u) != 0 || $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
    echo "Colab 安装器需要 Linux x86_64 的 root 环境。" >&2
    exit 1
fi
if ! command -v nvidia-smi >/dev/null || ! nvidia-smi -L >/dev/null; then
    echo "没有可用 NVIDIA GPU，请先在 Colab 中选择 GPU 运行时。" >&2
    exit 1
fi

mkdir -p "$WORKSPACE_DIR"
INSTALLER_DIR="$WORKSPACE_DIR/.comfycarry-installer"
mkdir -p "$INSTALLER_DIR/scripts"

echo "==> 下载安装脚本"
for file in bootstrap.sh scripts/install-colab.sh scripts/colab-requirements.txt; do
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 30 \
        "https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/$file" \
        -o "$INSTALLER_DIR/$file"
done

exec bash "$INSTALLER_DIR/scripts/install-colab.sh"
