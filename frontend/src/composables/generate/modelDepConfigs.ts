import type { DepRow, DepFileSpec } from './useDependencyStatus'
import { HF_VERSION_INDEX, MODEL_TYPE_DIRS } from '@/config/huggingface-models'

/**
 * 各功能模块的依赖清单。
 *
 * 全部是 useDependencyStatus 认得的 DepRow —— 运行组件、ControlNet、放大、
 * 面部修复、反推共用同一个状态机与同一个展示组件, 这里只描述"要哪些文件"。
 *
 * 模型文件优先锚定 HF 白名单 (hfFile): 文件事实 (url/size/sha256/目录) 单一来源,
 * 下载走 huggingface 统一通道 (完成即登记 SQLite + 状态与 HF 标签页同步)。
 * 仅 custom_nodes 辅助件与非 HF 源文件保留手写 url。
 */
export interface DepGroup {
  /** 展开态标题的 i18n key */
  title: string
  rows: DepRow[]
  /** 至少需要装几个可选行 (可选行 = 未标 required 的行) */
  minOptional?: number
}

// ── 白名单锚点工具 ────────────────────────────────────────────────────────────

function hfFile(versionId: number): DepFileSpec {
  const hit = HF_VERSION_INDEX.get(versionId)
  if (!hit) throw new Error(`modelDepConfigs: 白名单版本 ${versionId} 不存在`)
  const file = hit.version.file
  const subdir = MODEL_TYPE_DIRS[file.modelType]
  if (!subdir) throw new Error(`modelDepConfigs: modelType ${file.modelType} 无目录映射`)
  return { filename: file.filename, url: file.url, subdir, hf: hit }
}

function hfBytes(...versionIds: number[]): number {
  return versionIds.reduce((sum, vid) => {
    const hit = HF_VERSION_INDEX.get(vid)
    if (!hit) throw new Error(`modelDepConfigs: 白名单版本 ${vid} 不存在`)
    return sum + hit.version.file.sizeBytes
  }, 0)
}

// ── ControlNet ───────────────────────────────────────────────────────────────

const CN_MODELS: Record<string, DepRow> = {
  union: {
    id: 'xinsir-union-promax',
    label: 'Xinsir Union ProMax',
    hint: 'SDXL/Pony 通用',
    bytes: hfBytes(-10000362),
    required: true,
    files: [hfFile(-10000362)],
  },
  pose_dedicated: {
    id: 'windsingai-openpose',
    label: 'windsingai OpenPose',
    hint: 'Illustrious/NoobAI 专用',
    bytes: hfBytes(-10000363),
    required: true,
    files: [hfFile(-10000363)],
  },
  canny_dedicated: {
    id: 'illustrious-canny',
    label: 'Illustrious XL Canny',
    hint: 'Illustrious/NoobAI 专用',
    bytes: hfBytes(-10000364),
    required: true,
    files: [hfFile(-10000364)],
  },
  depth_dedicated: {
    id: 'illustrious-depth',
    label: 'Illustrious XL Depth',
    hint: 'Illustrious/NoobAI 专用',
    bytes: hfBytes(-10000365),
    required: true,
    files: [hfFile(-10000365)],
  },
  dwpose: {
    id: 'dwpose',
    label: 'DWPose',
    hint: '姿态检测',
    sizeText: '~352 MB',
    required: true,
    // custom_nodes 检测器 ckpt, 不属模型索引范畴 → 通用通道
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
    // custom_nodes 检测器 ckpt, 不属模型索引范畴 → 通用通道
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
    bytes: hfBytes(-10000366),
    required: true,
    files: [hfFile(-10000366)],
  },
}

// ── 放大 ─────────────────────────────────────────────────────────────────────

const UPSCALE_MODELS: Record<string, DepRow> = {
  aurasr_v2: {
    id: 'aurasr-v2',
    label: 'AuraSR v2',
    hint: '4× 超分辨率放大',
    // bytes 仅含白名单锚定的权重件; 伴生 config.json 非模型文件未计入 (数百字节, 忽略)
    bytes: hfBytes(-10000371),
    files: [
      hfFile(-10000371),
      {
        // 配套配置文件, 非模型文件不入白名单 → 通用通道
        filename: 'config.json',
        url: 'https://huggingface.co/fal/AuraSR-v2/resolve/main/config.json?download=true',
        subdir: 'models/Aura-SR',
      },
    ],
  },
  seedvr2_3b_fp8: {
    id: 'seedvr2-3b-fp8',
    label: 'SeedVR2 3B FP8',
    hint: '视频放大，显存约 10GB',
    bytes: hfBytes(-10000368, -10000369),
    files: [hfFile(-10000368), hfFile(-10000369)],
  },
  seedvr2_7b_sharp_fp8: {
    id: 'seedvr2-7b-sharp-fp8',
    label: 'SeedVR2 7B-sharp FP8',
    hint: '锐化版，显存约 17GB',
    bytes: hfBytes(-10000370, -10000369),
    files: [hfFile(-10000370), hfFile(-10000369)],
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
    bytes: hfBytes(-10000367),
    required: true,
    files: [hfFile(-10000367)],
  },
  sam_vit_b: {
    id: 'sam-vit-b',
    label: 'SAM 精细掩码',
    hint: '五官级分割掩码，边界更精确',
    sizeText: '~375 MB',
    // Meta 官方源 (dl.fbaipublicfiles.com/segment_anything, facebookresearch/segment-anything);
    // HF 无官方仓库 (facebook/sam-vit-base 是 transformers 格式转换, 非 Impact Pack 用的原始 .pth) → 通用通道
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
