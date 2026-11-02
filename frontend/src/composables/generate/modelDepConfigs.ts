import type { DepRow, DepFileSpec } from './useDependencyStatus'
import { HF_VERSION_INDEX, fileDirectory } from '@/config/huggingface-models'
import type { ModelTypeConfig } from '@/config/model-types'

/**
 * 各功能模块的依赖清单。
 *
 * 全部是 useDependencyStatus 认得的 DepRow —— 运行组件、ControlNet、放大、
 * 面部修复、反推共用同一个状态机与同一个展示组件, 这里只描述"要哪些文件"。
 *
 * 文件事实 (url/size/sha256/目录) 统一来自白名单，模型与辅助文件共用下载通道。
 */
export interface DepGroup {
  /** 展开态标题的 i18n key */
  title: string
  rows: DepRow[]
  /** 至少需要装几个可选行 (可选行 = 未标 required 的行) */
  minOptional?: number
  /**
   * 自定义就绪判定, 给出已安装的行 id, 返回整套是否可用 (覆盖 minOptional)。
   * 用于计数表达不了的"多套餐任一成套"规则: 如放大要么 AuraSR 权重齐,
   * 要么 SeedVR2 权重 + 共用 VAE 齐。
   */
  readyWhen?: (installedIds: Set<string>) => boolean
}

export function hfFile(versionId: number): DepFileSpec {
  const hit = HF_VERSION_INDEX.get(versionId)
  if (!hit) throw new Error(`modelDepConfigs: 白名单版本 ${versionId} 不存在`)
  const file = hit.version.file
  const directory = fileDirectory(file)
  if (!directory) throw new Error(`modelDepConfigs: modelType ${file.modelType} 无目录映射`)
  return { filename: file.filename, url: file.url, directory, hf: hit }
}

function hfBytes(...versionIds: number[]): number {
  return versionIds.reduce((sum, vid) => {
    const hit = HF_VERSION_INDEX.get(vid)
    if (!hit) throw new Error(`modelDepConfigs: 白名单版本 ${vid} 不存在`)
    return sum + hit.version.file.sizeBytes
  }, 0)
}

const CN_MODELS = {
  union: {
    id: 'xinsir-union-promax',
    label: 'Xinsir Union ProMax',
    hintKey: 'generate.dep.hints.sdxl',
    bytes: hfBytes(-10000362),
    required: true,
    files: [hfFile(-10000362)],
  },
  pose_dedicated: {
    id: 'windsingai-openpose',
    label: 'windsingai OpenPose',
    hintKey: 'generate.dep.hints.ilnoob',
    bytes: hfBytes(-10000363),
    required: true,
    files: [hfFile(-10000363)],
  },
  canny_dedicated: {
    id: 'illustrious-canny',
    label: 'Illustrious XL Canny',
    hintKey: 'generate.dep.hints.ilnoob',
    bytes: hfBytes(-10000364),
    required: true,
    files: [hfFile(-10000364)],
  },
  depth_dedicated: {
    id: 'illustrious-depth',
    label: 'Illustrious XL Depth',
    hintKey: 'generate.dep.hints.ilnoob',
    bytes: hfBytes(-10000365),
    required: true,
    files: [hfFile(-10000365)],
  },
  sd15_pose_dedicated: {
    id: 'sd15-controlnet-openpose',
    label: 'SD1.5 OpenPose ControlNet',
    hintKey: 'generate.dep.hints.sd15',
    bytes: hfBytes(-10000383),
    required: true,
    files: [hfFile(-10000383)],
  },
  sd15_canny_dedicated: {
    id: 'sd15-controlnet-canny',
    label: 'SD1.5 Canny ControlNet',
    hintKey: 'generate.dep.hints.sd15',
    bytes: hfBytes(-10000382),
    required: true,
    files: [hfFile(-10000382)],
  },
  sd15_depth_dedicated: {
    id: 'sd15-controlnet-depth',
    label: 'SD1.5 Depth ControlNet',
    hintKey: 'generate.dep.hints.sd15',
    bytes: hfBytes(-10000381),
    required: true,
    files: [hfFile(-10000381)],
  },
  dwpose: {
    id: 'dwpose',
    label: 'DWPose',
    hintKey: 'generate.dep.hints.pose',
    sizeText: '~352 MB',
    required: true,
    files: [hfFile(-10000386), hfFile(-10000387)],
  },
  depth_anything_v2: {
    id: 'depth-anything-v2',
    label: 'Depth Anything V2',
    hintKey: 'generate.dep.hints.depth',
    sizeText: '~1.34 GB',
    required: true,
    files: [hfFile(-10000388)],
  },
  flux_union: {
    id: 'flux-union-pro2-fp8',
    label: 'Union Pro 2.0 FP8',
    hintKey: 'generate.dep.hints.flux1',
    bytes: hfBytes(-10000366),
    required: true,
    files: [hfFile(-10000366)],
  },
}

