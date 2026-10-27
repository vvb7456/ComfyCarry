# syntax=docker/dockerfile:1.7
# ComfyCarry Docker 镜像 (CUDA 13.0 / PyTorch 2.9.1)
#
# 正式生产基线：NVIDIA cudnn-runtime + 最小 CUDA 编译链。
# CI 发布 latest / x86 / arm 和 v<版本>-<架构> 标签。
# 支持: amd64 Ampere/Ada/Hopper/Blackwell | arm64 GB10

FROM nvidia/cuda:13.0.0-cudnn-runtime-ubuntu24.04@sha256:f2c12914cf4751e61073843724275aa35d4817e01dbdc87eac03905971628c6e

LABEL maintainer="ComfyCarry"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_ROOT_USER_ACTION=ignore \
    HOME=/root \
    RP_WORKSPACE=/workspace \
    HF_HOME=/workspace/.cache/huggingface \
    UV_CACHE_DIR=/workspace/.cache/uv \
    VIRTUALENV_OVERRIDE_APP_DATA=/workspace/.cache/virtualenv \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    HF_XET_HIGH_PERFORMANCE=1 \
    CUDA_HOME=/usr/local/cuda \
    TZ=Etc/UTC \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# cuda-minimal-build 保留 nvcc、CUDA runtime headers、CCCL/NVVM/PTX 组件，
# 支持 SAM2 以及常见 torch.utils.cpp_extension；不安装 Nsight、完整数学库
# development/static packages 等约 2 GiB 的 devel 增量。
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        cuda-minimal-build-13-0=13.0.0-1 \
        ca-certificates curl wget gnupg gawk \
        python3.12 python3.12-dev python3.12-venv python3-pip \
        python-is-python3 \
        git git-lfs aria2 jq ffmpeg unzip tar gzip rsync \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
        build-essential cmake pkg-config \
        libjpeg-dev libpng-dev libtiff-dev \
        libffi-dev libssl-dev libnuma-dev \
        openssh-server passwd procps iproute2 && \
    nvcc --version && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Rclone 使用官方稳定版，避免 Ubuntu 仓库旧版本的 OneDrive multipart 问题。
RUN curl -fsSL https://rclone.org/install.sh | bash

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g pm2 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# =============================================================================
# 3. Cloudflared
# =============================================================================
RUN mkdir -p --mode=0755 /usr/share/keyrings && \
    curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg \
        | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null && \
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' \
        | tee /etc/apt/sources.list.d/cloudflared.list && \
    apt-get update -qq && \
    apt-get install -y --no-install-recommends cloudflared && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# =============================================================================
# 4. Python、PyTorch、Jupyter 与 Dashboard 依赖
# =============================================================================
RUN rm -f /usr/lib/python3.12/EXTERNALLY-MANAGED && \
    python3.12 -m pip install --upgrade --ignore-installed pip setuptools wheel && \
    python3.12 -m pip install \
        torch==2.9.1 \
        torchvision==0.24.1 \
        torchaudio==2.9.1 \
        --index-url https://download.pytorch.org/whl/cu130 && \
    python3.12 -m pip install \
        packaging ninja einops numpy psutil virtualenv uv nvidia-ml-py \
        hf_transfer && \
    python3.12 -m pip install --ignore-installed \
        flask flask-cors requests websocket-client && \
    python3.12 -m pip install \
        'openai==1.109.1' 'anthropic==0.46.0' 'google-genai==1.75.0' \
        'pydantic>=2.0,<3' 'httpx>=0.27,<1' && \
    python3.12 -m pip install \
        jupyterlab notebook==7.4.2 ipywidgets jupyter-archive \
        jupyterlab-language-pack-zh-CN

# =============================================================================
# 5. FlashAttention-2 (按 CPU 架构选取预编译 wheel)
# =============================================================================
RUN --mount=type=bind,source=docker/wheels,target=/tmp/wheels,ro \
    python3.12 -m pip install \
        /tmp/wheels/flash_attn-2.8.3-cp312-cp312-linux_$(uname -m).whl

