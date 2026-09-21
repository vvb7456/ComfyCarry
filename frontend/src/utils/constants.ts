export const CIVITAI_API_BASE = 'https://civitai.com/api/v1'

/**
 * 模型类别 badge 的单一事实源。
 *
 * 四条数据管线的 type 形态各不相同:
 *   - 本地索引 category: MODEL_DIRS 目录 key (复数小写, 'checkpoints'/'diffusion_models')
 *   - Civitai hit.type:  API 原始单数 ('Checkpoint'/'LORA'/'TextualInversion')
 *   - HF 白名单 hit.type: 自拟驼峰 ('DiffusionModel'/'TextEncoder')
 *   - 收藏/下载任务:      Civitai 原样透传
 *
 * 渲染层 (卡片/弹窗/列表 badge) 一律通过:
 *   normalizeModelCategory(type)  → 归一到目录 key (取颜色)
 *   modelCategoryLabel(type)      → 人类可读单数 (取文案)
 * 不再各自维护映射表 —— 曾经三套实现, ModelMetaModal 直查 COLORS['Checkpoint']
 * 永远 miss, HF 卡片 DiffusionModel 无映射, 全灰。
 */

export const MODEL_CATEGORY_COLORS: Record<string, string> = {
  checkpoints: '#f472b6',
  // Diffusion model directories are checkpoint-family weights shown in a
  // different ComfyUI folder, so keep their badge color consistent.
  diffusion_models: '#f472b6',
  unet: '#f472b6',
  unet_gguf: '#f472b6',
  diffusers: '#f472b6',
  loras: '#60a5fa',
  embeddings: '#22d3ee',
  controlnet: '#fb923c',
  vae: '#22c55e',
  upscale_models: '#a855f7',
  // ── 本地索引实际出现的功能件目录 (此前无色 → 灰 badge 误读为"状态未知") ──
  text_encoders: '#34d399',
  clip: '#34d399',
  clip_vision: '#34d399',
  clip_gguf: '#34d399',
  hypernetworks: '#22d3ee',
  seedvr2: '#a855f7',
  'aura-sr': '#a855f7',
  ultralytics: '#fbbf24',
  ultralytics_bbox: '#fbbf24',
  ultralytics_segm: '#fbbf24',
}

/**
 * 任意来源 type → MODEL_DIRS 目录 key。
 * 小写化后查别名表; 未命中原样返回 (调用方展示原值、颜色 fallback 灰)。
 * 别名表键收录 civitai_resolver._TYPE_TO_DIR_KEY / download_classify 中语义明确的子集
 * (排除 other/clothing/sdxl 等后端用于下载落盘兜底但前端展示时不应误标的别名)，
 * 加上 HF 白名单的驼峰值小写化形态 (diffusionmodel/textencoder)。
 */
const _ALIAS_TO_CATEGORY: Record<string, string> = {
  // civitai 单数 → 目录
  checkpoint: 'checkpoints',
  lora: 'loras',
  lycoris: 'loras',
  locon: 'loras',
  dora: 'loras',
  embedding: 'embeddings',
  textualinversion: 'embeddings',
  aestheticgradient: 'embeddings',
  hypernetwork: 'hypernetworks',
  motionmodule: 'animatediff_models',
  poses: 'poses',
  wildcards: 'wildcards',
  workflows: 'workflows',
  detection: 'ultralytics',
  upscaler: 'upscale_models',
  // HF 白名单驼峰小写化 → 目录
  diffusionmodel: 'diffusion_models',
  textencoder: 'text_encoders',
  // vae / controlnet 单复数同形, 无需条目
}

export function normalizeModelCategory(type: string | null | undefined): string {
  if (!type) return ''
  const lower = type.toLowerCase()
  return _ALIAS_TO_CATEGORY[lower] || lower
}

/** 归一后的目录 key → badge 颜色; 未知类型返回 '' (Badge 落 muted 灰, 表示"无已知类别") */
export function modelCategoryColor(type: string | null | undefined): string {
  return MODEL_CATEGORY_COLORS[normalizeModelCategory(type)] || ''
}

/** 目录 key → 人类可读单数 label (不再暴露目录名/全大写) */
export const MODEL_CATEGORY_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoint',
  diffusion_models: 'Diffusion Model',
  unet: 'Diffusion Model',
  unet_gguf: 'Diffusion Model (GGUF)',
  diffusers: 'Diffusers',
  loras: 'LoRA',
  embeddings: 'Embedding',
  hypernetworks: 'Hypernetwork',
  controlnet: 'ControlNet',
  vae: 'VAE',
  upscale_models: 'Upscaler',
  text_encoders: 'Text Encoder',
  clip: 'Text Encoder',
  clip_vision: 'CLIP Vision',
  clip_gguf: 'Text Encoder (GGUF)',
  animatediff_models: 'Motion Module',
  poses: 'Pose',
  wildcards: 'Wildcard',
  workflows: 'Workflow',
  seedvr2: 'SeedVR2',
  'aura-sr': 'AuraSR',
  ultralytics: 'Detector',
  ultralytics_bbox: 'Detector (BBox)',
  ultralytics_segm: 'Detector (Segm)',
}

/** 任意来源 type → badge 文案; 未收录类型原样返回 (保留信息量, 不猜) */
export function modelCategoryLabel(type: string | null | undefined): string {
  if (!type) return ''
  const key = normalizeModelCategory(type)
  return MODEL_CATEGORY_LABELS[key] || type
}