const UPSCALE_MODELS = {
  aurasr_v2: {
    id: 'aurasr-v2',
    label: 'AuraSR v2',
    hintKey: 'generate.dep.hints.aurasr',
    bytes: hfBytes(-10000371, -10000384),
    files: [hfFile(-10000371), hfFile(-10000384)],
  },
  seedvr2_3b_fp8: {
    id: 'seedvr2-3b-fp8',
    label: 'SeedVR2 3B FP8',
    hintKey: 'generate.dep.hints.seedvr2_3b',
    bytes: hfBytes(-10000368),
    files: [hfFile(-10000368)],
  },
  seedvr2_7b_sharp_fp8: {
    id: 'seedvr2-7b-sharp-fp8',
    label: 'SeedVR2 7B-sharp FP8',
    hintKey: 'generate.dep.hints.seedvr2_7b',
    bytes: hfBytes(-10000370),
    files: [hfFile(-10000370)],
  },
  // 3B/7B 共用的配套 VAE 单列一行: 两行各自引用同一文件会让下载进度互相串台
  // (点一行的下载, 另一行也显示在下载), 拆开后每行的进度只属于自己。
  seedvr2_vae: {
    id: 'seedvr2-vae',
    label: 'SeedVR2 VAE FP16',
    hintKey: 'generate.dep.hints.seedvr2_vae',
    bytes: hfBytes(-10000369),
    files: [hfFile(-10000369)],
  },
}

/** SeedVR2 共用 VAE 的依赖行 id (放大面板据此判断 VAE 是否在位) */
export const SEEDVR2_VAE_ROW_ID = UPSCALE_MODELS.seedvr2_vae.id

export const UPSCALE_DEP_GROUP: DepGroup = {
  title: 'generate.upscale.need_download',
  rows: [UPSCALE_MODELS.aurasr_v2, UPSCALE_MODELS.seedvr2_3b_fp8, UPSCALE_MODELS.seedvr2_7b_sharp_fp8, UPSCALE_MODELS.seedvr2_vae],
  // 两套引擎互为替代, 但各自必须成套: AuraSR 权重齐, 或 SeedVR2 权重 + 共用 VAE 齐。
  readyWhen: (ids) => ids.has(UPSCALE_MODELS.aurasr_v2.id)
    || (ids.has(UPSCALE_MODELS.seedvr2_vae.id)
      && (ids.has(UPSCALE_MODELS.seedvr2_3b_fp8.id) || ids.has(UPSCALE_MODELS.seedvr2_7b_sharp_fp8.id))),
}

// 检测器必需 (~52MB); SAM 可选增强 (vit_b, 修脸场景足够, vit_h 属过剩)

const FACE_MODELS = {
  face_yolov8m: {
    id: 'face-yolov8m',
    label: 'YOLOv8 面部检测器',
    hintKey: 'generate.dep.hints.face_detector',
    bytes: hfBytes(-10000367),
    required: true,
    files: [hfFile(-10000367)],
  },
  sam_vit_b: {
    id: 'sam-vit-b',
    label: 'SAM 精细掩码',
    hintKey: 'generate.dep.hints.face_mask',
    sizeText: '~375 MB',
    files: [hfFile(-10000385)],
  },
}

