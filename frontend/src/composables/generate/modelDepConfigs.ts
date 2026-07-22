import type { ModelDep, ModelDepConfig } from './useModelDependency'
import { TAGGER_MODEL_CONFIG } from './useTagInterrogation'  // 确认无循环依赖 (已核实)

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
  flux_union: {
    id: 'flux-union-pro2-fp8',
    name: 'Union Pro 2.0 FP8',
    description: 'Flux 1 专用 (InstantX/Shakker)',
    size: '~2.14 GB',
    files: [{
      filename: 'FLUX.1-dev-ControlNet-Union-Pro-2.0-fp8.safetensors',
      url: 'https://huggingface.co/ABDALLALSWAITI/FLUX.1-dev-ControlNet-Union-Pro-2.0-fp8/resolve/main/diffusion_pytorch_model.safetensors?download=true',
      subdir: 'models/controlnet',
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
}

/** 共享 VAE 依赖: Anima 与 Krea 2 均使用同一文件 */
const QWEN_IMAGE_VAE_DEP: ModelDep = {
  id: 'qwen_image_vae',
  name: 'Qwen Image VAE',
  description: 'Qwen Image VAE (Anima / Krea 2 共用)',
  size: '~253 MB',
  required: true,
  files: [{
    filename: 'qwen_image_vae.safetensors',
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors?download=true',
    subdir: 'models/vae',
  }],
}

export const ANIMA_MODEL_CONFIG: ModelDepConfig = {
  tab: 'anima',
  title: 'generate.gate.anima_title',
  models: [ANIMA_MODELS.qwen3_clip, QWEN_IMAGE_VAE_DEP],
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

// ── CN 分家: 按 branch 取依赖清单 ──────────────────────────────────────────────
// A2: pony/sdxl 走 union (sdxl 通用), illustrious/noobai 走专用模型。
// 检测器 (dwpose/depth_anything_v2) 的 required 语义不变, minOptional 保持 1
// (每 branch 现在只剩一个可选 CN 模型)。
//
// pose:   sdxl → [union, dwpose];            ilnoob → [pose_dedicated, dwpose]
// canny:  sdxl → [union];                    ilnoob → [canny_dedicated]
// depth:  sdxl → [union, depth_anything_v2];  ilnoob → [depth_dedicated, depth_anything_v2]

export type CnBranch = 'sdxl' | 'ilnoob' | 'flux'

const _CN_BRANCH_CONFIGS: Record<string, Record<CnBranch, ModelDepConfig>> = {
  pose: {
    sdxl: {
      tab: 'pose',
      title: 'generate.controlnet.need_download_pose',
      models: [CN_MODELS.union, CN_MODELS.dwpose],
      minOptional: 1,
    },
    ilnoob: {
      tab: 'pose',
      title: 'generate.controlnet.need_download_pose',
      models: [CN_MODELS.pose_dedicated, CN_MODELS.dwpose],
      minOptional: 1,
    },
    flux: {
      tab: 'pose',
      title: 'generate.controlnet.need_download_pose',
      models: [CN_MODELS.flux_union, CN_MODELS.dwpose],
      minOptional: 1,
    },
  },
  canny: {
    sdxl: {
      tab: 'canny',
      title: 'generate.controlnet.need_download_canny',
      models: [CN_MODELS.union],
      minOptional: 1,
    },
    ilnoob: {
      tab: 'canny',
      title: 'generate.controlnet.need_download_canny',
      models: [CN_MODELS.canny_dedicated],
      minOptional: 1,
    },
    flux: {
      tab: 'canny',
      title: 'generate.controlnet.need_download_canny',
      models: [CN_MODELS.flux_union],
      minOptional: 1,
    },
  },
  depth: {
    sdxl: {
      tab: 'depth',
      title: 'generate.controlnet.need_download_depth',
      models: [CN_MODELS.union, CN_MODELS.depth_anything_v2],
      minOptional: 1,
    },
    ilnoob: {
      tab: 'depth',
      title: 'generate.controlnet.need_download_depth',
      models: [CN_MODELS.depth_dedicated, CN_MODELS.depth_anything_v2],
      minOptional: 1,
    },
    flux: {
      tab: 'depth',
      title: 'generate.controlnet.need_download_depth',
      models: [CN_MODELS.flux_union, CN_MODELS.depth_anything_v2],
      minOptional: 1,
    },
  },
}

/**
 * getCnDepConfig — 按 CN 类型 + branch 返回该 branch 的依赖清单。
 * 调用方统一走此函数 (不再直接读 CN_MODEL_CONFIGS)。
 * branch 缺省时回退 'sdxl' (兼容旧调用, 仅 sdxl/pony 等已显式声明 cnBranch)。
 */
export function getCnDepConfig(cnType: string, branch: CnBranch | undefined): ModelDepConfig {
  const table = _CN_BRANCH_CONFIGS[cnType]
  if (!table) return CN_MODEL_CONFIGS[cnType]
  return table[branch ?? 'sdxl']
}

/**
 * CN_FILE_BRANCH — CN 模型文件名 → 所属 branch 映射, 供 CN 面板下拉过滤。
 * 仅含 "已知" CN 主模型 (union → sdxl; pose/canny/depth_dedicated → ilnoob)。
 * 检测器 (dwpose / depth_anything_v2) 不在此表 — 它们是辅助节点, 不参与 branch 分家。
 * 用户手动安装的未知文件也不在此表 → 面板走"未知"分支 (列出但排后)。
 */
export const CN_FILE_BRANCH: Record<string, CnBranch> = (() => {
  const map: Record<string, CnBranch> = {}
  // sdxl branch: union (一个文件)
  for (const f of CN_MODELS.union.files) map[f.filename] = 'sdxl'
  // ilnoob branch: 三个专用模型
  for (const f of CN_MODELS.pose_dedicated.files) map[f.filename] = 'ilnoob'
  for (const f of CN_MODELS.canny_dedicated.files) map[f.filename] = 'ilnoob'
  for (const f of CN_MODELS.depth_dedicated.files) map[f.filename] = 'ilnoob'
  // flux branch: flux_union (Union Pro 2.0 FP8)
  for (const f of CN_MODELS.flux_union.files) map[f.filename] = 'flux'
  return map
})()

/**
 * cnBranchForFile — 给定后端返回的 CN 模型文件名, 查 CN_FILE_BRANCH 返回 branch。
 * 匹配优先级: 精确 basename → endsWith (兼容子目录前缀如 "subdir/union.safetensors")。
 * 未命中返回 null (= 未知文件, 面板走"列出排后"分支)。
 */
export function cnBranchForFile(filename: string): CnBranch | null {
  // 精确 basename
  const base = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  if (CN_FILE_BRANCH[base]) return CN_FILE_BRANCH[base]
  // endsWith 兼容子目录前缀
  for (const [fn, br] of Object.entries(CN_FILE_BRANCH)) {
    if (filename === fn || filename.endsWith('/' + fn)) return br
  }
  return null
}

// ── Krea 2 Model Definitions ──────────────────────────────────────────────────
// Krea 2 架构需要 UNet + CLIP + VAE 三件套（split-file），其中 UNet 由用户在
// 主选择器中选择，CLIP / VAE 视为固定附属文件，缺失时由 tab 级 Gate 引导下载。
// HuggingFace 官方仓库：https://huggingface.co/Comfy-Org/Krea-2

const KREA2_MODELS: Record<string, ModelDep> = {
  qwen3vl_clip: {
    id: 'qwen3vl_4b',
    name: 'Qwen3-VL-4B (文本编码器)',
    description: 'Krea 2 专用文本编码器 (FP8)',
    size: '~5.24 GB',
    required: true,
    files: [{
      filename: 'qwen3vl_4b_fp8_scaled.safetensors',
      url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors?download=true',
      subdir: 'models/text_encoders',
    }],
  },
}

export const KREA2_MODEL_CONFIG: ModelDepConfig = {
  tab: 'krea2',
  title: 'generate.gate.krea2_title',
  models: [KREA2_MODELS.qwen3vl_clip, QWEN_IMAGE_VAE_DEP],
}

// ── Z-Image / Flux1 Model Definitions ────────────────────────────────────────
// Z-Image 与 Flux1 共用同一 VAE (ae.safetensors, 335MB)。
// Z-Image 专用文本编码器: qwen_3_4b (CLIPLoader type=lumina2)。
// Flux1 双 CLIP (DualCLIPLoader type=flux): clip_l + t5xxl_fp8_e4m3fn_scaled。
// 主模型 (UNet/checkpoint) 由用户自行下载, Gate 不含 UNet 条目。
// HuggingFace 官方仓库：https://huggingface.co/Comfy-Org/z_image_turbo (VAE+TE)
//   https://huggingface.co/comfyanonymous/flux_text_encoders (Flux1 双 TE)

/** 共享 VAE 依赖: Z-Image 与 Flux1 均使用同一文件 (Flux1 同款 VAE) */
const AE_VAE_DEP: ModelDep = {
  id: 'flux_ae',
  name: 'Flux AE (VAE)',
  description: 'Z-Image / Flux1 共用 VAE',
  size: '~335 MB',
  required: true,
  files: [{
    filename: 'ae.safetensors',
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors?download=true',
    subdir: 'models/vae',
  }],
}

/** Z-Image 专用文本编码器 (CLIPLoader type=lumina2) */
const QWEN3_4B_TE_DEP: ModelDep = {
  id: 'qwen3_4b',
  name: 'Qwen3-4B (文本编码器)',
  description: 'Z-Image 专用文本编码器',
  size: '~7.5 GB',
  required: true,
  files: [{
    filename: 'qwen_3_4b.safetensors',
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors?download=true',
    subdir: 'models/text_encoders',
  }],
}

/** Flux1 双 CLIP (DualCLIPLoader type=flux) */
const FLUX1_TE_MODELS: Record<string, ModelDep> = {
  clip_l: {
    id: 'clip_l',
    name: 'CLIP-L (文本编码器 1)',
    description: 'Flux1 双 CLIP 之一',
    size: '~246 MB',
    required: true,
    files: [{
      filename: 'clip_l.safetensors',
      url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors?download=true',
      subdir: 'models/text_encoders',
    }],
  },
  t5xxl_fp8: {
    id: 't5xxl_fp8_e4m3fn_scaled',
    name: 'T5-XXL FP8 (文本编码器 2)',
    description: 'Flux1 双 CLIP 之一 (FP8 量化)',
    size: '~4.9 GB',
    required: true,
    files: [{
      filename: 't5xxl_fp8_e4m3fn_scaled.safetensors',
      url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors?download=true',
      subdir: 'models/text_encoders',
    }],
  },
}

export const ZIMAGE_MODEL_CONFIG: ModelDepConfig = {
  tab: 'zimage',
  title: 'generate.gate.zimage_title',
  models: [QWEN3_4B_TE_DEP, AE_VAE_DEP],
}

export const FLUX1_MODEL_CONFIG: ModelDepConfig = {
  tab: 'flux1',
  title: 'generate.gate.flux1_title',
  models: [FLUX1_TE_MODELS.clip_l, FLUX1_TE_MODELS.t5xxl_fp8, AE_VAE_DEP],
}

export const CHROMA_MODEL_CONFIG: ModelDepConfig = {
  tab: 'chroma',
  title: 'generate.gate.chroma_title',
  models: [FLUX1_TE_MODELS.t5xxl_fp8, AE_VAE_DEP],
}

// ── Flux2 Model Definitions ──────────────────────────────────────────────────
// Flux2 公共 VAE: flux2-vae (0.34GB), 与 flux1 的 ae.safetensors 不同。
// klein TE = Qwen3-4B (qwen_3_4b.safetensors, type=flux2; 可能与 Z-Image 同名文件复用);
// dev TE  = Mistral-3-Small FP8 (mistral_3_small_flux2_fp8.safetensors, 18GB)。
// 主模型 (UNet) 由用户自行下载, Gate 不含 UNet 条目。
// HF URL 已核验 (Comfy-Org/flux2-dev · split_files/; HEAD 200)。

const FLUX2_VAE_DEP: ModelDep = {
  id: 'flux2_vae',
  name: 'Flux2 VAE',
  description: 'Flux2 公共 VAE',
  size: '~0.34 GB',
  required: true,
  files: [{
    filename: 'flux2-vae.safetensors',
    url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors?download=true',
    subdir: 'models/vae',
  }],
}

const FLUX2_KLEIN_TE_DEP: ModelDep = {
  id: 'qwen3_4b_flux2',
  name: 'Qwen3-4B (Klein TE)',
  description: 'Flux2 Klein 文本编码器 (与 Z-Image 同名文件, type=flux2)',
  size: '~7.5 GB',
  required: true,
  files: [{
    filename: 'qwen_3_4b.safetensors',
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors?download=true',
    subdir: 'models/text_encoders',
  }],
}

const FLUX2_DEV_TE_DEP: ModelDep = {
  id: 'mistral_3_small_flux2_fp8',
  name: 'Mistral-3-Small (Dev TE)',
  description: 'Flux2 Dev 文本编码器 (FP8)',
  size: '~18 GB',
  required: true,
  files: [{
    filename: 'mistral_3_small_flux2_fp8.safetensors',
    url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors?download=true',
    subdir: 'models/text_encoders',
  }],
}

export const FLUX2_KLEIN_MODEL_CONFIG: ModelDepConfig = {
  tab: 'flux2klein',
  title: 'generate.gate.flux2klein_title',
  models: [FLUX2_KLEIN_TE_DEP, FLUX2_VAE_DEP],
}

export const FLUX2_DEV_MODEL_CONFIG: ModelDepConfig = {
  tab: 'flux2dev',
  title: 'generate.gate.flux2dev_title',
  models: [FLUX2_DEV_TE_DEP, FLUX2_VAE_DEP],
}

/** tab key → tab 级依赖 Gate 配置; 无 Gate 的架构 (sdxl) 不在表内 */
export const TAB_DEP_CONFIGS: Record<string, ModelDepConfig> = {
  anima: ANIMA_MODEL_CONFIG,
  krea2: KREA2_MODEL_CONFIG,
  zimage: ZIMAGE_MODEL_CONFIG,
  flux1: FLUX1_MODEL_CONFIG,
  chroma: CHROMA_MODEL_CONFIG,
  flux2klein: FLUX2_KLEIN_MODEL_CONFIG,
  flux2dev: FLUX2_DEV_MODEL_CONFIG,
}

/**
 * 所有依赖组件文件名集合 — 模型管理页默认隐藏这些文件。
 * 聚合: TAB_DEP_CONFIGS + CN_MODEL_CONFIGS (legacy) + _CN_BRANCH_CONFIGS 全部 branch 的 models
 * (Set 天然去重, 确保 flux branch 的 flux_union CN 文件也被隐藏)。
 */
export const COMPONENT_FILENAMES: Set<string> = (() => {
  const s = new Set<string>()
  const configs = [
    ...Object.values(TAB_DEP_CONFIGS),
    ...Object.values(CN_MODEL_CONFIGS),
    ...Object.values(_CN_BRANCH_CONFIGS).flatMap(table => Object.values(table)),
    UPSCALE_MODEL_CONFIG,
    TAGGER_MODEL_CONFIG,
  ]
  for (const c of configs)
    for (const m of c.models)
      for (const f of m.files) s.add(f.filename)
  return s
})()