# =============================================================================
# 6. SageAttention-2 (预编译 wheel — 按架构分包, 运行时选装)
# =============================================================================
COPY docker/wheels/sageattention-2.2.0-0.cu130torch2.9.1.sm*-cp312-cp312-linux_*.whl /opt/wheels/sa2/

# =============================================================================
# 7. 生成 torch 约束文件，防止插件依赖覆盖已验证版本
# =============================================================================
RUN python3.12 -c "\
import torch; print(f'torch=={torch.__version__}'); \
import torchaudio; print(f'torchaudio=={torchaudio.__version__}'); \
import torchvision; print(f'torchvision=={torchvision.__version__}')" \
    > /tmp/torch-constraints.txt && \
    cat /tmp/torch-constraints.txt

# =============================================================================
# 8. ComfyUI
# =============================================================================
WORKDIR /opt
RUN COMFY_TAG=$(git ls-remote --refs --tags https://github.com/comfyanonymous/ComfyUI.git 'v*' \
        | awk -F/ '{print $NF}' | grep -E '^v[0-9]+\.[0-9]+' | sort -V | tail -1) && \
    echo "ComfyUI stable tag: ${COMFY_TAG}" && \
    git clone --depth 1 --branch "${COMFY_TAG}" https://github.com/comfyanonymous/ComfyUI.git && \
    cd ComfyUI && \
    python3.12 -m pip install --constraint /tmp/torch-constraints.txt \
        -r requirements.txt

# =============================================================================
# 9. 常用插件
# =============================================================================
WORKDIR /opt/ComfyUI/custom_nodes
RUN git clone --depth 1 https://github.com/Comfy-Org/ComfyUI-Manager.git && \
    git clone --depth 1 https://github.com/Fannovel16/comfyui_controlnet_aux && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Pack && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Subpack && \
    git clone --depth 1 https://github.com/yolain/ComfyUI-Easy-Use && \
    git clone --depth 1 https://github.com/crystian/ComfyUI-Crystools && \
    git clone --depth 1 --recursive https://github.com/ssitu/ComfyUI_UltimateSDUpscale && \
    git clone --depth 1 https://github.com/adieyal/comfyui-dynamicprompts && \
    git clone --depth 1 https://github.com/vvb7456/AuraSR-ComfyUI.git && \
    git clone --depth 1 https://github.com/ltdrdata/was-node-suite-comfyui && \
    git clone --depth 1 https://github.com/kijai/ComfyUI-KJNodes && \
    git clone --depth 1 https://github.com/pythongosssss/ComfyUI-WD14-Tagger && \
    git clone --depth 1 https://github.com/rgthree/rgthree-comfy && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Inspire-Pack && \
    git clone --depth 1 https://github.com/pythongosssss/ComfyUI-Custom-Scripts && \
    git clone --depth 1 https://github.com/city96/ComfyUI-GGUF && \
    git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus && \
    git clone --depth 1 https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite && \
    git clone --depth 1 https://github.com/cubiq/ComfyUI_essentials && \
    git clone --depth 1 https://github.com/1038lab/ComfyUI-RMBG && \
    git clone --depth 1 https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler

# decord 没有 Linux ARM wheel，decord2 保留相同的 decord 导入接口。
RUN if [ "$(uname -m)" = aarch64 ]; then \
        sed -i 's/^decord[[:space:]]*$/decord2==3.4.0/' /opt/ComfyUI/custom_nodes/ComfyUI-RMBG/requirements.txt; \
    fi

RUN for req in $(find /opt/ComfyUI/custom_nodes -name "requirements.txt" -type f); do \
        echo "========================================" && \
        echo ">>> Installing: $req" && \
        echo "========================================" && \
        python3.12 -m pip install --constraint /tmp/torch-constraints.txt -r "$req" || \
        echo "PARTIAL FAILURE: $req"; \
    done