export const FACE_DEP_GROUP: DepGroup = {
  title: 'generate.face.need_download',
  rows: [FACE_MODELS.face_yolov8m, FACE_MODELS.sam_vit_b],
}

export type CnBranch = NonNullable<ModelTypeConfig['cnBranch']>

function modelRow(id: string, label: string, hint: string, ...versions: number[]): DepRow {
  return { id, label, hintKey: `generate.dep.hints.${hint}`, required: true, bytes: hfBytes(...versions), files: versions.map(hfFile) }
}

const CONTROL_MODELS = {
  qwen: modelRow('qwen-union', 'Qwen Image 2.1 Fun Union INT8', 'qwen_image21', -10000395),
  zimage: modelRow('zimage-union', 'Z-Image Fun Union 2.1 Lite', 'zimage', -10000420),
  zimageTile: modelRow('zimage-tile', 'Z-Image Fun Tile 2.1 Lite', 'zimage', -10000421),
  zimageTurbo: modelRow('zimage-turbo-union', 'Z-Image Turbo Fun Union 2602 Lite', 'zimage_turbo', -10000422),
  zimageTurboTile: modelRow('zimage-turbo-tile', 'Z-Image Turbo Fun Tile 2601 Lite', 'zimage_turbo', -10000423),
  anima: modelRow('anima-any', 'Anima LLLite Any v2', 'anima', -10000424),
  animaDepth: modelRow('anima-depth', 'Anima LLLite Depth', 'anima', -10000425),
  h3: modelRow('h3-union', 'MiniMax H3 Fun Union 2.0 INT8', 'minimax_h3', -10000430),
  sd15Lineart: modelRow('sd15-lineart', 'SD1.5 Lineart ControlNet', 'sd15', -10000431),
  sd15Tile: modelRow('sd15-tile', 'SD1.5 Tile ControlNet', 'sd15', -10000432),
  noobLineart: modelRow('noob-lineart', 'Noob SDXL Lineart Anime', 'ilnoob', -10000433),
  noobTile: modelRow('noob-tile', 'Noob SDXL Tile', 'ilnoob', -10000434),
  fluxLineart: modelRow('flux-lineart', 'MistoLine Flux Dev', 'flux1', -10000442),
  fluxTile: modelRow('flux-tile', 'Jasper Flux Dev Upscaler', 'flux1', -10000443),
}

const PREPROCESSORS = {
  lineart: modelRow('lineart', 'Lineart', 'lineart', -10000435),
  lineartCoarse: modelRow('lineart-coarse', 'Lineart Coarse', 'lineart_coarse', -10000436),
  lineartAnime: modelRow('lineart-anime', 'Lineart Anime', 'lineart_anime', -10000437),
}

const CN_BRANCH_MODELS: Record<CnBranch, Record<string, DepRow>> = {
  sdxl: { pose: CN_MODELS.union, canny: CN_MODELS.union, depth: CN_MODELS.union, lineart: CN_MODELS.union, tile: CN_MODELS.union },
  ilnoob: { pose: CN_MODELS.pose_dedicated, canny: CN_MODELS.canny_dedicated, depth: CN_MODELS.depth_dedicated, lineart: CONTROL_MODELS.noobLineart, tile: CONTROL_MODELS.noobTile },
  sd15: { pose: CN_MODELS.sd15_pose_dedicated, canny: CN_MODELS.sd15_canny_dedicated, depth: CN_MODELS.sd15_depth_dedicated, lineart: CONTROL_MODELS.sd15Lineart, tile: CONTROL_MODELS.sd15Tile },
  flux: { pose: CN_MODELS.flux_union, canny: CN_MODELS.flux_union, depth: CN_MODELS.flux_union, lineart: CONTROL_MODELS.fluxLineart, tile: CONTROL_MODELS.fluxTile },
  zimage: { pose: CONTROL_MODELS.zimage, canny: CONTROL_MODELS.zimage, depth: CONTROL_MODELS.zimage, tile: CONTROL_MODELS.zimageTile },
  zimage_turbo: { pose: CONTROL_MODELS.zimageTurbo, canny: CONTROL_MODELS.zimageTurbo, depth: CONTROL_MODELS.zimageTurbo, tile: CONTROL_MODELS.zimageTurboTile },
  qwen_image21: { pose: CONTROL_MODELS.qwen, canny: CONTROL_MODELS.qwen, depth: CONTROL_MODELS.qwen, lineart: CONTROL_MODELS.qwen },
  anima: { canny: CONTROL_MODELS.anima, depth: CONTROL_MODELS.animaDepth, lineart: CONTROL_MODELS.anima },
  minimax_h3: { pose: CONTROL_MODELS.h3, canny: CONTROL_MODELS.h3, depth: CONTROL_MODELS.h3, lineart: CONTROL_MODELS.h3 },
}

