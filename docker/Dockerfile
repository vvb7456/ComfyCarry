# ==============================================================================
# ComfyUI 通用 Docker 镜像 (v3.0) — GitHub Actions CI 构建
# 支持: Ampere (A100/30xx) | Ada (40xx) | Hopper (H100) | Blackwell (50xx/B200)
#
# 基于 runpod/pytorch:1.0.3-cu1300-torch291-ubuntu2404
# 预装: Python 3.12, PyTorch 2.9.1+cu130, ComfyUI, FA2, SA2(运行时选装), 常用插件
# ==============================================================================

FROM runpod/pytorch:1.0.3-cu1300-torch291-ubuntu2404

LABEL maintainer="ComfyCarry"
LABEL description="Universal ComfyUI image — Ampere/Ada/Hopper/Blackwell"
LABEL version="3.0"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# =============================================================================
# 1. 系统依赖
# =============================================================================
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        software-properties-common \
        git git-lfs aria2 rclone jq curl wget ffmpeg \
        libgl1 libglib2.0-0 libsm6 libxext6 \
        build-essential openssh-server && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# =============================================================================
# 2. Node.js 20.x + PM2
# =============================================================================
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g pm2 && \
    pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# =============================================================================
# 3. Cloudflared
# =============================================================================
RUN mkdir -p --mode=0755 /usr/share/keyrings && \
    curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg \
        | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null && \
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' \
        | tee /etc/apt/sources.list.d/cloudflared.list && \
    apt-get update -qq && apt-get install -y cloudflared && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# =============================================================================
# 4. Python 基础包 + Dashboard 依赖
# =============================================================================
RUN python3.12 -m pip install --upgrade pip setuptools wheel && \
    python3.12 -m pip install \
        packaging ninja einops numpy psutil && \
    python3.12 -m pip install --ignore-installed \
        flask flask-cors requests websocket-client && \
    python3.12 -m pip install jupyterlab-language-pack-zh-CN

# =============================================================================
# 5. torchvision (CUDA 版)
#    基础镜像只有 torch + torchaudio, 没有 torchvision
#    注意: 必须锁定 0.24.1 — cu130 索引中的 0.25.0 是为 torch 2.10.x 编译的,
#    与基础镜像的 torch 2.9.1+cu130 (RunPod 自定义 ABI) 存在 C++ 符号不兼容
# =============================================================================
RUN python3.12 -m pip install \
    torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu130

# =============================================================================
# 6. FlashAttention-2 (预编译 wheel — 全架构: sm80/86/89/90/100/120)
# =============================================================================
COPY wheels/flash_attn-2.8.3-cp312-cp312-linux_x86_64.whl /tmp/wheels/
RUN python3.12 -m pip install /tmp/wheels/flash_attn-2.8.3-cp312-cp312-linux_x86_64.whl && \
    rm -rf /tmp/wheels

# =============================================================================
# 7. SageAttention-2 (预编译 wheel — 按架构分包, 运行时选装)
#    deploy_engine.py 检测 GPU → 安装对应 wheel
# =============================================================================
COPY wheels/sageattention-2.2.0-cp312-cp312-linux_x86_64_sm*.whl /opt/wheels/sa2/

# =============================================================================
# 8. Rclone Windows 版 (供用户从 Dashboard 下载配置助手)
# =============================================================================
RUN mkdir -p /opt/rclone-win && \
    curl -fsSL https://downloads.rclone.org/rclone-current-windows-amd64.zip -o /tmp/rclone-win.zip && \
    unzip -j /tmp/rclone-win.zip '*/rclone.exe' -d /opt/rclone-win/ && \
    rm -f /tmp/rclone-win.zip

# =============================================================================
# 8. 生成 torch 约束文件 (后续步骤复用, 防止依赖覆盖预装版本)
# =============================================================================
RUN python3.12 -c "\
import torch; print(f'torch=={torch.__version__}'); \
import torchaudio; print(f'torchaudio=={torchaudio.__version__}'); \
import torchvision; print(f'torchvision=={torchvision.__version__}')" \
    > /tmp/torch-constraints.txt && \
    cat /tmp/torch-constraints.txt

# =============================================================================
# 9. ComfyUI
# =============================================================================
WORKDIR /opt
RUN git clone https://github.com/comfyanonymous/ComfyUI.git && \
    cd ComfyUI && \
    python3.12 -m pip install --constraint /tmp/torch-constraints.txt \
        -r requirements.txt

