import type { DepRow } from './useDependencyStatus'

/**
 * 各功能模块的依赖清单。
 *
 * 全部是 useDependencyStatus 认得的 DepRow —— 运行组件、ControlNet、放大、
 * 面部修复、反推共用同一个状态机与同一个展示组件, 这里只描述"要哪些文件"。
 */
export interface DepGroup {
  /** 展开态标题的 i18n key */
  title: string
  rows: DepRow[]
  /** 至少需要装几个可选行 (可选行 = 未标 required 的行) */
  minOptional?: number
}

// ── ControlNet ───────────────────────────────────────────────────────────────

const CN_MODELS: Record<string, DepRow> = {
  union: {
    id: 'xinsir-union-promax',
    label: 'Xinsir Union ProMax',
    hint: 'SDXL/Pony 通用',
    sizeText: '~2.5 GB',
    required: true,
    files: [{
      filename: 'diffusion_pytorch_model_promax.safetensors',
      url: 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  pose_dedicated: {
    id: 'windsingai-openpose',
    label: 'windsingai OpenPose',
    hint: 'Illustrious/NoobAI 专用',
    sizeText: '~2.5 GB',
    required: true,
    files: [{
      filename: 'openpose_s6000.safetensors',
      url: 'https://huggingface.co/windsingai/openpose/resolve/main/openpose_s6000.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  canny_dedicated: {
    id: 'illustrious-canny',
    label: 'Illustrious XL Canny',
    hint: 'Illustrious/NoobAI 专用',
    sizeText: '~2.5 GB',
    required: true,
    files: [{
      filename: 'illustriousXLv1.1_canny_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_canny_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  depth_dedicated: {
    id: 'illustrious-depth',
    label: 'Illustrious XL Depth',
    hint: 'Illustrious/NoobAI 专用',
    sizeText: '~2.5 GB',
    required: true,
    files: [{
      filename: 'illustriousXLv1.1_depth_midas_fp16.safetensors',
      url: 'https://huggingface.co/MIC-Lab/illustriousXLv1.1_controlnet/resolve/main/illustriousXLv1.1_depth_midas_fp16.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
  dwpose: {
    id: 'dwpose',
    label: 'DWPose',
    hint: '姿态检测',
    sizeText: '~352 MB',
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
    label: 'Depth Anything V2',
    hint: '深度估计',
    sizeText: '~1.34 GB',
    required: true,
    files: [{
      filename: 'depth_anything_v2_vitl.pth',
      url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth?download=true',
      subdir: 'custom_nodes/comfyui_controlnet_aux/ckpts/depth-anything/Depth-Anything-V2-Large',
    }],
  },
  flux_union: {
    id: 'flux-union-pro2-fp8',
    label: 'Union Pro 2.0 FP8',
    hint: 'Flux 1 专用',
    sizeText: '~2.14 GB',
    required: true,
    files: [{
      filename: 'FLUX.1-dev-ControlNet-Union-Pro-2.0-fp8.safetensors',
      url: 'https://huggingface.co/ABDALLALSWAITI/FLUX.1-dev-ControlNet-Union-Pro-2.0-fp8/resolve/main/diffusion_pytorch_model.safetensors?download=true',
      subdir: 'models/controlnet',
    }],
  },
}

// ── 放大 ─────────────────────────────────────────────────────────────────────

const UPSCALE_MODELS: Record<string, DepRow> = {
  aurasr_v2: {
    id: 'aurasr-v2',
    label: 'AuraSR v2',
    hint: '4× 超分辨率放大',
    sizeText: '~2.47 GB',
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
    label: 'SeedVR2 3B FP8',
    hint: '视频放大，显存约 10GB',
    sizeText: '~3.9 GB',
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
    label: 'SeedVR2 7B-sharp FP8',
    hint: '锐化版，显存约 17GB',
    sizeText: '~8.96 GB',
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

export const UPSCALE_DEP_GROUP: DepGroup = {
  title: 'generate.upscale.need_download',
  rows: [UPSCALE_MODELS.aurasr_v2, UPSCALE_MODELS.seedvr2_3b_fp8, UPSCALE_MODELS.seedvr2_7b_sharp_fp8],
  // 三个引擎互为替代: 装任意一个即可用, 一个都没有则模块开关打不开
  minOptional: 1,
}

// ── 面部重绘 (FaceDetailer) ──────────────────────────────────────────────────
// 检测器必需 (~52MB); SAM 可选增强 (vit_b, 修脸场景足够, vit_h 属过剩)

const FACE_MODELS: Record<string, DepRow> = {
  face_yolov8m: {
    id: 'face-yolov8m',
    label: 'YOLOv8 面部检测器',
    hint: '检测人脸位置',
    sizeText: '~52 MB',
    required: true,
    files: [{
      filename: 'face_yolov8m.pt',
      url: 'https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt?download=true',
      subdir: 'models/ultralytics/bbox',
    }],
  },
  sam_vit_b: {
    id: 'sam-vit-b',
    label: 'SAM 精细掩码',
    hint: '五官级分割掩码，边界更精确',
    sizeText: '~375 MB',
    files: [{
      filename: 'sam_vit_b_01ec64.pth',
      url: 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth',
      subdir: 'models/sams',
    }],
  },
}

export const FACE_DEP_GROUP: DepGroup = {
  title: 'generate.face.need_download',
  rows: [FACE_MODELS.face_yolov8m, FACE_MODELS.sam_vit_b],
}

// ── CN 分家: 按 branch 取依赖清单 ──────────────────────────────────────────────
// pony/sdxl 走 union (sdxl 通用), illustrious/noobai 走专用模型。
// 分家后每 branch 只剩一个 CN 主模型 → 它和检测器一样是必需的 (不再是"多选一",
// 故无 minOptional)。这是"原本可选的模型因架构拆分变成必需"的那一类。
//
// pose:   sdxl → [union, dwpose];            ilnoob → [pose_dedicated, dwpose]
// canny:  sdxl → [union];                    ilnoob → [canny_dedicated]
// depth:  sdxl → [union, depth_anything_v2];  ilnoob → [depth_dedicated, depth_anything_v2]

export type CnBranch = 'sdxl' | 'ilnoob' | 'flux'

const _CN_BRANCH_GROUPS: Record<string, Record<CnBranch, DepGroup>> = {
  pose: {
    sdxl: {
      title: 'generate.controlnet.need_download_pose',
      rows: [CN_MODELS.union, CN_MODELS.dwpose],
    },
    ilnoob: {
      title: 'generate.controlnet.need_download_pose',
      rows: [CN_MODELS.pose_dedicated, CN_MODELS.dwpose],
    },
    flux: {
      title: 'generate.controlnet.need_download_pose',
      rows: [CN_MODELS.flux_union, CN_MODELS.dwpose],
    },
  },
  canny: {
    sdxl: {
      title: 'generate.controlnet.need_download_canny',
      rows: [CN_MODELS.union],
    },
    ilnoob: {
      title: 'generate.controlnet.need_download_canny',
      rows: [CN_MODELS.canny_dedicated],
    },
    flux: {
      title: 'generate.controlnet.need_download_canny',
      rows: [CN_MODELS.flux_union],
    },
  },
  depth: {
    sdxl: {
      title: 'generate.controlnet.need_download_depth',
      rows: [CN_MODELS.union, CN_MODELS.depth_anything_v2],
    },
    ilnoob: {
      title: 'generate.controlnet.need_download_depth',
      rows: [CN_MODELS.depth_dedicated, CN_MODELS.depth_anything_v2],
    },
    flux: {
      title: 'generate.controlnet.need_download_depth',
      rows: [CN_MODELS.flux_union, CN_MODELS.depth_anything_v2],
    },
  },
}

/**
 * getCnDepGroup — 按 CN 类型 + branch 返回该 branch 的依赖清单。
 * branch 缺省时回退 'sdxl' (仅 sdxl/pony 等已显式声明 cnBranch)。
 */
export function getCnDepGroup(cnType: string, branch: CnBranch | undefined): DepGroup {
  const table = _CN_BRANCH_GROUPS[cnType]
  if (!table) return { title: '', rows: [] }
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
