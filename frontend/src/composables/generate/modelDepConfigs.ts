import type { ModelDep, ModelDepConfig } from './useModelDependency'

// ── CN Model Definitions ─────────────────────────────────────────────────────

const CN_MODELS: Record<string, ModelDep> = {
  union: {
    id: 'xinsir-union-promax',
    name: 'Xinsir Union ProMax',
    description: 'SDXL/Pony 通用',
    size: '~2.5 GB',
    files: [{
      filename: 'diffusion_pytorch_model_promax.safetensors',
      url: 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  pose_dedicated: {
    id: 'windsingai-openpose',
    name: 'windsingai OpenPose',
    description: 'Illustrious/NoobAI 专用',
    size: '~2.5 GB',
    files: [{
      filename: 'openpose_s6000.safetensors',
      url: 'https://huggingface.co/windsingai/openpose/resolve/main/openpose_s6000.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  canny_dedicated: {
    id: 'illustrious-canny',
    name: 'Illustrious XL Canny',
    description: 'Illustrious/NoobAI 专用',
    size: '~1.2 GB',
    files: [{
      filename: 'illustriousXLv1.1_canny_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_canny_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  depth_dedicated: {
    id: 'illustrious-depth',
    name: 'Illustrious XL Depth',
    description: 'Illustrious/NoobAI 专用',
    size: '~1.2 GB',
    files: [{
      filename: 'illustriousXLv1.1_depth_midas_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_depth_midas_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  dwpose: {
    id: 'dwpose',
    name: 'DWPose 姿态检测器',
    description: 'YOLO + 关键点估计',
    size: '~200 MB',
    required: true,
    files: [
      {
        filename: 'yolox_l.onnx',
        url: 'https://huggingface.co/yzd-v/DWPose/resolve/main/yolox_l.onnx?download=true',
        subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose',
      },
      {
        filename: 'dw-ll_ucoco_384_bs5.torchscript.pt',
        url: 'https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt?download=true',
        subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5',
      },
    ],
  },
  depth_anything_v2: {
    id: 'depth-anything-v2',
    name: 'Depth Anything V2',
    description: '深度图估计',
    size: '~398 MB',
    required: true,
    files: [{
      filename: 'depth_anything_v2_vitl.pth',
      url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth?download=true',
      subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/depth-anything/Depth-Anything-V2-Large',
    }],
  },
}

// ── Upscale Model Definitions ────────────────────────────────────────────────

const UPSCALE_MODELS: Record<string, ModelDep> = {
  aurasr_v2: {
    id: 'aurasr-v2',
    name: 'AuraSR v2',
    description: '4× 超分辨率放大',
    size: '~2.3 GB',
    required: true,
    files: [
      {
        filename: 'config.json',
        url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true',
        subdir: 'models/Aura-SR',
      },
      {
        filename: 'model.safetensors',
        url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/model.safetensors?download=true',
        subdir: 'models/Aura-SR',
      },
    ],
  },
  seedvr2_3b_fp8: {
    id: 'seedvr2-3b-fp8',
    name: 'SeedVR2 3B FP8',
    description: 'SeedVR2 视频放大，推理显存约 10GB（1024 底图 2x）',
    size: '~3.4 GB',
    files: [
      {
        filename: 'seedvr2_ema_3b_fp8_e4m3fn.safetensors',
        url: 'https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_3b_fp8_e4m3fn.safetensors?download=true',
        subdir: 'models/SEEDVR2',
      },
      {
        filename: 'ema_vae_fp16.safetensors',
        url: 'https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors?download=true',
        subdir: 'models/SEEDVR2',
      },
    ],
  },
  seedvr2_7b_sharp_fp8: {
    id: 'seedvr2-7b-sharp-fp8',
    name: 'SeedVR2 7B-sharp FP8',
    description: 'SeedVR2 7B 锐化版，推理显存约 17GB',
    size: '~10 GB',
    files: [
      {
        filename: 'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors',
        url: 'https://huggingface.co/AInVFX/SeedVR2_comfyUI/resolve/main/seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors?download=true',
        subdir: 'models/SEEDVR2',
      },
      {
        filename: 'ema_vae_fp16.safetensors',
        url: 'https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors?download=true',
        subdir: 'models/SEEDVR2',
      },
    ],
  },
}

export const UPSCALE_MODEL_CONFIG: ModelDepConfig = {
  tab: 'upscale',
  title: 'generate.upscale.need_download',
  models: [UPSCALE_MODELS.aurasr_v2, UPSCALE_MODELS.seedvr2_3b_fp8, UPSCALE_MODELS.seedvr2_7b_sharp_fp8],
}

// ── Anima Model Definitions ──────────────────────────────────────────────────
// Anima 架构需要 UNet + CLIP + VAE 三件套（split-file），其中 UNet 由用户在
// 主选择器中选择，CLIP / VAE 视为固定附属文件，缺失时由 tab 级 Gate 引导下载。
// HuggingFace 官方仓库：https://huggingface.co/circlestone-labs/Anima

const ANIMA_MODELS: Record<string, ModelDep> = {
  qwen3_clip: {
    id: 'qwen_3_06b_base',
    name: 'Qwen3 0.6B (CLIP / 文本编码器)',
    description: 'Anima 专用文本编码器，体积约 1.19 GB',
    size: '~1.19 GB',
    required: true,
    files: [{
      filename: 'qwen_3_06b_base.safetensors',
      url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors?download=true',
      subdir: 'models/text_encoders',
    }],
  },
  qwen_vae: {
    id: 'qwen_image_vae',
    name: 'Qwen Image VAE',
    description: 'Anima 专用 VAE，体积约 253 MB',
    size: '~253 MB',
    required: true,
    files: [{
      filename: 'qwen_image_vae.safetensors',
      url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors?download=true',
      subdir: 'models/vae',
    }],
  },
}

export const ANIMA_MODEL_CONFIG: ModelDepConfig = {
  tab: 'anima',
  title: 'generate.gate.anima_title',
  models: [ANIMA_MODELS.qwen3_clip, ANIMA_MODELS.qwen_vae],
}

export const CN_MODEL_CONFIGS: Record<string, ModelDepConfig> = {
  pose: {
    tab: 'pose',
    title: 'generate.controlnet.need_download_pose',
    models: [CN_MODELS.union, CN_MODELS.pose_dedicated, CN_MODELS.dwpose],
    minOptional: 1,
  },
  canny: {
    tab: 'canny',
    title: 'generate.controlnet.need_download_canny',
    models: [CN_MODELS.union, CN_MODELS.canny_dedicated],
    minOptional: 1,
  },
  depth: {
    tab: 'depth',
    title: 'generate.controlnet.need_download_depth',
    models: [CN_MODELS.union, CN_MODELS.depth_dedicated, CN_MODELS.depth_anything_v2],
    minOptional: 1,
  },
}
