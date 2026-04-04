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
}

export const UPSCALE_MODEL_CONFIG: ModelDepConfig = {
  tab: 'upscale',
  title: 'generate.upscale.need_download',
  models: [UPSCALE_MODELS.aurasr_v2],
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
