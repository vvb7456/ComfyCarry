#!/usr/bin/env bash
set -Eeuo pipefail

export WORKSPACE_DIR="${WORKSPACE_DIR:-/content}"
export COMFYUI_DIR="${COMFYUI_DIR:-$WORKSPACE_DIR/ComfyUI}"
export COMFYCARRY_REF="${COMFYCARRY_REF:-main}"
export COMFYCARRY_REPO="${COMFYCARRY_REPO:-https://github.com/vvb7456/ComfyCarry.git}"

if [[ $(id -u) != 0 || $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
    echo "Colab 安装器需要 Linux x86_64 的 root 环境。" >&2
    exit 1
fi
if ! command -v nvidia-smi >/dev/null || ! nvidia-smi -L >/dev/null; then
    echo "没有可用 NVIDIA GPU，请先在 Colab 中选择 GPU 运行时。" >&2
    exit 1
fi

mkdir -p "$WORKSPACE_DIR"
export COMFYCARRY_SOURCE_DIR="${COMFYCARRY_SOURCE_DIR:-$WORKSPACE_DIR/ComfyCarry}"

if [[ ! -f "$COMFYCARRY_SOURCE_DIR/scripts/install-colab.sh" ]]; then
    if [[ -e "$COMFYCARRY_SOURCE_DIR" ]] && [[ -n $(ls -A "$COMFYCARRY_SOURCE_DIR") ]]; then
        echo "目录已存在但缺少 Colab 安装器：$COMFYCARRY_SOURCE_DIR。请指定新的 COMFYCARRY_SOURCE_DIR。" >&2
        exit 1
    fi
    if ! command -v git >/dev/null; then
        apt-get update -qq
        apt-get install -y --no-install-recommends git ca-certificates
    fi
    git clone --depth 1 --branch "$COMFYCARRY_REF" "$COMFYCARRY_REPO" "$COMFYCARRY_SOURCE_DIR"
elif [[ ${FORCE_UPDATE:-false} == true ]] && [[ -d "$COMFYCARRY_SOURCE_DIR/.git" ]]; then
    git -C "$COMFYCARRY_SOURCE_DIR" pull --ff-only
fi

exec bash "$COMFYCARRY_SOURCE_DIR/scripts/install-colab.sh"