export function cnPreprocessor(type: string, branch: CnBranch | undefined): { rows: DepRow[]; params: Record<string, boolean> } {
  if (type === 'pose') return { rows: [CN_MODELS.dwpose], params: {} }
  if (type === 'depth') return { rows: [CN_MODELS.depth_anything_v2], params: {} }
  if (type === 'lineart') {
    const anime = branch === 'ilnoob'
    return { rows: anime ? [PREPROCESSORS.lineartAnime] : [PREPROCESSORS.lineart, PREPROCESSORS.lineartCoarse], params: { lineart_anime: anime } }
  }
  return { rows: [], params: {} }
}

export function getCnDepGroup(type: string, branch: CnBranch | undefined, model = ''): DepGroup {
  const recommended = CN_BRANCH_MODELS[branch ?? 'sdxl'][type]
  if (!recommended) return { title: `generate.controlnet.need_download_${type}`, rows: [] }
  let control: DepRow | undefined = recommended
  if (model) {
    const filename = model.split('/').pop()
    const hit = [...HF_VERSION_INDEX.values()].find(entry => entry.version.file.filename === filename)
    control = hit ? {
      ...recommended,
      id: `controlnet-${hit.version.id}`,
      label: recommended.files.some(file => file.filename === filename) ? recommended.label : hit.model.name,
      required: true,
      bytes: hit.version.file.sizeBytes,
      files: [{ ...hfFile(hit.version.id), filename: model }],
    } : undefined
  }
  return { title: `generate.controlnet.need_download_${type}`,
    rows: [...(control ? [control] : []), ...cnPreprocessor(type, branch).rows] }
}

/**
 * CN_FILE_BRANCH — CN 模型文件名 → 所属 branch 映射, 供 CN 面板下拉过滤。
 * 仅含 "已知" CN 主模型 (union → sdxl; pose/canny/depth_dedicated → ilnoob;
 * sd15 专用模型 → sd15)。
 * 检测器 (dwpose / depth_anything_v2) 不在此表 — 它们是辅助节点, 不参与 branch 分家。
 * 用户手动安装的未知文件也不在此表 → 面板走"未知"分支 (列出但排后)。
 */
export const CN_FILE_BRANCH: Record<string, CnBranch> = (() => {
  const map: Record<string, CnBranch> = {}
  for (const [branch, modes] of Object.entries(CN_BRANCH_MODELS)) {
    for (const row of Object.values(modes)) {
      for (const file of row.files) map[file.filename] = branch as CnBranch
    }
  }
  map[hfFile(-10000394).filename] = 'qwen_image21'
  for (const id of [-10000438, -10000439, -10000440]) map[hfFile(id).filename] = 'ilnoob'
  return map
})()

/**
 * cnBranchForFile — 给定后端返回的 CN 模型文件名, 查 CN_FILE_BRANCH 返回 branch。
 * 匹配优先级: 精确 basename → endsWith (兼容子目录前缀如 "subdir/union.safetensors")。
 * 未命中返回 null (= 未知文件, 面板走"列出排后"分支)。
 */
export function cnBranchForFile(filename: string): CnBranch | null {
  const base = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  if (CN_FILE_BRANCH[base]) return CN_FILE_BRANCH[base]
  for (const [fn, br] of Object.entries(CN_FILE_BRANCH)) {
    if (filename === fn || filename.endsWith('/' + fn)) return br
  }
  return null
}
