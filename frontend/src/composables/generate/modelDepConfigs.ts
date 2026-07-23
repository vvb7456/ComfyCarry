import type { ModelDep, ModelDepConfig } from './useModelDependency'
import { TAGGER_MODEL_CONFIG } from './useTagInterrogation'  // 确认无循环依赖 (已核实)
import {
  REGISTRY_FILENAMES,
} from '@/config/component-registry'

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
    size: '~2.5 GB',
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
    size: '~2.5 GB',
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
    size: '~352 MB',
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
    size: '~1.34 GB',
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
    size: '~2.47 GB',
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
    size: '~3.9 GB',
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
    size: '~8.96 GB',
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

/**
 * 所有依赖组件文件名集合 — 模型管理页默认隐藏这些文件。
 * 聚合: REGISTRY_FILENAMES (组件表) + CN_MODEL_CONFIGS + _CN_BRANCH_CONFIGS 全部 branch
 * + UPSCALE_MODEL_CONFIG + TAGGER_MODEL_CONFIG (Set 天然去重)。
 */
export const COMPONENT_FILENAMES: Set<string> = (() => {
  const s = new Set<string>(REGISTRY_FILENAMES)
  const configs = [
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
