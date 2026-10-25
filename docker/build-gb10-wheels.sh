#!/bin/bash
set -euo pipefail

BUILD_DIR="${BUILD_DIR:-/workspace/gb10-wheels}"
PYTHON="${PYTHON:-python3.12}"
mkdir -p "$BUILD_DIR/dist"
export MAX_JOBS="${MAX_JOBS:-4}"
export NVCC_THREADS="${NVCC_THREADS:-2}"

# sm120 的通用 CUDA 内核可在 GB10 sm121 上运行；上游 2.8.3 仅识别 120 构建目标。
FLASH_ATTENTION_FORCE_BUILD=TRUE FLASH_ATTN_CUDA_ARCHS=120 \
    "$PYTHON" -m pip wheel flash-attn==2.8.3 \
    --no-deps --no-build-isolation --no-binary flash-attn -w "$BUILD_DIR/dist"

git clone --depth 1 --branch v2.2.0 https://github.com/thu-ml/SageAttention.git "$BUILD_DIR/SageAttention"
# 2.2.0 的自动分派未列出 sm121，GB10 使用同代的 Blackwell CUDA 内核。
sed -i 's/elif arch == "sm120":/elif arch in ("sm120", "sm121"):/' "$BUILD_DIR/SageAttention/sageattention/core.py"
TORCH_CUDA_ARCH_LIST=12.0 EXT_PARALLEL=1 \
    "$PYTHON" -m pip wheel "$BUILD_DIR/SageAttention" \
    --no-deps --no-build-isolation -w "$BUILD_DIR/dist"
mv "$BUILD_DIR/dist/sageattention-2.2.0-cp312-cp312-linux_aarch64.whl" \
    "$BUILD_DIR/dist/sageattention-2.2.0-cp312-cp312-linux_aarch64_sm120.whl"