# =============================================================================
# 10. 显式安装易遗漏 / 补充依赖
# =============================================================================
RUN python3.12 -m pip install \
    diffusers clip_interrogator peft open-clip-torch timm ftfy \
    color-matcher mss dill

# SAM2 使用镜像内的 PyTorch 编译，避免隔离环境引入其他版本导致 ABI 不匹配。
# 显式指定目标架构并禁止静默降级，确保 minimal-build 工具链在 CI 中真实可用。
ARG TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0;10.0;12.0"
RUN TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST}" \
    SAM2_BUILD_ALLOW_ERRORS=0 \
    python3.12 -m pip install --no-build-isolation \
        "git+https://github.com/facebookresearch/sam2.git"

RUN python3.12 -m pip install \
    numba matplotlib dynamicprompts==0.30.2 \
    aiosqlite uuid7 deepdiff piexif segment-anything py-cpuinfo

RUN python3.12 -m pip install \
    aiohttp opencv-python-headless scikit-image \
    accelerate transformers safetensors onnxruntime-gpu

RUN python3.12 -m pip install \
    gguf insightface imageio imageio-ffmpeg

# =============================================================================
# 11. 目录结构 & 预构建标记
# =============================================================================
ARG IMAGE_VERSION
LABEL description="ComfyCarry v${IMAGE_VERSION} — CUDA 13.0 / PyTorch 2.9.1"
LABEL version="${IMAGE_VERSION}"
LABEL org.opencontainers.image.title="ComfyCarry"
LABEL org.opencontainers.image.version="${IMAGE_VERSION}"

WORKDIR /workspace
RUN mkdir -p /opt/ComfyUI/models/{checkpoints,loras,controlnet,vae,upscale_models,Aura-SR,sams} \
             /opt/ComfyUI/{output,input} \
             /opt/ComfyUI/user/default/workflows \
             /root/.config/rclone \
             /workspace/.cache/{huggingface,uv,virtualenv} && \
    ln -snf /workspace /root/workspace && \
    touch /root/.no_auto_tmux && \
    python3.12 -c "\
import json, datetime, platform, torch; \
info = { \
    'version': '${IMAGE_VERSION} (arm)' if platform.machine() == 'aarch64' else '${IMAGE_VERSION} (x86)', \
    'build_date': datetime.datetime.now().strftime('%Y-%m-%d'), \
    'python': '3.12', \
    'torch': torch.__version__, \
    'cuda_toolkit': torch.version.cuda or '', \
    'fa2': True, \
    'sa2_archs': ['sm120'] if platform.machine() == 'aarch64' else ['sm80','sm86','sm89','sm90','sm100','sm120'], \
    'base_image': 'nvidia/cuda:13.0.0-cudnn-runtime-ubuntu24.04', \
    'cuda_build_toolchain': 'cuda-minimal-build-13-0', \
}; \
open('/opt/.comfycarry-prebuilt','w').write(json.dumps(info, indent=2))"

# =============================================================================
# 12. 入口脚本与交互式 Shell 品牌信息
# =============================================================================
COPY comfycarry/services/management_agent.py /opt/comfycarry-management-agent.py
COPY comfycarry/services/management_agent.py /opt/management_agent.py
COPY comfycarry/services/usage_collector.py /opt/comfycarry-usage-collector.py
COPY comfycarry/services/system_monitor.py /opt/system_monitor.py
COPY docker/entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

COPY docker/comfycarry-banner.txt /etc/runpod.txt
RUN touch /root/.bashrc && \
    sed -i '/docs\.runpod\.io/d' /root/.bashrc && \
    echo '[ -f /etc/runpod.txt ] && cat /etc/runpod.txt' >> /root/.bashrc

# =============================================================================
# 13. 清理
# =============================================================================
RUN find /opt/ComfyUI/custom_nodes -name "requirements.txt" -type f \
        -exec sed -i '/^git+/d' {} \;

RUN rm -rf /tmp/* /var/tmp/* && \
    python3.12 -m pip cache purge 2>/dev/null || true

EXPOSE 5000 8188 8888 22
CMD ["/opt/entrypoint.sh"]
