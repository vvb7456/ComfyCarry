#!/bin/bash
# ==============================================================================
# ComfyUI 通用 Docker 镜像构建脚本 (v3.0)
# 支持: Ampere | Ada | Hopper | Blackwell
# ==============================================================================

set -e

IMAGE_NAME="comfyui-runpod"
IMAGE_TAG="v3.0-cu130-universal"
FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"
DOCKERFILE="Dockerfile"

# 代理 (仅传给 Dockerfile 用于 git clone GitHub)
PROXY="http://192.168.1.2:7890"
NO_PROXY="localhost,127.0.0.1,pypi.nvidia.com,download.pytorch.org,pypi.tuna.tsinghua.edu.cn,mirrors.tuna.tsinghua.edu.cn,deb.nodesource.com,pkg.cloudflare.com,*.ubuntu.com,*.launchpad.net,huggingface.co"

echo "================================================="
echo "  ComfyUI Docker 构建 (v3.0 Universal)"
echo "  目标: ${FULL_IMAGE_NAME}"
echo "  基础: runpod/pytorch:1.0.3-cu1300-torch291-ubuntu2404"
echo "  Python: 3.12 (基础镜像自带)"
echo "  PyTorch: 2.9.1+cu130 (基础镜像自带)"
echo "  FA2: 预编译 wheel (全架构)"
echo "  SA2: 6 个架构 wheel (运行时按 GPU 选装)"
echo "  代理: ${PROXY} (仅 GitHub git clone)"
echo "================================================="

cd "$(dirname "$0")"

# 检查必要文件
if [ ! -f "${DOCKERFILE}" ]; then
    echo "❌ ${DOCKERFILE} 不存在"
    exit 1
fi

if [ ! -f "wheels/flash_attn-2.8.3-cp312-cp312-linux_x86_64.whl" ]; then
    echo "❌ FA2 wheel 不存在: wheels/flash_attn-2.8.3-cp312-cp312-linux_x86_64.whl"
    exit 1
fi

SA2_COUNT=$(ls wheels/sageattention-*.whl 2>/dev/null | wc -l)
if [ "$SA2_COUNT" -lt 6 ]; then
    echo "❌ SA2 wheel 不足 (需要 6 个, 找到 $SA2_COUNT 个)"
    exit 1
fi

echo ""
echo ">>> Wheels:"
ls -lh wheels/*.whl
echo ""

echo "--> 开始构建 (BuildKit=1 — 确保所有 blob 写入 content store 以支持 push)..."
DOCKER_BUILDKIT=1 docker build \
    --progress=plain \
    --build-arg HTTP_PROXY="${PROXY}" \
    --build-arg HTTPS_PROXY="${PROXY}" \
    --build-arg NO_PROXY="${NO_PROXY}" \
    -f "${DOCKERFILE}" \
    -t "${FULL_IMAGE_NAME}" \
    .

echo ""
echo "================================================="
echo "  ✅ 构建完成: ${FULL_IMAGE_NAME}"
echo ""
echo "  镜像大小:"
docker images "${FULL_IMAGE_NAME}" --format "  {{.Size}}"
echo ""
echo "  推送到 GHCR:"
echo "  docker tag ${FULL_IMAGE_NAME} ghcr.io/vvb7456/comfyui-runpod:latest"
echo "  docker push ghcr.io/vvb7456/comfyui-runpod:latest"
echo "================================================="