# =============================================================================
# 10. 常用插件
# =============================================================================
WORKDIR /opt/ComfyUI/custom_nodes
RUN git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Manager && \
    git clone --depth 1 https://github.com/Fannovel16/comfyui_controlnet_aux && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Pack && \
    git clone --depth 1 https://github.com/yolain/ComfyUI-Easy-Use && \
    git clone --depth 1 https://github.com/crystian/ComfyUI-Crystools && \
    git clone --depth 1 --recursive https://github.com/ssitu/ComfyUI_UltimateSDUpscale && \
    git clone --depth 1 https://github.com/adieyal/comfyui-dynamicprompts && \
    git clone --depth 1 https://github.com/weilin9999/WeiLin-Comfyui-Tools && \
    git clone --depth 1 https://github.com/GreenLandisaLie/AuraSR-ComfyUI && \
    git clone --depth 1 https://github.com/ltdrdata/was-node-suite-comfyui && \
    git clone --depth 1 https://github.com/kijai/ComfyUI-KJNodes && \
    git clone --depth 1 https://github.com/BenjaMITM/Enhanced-Civicomfy && \
    git clone --depth 1 https://github.com/pythongosssss/ComfyUI-WD14-Tagger && \
    git clone --depth 1 https://github.com/rgthree/rgthree-comfy && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Inspire-Pack && \
    git clone --depth 1 https://github.com/pythongosssss/ComfyUI-Custom-Scripts && \
    git clone --depth 1 https://github.com/city96/ComfyUI-GGUF && \
    git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus && \
    git clone --depth 1 https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite && \
    git clone --depth 1 https://github.com/cubiq/ComfyUI_essentials && \
    git clone --depth 1 https://github.com/1038lab/ComfyUI-RMBG

# 逐个安装插件依赖 (失败打印警告但继续, 后续显式安装补救)
RUN for req in $(find /opt/ComfyUI/custom_nodes -name "requirements.txt" -type f); do \
        echo "========================================" && \
        echo ">>> Installing: $req" && \
        echo "========================================" && \
        python3.12 -m pip install --constraint /tmp/torch-constraints.txt -r "$req" || \
        echo "⚠️ PARTIAL FAILURE: $req"; \
    done

# =============================================================================
# 11. 显式安装易遗漏 / 补充依赖
# =============================================================================
RUN python3.12 -m pip install \
    diffusers clip_interrogator peft open-clip-torch timm ftfy \
    color-matcher mss dill \
    "git+https://github.com/facebookresearch/sam2.git"

RUN python3.12 -m pip install \
    numba matplotlib dynamicprompts==0.30.2 \
    aiosqlite uuid7 deepdiff piexif segment-anything py-cpuinfo

RUN python3.12 -m pip install \
    hf_transfer aiohttp opencv-python-headless scikit-image \
    accelerate transformers safetensors onnxruntime-gpu

RUN python3.12 -m pip install \
    gguf insightface imageio imageio-ffmpeg

# =============================================================================
# 12. 目录结构 & 标记
# =============================================================================
WORKDIR /workspace
RUN mkdir -p /opt/ComfyUI/models/{checkpoints,loras,controlnet,vae,upscale_models,Aura-SR,sams} \
             /opt/ComfyUI/{output,input} \
             /opt/ComfyUI/user/default/workflows \
             /root/.config/rclone && \
    ln -snf /workspace /root/workspace && \
    touch ~/.no_auto_tmux && \
    python3.12 -c "\
import json, datetime, torch; \
info = { \
    'version': '3.0', \
    'build_date': datetime.datetime.now().strftime('%Y-%m-%d'), \
    'python': '3.12', \
    'torch': torch.__version__, \
    'cuda_toolkit': torch.version.cuda or '', \
    'fa2': True, \
    'sa2_archs': ['sm80','sm86','sm89','sm90','sm100','sm120'], \
    'base_image': 'runpod/pytorch:1.0.3-cu1300-torch291-ubuntu2404', \
}; \
open('/opt/.comfycarry-prebuilt','w').write(json.dumps(info, indent=2))"

# =============================================================================
# 13. 入口脚本
# =============================================================================
COPY entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

# =============================================================================
# 14. Brand — 替换 RunPod 登录横幅
# =============================================================================
COPY comfycarry-banner.txt /etc/runpod.txt
RUN sed -i '/docs\.runpod\.io/d' /root/.bashrc

# =============================================================================
# 15. 清理
# =============================================================================
# 移除插件 requirements.txt 中的 git+ URL (这些包已在步骤 11 安装,
# 保留会导致 deploy 阶段 pip 重复 clone+build, 浪费 ~90s)
RUN find /opt/ComfyUI/custom_nodes -name "requirements.txt" -type f \
        -exec sed -i '/^git+/d' {} \;

RUN rm -rf /tmp/* /var/tmp/* && \
    python3.12 -m pip cache purge 2>/dev/null || true

EXPOSE 5000 8188 22
CMD ["/opt/entrypoint.sh"]
