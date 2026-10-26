#!/bin/bash
set -euo pipefail

# runtime-minimal 镜像需补齐 cuBLAS/cuSPARSE/cuSOLVER 开发头文件，PyTorch 扩展编译会引用它们。
PYTHON_VERSION=3.13
TORCH_VERSION=2.11.0
CUDA_VERSION=13.0
FLASH_VERSION=2.8.3.post2
SAGE_VERSION=2.2.0
BUILD_DIR="${BUILD_DIR:-/workspace/attention-wheels}"
PYTHON="${PYTHON:-python$PYTHON_VERSION}"
COMPONENT="${1:-all}"
LOCAL_VERSION="cu${CUDA_VERSION//./}torch${TORCH_VERSION}"

mkdir -p "$BUILD_DIR"/{src,dist}
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export PATH="$CUDA_HOME/bin:$PATH"
# Hopper 扩展需要链接 libcuda；stubs 仅用于构建，不能加入运行时 LD_LIBRARY_PATH。
export LIBRARY_PATH="$CUDA_HOME/lib64/stubs${LIBRARY_PATH:+:$LIBRARY_PATH}"
export MAX_JOBS="${MAX_JOBS:-4}"
export NVCC_THREADS="${NVCC_THREADS:-2}"
export EXT_PARALLEL=1

"$PYTHON" - "$PYTHON_VERSION" "$TORCH_VERSION" "$CUDA_VERSION" <<'PY'
import sys
import torch

assert f'{sys.version_info.major}.{sys.version_info.minor}' == sys.argv[1], sys.version
assert torch.__version__.split('+')[0] == sys.argv[2], torch.__version__
assert torch.version.cuda == sys.argv[3], torch.version.cuda
print(f'编译环境：Python {sys.version.split()[0]} / PyTorch {torch.__version__}')
PY

case "$(uname -m)" in
    x86_64)
        FLASH_ARCHS="80;90;100;120"
        SAGE_ARCHS=(8.0 8.6 8.9 9.0 10.0 12.0)
        ;;
    aarch64)
        FLASH_ARCHS=120
        SAGE_ARCHS=(12.0)
        ;;
    *)
        echo "不支持的 CPU 架构：$(uname -m)" >&2
        exit 1
        ;;
esac

build_flash() {
    local source="$BUILD_DIR/src/flash_attn-$FLASH_VERSION"
    if [[ ! -d "$source" ]]; then
        "$PYTHON" -m pip download "flash-attn==$FLASH_VERSION" \
            --no-deps --no-binary flash-attn --no-build-isolation -d "$BUILD_DIR/src"
        tar -xzf "$BUILD_DIR/src/flash_attn-$FLASH_VERSION.tar.gz" -C "$BUILD_DIR/src"
    fi
    # sm80 cubin 可用于同代 sm86/sm89；GB10 使用同代 sm120 内核。
    FLASH_ATTENTION_FORCE_BUILD=TRUE FLASH_ATTN_CUDA_ARCHS="$FLASH_ARCHS" \
        FLASH_ATTN_LOCAL_VERSION="$LOCAL_VERSION" \
        "$PYTHON" -m pip wheel "$source" --no-deps --no-build-isolation -v -w "$BUILD_DIR/dist"
}

build_sage() {
    local arch="$1"
    local checkout="$BUILD_DIR/src/SageAttention-$SAGE_VERSION"
    local source="$BUILD_DIR/src/SageAttention-$SAGE_VERSION-${arch//./}"
    if [[ ! -d "$checkout" ]]; then
        git clone --depth 1 --branch "v$SAGE_VERSION" https://github.com/thu-ml/SageAttention.git "$checkout"
    fi
    if [[ ! -d "$source" ]]; then
        cp -a "$checkout" "$source"
    fi
    "$PYTHON" - "$source" "$arch" "$SAGE_VERSION+$LOCAL_VERSION" "$checkout" <<'PY'
import os
import sys
from pathlib import Path

source = Path(sys.argv[1])
arch = sys.argv[2].replace('.', '')
version = f'{sys.argv[3]}.sm{arch}'
checkout = Path(sys.argv[4])
base_version = sys.argv[3].split('+')[0]
setup = source / 'setup.py'
text = (checkout / 'setup.py').read_text()
text = text.replace(f"version='{base_version}',", f"version='{version}',")
text = text.replace('"--threads=8",', f'"--threads={os.environ["NVCC_THREADS"]}",')
# B200 复用 Blackwell FP8 CUDA 实现，但必须生成 sm100 目标代码。
if 'elif capability.startswith("10.0"):' not in text:
    text = text.replace(
        'elif capability.startswith("12.0"):',
        'elif capability.startswith("10.0"):\n            HAS_SM120 = True\n            num = "100"\n        elif capability.startswith("12.0"):',
    )
setup.write_text(text)
core = source / 'sageattention/core.py'
text = (checkout / 'sageattention/core.py').read_text().replace('elif arch == "sm120":', 'elif arch in ("sm100", "sm120", "sm121"):')
core.write_text(text)
PY
    TORCH_CUDA_ARCH_LIST="$arch" \
        "$PYTHON" -m pip wheel "$source" --no-deps --no-build-isolation -v -w "$BUILD_DIR/dist"
}

case "$COMPONENT" in
    all)
        build_flash
        for arch in "${SAGE_ARCHS[@]}"; do build_sage "$arch"; done
        ;;
    flash)
        build_flash
        ;;
    sage)
        build_sage "${2:?需要指定目标架构，例如 8.9 或 12.0}"
        ;;
    *)
        echo "用法：$0 [all|flash|sage <目标架构>]" >&2
        exit 1
        ;;
esac
