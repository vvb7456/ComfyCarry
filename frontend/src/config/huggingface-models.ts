/**
 * huggingface-models.ts — Hugging Face 模型白名单 (人工维护)
 *
 * 对应 SPEC: docs/HF_OFFICIAL_MODEL_CATALOG_SPEC.md §5 (数据契约)
 * 白名单条目从 docs/hf-catalog-research.json 生成, 全部经 Hugging Face API 逐项核实
 * (2026-08-06):
 *   - author / downloads / likes   ← GET /api/models/{repo}
 *   - sizeBytes / sha256           ← GET /api/models/{repo}/tree/main?recursive=true 的
 *                                     size 与 lfs.oid (LFS 对象 OID 即 SHA256)
 *   - resolve URL 存在性           ← HEAD {repo}/resolve/main/{path} 返回 200/302
 *   - 预览图                         ← ComfyUI 官方工作流模板缩略图, 兜底 HF README
 *                                     首图 (均经 HEAD 200 核实)
 *
 * 第一批 19 条人工核实; 第二批 225 条由 hf-catalog-research.json 全覆盖生成,
 * 跳过 11 条后端无对应目录的 audio/3d/segmentation/pose 条目与 3 条需登录下载的
 * FLUX.2 klein 门控仓库, 共 225 条。
 *
 * 可用 ID (下一个):
 *   模型 ID: -100265
 *   版本 ID: -10000356
 */

import type { CivitaiHit, CivitaiImage } from '@/composables/useCivitaiSearch'

export interface HuggingFaceFile {
  url: string
  filename: string
  modelType:
    | 'checkpoints'
    | 'loras'
    | 'controlnet'
    | 'vae'
    | 'embeddings'
    | 'upscale_models'
    | 'diffusion_models'
    | 'text_encoders'
  architecture: string
  sizeBytes: number
  sha256: string
}

export interface HuggingFaceVersion {
  id: number
  name: string
  baseModel: string
  images: CivitaiImage[]
  trainedWords: string[]
  hashes: { SHA256: string }
  file: HuggingFaceFile
}

export interface HuggingFaceModel extends Omit<CivitaiHit, 'version' | 'versions'> {
  id: number
  name: string
  type: string
  metrics: {
    downloadCount: number
    thumbsUpCount: number
  }
  images: CivitaiImage[]
  user: { username: string }
  sourceUrl: string
  description: string
  version: HuggingFaceVersion
  versions: HuggingFaceVersion[]
}

// ── checkpoints ──────────────────────────────────────────────────────────────

// SDXL 1.0 官方 base, 通用高质量文生图
const sdXlBaseVersion: HuggingFaceVersion = {
  id: -10000101,
  name: '1.0',
  baseModel: 'SDXL 1.0',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sdxl_refiner_prompt_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b',
  },
  file: {
    url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
    filename: 'sd_xl_base_1.0.safetensors',
    modelType: 'checkpoints',
    architecture: 'sdxl',
    sizeBytes: 6938078334,
    sha256: '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b',
  },
}
const sdXlBaseModel: HuggingFaceModel = {
  id: -100001,
  name: 'SDXL Base 1.0',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 1401961,
    thumbsUpCount: 8021,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sdxl_refiner_prompt_example-1.webp', type: 'image' }],
  user: { username: 'stabilityai' },
  sourceUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0',
  description: 'SDXL 1.0 官方 base, 通用高质量文生图',
  version: sdXlBaseVersion,
  versions: [sdXlBaseVersion],
}

// SD1.5 官方归档 fp16 剪枝整合包, 基础文生图
const sd15PrunedVersion: HuggingFaceVersion = {
  id: -10000102,
  name: '1.5',
  baseModel: 'SD 1.5',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: 'e9476a13728cd75d8279f6ec8bad753a66a1957ca375a1464dc63b37db6e3916',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly-fp16.safetensors',
    filename: 'v1-5-pruned-emaonly-fp16.safetensors',
    modelType: 'checkpoints',
    architecture: 'sd15',
    sizeBytes: 2132696762,
    sha256: 'e9476a13728cd75d8279f6ec8bad753a66a1957ca375a1464dc63b37db6e3916',
  },
}
const sd15PrunedModel: HuggingFaceModel = {
  id: -100002,
  name: 'SD 1.5 Pruned Emaonly FP16',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 8183827,
    thumbsUpCount: 112,
  },
  images: [],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive',
  description: 'SD1.5 官方归档 fp16 剪枝整合包, 基础文生图',
  version: sd15PrunedVersion,
  versions: [sd15PrunedVersion],
}

// Flux.1 dev FP8 量化整合包, 通用文生图
const flux1DevFp8Version: HuggingFaceVersion = {
  id: -10000103,
  name: 'dev-fp8',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_dev_uso_reference_image_gen-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8e91b68084b53a7fc44ed2a3756d821e355ac1a7b6fe29be760c1db532f3d88a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors',
    filename: 'flux1-dev-fp8.safetensors',
    modelType: 'checkpoints',
    architecture: 'flux',
    sizeBytes: 17246524772,
    sha256: '8e91b68084b53a7fc44ed2a3756d821e355ac1a7b6fe29be760c1db532f3d88a',
  },
}
const flux1DevFp8Model: HuggingFaceModel = {
  id: -100003,
  name: 'Flux.1 Dev FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 399302,
    thumbsUpCount: 650,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_dev_uso_reference_image_gen-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-dev',
  description: 'Flux.1 dev FP8 量化整合包, 通用文生图',
  version: flux1DevFp8Version,
  versions: [flux1DevFp8Version],
}

// ── diffusion_models ─────────────────────────────────────────────────────────

// Flux.2 Dev fp8 拆分形态 UNet, 文生图/编辑
const flux2DevFp8Version: HuggingFaceVersion = {
  id: -10000104,
  name: 'dev-fp8mixed',
  baseModel: 'Flux.2 Dev',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '863a82e4ff950a42a6b0e80bea824828f129eb1a8fbbdbd9e8cb29859127b486',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors',
    filename: 'flux2_dev_fp8mixed.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux2',
    sizeBytes: 35455599592,
    sha256: '863a82e4ff950a42a6b0e80bea824828f129eb1a8fbbdbd9e8cb29859127b486',
  },
}
const flux2DevFp8Model: HuggingFaceModel = {
  id: -100004,
  name: 'Flux.2 Dev FP8 Mixed',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1505066,
    thumbsUpCount: 285,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-dev',
  description: 'Flux.2 Dev fp8 文生图/编辑',
  version: flux2DevFp8Version,
  versions: [flux2DevFp8Version],
}

// Z-Image 官方拆分形态 UNet (bf16), 文生图
const zImageVersion: HuggingFaceVersion = {
  id: -10000105,
  name: 'bf16',
  baseModel: 'Z-Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_z_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '996a67d3ff666946b1c25cbc16d1b1918b6cc0ac166309e23fe3b3d830263dee',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/z_image/resolve/main/split_files/diffusion_models/z_image_bf16.safetensors',
    filename: 'z_image_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'zimage',
    sizeBytes: 12309866400,
    sha256: '996a67d3ff666946b1c25cbc16d1b1918b6cc0ac166309e23fe3b3d830263dee',
  },
}
const zImageModel: HuggingFaceModel = {
  id: -100005,
  name: 'Z-Image BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 146059,
    thumbsUpCount: 256,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_z_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/z_image',
  description: 'Z-Image 文生图',
  version: zImageVersion,
  versions: [zImageVersion],
}

// Wan 2.2 5B 单权重 (t2v/i2v 双模式), 图/文生视频
const wan22_5bVersion: HuggingFaceVersion = {
  id: -10000106,
  name: 'fp16',
  baseModel: 'Wan Video 2.2 TI2V-5B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_ti2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors',
    filename: 'wan2.2_ti2v_5B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_5b',
    sizeBytes: 9999658848,
    sha256: '456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e',
  },
}
const wan22_5bModel: HuggingFaceModel = {
  id: -100006,
  name: 'Wan 2.2 TI2V 5B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_ti2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 ti2v 5B 图生视频',
  version: wan22_5bVersion,
  versions: [wan22_5bVersion],
}

// ── loras ────────────────────────────────────────────────────────────────────

// Flux.2 dev Turbo 加速 LoRA (ByteZSzn v2, ComfyUI 官方 repackaged)
const flux2TurboLoraVersion: HuggingFaceVersion = {
  id: -10000107,
  name: 'v2',
  baseModel: 'Flux.2 Dev',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_fp8-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'dfc97af0180d432269361a7bc36b4a7df6a2a3ffb630763f8c3343d3d1991d87',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/loras/Flux2TurboComfyv2.safetensors',
    filename: 'Flux2TurboComfyv2.safetensors',
    modelType: 'loras',
    architecture: 'flux2',
    sizeBytes: 2760814872,
    sha256: 'dfc97af0180d432269361a7bc36b4a7df6a2a3ffb630763f8c3343d3d1991d87',
  },
}
const flux2TurboLoraModel: HuggingFaceModel = {
  id: -100007,
  name: 'Flux.2 Dev Turbo LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 1505066,
    thumbsUpCount: 285,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_fp8-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-dev',
  description: 'Flux.2 dev Turbo 加速 LoRA (ByteZSzn v2, ComfyUI 官方 repackaged)',
  version: flux2TurboLoraVersion,
  versions: [flux2TurboLoraVersion],
}

// LTX-2 19B 蒸馏加速 LoRA (8 步, CFG=1), 用于完整版 19B
const ltx2DistillLoraVersion: HuggingFaceVersion = {
  id: -10000108,
  name: 'distilled-lora-384',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2718f89582003cbb5b616635f18c091641917a3f3e5a2f2ad0fb3d5fdd153534',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-distilled-lora-384.safetensors',
    filename: 'ltx-2-19b-distilled-lora-384.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 7674558424,
    sha256: '2718f89582003cbb5b616635f18c091641917a3f3e5a2f2ad0fb3d5fdd153534',
  },
}
const ltx2DistillLoraModel: HuggingFaceModel = {
  id: -100008,
  name: 'LTX-2 19B Distilled LoRA 384',
  type: 'LORA',
  metrics: {
    downloadCount: 412193,
    thumbsUpCount: 1769,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2',
  description: 'LTX-2 蒸馏 LoRA (8 步, CFG=1, 应用于完整版 19B)',
  version: ltx2DistillLoraVersion,
  versions: [ltx2DistillLoraVersion],
}

// Wan 2.2 i2v 14B 4 步 Lightning 加速 LoRA (high noise)
const wan22I2vLightningLoraVersion: HuggingFaceVersion = {
  id: -10000109,
  name: 'v1-high-noise',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd176c808d6fc461999b68e321efcb7501b20b8c3797523ed0df14f7d1deff11e',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 1226977424,
    sha256: 'd176c808d6fc461999b68e321efcb7501b20b8c3797523ed0df14f7d1deff11e',
  },
}
const wan22I2vLightningLoraModel: HuggingFaceModel = {
  id: -100009,
  name: 'Wan 2.2 I2V LightX2V 4steps LoRA V1 High Noise',
  type: 'LORA',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 i2v 4 步加速 LoRA (high noise, ComfyUI 官方 repackaged)',
  version: wan22I2vLightningLoraVersion,
  versions: [wan22I2vLightningLoraVersion],
}

// ── controlnet ───────────────────────────────────────────────────────────────

// SD 3.5 Large Canny 边缘 ControlNet
const sd35CannyCnVersion: HuggingFaceVersion = {
  id: -10000110,
  name: 'canny',
  baseModel: 'SD 3.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_canny_controlnet_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '4bc5cf949f6501a4bd125c6c1190e8fba0f1471f5ce36e9ebd1114867abedd4c',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-controlnets_ComfyUI_repackaged/resolve/main/split_files/controlnet/sd3.5_large_controlnet_canny.safetensors',
    filename: 'sd3.5_large_controlnet_canny.safetensors',
    modelType: 'controlnet',
    architecture: 'sd3',
    sizeBytes: 8654590644,
    sha256: '4bc5cf949f6501a4bd125c6c1190e8fba0f1471f5ce36e9ebd1114867abedd4c',
  },
}
const sd35CannyCnModel: HuggingFaceModel = {
  id: -100010,
  name: 'SD 3.5 Large Controlnet Canny',
  type: 'ControlNet',
  metrics: {
    downloadCount: 7034,
    thumbsUpCount: 4,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_canny_controlnet_example-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-controlnets_ComfyUI_repackaged',
  description: 'SD 3.5 Large 的 Canny 边缘 ControlNet',
  version: sd35CannyCnVersion,
  versions: [sd35CannyCnVersion],
}

// SD 3.5 Large 深度图 ControlNet
const sd35DepthCnVersion: HuggingFaceVersion = {
  id: -10000111,
  name: 'depth',
  baseModel: 'SD 3.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_depth-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd6ded6aa4f60eda74ae48a8fdc1a9fa11b36f05488975916f1ecd4834fddffd0',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-controlnets_ComfyUI_repackaged/resolve/main/split_files/controlnet/sd3.5_large_controlnet_depth.safetensors',
    filename: 'sd3.5_large_controlnet_depth.safetensors',
    modelType: 'controlnet',
    architecture: 'sd3',
    sizeBytes: 8654590644,
    sha256: 'd6ded6aa4f60eda74ae48a8fdc1a9fa11b36f05488975916f1ecd4834fddffd0',
  },
}
const sd35DepthCnModel: HuggingFaceModel = {
  id: -100011,
  name: 'SD 3.5 Large Controlnet Depth',
  type: 'ControlNet',
  metrics: {
    downloadCount: 7034,
    thumbsUpCount: 4,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_depth-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-controlnets_ComfyUI_repackaged',
  description: 'SD 3.5 Large 的深度图 ControlNet',
  version: sd35DepthCnVersion,
  versions: [sd35DepthCnVersion],
}

// ── vae ──────────────────────────────────────────────────────────────────────

// Wan 2.1 官方 VAE (bf16), Wan 2.1/2.2 14B 视频生成通用
const wan21VaeVersion: HuggingFaceVersion = {
  id: -10000112,
  name: 'bf16',
  baseModel: 'Wan Video 2.1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '1ab9a32cc2c740f6e39d80d367ce5dcc28db8c71b79b28670546b8973e9d75f9',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors',
    filename: 'Wan2_1_VAE_bf16.safetensors',
    modelType: 'vae',
    architecture: 'wan21',
    sizeBytes: 253806278,
    sha256: '1ab9a32cc2c740f6e39d80d367ce5dcc28db8c71b79b28670546b8973e9d75f9',
  },
}
const wan21VaeModel: HuggingFaceModel = {
  id: -100012,
  name: 'Wan 2.1 VAE BF16',
  type: 'VAE',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 官方 VAE (bf16 版), Wan 2.1/2.2 14B 视频生成通用',
  version: wan21VaeVersion,
  versions: [wan21VaeVersion],
}

// Flux/Z-Image 共用 VAE (ae), ComfyUI 官方 repackage
const fluxAeVaeVersion: HuggingFaceVersion = {
  id: -10000113,
  name: 'ae',
  baseModel: 'ZImageTurbo',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors',
    filename: 'ae.safetensors',
    modelType: 'vae',
    architecture: 'zimage',
    sizeBytes: 335304388,
    sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38',
  },
}
const fluxAeVaeModel: HuggingFaceModel = {
  id: -100013,
  name: 'Z-Image VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 5204347,
    thumbsUpCount: 801,
  },
  images: [],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/z_image_turbo',
  description: 'Z-Image 专属 VAE (与 FLUX.1/Chroma 共用同一文件)',
  version: fluxAeVaeVersion,
  versions: [fluxAeVaeVersion],
}

// SD 1.5/SDXL 通用微调 VAE (ft-MSE, 人物/细节重建更佳)
const sdVaeFtMseVersion: HuggingFaceVersion = {
  id: -10000114,
  name: '840000',
  baseModel: 'SD 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_depth_lora_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '735e4c3a447a3255760d7f86845f09f937809baa529c17370d83e4c3758f3c75',
  },
  file: {
    url: 'https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors',
    filename: 'vae-ft-mse-840000-ema-pruned.safetensors',
    modelType: 'vae',
    architecture: 'sd15',
    sizeBytes: 334641190,
    sha256: '735e4c3a447a3255760d7f86845f09f937809baa529c17370d83e4c3758f3c75',
  },
}
const sdVaeFtMseModel: HuggingFaceModel = {
  id: -100014,
  name: 'SD 1.5/SDXL ft-MSE VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 1420,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_depth_lora_example-1.webp', type: 'image' }],
  user: { username: 'stabilityai' },
  sourceUrl: 'https://huggingface.co/stabilityai/sd-vae-ft-mse-original',
  description: 'SD 1.5/SDXL 通用微调 VAE (ft-MSE, 人物/细节重建更佳)',
  version: sdVaeFtMseVersion,
  versions: [sdVaeFtMseVersion],
}

// ── text_encoders ────────────────────────────────────────────────────────────

// Flux.1 CLIP-L 文本编码器 (双 CLIP 之一)
const fluxClipLVersion: HuggingFaceVersion = {
  id: -10000115,
  name: 'clip_l',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_krea_dev-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd',
  },
  file: {
    url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors',
    filename: 'clip_l.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux',
    sizeBytes: 246144152,
    sha256: '660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd',
  },
}
const fluxClipLModel: HuggingFaceModel = {
  id: -100015,
  name: 'CLIP-L',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 1383,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_krea_dev-1.webp', type: 'image' }],
  user: { username: 'comfyanonymous' },
  sourceUrl: 'https://huggingface.co/comfyanonymous/flux_text_encoders',
  description: 'CLIP-L 文本编码器, Flux 1 双 CLIP 之一 (HiDream / HunyuanVideo 2.0 共用)',
  version: fluxClipLVersion,
  versions: [fluxClipLVersion],
}

// Flux.1 T5-XXL FP8 文本编码器 (双 CLIP 之一, Chroma/HiDream 共用)
const fluxT5xxlFp8Version: HuggingFaceVersion = {
  id: -10000116,
  name: 'fp8_scaled',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_kontext_dev_basic-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a498f0485dc9536735258018417c3fd7758dc3bccc0a645feaa472b34955557a',
  },
  file: {
    url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors',
    filename: 't5xxl_fp8_e4m3fn_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux',
    sizeBytes: 5157348688,
    sha256: 'a498f0485dc9536735258018417c3fd7758dc3bccc0a645feaa472b34955557a',
  },
}
const fluxT5xxlFp8Model: HuggingFaceModel = {
  id: -100016,
  name: 'T5-XXL FP8 E4M3FN',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 1383,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_kontext_dev_basic-1.webp', type: 'image' }],
  user: { username: 'comfyanonymous' },
  sourceUrl: 'https://huggingface.co/comfyanonymous/flux_text_encoders',
  description: 'T5-XXL FP8 文本编码器, Flux 1 双 CLIP 之一 (Chroma / HiDream 共用)',
  version: fluxT5xxlFp8Version,
  versions: [fluxT5xxlFp8Version],
}

// Wan 2.1/2.2 全系 UM-T5-XXL FP8 文本编码器
const wanUmt5Version: HuggingFaceVersion = {
  id: -10000117,
  name: 'fp8_scaled',
  baseModel: 'Wan Video 2.2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    filename: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'wan22',
    sizeBytes: 6735906897,
    sha256: 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68',
  },
}
const wanUmt5Model: HuggingFaceModel = {
  id: -100017,
  name: 'UMT5 XXL FP8 E4M3FN',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'UM-T5-XXL FP8 文本编码器, Wan 2.1/2.2 全系使用',
  version: wanUmt5Version,
  versions: [wanUmt5Version],
}

// ── upscale_models ───────────────────────────────────────────────────────────

// Real-ESRGAN 4x 通用放大模型 (arch 'realesrgan' 尚未注册进 ARCH_LABELS, 建议补充)
const realEsrganVersion: HuggingFaceVersion = {
  id: -10000118,
  name: 'x4plus',
  baseModel: 'RealESRGAN',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_realistic_2k_images_quick_variations-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '37f9a931c215f040aa6d50f711f2cb115f713c46df1d0d6469a8bd7bfe9a60bb',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors',
    filename: 'RealESRGAN_x4plus.safetensors',
    modelType: 'upscale_models',
    architecture: 'realesrgan',
    sizeBytes: 66857836,
    sha256: '37f9a931c215f040aa6d50f711f2cb115f713c46df1d0d6469a8bd7bfe9a60bb',
  },
}
const realEsrganModel: HuggingFaceModel = {
  id: -100018,
  name: 'RealESRGAN X4',
  type: 'Upscaler',
  metrics: {
    downloadCount: 40396,
    thumbsUpCount: 24,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_realistic_2k_images_quick_variations-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged',
  description: 'Real-ESRGAN 4x 通用放大模型',
  version: realEsrganVersion,
  versions: [realEsrganVersion],
}

// 4x 通用放大模型 (ESRGAN, 擅长 JPEG 压缩图; arch 'esrgan' 尚未注册进 ARCH_LABELS)
const ultraSharpVersion: HuggingFaceVersion = {
  id: -10000119,
  name: '4x',
  baseModel: 'ESRGAN',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_mjm_airt_machIne-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '36a340b5509b699d2c06cb445ddc1d3d39199ac734d889ed6d7915f60e05bcbc',
  },
  file: {
    url: 'https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.safetensors',
    filename: '4x-UltraSharp.safetensors',
    modelType: 'upscale_models',
    architecture: 'esrgan',
    sizeBytes: 66864028,
    sha256: '36a340b5509b699d2c06cb445ddc1d3d39199ac734d889ed6d7915f60e05bcbc',
  },
}
const ultraSharpModel: HuggingFaceModel = {
  id: -100019,
  name: '4x-UltraSharp',
  type: 'Upscaler',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 63,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_mjm_airt_machIne-1.webp', type: 'image' }],
  user: { username: 'Kim2091' },
  sourceUrl: 'https://huggingface.co/Kim2091/UltraSharp',
  description: '4x 通用放大模型 (ESRGAN), 擅长 JPEG 压缩图',
  version: ultraSharpVersion,
  versions: [ultraSharpVersion],
}

// ── checkpoints ──────────────────────────────────────────────────────────────

// DreamShaper 8, 经典 SD1.5 通用文生图整合包 (剪枝版)
const dreamShaper8PrunedVersion: HuggingFaceVersion = {
  id: -10000120,
  name: 'v1.0',
  baseModel: 'SD 1.5',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd',
  },
  file: {
    url: 'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors',
    filename: 'DreamShaper_8_pruned.safetensors',
    modelType: 'checkpoints',
    architecture: 'sd15',
    sizeBytes: 2132625894,
    sha256: '879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd',
  },
}

const dreamShaper8PrunedModel: HuggingFaceModel = {
  id: -100020,
  name: 'DreamShaper 8 Pruned',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 219519,
    thumbsUpCount: 1014,
  },
  images: [],
  user: { username: 'Lykon' },
  sourceUrl: 'https://huggingface.co/Lykon/DreamShaper',
  description: 'DreamShaper 8, 经典 SD1.5 通用文生图整合包 (剪枝版)',
  version: dreamShaper8PrunedVersion,
  versions: [dreamShaper8PrunedVersion],
}

// Juggernaut XL V9, SDXL 写实人像/摄影风格整合包
const juggernautXLV9RunDiffusionPhotoV2Version: HuggingFaceVersion = {
  id: -10000121,
  name: 'v1.0',
  baseModel: 'SDXL 1.0',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_hellorob_facegen_skindetail_upscale-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c9e3e68f89b8e38689e1097d4be4573cf308de4e3fd044c64ca697bdb4aa8bca',
  },
  file: {
    url: 'https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
    filename: 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
    modelType: 'checkpoints',
    architecture: 'sdxl',
    sizeBytes: 7105348188,
    sha256: 'c9e3e68f89b8e38689e1097d4be4573cf308de4e3fd044c64ca697bdb4aa8bca',
  },
}

const juggernautXLV9RunDiffusionPhotoV2Model: HuggingFaceModel = {
  id: -100021,
  name: 'Juggernaut XL V9 RunDiffusionPhoto V2',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 176075,
    thumbsUpCount: 400,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_hellorob_facegen_skindetail_upscale-1.webp', type: 'image' }],
  user: { username: 'RunDiffusion' },
  sourceUrl: 'https://huggingface.co/RunDiffusion/Juggernaut-XL-v9',
  description: 'Juggernaut XL V9, SDXL 写实人像/摄影风格整合包',
  version: juggernautXLV9RunDiffusionPhotoV2Version,
  versions: [juggernautXLV9RunDiffusionPhotoV2Version],
}

// NetaYume, 基于 Lumina Image 2.0 的动漫风格文生图整合包 (内置 Gemma2 TE + Flux VAE)
const netaYumev35PretrainedAllInOneVersion: HuggingFaceVersion = {
  id: -10000122,
  name: 'v1.0',
  baseModel: 'Lumina',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_netayume_lumina_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '4125cb490996ea85c8e3ba242866da02efd83a6a2c079dc8924a95eaa8327a44',
  },
  file: {
    url: 'https://huggingface.co/duongve/NetaYume-Lumina-Image-2.0/resolve/main/NetaYumev35_pretrained_all_in_one.safetensors',
    filename: 'NetaYumev35_pretrained_all_in_one.safetensors',
    modelType: 'checkpoints',
    architecture: 'zimage',
    sizeBytes: 10620231237,
    sha256: '4125cb490996ea85c8e3ba242866da02efd83a6a2c079dc8924a95eaa8327a44',
  },
}

const netaYumev35PretrainedAllInOneModel: HuggingFaceModel = {
  id: -100022,
  name: 'NetaYumev35 Pretrained All In One',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 20341,
    thumbsUpCount: 72,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_netayume_lumina_t2i-1.webp', type: 'image' }],
  user: { username: 'duongve' },
  sourceUrl: 'https://huggingface.co/duongve/NetaYume-Lumina-Image-2.0',
  description: 'NetaYume, 基于 Lumina Image 2.0 的动漫风格文生图整合包 (内置 Gemma2 TE + Flux VAE)',
  version: netaYumev35PretrainedAllInOneVersion,
  versions: [netaYumev35PretrainedAllInOneVersion],
}

// Flux.1 schnell FP8 量化整合包, 少步数快速文生图
const flux1SchnellFp8Version: HuggingFaceVersion = {
  id: -10000123,
  name: 'v1.0',
  baseModel: 'Flux.1 S',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_schnell-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors',
    filename: 'flux1-schnell-fp8.safetensors',
    modelType: 'checkpoints',
    architecture: 'flux',
    sizeBytes: 17236328572,
    sha256: 'ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72',
  },
}

const flux1SchnellFp8Model: HuggingFaceModel = {
  id: -100023,
  name: 'Flux.1 Schnell FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 197260,
    thumbsUpCount: 272,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_schnell-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-schnell',
  description: 'Flux.1 schnell FP8 量化整合包, 少步数快速文生图',
  version: flux1SchnellFp8Version,
  versions: [flux1SchnellFp8Version],
}

// HiDream-O1 Image bf16, 通用文生图/图生图
const hidreamO1ImageBf16Version: HuggingFaceVersion = {
  id: -10000124,
  name: 'v1.0',
  baseModel: 'HiDream-O1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_hidream_o1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '0520134a47e5b2bacea25804b2a6021413eb95945344b5a953aa14170edff1aa',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-O1-Image/resolve/main/checkpoints/hidream_o1_image_bf16.safetensors',
    filename: 'hidream_o1_image_bf16.safetensors',
    modelType: 'checkpoints',
    architecture: 'hidream',
    sizeBytes: 16365209824,
    sha256: '0520134a47e5b2bacea25804b2a6021413eb95945344b5a953aa14170edff1aa',
  },
}

const hidreamO1ImageBf16Model: HuggingFaceModel = {
  id: -100024,
  name: 'HiDream O1 Image BF16',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 43034,
    thumbsUpCount: 77,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_hidream_o1-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-O1-Image',
  description: 'HiDream-O1 Image bf16, 通用文生图/图生图',
  version: hidreamO1ImageBf16Version,
  versions: [hidreamO1ImageBf16Version],
}

// HiDream-O1 Image Dev FP8 缩放版, 低显存文生图
const hidreamO1ImageDevFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000125,
  name: 'v1.0',
  baseModel: 'HiDream-O1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_hidream_o1_dev-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '7cbf53a475e0a13f92f2ec08bcffdb9b9de4305ef3b6f35cdd784d09dcd8d0cc',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-O1-Image/resolve/main/checkpoints/hidream_o1_image_dev_fp8_scaled.safetensors',
    filename: 'hidream_o1_image_dev_fp8_scaled.safetensors',
    modelType: 'checkpoints',
    architecture: 'hidream',
    sizeBytes: 8067535296,
    sha256: '7cbf53a475e0a13f92f2ec08bcffdb9b9de4305ef3b6f35cdd784d09dcd8d0cc',
  },
}

const hidreamO1ImageDevFp8ScaledModel: HuggingFaceModel = {
  id: -100025,
  name: 'HiDream O1 Image Dev FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 43034,
    thumbsUpCount: 77,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_hidream_o1_dev-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-O1-Image',
  description: 'HiDream-O1 Image Dev FP8 缩放版, 低显存文生图',
  version: hidreamO1ImageDevFp8ScaledVersion,
  versions: [hidreamO1ImageDevFp8ScaledVersion],
}

// Juggernaut XL V9 RDPhoto2 Lightning, SDXL 4步超快写实生图
const juggernautXLV9Rdphoto2LightningVersion: HuggingFaceVersion = {
  id: -10000126,
  name: 'v1.0',
  baseModel: 'SDXL Lightning',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_image_upscale_supir-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c8df560d2992ac04299412be6a36fa53a4e7a1b74f27b94867ad3f84f4b425a5',
  },
  file: {
    url: 'https://huggingface.co/AiWise/Juggernaut-XL-V9-GE-RDPhoto2-Lightning_4S/resolve/main/juggernautXL_v9Rdphoto2Lightning.safetensors',
    filename: 'juggernautXL_v9Rdphoto2Lightning.safetensors',
    modelType: 'checkpoints',
    architecture: 'sdxl',
    sizeBytes: 7105348284,
    sha256: 'c8df560d2992ac04299412be6a36fa53a4e7a1b74f27b94867ad3f84f4b425a5',
  },
}

const juggernautXLV9Rdphoto2LightningModel: HuggingFaceModel = {
  id: -100026,
  name: 'JuggernautXL V9Rdphoto2Lightning',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 7078,
    thumbsUpCount: 16,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_image_upscale_supir-1.webp', type: 'image' }],
  user: { username: 'AiWise' },
  sourceUrl: 'https://huggingface.co/AiWise/Juggernaut-XL-V9-GE-RDPhoto2-Lightning_4S',
  description: 'Juggernaut XL V9 RDPhoto2 Lightning, SDXL 4步超快写实生图',
  version: juggernautXLV9Rdphoto2LightningVersion,
  versions: [juggernautXLV9Rdphoto2LightningVersion],
}

// LTX-2 19B dev FP8, 音视频联合生成 (图/文生视频+音频)
const ltx219bDevFp8Version: HuggingFaceVersion = {
  id: -10000127,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8a67e709b6d1adc061cb19921887a5c15754178199e45801a04310e9b522760d',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev-fp8.safetensors',
    filename: 'ltx-2-19b-dev-fp8.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 27078716018,
    sha256: '8a67e709b6d1adc061cb19921887a5c15754178199e45801a04310e9b522760d',
  },
}

const ltx219bDevFp8Model: HuggingFaceModel = {
  id: -100027,
  name: 'LTX-2 19B Dev FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 412193,
    thumbsUpCount: 1769,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2',
  description: 'LTX-2 19B dev FP8, 音视频联合生成 (图/文生视频+音频)',
  version: ltx219bDevFp8Version,
  versions: [ltx219bDevFp8Version],
}

// LTX-2 19B dev bf16 完整版, 音视频联合生成
const ltx219bDevVersion: HuggingFaceVersion = {
  id: -10000128,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_i2v_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '4a51e70aad660e55648d6f0b8af15c8acaaffc06e2a4ae7c7cb01ede701981a8',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev.safetensors',
    filename: 'ltx-2-19b-dev.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 43285058242,
    sha256: '4a51e70aad660e55648d6f0b8af15c8acaaffc06e2a4ae7c7cb01ede701981a8',
  },
}

const ltx219bDevModel: HuggingFaceModel = {
  id: -100028,
  name: 'LTX-2 19B Dev',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 412193,
    thumbsUpCount: 1769,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_i2v_lora-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2',
  description: 'LTX-2 19B dev bf16 完整版, 音视频联合生成',
  version: ltx219bDevVersion,
  versions: [ltx219bDevVersion],
}

// LTX-2 19B distilled, 8步蒸馏版音视频生成
const ltx219bDistilledVersion: HuggingFaceVersion = {
  id: -10000129,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c4006d689061cde0967b9d96eaf44253ff08f5de0c78e5fa1331a763cd03ee28',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-distilled.safetensors',
    filename: 'ltx-2-19b-distilled.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 43285058186,
    sha256: 'c4006d689061cde0967b9d96eaf44253ff08f5de0c78e5fa1331a763cd03ee28',
  },
}

const ltx219bDistilledModel: HuggingFaceModel = {
  id: -100029,
  name: 'LTX-2 19B Distilled',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 412193,
    thumbsUpCount: 1769,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2',
  description: 'LTX-2 19B distilled, 8步蒸馏版音视频生成',
  version: ltx219bDistilledVersion,
  versions: [ltx219bDistilledVersion],
}

// LTX-2.3 22B dev FP8, 高质量音视频联合生成
const ltx2322bDevFp8Version: HuggingFaceVersion = {
  id: -10000130,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '28606c5b5a06ce56f896d4dfcb20f212739e07a68fbe48e53638188449d26450',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-dev-fp8.safetensors',
    filename: 'ltx-2.3-22b-dev-fp8.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 29145431166,
    sha256: '28606c5b5a06ce56f896d4dfcb20f212739e07a68fbe48e53638188449d26450',
  },
}

const ltx2322bDevFp8Model: HuggingFaceModel = {
  id: -100030,
  name: 'LTX-2.3 22B Dev FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 790093,
    thumbsUpCount: 129,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2.3-fp8',
  description: 'LTX-2.3 22B dev FP8, 高质量音视频联合生成',
  version: ltx2322bDevFp8Version,
  versions: [ltx2322bDevFp8Version],
}

// LTX-2.3 22B dev bf16 完整版, 高质量音视频联合生成
const ltx2322bDevVersion: HuggingFaceVersion = {
  id: -10000131,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_lora_remove_subtitles_from_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '7ab7225325bc403448ea84b6db2269811a880e5118cd2ee2b6282a93d585016f',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-dev.safetensors',
    filename: 'ltx-2.3-22b-dev.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 46149344974,
    sha256: '7ab7225325bc403448ea84b6db2269811a880e5118cd2ee2b6282a93d585016f',
  },
}

const ltx2322bDevModel: HuggingFaceModel = {
  id: -100031,
  name: 'LTX-2.3 22B Dev',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 1884441,
    thumbsUpCount: 1761,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_lora_remove_subtitles_from_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2.3',
  description: 'LTX-2.3 22B dev bf16 完整版, 高质量音视频联合生成',
  version: ltx2322bDevVersion,
  versions: [ltx2322bDevVersion],
}

// LTX-2.3 22B distilled FP8, 8步蒸馏版音视频生成
const ltx2322bDistilledFp8Version: HuggingFaceVersion = {
  id: -10000132,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_style_transition-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd9646b6f2d5c42d337b23671634c43bfeece6989644f51b4a3aa088465ccd3b2',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-distilled-fp8.safetensors',
    filename: 'ltx-2.3-22b-distilled-fp8.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 29531884062,
    sha256: 'd9646b6f2d5c42d337b23671634c43bfeece6989644f51b4a3aa088465ccd3b2',
  },
}

const ltx2322bDistilledFp8Model: HuggingFaceModel = {
  id: -100032,
  name: 'LTX-2.3 22B Distilled FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 790093,
    thumbsUpCount: 129,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_style_transition-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2.3-fp8',
  description: 'LTX-2.3 22B distilled FP8, 8步蒸馏版音视频生成',
  version: ltx2322bDistilledFp8Version,
  versions: [ltx2322bDistilledFp8Version],
}

// LTX-Video 2B v0.9.5, 实时图生视频
const ltxVideo2bV095Version: HuggingFaceVersion = {
  id: -10000133,
  name: 'v1.0',
  baseModel: 'LTXV',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/ltxv_image_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '720d15c9f19f7d0f6b2a92bbbc34410e2cfb2f6856a100b38f734fbf973d4adf',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors',
    filename: 'ltx-video-2b-v0.9.5.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 6340729500,
    sha256: '720d15c9f19f7d0f6b2a92bbbc34410e2cfb2f6856a100b38f734fbf973d4adf',
  },
}

const ltxVideo2bV095Model: HuggingFaceModel = {
  id: -100033,
  name: 'LTX-Video 2B V0.9.5',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 547210,
    thumbsUpCount: 2253,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/ltxv_image_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-Video',
  description: 'LTX-Video 2B v0.9.5, 实时图生视频',
  version: ltxVideo2bV095Version,
  versions: [ltxVideo2bV095Version],
}

// LTX-Video 2B v0.9, 实时文生视频
const ltxVideo2bV09Version: HuggingFaceVersion = {
  id: -10000134,
  name: 'v1.0',
  baseModel: 'LTXV',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/ltxv_text_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '45369c2ae94e3949b127ef99ca9fe173b077f1ca0fecf8185e4115afcbc09581',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.safetensors',
    filename: 'ltx-video-2b-v0.9.safetensors',
    modelType: 'checkpoints',
    architecture: 'ltxv',
    sizeBytes: 9370442108,
    sha256: '45369c2ae94e3949b127ef99ca9fe173b077f1ca0fecf8185e4115afcbc09581',
  },
}

const ltxVideo2bV09Model: HuggingFaceModel = {
  id: -100034,
  name: 'LTX-Video 2B V0.9',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 547210,
    thumbsUpCount: 2253,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/ltxv_text_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-Video',
  description: 'LTX-Video 2B v0.9, 实时文生视频',
  version: ltxVideo2bV09Version,
  versions: [ltxVideo2bV09Version],
}

// SD3.5 Large FP8 整合包 (内置文本编码器), 高质量文生图
const sd35LargeFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000135,
  name: 'v1.0',
  baseModel: 'SD 3.5 Large',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_blur-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '5ad94d6f951556b1ab6b75930fd4effbafaf3130fe9df440e7f2d05a220dd1be',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-fp8/resolve/main/sd3.5_large_fp8_scaled.safetensors',
    filename: 'sd3.5_large_fp8_scaled.safetensors',
    modelType: 'checkpoints',
    architecture: 'sd3',
    sizeBytes: 14934922866,
    sha256: '5ad94d6f951556b1ab6b75930fd4effbafaf3130fe9df440e7f2d05a220dd1be',
  },
}

const sd35LargeFp8ScaledModel: HuggingFaceModel = {
  id: -100035,
  name: 'SD 3.5 Large FP8',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 59574,
    thumbsUpCount: 233,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_blur-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-fp8',
  description: 'SD3.5 Large FP8 整合包 (内置文本编码器), 高质量文生图',
  version: sd35LargeFp8ScaledVersion,
  versions: [sd35LargeFp8ScaledVersion],
}

// SDXL 1.0 refiner, 配合 base 精修图像细节
const sdXlRefiner10Version: HuggingFaceVersion = {
  id: -10000136,
  name: 'v1.0',
  baseModel: 'SDXL 1.0',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sdxl_refiner_prompt_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '7440042bbdc8a24813002c09b6b69b64dc90fded4472613437b7f55f9b7d9c5f',
  },
  file: {
    url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0/resolve/main/sd_xl_refiner_1.0.safetensors',
    filename: 'sd_xl_refiner_1.0.safetensors',
    modelType: 'checkpoints',
    architecture: 'sdxl',
    sizeBytes: 6075981930,
    sha256: '7440042bbdc8a24813002c09b6b69b64dc90fded4472613437b7f55f9b7d9c5f',
  },
}

const sdXlRefiner10Model: HuggingFaceModel = {
  id: -100036,
  name: 'SDXL Refiner 1.0',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 119760,
    thumbsUpCount: 2059,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sdxl_refiner_prompt_example-1.webp', type: 'image' }],
  user: { username: 'stabilityai' },
  sourceUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0',
  description: 'SDXL 1.0 refiner, 配合 base 精修图像细节',
  version: sdXlRefiner10Version,
  versions: [sdXlRefiner10Version],
}

// SDXL Turbo, 1-4步极速文生图
const sdXlTurbo10Fp16Version: HuggingFaceVersion = {
  id: -10000137,
  name: 'v1.0',
  baseModel: 'SDXL Turbo',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sdxlturbo_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26',
  },
  file: {
    url: 'https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors',
    filename: 'sd_xl_turbo_1.0_fp16.safetensors',
    modelType: 'checkpoints',
    architecture: 'sdxl',
    sizeBytes: 6938081905,
    sha256: 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26',
  },
}

const sdXlTurbo10Fp16Model: HuggingFaceModel = {
  id: -100037,
  name: 'SDXL Turbo 1.0 FP16',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 1115308,
    thumbsUpCount: 2613,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sdxlturbo_example-1.webp', type: 'image' }],
  user: { username: 'stabilityai' },
  sourceUrl: 'https://huggingface.co/stabilityai/sdxl-turbo',
  description: 'SDXL Turbo, 1-4步极速文生图',
  version: sdXlTurbo10Fp16Version,
  versions: [sdXlTurbo10Fp16Version],
}

// Stable Video Diffusion XT, 图生视频 (25帧)
const svdXtVersion: HuggingFaceVersion = {
  id: -10000138,
  name: 'v1.0',
  baseModel: 'SVD XT',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/txt_to_image_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b2652c23d64a1da5f14d55011b9b6dce55f2e72e395719f1cd1f8a079b00a451',
  },
  file: {
    url: 'https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt/resolve/main/svd_xt.safetensors',
    filename: 'svd_xt.safetensors',
    modelType: 'checkpoints',
    architecture: 'svd',
    sizeBytes: 9559625980,
    sha256: 'b2652c23d64a1da5f14d55011b9b6dce55f2e72e395719f1cd1f8a079b00a451',
  },
}

const svdXtModel: HuggingFaceModel = {
  id: -100038,
  name: 'SVD XT',
  type: 'Checkpoint',
  metrics: {
    downloadCount: 172794,
    thumbsUpCount: 3372,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/txt_to_image_to_video-1.webp', type: 'image' }],
  user: { username: 'stabilityai' },
  sourceUrl: 'https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt',
  description: 'Stable Video Diffusion XT, 图生视频 (25帧)',
  version: svdXtVersion,
  versions: [svdXtVersion],
}
// ── diffusion_models ─────────────────────────────────────────────────────────

// Chroma1 HD 文生图 fp8 混合精度
const chroma1HDFp8mixedVersion: HuggingFaceVersion = {
  id: -10000139,
  name: 'v1.0',
  baseModel: 'Chroma',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chroma_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a2928ca6075f308f4d5e2182e2b96120fa8ad270ec6ea9b1b5c724c85c49a575',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Chroma1-HD_repackaged/resolve/main/split_files/diffusion_models/Chroma1-HD-fp8mixed.safetensors',
    filename: 'Chroma1-HD-fp8mixed.safetensors',
    modelType: 'diffusion_models',
    architecture: 'chroma',
    sizeBytes: 9193379316,
    sha256: 'a2928ca6075f308f4d5e2182e2b96120fa8ad270ec6ea9b1b5c724c85c49a575',
  },
}

const chroma1HDFp8mixedModel: HuggingFaceModel = {
  id: -100039,
  name: 'Chroma 1 HD FP8 Mixed',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 10399,
    thumbsUpCount: 7,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chroma_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Chroma1-HD_repackaged',
  description: 'Chroma1 HD 文生图 fp8 混合精度',
  version: chroma1HDFp8mixedVersion,
  versions: [chroma1HDFp8mixedVersion],
}

// FireRed Image Edit 1.1 通用图像编辑 transformer
const fireRedImageEdit11TransformerVersion: HuggingFaceVersion = {
  id: -10000140,
  name: 'v1.0',
  baseModel: 'FireRed',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_firered_image_edit1_1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '004b0326de38ffee22f104048d64670cfdf17c6f53a7349d9cd69d089505e219',
  },
  file: {
    url: 'https://huggingface.co/FireRedTeam/FireRed-Image-Edit-1.1-ComfyUI/resolve/main/FireRed-Image-Edit-1.1-transformer.safetensors',
    filename: 'FireRed-Image-Edit-1.1-transformer.safetensors',
    modelType: 'diffusion_models',
    architecture: 'firedred',
    sizeBytes: 40861031488,
    sha256: '004b0326de38ffee22f104048d64670cfdf17c6f53a7349d9cd69d089505e219',
  },
}

const fireRedImageEdit11TransformerModel: HuggingFaceModel = {
  id: -100040,
  name: 'FireRed-Image-Edit 1.1 Transformer',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 15346,
    thumbsUpCount: 125,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_firered_image_edit1_1-1.webp', type: 'image' }],
  user: { username: 'FireRedTeam' },
  sourceUrl: 'https://huggingface.co/FireRedTeam/FireRed-Image-Edit-1.1-ComfyUI',
  description: 'FireRed Image Edit 1.1 通用图像编辑 transformer',
  version: fireRedImageEdit11TransformerVersion,
  versions: [fireRedImageEdit11TransformerVersion],
}

// NewBie Image Exp0.1 文生图
const newBieImageExp01Bf16Version: HuggingFaceVersion = {
  id: -10000141,
  name: 'v1.0',
  baseModel: 'NewBie',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_newbieimage_exp0_1-t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b8ed0f26c0b90b70a5a2ef0f69041529af7fbfef206f773c07d6cd1d56d77ef8',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/NewBie-image-Exp0.1_repackaged/resolve/main/split_files/diffusion_models/NewBie-Image-Exp0.1-bf16.safetensors',
    filename: 'NewBie-Image-Exp0.1-bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'newbie',
    sizeBytes: 6973329400,
    sha256: 'b8ed0f26c0b90b70a5a2ef0f69041529af7fbfef206f773c07d6cd1d56d77ef8',
  },
}

const newBieImageExp01Bf16Model: HuggingFaceModel = {
  id: -100041,
  name: 'NewBie Image Exp0.1 BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 29840,
    thumbsUpCount: 16,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_newbieimage_exp0_1-t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/NewBie-image-Exp0.1_repackaged',
  description: 'NewBie Image Exp0.1 文生图',
  version: newBieImageExp01Bf16Version,
  versions: [newBieImageExp01Bf16Version],
}

// Wan 2.1 WanMove 运动控制模型 (i2v 架构)
const wan21WanMoveFp8ScaledE4m3fnKJVersion: HuggingFaceVersion = {
  id: -10000142,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_rob_wan_ati_motion_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '88aa449ce87dae29f3e6c1ec1c6107ba1a2d5057e6547ac1720d75c71eac32e9',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/WanMove/Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors',
    filename: 'Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 16402832658,
    sha256: '88aa449ce87dae29f3e6c1ec1c6107ba1a2d5057e6547ac1720d75c71eac32e9',
  },
}

const wan21WanMoveFp8ScaledE4m3fnKJModel: HuggingFaceModel = {
  id: -100042,
  name: 'Wan 2.1 WanMove FP8 E4M3FN KJ',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 494440,
    thumbsUpCount: 725,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_rob_wan_ati_motion_control-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled',
  description: 'Wan 2.1 WanMove 运动控制模型 (i2v 架构)',
  version: wan21WanMoveFp8ScaledE4m3fnKJVersion,
  versions: [wan21WanMoveFp8ScaledE4m3fnKJVersion],
}

// Wan 2.1 i2v 480p 14B 图生视频
const wan21I2V14B480pFp8E4m3fnScaledKJVersion: HuggingFaceVersion = {
  id: -10000143,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_1_infinitetalk-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2ff922282cd84589702e6e8c26e083d1160bfc2b217dd44e1ae2688441dc495d',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors',
    filename: 'Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 16643349018,
    sha256: '2ff922282cd84589702e6e8c26e083d1160bfc2b217dd44e1ae2688441dc495d',
  },
}

const wan21I2V14B480pFp8E4m3fnScaledKJModel: HuggingFaceModel = {
  id: -100043,
  name: 'Wan 2.1 I2V 14B 480p FP8 E4M3FN KJ',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 494440,
    thumbsUpCount: 725,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_1_infinitetalk-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled',
  description: 'Wan 2.1 i2v 480p 14B 图生视频',
  version: wan21I2V14B480pFp8E4m3fnScaledKJVersion,
  versions: [wan21I2V14B480pFp8E4m3fnScaledKJVersion],
}

// Wan 2.1 i2v ATI 动画轨迹控制 14B
const wan21I2VATI14BFp8E4m3fnVersion: HuggingFaceVersion = {
  id: -10000144,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9f5e44de79dfec7cb78a92d1b85d61cec68b950ac3b458ee7b4d8102bbc45ab0',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors',
    filename: 'Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 17135435696,
    sha256: '9f5e44de79dfec7cb78a92d1b85d61cec68b950ac3b458ee7b4d8102bbc45ab0',
  },
}

const wan21I2VATI14BFp8E4m3fnModel: HuggingFaceModel = {
  id: -100044,
  name: 'Wan 2.1 I2V ATI 14B FP8 E4M3FN',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 i2v ATI 动画轨迹控制 14B',
  version: wan21I2VATI14BFp8E4m3fnVersion,
  versions: [wan21I2VATI14BFp8E4m3fnVersion],
}

// Wan 2.1 VACE 视频编辑模块 14B
const wan21VACEModule14BBf16Version: HuggingFaceVersion = {
  id: -10000145,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_shane_video_restyle-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '66a4bd41ec0fc58f1ff6d1313e06cd9a4c24ab60171a5846937536f8d4de6a65',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1-VACE_module_14B_bf16.safetensors',
    filename: 'Wan2_1-VACE_module_14B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 6098227873,
    sha256: '66a4bd41ec0fc58f1ff6d1313e06cd9a4c24ab60171a5846937536f8d4de6a65',
  },
}

const wan21VACEModule14BBf16Model: HuggingFaceModel = {
  id: -100045,
  name: 'Wan 2.1 VACE Module 14B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_shane_video_restyle-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 VACE 视频编辑模块 14B',
  version: wan21VACEModule14BBf16Version,
  versions: [wan21VACEModule14BBf16Version],
}

// Wan 2.2 Animate 14B 动画/换装人物驱动 (i2v 架构)
const wan22Animate14BFp8E4m3fnScaledKJVersion: HuggingFaceVersion = {
  id: -10000146,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_purz_wan22_animate_auto_character_replace-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2936b31473a967e7a429a6646bba60e7862d0938e178b58b2a140f391dd5b8e6',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/Wan22Animate/Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors',
    filename: 'Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 18401760586,
    sha256: '2936b31473a967e7a429a6646bba60e7862d0938e178b58b2a140f391dd5b8e6',
  },
}

const wan22Animate14BFp8E4m3fnScaledKJModel: HuggingFaceModel = {
  id: -100046,
  name: 'Wan 2.2 Animate 14B FP8 E4M3FN KJ',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 494440,
    thumbsUpCount: 725,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_purz_wan22_animate_auto_character_replace-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled',
  description: 'Wan 2.2 Animate 14B 动画/换装人物驱动 (i2v 架构)',
  version: wan22Animate14BFp8E4m3fnScaledKJVersion,
  versions: [wan22Animate14BFp8E4m3fnScaledKJVersion],
}

// ACE-Step 1.5 Turbo 文生音频
const acestepV15TurboVersion: HuggingFaceVersion = {
  id: -10000147,
  name: 'v1.0',
  baseModel: 'ACE-Step',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '3f6e0797fad420a39bd33979eb6e840e30989e34a3794e843d23b60ec6e422d7',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_turbo.safetensors',
    filename: 'acestep_v1.5_turbo.safetensors',
    modelType: 'diffusion_models',
    architecture: 'acestep',
    sizeBytes: 4787825604,
    sha256: '3f6e0797fad420a39bd33979eb6e840e30989e34a3794e843d23b60ec6e422d7',
  },
}

const acestepV15TurboModel: HuggingFaceModel = {
  id: -100047,
  name: 'ACE-Step V1.5 Turbo',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'ACE-Step 1.5 Turbo 文生音频',
  version: acestepV15TurboVersion,
  versions: [acestepV15TurboVersion],
}

// ACE-Step 1.5 XL Base 文生音频
const acestepV15XlBaseBf16Version: HuggingFaceVersion = {
  id: -10000148,
  name: 'v1.0',
  baseModel: 'ACE-Step XL',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '56bf816fc9a69a5f45635e867b2ad742e1e648eb51fadb7d124cb8332d2e0940',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_xl_base_bf16.safetensors',
    filename: 'acestep_v1.5_xl_base_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'acestep',
    sizeBytes: 9974719930,
    sha256: '56bf816fc9a69a5f45635e867b2ad742e1e648eb51fadb7d124cb8332d2e0940',
  },
}

const acestepV15XlBaseBf16Model: HuggingFaceModel = {
  id: -100048,
  name: 'ACE-Step V1.5 Xl Base BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'ACE-Step 1.5 XL Base 文生音频',
  version: acestepV15XlBaseBf16Version,
  versions: [acestepV15XlBaseBf16Version],
}

// ACE-Step 1.5 XL SFT 文生音频
const acestepV15XlSftBf16Version: HuggingFaceVersion = {
  id: -10000149,
  name: 'v1.0',
  baseModel: 'ACE-Step XL',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_sft-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '3c05ae268353b3540fb1fd7db4fd77ffbda9802ec641b624e15648e030ecf3ce',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_xl_sft_bf16.safetensors',
    filename: 'acestep_v1.5_xl_sft_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'acestep',
    sizeBytes: 9974719930,
    sha256: '3c05ae268353b3540fb1fd7db4fd77ffbda9802ec641b624e15648e030ecf3ce',
  },
}

const acestepV15XlSftBf16Model: HuggingFaceModel = {
  id: -100049,
  name: 'ACE-Step V1.5 Xl SFT BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_sft-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'ACE-Step 1.5 XL SFT 文生音频',
  version: acestepV15XlSftBf16Version,
  versions: [acestepV15XlSftBf16Version],
}

// ACE-Step 1.5 XL Turbo 文生音频
const acestepV15XlTurboBf16Version: HuggingFaceVersion = {
  id: -10000150,
  name: 'v1.0',
  baseModel: 'ACE-Step XL',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_turbo-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '86a1afb0a1f711f0e3304ff65d874df3ae6783db683dcf982513fb9b6d14ae71',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_xl_turbo_bf16.safetensors',
    filename: 'acestep_v1.5_xl_turbo_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'acestep',
    sizeBytes: 9974719892,
    sha256: '86a1afb0a1f711f0e3304ff65d874df3ae6783db683dcf982513fb9b6d14ae71',
  },
}

const acestepV15XlTurboBf16Model: HuggingFaceModel = {
  id: -100050,
  name: 'ACE-Step V1.5 Xl Turbo BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_turbo-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'ACE-Step 1.5 XL Turbo 文生音频',
  version: acestepV15XlTurboBf16Version,
  versions: [acestepV15XlTurboBf16Version],
}

// Anima 基础版文生图
const animaBaseV10Version: HuggingFaceVersion = {
  id: -10000151,
  name: 'v1.0',
  baseModel: 'Anima',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_anima_base_v1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'bd43b7cffe1ed1153d9c41e7beb2f18cb1273eafbaa3af3edd6a173dc90a006e',
  },
  file: {
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-base-v1.0.safetensors',
    filename: 'anima-base-v1.0.safetensors',
    modelType: 'diffusion_models',
    architecture: 'anima',
    sizeBytes: 4182218328,
    sha256: 'bd43b7cffe1ed1153d9c41e7beb2f18cb1273eafbaa3af3edd6a173dc90a006e',
  },
}

const animaBaseV10Model: HuggingFaceModel = {
  id: -100051,
  name: 'Anima Base V1.0',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 826747,
    thumbsUpCount: 2020,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_anima_base_v1-1.webp', type: 'image' }],
  user: { username: 'circlestone-labs' },
  sourceUrl: 'https://huggingface.co/circlestone-labs/Anima',
  description: 'Anima 基础版文生图',
  version: animaBaseV10Version,
  versions: [animaBaseV10Version],
}

// Anima Preview3 预览版文生图
const animaPreview3BaseVersion: HuggingFaceVersion = {
  id: -10000152,
  name: 'v1.0',
  baseModel: 'Anima',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_anima_preview-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '14fffe8ad5116cd73b9a4696f6a89d7e5f6efdd24b2e4785603aa891a9b2295b',
  },
  file: {
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-preview3-base.safetensors',
    filename: 'anima-preview3-base.safetensors',
    modelType: 'diffusion_models',
    architecture: 'anima',
    sizeBytes: 4182218360,
    sha256: '14fffe8ad5116cd73b9a4696f6a89d7e5f6efdd24b2e4785603aa891a9b2295b',
  },
}

const animaPreview3BaseModel: HuggingFaceModel = {
  id: -100052,
  name: 'Anima Preview3 Base',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 826747,
    thumbsUpCount: 2020,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_anima_preview-1.webp', type: 'image' }],
  user: { username: 'circlestone-labs' },
  sourceUrl: 'https://huggingface.co/circlestone-labs/Anima',
  description: 'Anima Preview3 预览版文生图',
  version: animaPreview3BaseVersion,
  versions: [animaPreview3BaseVersion],
}

// Capybara v0.1 图像编辑 (基于 HunyuanVideo 1.5 架构)
const capybaraV01Version: HuggingFaceVersion = {
  id: -10000153,
  name: 'v1.0',
  baseModel: 'Hunyuan Video 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f6961dc4ffefaf917709857ace71ce9799a27b78993e46340c1a71ce4715397d',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/capybara_v0.1.safetensors',
    filename: 'capybara_v0.1.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hunyuan',
    sizeBytes: 16653435264,
    sha256: 'f6961dc4ffefaf917709857ace71ce9799a27b78993e46340c1a71ce4715397d',
  },
}

const capybaraV01Model: HuggingFaceModel = {
  id: -100053,
  name: 'Capybara V0.1',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 450910,
    thumbsUpCount: 94,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged',
  description: 'Capybara v0.1 图像编辑 (基于 HunyuanVideo 1.5 架构)',
  version: capybaraV01Version,
  versions: [capybaraV01Version],
}

// Causal Forcing 帧级自回归视频生成 (基于 Wan 2.1, 支持 t2v/i2v)
const causalForcingFramewiseVersion: HuggingFaceVersion = {
  id: -10000154,
  name: 'v1.0',
  baseModel: 'Causal Forcing',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_causal_forcing_i2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '408c67a8c6725756f5be2c5cf2d5c584c15dd147f5a0c458be62dcb3efb78477',
  },
  file: {
    url: 'https://huggingface.co/TalmajM/causal_forcing_framewise_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/causal_forcing-framewise.safetensors',
    filename: 'causal_forcing-framewise.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 5676070464,
    sha256: '408c67a8c6725756f5be2c5cf2d5c584c15dd147f5a0c458be62dcb3efb78477',
  },
}

const causalForcingFramewiseModel: HuggingFaceModel = {
  id: -100054,
  name: 'Causal Forcing Framewise',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 9,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_causal_forcing_i2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/TalmajM/causal_forcing_framewise_ComfyUI_repackaged',
  description: 'Causal Forcing 帧级自回归视频生成 (基于 Wan 2.1, 支持 t2v/i2v)',
  version: causalForcingFramewiseVersion,
  versions: [causalForcingFramewiseVersion],
}

// Chroma1 Radiance 文生图 x0
const chromaRadianceX0Version: HuggingFaceVersion = {
  id: -10000155,
  name: 'v1.0',
  baseModel: 'Chroma',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chroma1_radiance_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '086e11d033ccd7470e67fa80e00a29902df2868cc84e16df0b48853be3a8672a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Chroma1-Radiance_Repackaged/resolve/main/split_files/diffusion_models/chroma-radiance-x0.safetensors',
    filename: 'chroma-radiance-x0.safetensors',
    modelType: 'diffusion_models',
    architecture: 'chroma',
    sizeBytes: 19012346326,
    sha256: '086e11d033ccd7470e67fa80e00a29902df2868cc84e16df0b48853be3a8672a',
  },
}

const chromaRadianceX0Model: HuggingFaceModel = {
  id: -100055,
  name: 'Chroma Radiance X0',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 3650,
    thumbsUpCount: 4,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chroma1_radiance_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Chroma1-Radiance_Repackaged',
  description: 'Chroma1 Radiance 文生图 x0',
  version: chromaRadianceX0Version,
  versions: [chromaRadianceX0Version],
}

// ChronoEdit 14B 时间控制图像编辑 (基于 Wan 2.2 i2v 架构)
const chronoEdit14BFp16Version: HuggingFaceVersion = {
  id: -10000156,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '3294a5795e6cb5d16c8f3f34b8a22fe0a600e35cb49624c52f2100cd320a5988',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/chrono_edit_14B_fp16.safetensors',
    filename: 'chrono_edit_14B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 32789892720,
    sha256: '3294a5795e6cb5d16c8f3f34b8a22fe0a600e35cb49624c52f2100cd320a5988',
  },
}

const chronoEdit14BFp16Model: HuggingFaceModel = {
  id: -100056,
  name: 'Chrono Edit 14B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'ChronoEdit 14B 时间控制图像编辑 (基于 Wan 2.2 i2v 架构)',
  version: chronoEdit14BFp16Version,
  versions: [chronoEdit14BFp16Version],
}

// ERNIE Image Turbo 文生图
const ernieImageTurboVersion: HuggingFaceVersion = {
  id: -10000157,
  name: 'v1.0',
  baseModel: 'ERNIE Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image_turbo-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '741a4cc0467d4b9f04490d7faa9a5869ff4aa97eb2914927a1df9abb070e8e52',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/diffusion_models/ernie-image-turbo.safetensors',
    filename: 'ernie-image-turbo.safetensors',
    modelType: 'diffusion_models',
    architecture: 'ernie',
    sizeBytes: 16067025480,
    sha256: '741a4cc0467d4b9f04490d7faa9a5869ff4aa97eb2914927a1df9abb070e8e52',
  },
}

const ernieImageTurboModel: HuggingFaceModel = {
  id: -100057,
  name: 'Ernie Image Turbo',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 190,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image_turbo-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ERNIE-Image',
  description: 'ERNIE Image Turbo 文生图',
  version: ernieImageTurboVersion,
  versions: [ernieImageTurboVersion],
}

// ERNIE Image 文生图
const ernieImageVersion: HuggingFaceVersion = {
  id: -10000158,
  name: 'v1.0',
  baseModel: 'ERNIE Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '94a35abaa0899cccc34d2e37310abf74a0a714256526117bba782c7eb4eb91c7',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/diffusion_models/ernie-image.safetensors',
    filename: 'ernie-image.safetensors',
    modelType: 'diffusion_models',
    architecture: 'ernie',
    sizeBytes: 16067025480,
    sha256: '94a35abaa0899cccc34d2e37310abf74a0a714256526117bba782c7eb4eb91c7',
  },
}

const ernieImageModel: HuggingFaceModel = {
  id: -100058,
  name: 'Ernie Image',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 190,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ERNIE-Image',
  description: 'ERNIE Image 文生图',
  version: ernieImageVersion,
  versions: [ernieImageVersion],
}

// Flux.2 Klein 4B fp8 文生图/编辑
const flux2Klein4bFp8Version: HuggingFaceVersion = {
  id: -10000159,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 4B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_image_edit_4b_distilled-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6',
  },
  file: {
    url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors',
    filename: 'flux-2-klein-4b-fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux2',
    sizeBytes: 4070624520,
    sha256: '97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6',
  },
}

const flux2Klein4bFp8Model: HuggingFaceModel = {
  id: -100059,
  name: 'Flux 2 Klein 4B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 119671,
    thumbsUpCount: 60,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_image_edit_4b_distilled-1.webp', type: 'image' }],
  user: { username: 'black-forest-labs' },
  sourceUrl: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8',
  description: 'Flux.2 Klein 4B fp8 文生图/编辑',
  version: flux2Klein4bFp8Version,
  versions: [flux2Klein4bFp8Version],
}

// Flux.2 Klein 4B 文生图/编辑
const flux2Klein4bVersion: HuggingFaceVersion = {
  id: -10000160,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 4B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-4b.safetensors',
    filename: 'flux-2-klein-4b.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux2',
    sizeBytes: 7751105712,
    sha256: 'ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343',
  },
}

const flux2Klein4bModel: HuggingFaceModel = {
  id: -100060,
  name: 'Flux 2 Klein 4B',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 80,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-klein',
  description: 'Flux.2 Klein 4B 文生图/编辑',
  version: flux2Klein4bVersion,
  versions: [flux2Klein4bVersion],
}

// Flux.2 Klein 9B KV 缓存版 fp8 图像编辑
const flux2Klein9bKvFp8Version: HuggingFaceVersion = {
  id: -10000161,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 9B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_9b_kv_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '33f7da5625a00798349a719742999d3c7dd20c1a7eda14663922c363640728f1',
  },
  file: {
    url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-kv-fp8/resolve/main/flux-2-klein-9b-kv-fp8.safetensors',
    filename: 'flux-2-klein-9b-kv-fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux2',
    sizeBytes: 9818935984,
    sha256: '33f7da5625a00798349a719742999d3c7dd20c1a7eda14663922c363640728f1',
  },
}

const flux2Klein9bKvFp8Model: HuggingFaceModel = {
  id: -100061,
  name: 'Flux 2 Klein 9B Kv FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 50864,
    thumbsUpCount: 87,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_9b_kv_image_edit-1.webp', type: 'image' }],
  user: { username: 'black-forest-labs' },
  sourceUrl: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-kv-fp8',
  description: 'Flux.2 Klein 9B KV 缓存版 fp8 图像编辑',
  version: flux2Klein9bKvFp8Version,
  versions: [flux2Klein9bKvFp8Version],
}

// Flux.2 Klein Base 4B fp8 文生图
const flux2KleinBase4bFp8Version: HuggingFaceVersion = {
  id: -10000162,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 4B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_image_edit_4b_base-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '44bab3a86fe98b85d21dd2a4729ebdc3ae51fb8a39f76e457e18c724219e6840',
  },
  file: {
    url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4b-fp8/resolve/main/flux-2-klein-base-4b-fp8.safetensors',
    filename: 'flux-2-klein-base-4b-fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux2',
    sizeBytes: 4089498488,
    sha256: '44bab3a86fe98b85d21dd2a4729ebdc3ae51fb8a39f76e457e18c724219e6840',
  },
}

const flux2KleinBase4bFp8Model: HuggingFaceModel = {
  id: -100062,
  name: 'Flux 2 Klein Base 4B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 54242,
    thumbsUpCount: 48,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_image_edit_4b_base-1.webp', type: 'image' }],
  user: { username: 'black-forest-labs' },
  sourceUrl: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4b-fp8',
  description: 'Flux.2 Klein Base 4B fp8 文生图',
  version: flux2KleinBase4bFp8Version,
  versions: [flux2KleinBase4bFp8Version],
}

// Flux.2 Klein Base 4B 文生图
const flux2KleinBase4bVersion: HuggingFaceVersion = {
  id: -10000163,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 4B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9c5fed22b76baea749d88fc2abe3ad53245e7b21a0d353a762665eea00043b92',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-base-4b.safetensors',
    filename: 'flux-2-klein-base-4b.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux2',
    sizeBytes: 7751105712,
    sha256: '9c5fed22b76baea749d88fc2abe3ad53245e7b21a0d353a762665eea00043b92',
  },
}

const flux2KleinBase4bModel: HuggingFaceModel = {
  id: -100063,
  name: 'Flux 2 Klein Base 4B',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 80,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-klein',
  description: 'Flux.2 Klein Base 4B 文生图',
  version: flux2KleinBase4bVersion,
  versions: [flux2KleinBase4bVersion],
}

// Flux.1 Fill Dev OneReward 图像修复/编辑 fp8
const flux1FillDevOneRewardTransformerFp8Version: HuggingFaceVersion = {
  id: -10000164,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux.1_fill_dev_OneReward-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'dd5cc73df9d2fb1e5e9d8ec518bcb7ea1103f55f679ad58877aa192e00481d1a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/OneReward_repackaged/resolve/main/split_files/diffusion_models/flux.1-fill-dev-OneReward-transformer_fp8.safetensors',
    filename: 'flux.1-fill-dev-OneReward-transformer_fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 11902532704,
    sha256: 'dd5cc73df9d2fb1e5e9d8ec518bcb7ea1103f55f679ad58877aa192e00481d1a',
  },
}

const flux1FillDevOneRewardTransformerFp8Model: HuggingFaceModel = {
  id: -100064,
  name: 'Flux.1 Fill Dev OneReward Transformer FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 8221,
    thumbsUpCount: 11,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux.1_fill_dev_OneReward-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/OneReward_repackaged',
  description: 'Flux.1 Fill Dev OneReward 图像修复/编辑 fp8',
  version: flux1FillDevOneRewardTransformerFp8Version,
  versions: [flux1FillDevOneRewardTransformerFp8Version],
}

// Flux.1 Canny Dev 边缘控制文生图
const flux1CannyDevVersion: HuggingFaceVersion = {
  id: -10000165,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_canny_model_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '996876670169591cb412b937fbd46ea14cbed6933aef17c48a2dcd9685c98cdb',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/split_files/diffusion_models/flux1-canny-dev.safetensors',
    filename: 'flux1-canny-dev.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 23803351736,
    sha256: '996876670169591cb412b937fbd46ea14cbed6933aef17c48a2dcd9685c98cdb',
  },
}

const flux1CannyDevModel: HuggingFaceModel = {
  id: -100065,
  name: 'Flux.1 Canny Dev',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 399302,
    thumbsUpCount: 650,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_canny_model_example-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-dev',
  description: 'Flux.1 Canny Dev 边缘控制文生图',
  version: flux1CannyDevVersion,
  versions: [flux1CannyDevVersion],
}

// Flux.1 Dev Kontext 多图上下文图像编辑 fp8
const flux1DevKontextFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000166,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_kontext_dev_basic-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '630ba795ec64283b4230ea23cf79406c2c68b7c578229ed139f30043eadb30a2',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors',
    filename: 'flux1-dev-kontext_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 11904640136,
    sha256: '630ba795ec64283b4230ea23cf79406c2c68b7c578229ed139f30043eadb30a2',
  },
}

const flux1DevKontextFp8ScaledModel: HuggingFaceModel = {
  id: -100066,
  name: 'Flux.1 Dev Kontext FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 76986,
    thumbsUpCount: 191,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_kontext_dev_basic-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI',
  description: 'Flux.1 Dev Kontext 多图上下文图像编辑 fp8',
  version: flux1DevKontextFp8ScaledVersion,
  versions: [flux1DevKontextFp8ScaledVersion],
}

// Flux.1 Dev 文生图
const flux1DevVersion: HuggingFaceVersion = {
  id: -10000167,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_dev_checkpoint_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev.safetensors',
    filename: 'flux1-dev.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 23802932552,
    sha256: '4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7',
  },
}

const flux1DevModel: HuggingFaceModel = {
  id: -100067,
  name: 'Flux.1 Dev',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 399302,
    thumbsUpCount: 650,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_dev_checkpoint_example-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-dev',
  description: 'Flux.1 Dev 文生图',
  version: flux1DevVersion,
  versions: [flux1DevVersion],
}

// Flux.1 Fill Dev 图像修复/编辑
const flux1FillDevVersion: HuggingFaceVersion = {
  id: -10000168,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_fill_inpaint_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '03e289f530df51d014f48e675a9ffa2141bc003259bf5f25d75b957e920a41ca',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/split_files/diffusion_models/flux1-fill-dev.safetensors',
    filename: 'flux1-fill-dev.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 23804922408,
    sha256: '03e289f530df51d014f48e675a9ffa2141bc003259bf5f25d75b957e920a41ca',
  },
}

const flux1FillDevModel: HuggingFaceModel = {
  id: -100068,
  name: 'Flux.1 Fill Dev',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 399302,
    thumbsUpCount: 650,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_fill_inpaint_example-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-dev',
  description: 'Flux.1 Fill Dev 图像修复/编辑',
  version: flux1FillDevVersion,
  versions: [flux1FillDevVersion],
}

// Flux.1 Krea Dev 实时风格控制文生图 fp8
const flux1KreaDevFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000169,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_krea_dev-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b17a8c21703c4d6ffb0e300dd920eff3cfd35c9a72a1abaf107e3788e408b8d8',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/FLUX.1-Krea-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-krea-dev_fp8_scaled.safetensors',
    filename: 'flux1-krea-dev_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 11904639672,
    sha256: 'b17a8c21703c4d6ffb0e300dd920eff3cfd35c9a72a1abaf107e3788e408b8d8',
  },
}

const flux1KreaDevFp8ScaledModel: HuggingFaceModel = {
  id: -100069,
  name: 'Flux.1 Krea Dev FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 31674,
    thumbsUpCount: 47,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_krea_dev-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/FLUX.1-Krea-dev_ComfyUI',
  description: 'Flux.1 Krea Dev 实时风格控制文生图 fp8',
  version: flux1KreaDevFp8ScaledVersion,
  versions: [flux1KreaDevFp8ScaledVersion],
}

// Flux.1 Schnell 快速文生图
const flux1SchnellVersion: HuggingFaceVersion = {
  id: -10000170,
  name: 'v1.0',
  baseModel: 'Flux.1 S',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_schnell_full_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9403429e0052277ac2a87ad800adece5481eecefd9ed334e1f348723621d2a0a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell.safetensors',
    filename: 'flux1-schnell.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 23782506688,
    sha256: '9403429e0052277ac2a87ad800adece5481eecefd9ed334e1f348723621d2a0a',
  },
}

const flux1SchnellModel: HuggingFaceModel = {
  id: -100070,
  name: 'Flux.1 Schnell',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 197260,
    thumbsUpCount: 272,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_schnell_full_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-schnell',
  description: 'Flux.1 Schnell 快速文生图',
  version: flux1SchnellVersion,
  versions: [flux1SchnellVersion],
}

// HiDream E1.1 文生图/图像编辑
const hidreamE11Bf16Version: HuggingFaceVersion = {
  id: -10000171,
  name: 'v1.0',
  baseModel: 'HiDream E1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b5d14b8d55fbbd42a1f2aaf6d0974623d48275fab4bbeae2663ace4ac13ad241',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_e1_1_bf16.safetensors',
    filename: 'hidream_e1_1_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hidream',
    sizeBytes: 34211675392,
    sha256: 'b5d14b8d55fbbd42a1f2aaf6d0974623d48275fab4bbeae2663ace4ac13ad241',
  },
}

const hidreamE11Bf16Model: HuggingFaceModel = {
  id: -100071,
  name: 'HiDream E1 1 BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'HiDream E1.1 文生图/图像编辑',
  version: hidreamE11Bf16Version,
  versions: [hidreamE11Bf16Version],
}

// HiDream E1 Full 文生图/图像编辑
const hidreamE1FullBf16Version: HuggingFaceVersion = {
  id: -10000172,
  name: 'v1.0',
  baseModel: 'HiDream E1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_full-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b645503c5d5d583a135d7e77c655237ebc6dc132d49d763759c1dd51683bd1dd',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_e1_full_bf16.safetensors',
    filename: 'hidream_e1_full_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hidream',
    sizeBytes: 34211675392,
    sha256: 'b645503c5d5d583a135d7e77c655237ebc6dc132d49d763759c1dd51683bd1dd',
  },
}

const hidreamE1FullBf16Model: HuggingFaceModel = {
  id: -100072,
  name: 'HiDream E1 Full BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_full-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'HiDream E1 Full 文生图/图像编辑',
  version: hidreamE1FullBf16Version,
  versions: [hidreamE1FullBf16Version],
}

// HiDream I1 Dev fp8 文生图/编辑
const hidreamI1DevFp8Version: HuggingFaceVersion = {
  id: -10000173,
  name: 'v1.0',
  baseModel: 'HiDream I1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_i1_dev-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9a372d7384d56e34a8cc7fd77a0fa3d26d6b75d82c7582fd5347e2fd9e6f8664',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_i1_dev_fp8.safetensors',
    filename: 'hidream_i1_dev_fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hidream',
    sizeBytes: 17105946040,
    sha256: '9a372d7384d56e34a8cc7fd77a0fa3d26d6b75d82c7582fd5347e2fd9e6f8664',
  },
}

const hidreamI1DevFp8Model: HuggingFaceModel = {
  id: -100073,
  name: 'HiDream I1 Dev FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_i1_dev-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'HiDream I1 Dev fp8 文生图/编辑',
  version: hidreamI1DevFp8Version,
  versions: [hidreamI1DevFp8Version],
}

// HiDream I1 Fast fp8 快速文生图
const hidreamI1FastFp8Version: HuggingFaceVersion = {
  id: -10000174,
  name: 'v1.0',
  baseModel: 'HiDream I1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_i1_fast-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2d471e82523234e157b9ddd44c0428c89907eeb4e7923b316d49362d17020236',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_i1_fast_fp8.safetensors',
    filename: 'hidream_i1_fast_fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hidream',
    sizeBytes: 17105946040,
    sha256: '2d471e82523234e157b9ddd44c0428c89907eeb4e7923b316d49362d17020236',
  },
}

const hidreamI1FastFp8Model: HuggingFaceModel = {
  id: -100074,
  name: 'HiDream I1 Fast FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_i1_fast-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'HiDream I1 Fast fp8 快速文生图',
  version: hidreamI1FastFp8Version,
  versions: [hidreamI1FastFp8Version],
}

// HiDream I1 Full fp8 文生图/编辑
const hidreamI1FullFp8Version: HuggingFaceVersion = {
  id: -10000175,
  name: 'v1.0',
  baseModel: 'HiDream I1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_i1_full-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '807e458dd2ea31e69e40db27afadde4a14ffd0c4c0a23b8c9a0833102e055337',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_i1_full_fp8.safetensors',
    filename: 'hidream_i1_full_fp8.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hidream',
    sizeBytes: 17105946040,
    sha256: '807e458dd2ea31e69e40db27afadde4a14ffd0c4c0a23b8c9a0833102e055337',
  },
}

const hidreamI1FullFp8Model: HuggingFaceModel = {
  id: -100075,
  name: 'HiDream I1 Full FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_i1_full-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'HiDream I1 Full fp8 文生图/编辑',
  version: hidreamI1FullFp8Version,
  versions: [hidreamI1FullFp8Version],
}

// HuMo 17B 音频驱动人物视频生成 (基于 Wan 架构)
const humo17BFp8E4m3fnVersion: HuggingFaceVersion = {
  id: -10000176,
  name: 'v1.0',
  baseModel: 'HuMo 17B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_humo-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '222ddeac4dea6b78363cb5be78c47660c92963a69386026cd6dc0de4d3094f66',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HuMo_ComfyUI/resolve/main/split_files/diffusion_models/humo_17B_fp8_e4m3fn.safetensors',
    filename: 'humo_17B_fp8_e4m3fn.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 17058372152,
    sha256: '222ddeac4dea6b78363cb5be78c47660c92963a69386026cd6dc0de4d3094f66',
  },
}

const humo17BFp8E4m3fnModel: HuggingFaceModel = {
  id: -100076,
  name: 'Humo 17B FP8 E4M3FN',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 9005,
    thumbsUpCount: 14,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_humo-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HuMo_ComfyUI',
  description: 'HuMo 17B 音频驱动人物视频生成 (基于 Wan 架构)',
  version: humo17BFp8E4m3fnVersion,
  versions: [humo17BFp8E4m3fnVersion],
}

// Hunyuan Video t2v 720p 文生视频
const hunyuanVideoT2v720pBf16Version: HuggingFaceVersion = {
  id: -10000177,
  name: 'v1.0',
  baseModel: 'Hunyuan Video',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hunyuan_video_text_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c6ff2d107f0fec571fe276ad847468404ed01855c28c0be8859c3b311daec52a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged/resolve/main/split_files/diffusion_models/hunyuan_video_t2v_720p_bf16.safetensors',
    filename: 'hunyuan_video_t2v_720p_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hunyuan',
    sizeBytes: 25642131432,
    sha256: 'c6ff2d107f0fec571fe276ad847468404ed01855c28c0be8859c3b311daec52a',
  },
}

const hunyuanVideoT2v720pBf16Model: HuggingFaceModel = {
  id: -100077,
  name: 'HunyuanVideo T2V 720p BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 77386,
    thumbsUpCount: 243,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hunyuan_video_text_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged',
  description: 'Hunyuan Video t2v 720p 文生视频',
  version: hunyuanVideoT2v720pBf16Version,
  versions: [hunyuanVideoT2v720pBf16Version],
}

// Hunyuan Video 1.5 1080p 超分蒸馏
const hunyuanvideo151080pSrDistilledFp16Version: HuggingFaceVersion = {
  id: -10000178,
  name: 'v1.0',
  baseModel: 'Hunyuan Video 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_i2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e706673b109ea7d041fd2cff1fd2008f0ea960f386ced5aa024246ec2ce5ead1',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_1080p_sr_distilled_fp16.safetensors',
    filename: 'hunyuanvideo1.5_1080p_sr_distilled_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hunyuan',
    sizeBytes: 16662949080,
    sha256: 'e706673b109ea7d041fd2cff1fd2008f0ea960f386ced5aa024246ec2ce5ead1',
  },
}

const hunyuanvideo151080pSrDistilledFp16Model: HuggingFaceModel = {
  id: -100078,
  name: 'Hunyuanvideo1.5 1080p SR Distilled FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 450910,
    thumbsUpCount: 94,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_i2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged',
  description: 'Hunyuan Video 1.5 1080p 超分蒸馏',
  version: hunyuanvideo151080pSrDistilledFp16Version,
  versions: [hunyuanvideo151080pSrDistilledFp16Version],
}

// Hunyuan Video 1.5 720p 图生视频
const hunyuanvideo15720pI2vFp16Version: HuggingFaceVersion = {
  id: -10000179,
  name: 'v1.0',
  baseModel: 'Hunyuan Video 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_i2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '96883b154e4231e6106515bdef53a091085d5821518c387eb28609fde77e4bf1',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_i2v_fp16.safetensors',
    filename: 'hunyuanvideo1.5_720p_i2v_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hunyuan',
    sizeBytes: 16653368128,
    sha256: '96883b154e4231e6106515bdef53a091085d5821518c387eb28609fde77e4bf1',
  },
}

const hunyuanvideo15720pI2vFp16Model: HuggingFaceModel = {
  id: -100079,
  name: 'Hunyuanvideo1.5 720p I2V FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 450910,
    thumbsUpCount: 94,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_i2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged',
  description: 'Hunyuan Video 1.5 720p 图生视频',
  version: hunyuanvideo15720pI2vFp16Version,
  versions: [hunyuanvideo15720pI2vFp16Version],
}

// Hunyuan Video 1.5 720p 文生视频
const hunyuanvideo15720pT2vFp16Version: HuggingFaceVersion = {
  id: -10000180,
  name: 'v1.0',
  baseModel: 'Hunyuan Video 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_t2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '4f05e2a31b51b7ddee3ef336d234e0932001cbdc85887da15451069fda3e1d05',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_t2v_fp16.safetensors',
    filename: 'hunyuanvideo1.5_720p_t2v_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'hunyuan',
    sizeBytes: 16653368128,
    sha256: '4f05e2a31b51b7ddee3ef336d234e0932001cbdc85887da15451069fda3e1d05',
  },
}

const hunyuanvideo15720pT2vFp16Model: HuggingFaceModel = {
  id: -100080,
  name: 'Hunyuanvideo1.5 720p T2V FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 450910,
    thumbsUpCount: 94,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_t2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged',
  description: 'Hunyuan Video 1.5 720p 文生视频',
  version: hunyuanvideo15720pT2vFp16Version,
  versions: [hunyuanvideo15720pT2vFp16Version],
}

// Kandinsky 5.0 Lite i2v 5 秒图生视频
const kandinsky5liteI2v5sVersion: HuggingFaceVersion = {
  id: -10000181,
  name: 'v1.0',
  baseModel: 'Kandinsky 5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_kandinsky5_i2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '0bfa417e53d1da3f4d3be1fb33b79e3692edb60404154e9dbeb78e29e21c8f55',
  },
  file: {
    url: 'https://huggingface.co/kandinskylab/Kandinsky-5.0-I2V-Lite-5s/resolve/main/model/kandinsky5lite_i2v_5s.safetensors',
    filename: 'kandinsky5lite_i2v_5s.safetensors',
    modelType: 'diffusion_models',
    architecture: 'kandinsky5',
    sizeBytes: 4573130528,
    sha256: '0bfa417e53d1da3f4d3be1fb33b79e3692edb60404154e9dbeb78e29e21c8f55',
  },
}

const kandinsky5liteI2v5sModel: HuggingFaceModel = {
  id: -100081,
  name: 'Kandinsky 5 Lite I2V 5s',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 30,
    thumbsUpCount: 16,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_kandinsky5_i2v-1.webp', type: 'image' }],
  user: { username: 'kandinskylab' },
  sourceUrl: 'https://huggingface.co/kandinskylab/Kandinsky-5.0-I2V-Lite-5s',
  description: 'Kandinsky 5.0 Lite i2v 5 秒图生视频',
  version: kandinsky5liteI2v5sVersion,
  versions: [kandinsky5liteI2v5sVersion],
}

// Kandinsky 5.0 Lite 文生图
const kandinsky5liteT2iVersion: HuggingFaceVersion = {
  id: -10000182,
  name: 'v1.0',
  baseModel: 'Kandinsky 5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_kandinsky5_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'be7a9e1f002f3aded7bed95dfe664a762e66ce766876f137444aab13ba48b63f',
  },
  file: {
    url: 'https://huggingface.co/kandinskylab/Kandinsky-5.0-T2I-Lite/resolve/main/model/kandinsky5lite_t2i.safetensors',
    filename: 'kandinsky5lite_t2i.safetensors',
    modelType: 'diffusion_models',
    architecture: 'kandinsky5',
    sizeBytes: 12044328816,
    sha256: 'be7a9e1f002f3aded7bed95dfe664a762e66ce766876f137444aab13ba48b63f',
  },
}

const kandinsky5liteT2iModel: HuggingFaceModel = {
  id: -100082,
  name: 'Kandinsky 5 Lite T2i',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 27,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_kandinsky5_t2i-1.webp', type: 'image' }],
  user: { username: 'kandinskylab' },
  sourceUrl: 'https://huggingface.co/kandinskylab/Kandinsky-5.0-T2I-Lite',
  description: 'Kandinsky 5.0 Lite 文生图',
  version: kandinsky5liteT2iVersion,
  versions: [kandinsky5liteT2iVersion],
}

// Kandinsky 5.0 Lite t2v SFT 5 秒文生视频
const kandinsky5liteT2vSft5sVersion: HuggingFaceVersion = {
  id: -10000183,
  name: 'v1.0',
  baseModel: 'Kandinsky 5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_kandinsky5_t2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9bd1cb1e67d07de19458b9ad288b906815411c68dad7910d042ceb66f61f9f44',
  },
  file: {
    url: 'https://huggingface.co/kandinskylab/Kandinsky-5.0-T2V-Lite-sft-5s/resolve/main/model/kandinsky5lite_t2v_sft_5s.safetensors',
    filename: 'kandinsky5lite_t2v_sft_5s.safetensors',
    modelType: 'diffusion_models',
    architecture: 'kandinsky5',
    sizeBytes: 4573130528,
    sha256: '9bd1cb1e67d07de19458b9ad288b906815411c68dad7910d042ceb66f61f9f44',
  },
}

const kandinsky5liteT2vSft5sModel: HuggingFaceModel = {
  id: -100083,
  name: 'Kandinsky 5 Lite T2V SFT 5s',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 18,
    thumbsUpCount: 0,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_kandinsky5_t2v-1.webp', type: 'image' }],
  user: { username: 'kandinskylab' },
  sourceUrl: 'https://huggingface.co/kandinskylab/Kandinsky-5.0-T2V-Lite-sft-5s',
  description: 'Kandinsky 5.0 Lite t2v SFT 5 秒文生视频',
  version: kandinsky5liteT2vSft5sVersion,
  versions: [kandinsky5liteT2vSft5sVersion],
}

// Lens 文生图 (GPT-OSS 文本编码 + Flux.2 架构)
const lensBf16Version: HuggingFaceVersion = {
  id: -10000184,
  name: 'v1.0',
  baseModel: 'Lens',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_lens_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b1a33d05a2da4aef4d7c0c5692d5a143cbc9360c49b21c0f1b740d696e495f60',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Lens/resolve/main/diffusion_models/lens_bf16.safetensors',
    filename: 'lens_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'lens',
    sizeBytes: 8208595784,
    sha256: 'b1a33d05a2da4aef4d7c0c5692d5a143cbc9360c49b21c0f1b740d696e495f60',
  },
}

const lensBf16Model: HuggingFaceModel = {
  id: -100084,
  name: 'Lens BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 21695,
    thumbsUpCount: 54,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_lens_t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Lens',
  description: 'Lens 文生图 (GPT-OSS 文本编码 + Flux.2 架构)',
  version: lensBf16Version,
  versions: [lensBf16Version],
}

// Lens Turbo 快速文生图
const lensTurboBf16Version: HuggingFaceVersion = {
  id: -10000185,
  name: 'v1.0',
  baseModel: 'Lens',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_lens_turbo_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a9fc0e27261d9199d4e46e573a6b247f3cd94beec0241e61ae9eaee5ae9ef7c9',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Lens/resolve/main/diffusion_models/lens_turbo_bf16.safetensors',
    filename: 'lens_turbo_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'lens',
    sizeBytes: 8208595784,
    sha256: 'a9fc0e27261d9199d4e46e573a6b247f3cd94beec0241e61ae9eaee5ae9ef7c9',
  },
}

const lensTurboBf16Model: HuggingFaceModel = {
  id: -100085,
  name: 'Lens Turbo BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 21695,
    thumbsUpCount: 54,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_lens_turbo_t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Lens',
  description: 'Lens Turbo 快速文生图',
  version: lensTurboBf16Version,
  versions: [lensTurboBf16Version],
}

// LongCat-Image 文生图
const longcatImageBf16Version: HuggingFaceVersion = {
  id: -10000186,
  name: 'v1.0',
  baseModel: 'LongCat',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_longcat_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '7c83c314a3d879d43e5700072033256000f46a56900ae48b209a77ac1921488b',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/LongCat-Image/resolve/main/split_files/diffusion_models/longcat_image_bf16.safetensors',
    filename: 'longcat_image_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'longcat',
    sizeBytes: 12541383144,
    sha256: '7c83c314a3d879d43e5700072033256000f46a56900ae48b209a77ac1921488b',
  },
}

const longcatImageBf16Model: HuggingFaceModel = {
  id: -100086,
  name: 'LongCat Image BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 11242,
    thumbsUpCount: 19,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_longcat_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/LongCat-Image',
  description: 'LongCat-Image 文生图',
  version: longcatImageBf16Version,
  versions: [longcatImageBf16Version],
}

// LongCat-Image Edit 图像编辑
const longcatImageEditBf16Version: HuggingFaceVersion = {
  id: -10000187,
  name: 'v1.0',
  baseModel: 'LongCat',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_longcat_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8e65ba6ab2f6b323c1619347cd681e4ff78a017b608c82c7bf30f1d125925fab',
  },
  file: {
    url: 'https://huggingface.co/TalmajM/LongCat-Image-Edit_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/longcat_image_edit_bf16.safetensors',
    filename: 'longcat_image_edit_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'longcat',
    sizeBytes: 12541383144,
    sha256: '8e65ba6ab2f6b323c1619347cd681e4ff78a017b608c82c7bf30f1d125925fab',
  },
}

const longcatImageEditBf16Model: HuggingFaceModel = {
  id: -100087,
  name: 'LongCat Image Edit BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 2,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_longcat_image_edit-1.webp', type: 'image' }],
  user: { username: 'TalmajM' },
  sourceUrl: 'https://huggingface.co/TalmajM/LongCat-Image-Edit_ComfyUI_repackaged',
  description: 'LongCat-Image Edit 图像编辑',
  version: longcatImageEditBf16Version,
  versions: [longcatImageEditBf16Version],
}

// Lotus 单目深度估计模型
const lotusDepthDV11Version: HuggingFaceVersion = {
  id: -10000188,
  name: 'v1.0',
  baseModel: 'Lotus',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_depth_lora_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'dc1394219a04afdd9f72ad41ea0d3dfa435603fc7831a0ac5b884cc2b2ebf688',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/lotus/resolve/main/lotus-depth-d-v1-1.safetensors',
    filename: 'lotus-depth-d-v1-1.safetensors',
    modelType: 'diffusion_models',
    architecture: 'lotus',
    sizeBytes: 1735197352,
    sha256: 'dc1394219a04afdd9f72ad41ea0d3dfa435603fc7831a0ac5b884cc2b2ebf688',
  },
}

const lotusDepthDV11Model: HuggingFaceModel = {
  id: -100088,
  name: 'Lotus Depth D V1 1',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 19766,
    thumbsUpCount: 5,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_depth_lora_example-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/lotus',
  description: 'Lotus 单目深度估计模型',
  version: lotusDepthDV11Version,
  versions: [lotusDepthDV11Version],
}

// LTX-2 19B Distilled 蒸馏视频生成 transformer
const ltx219bDistilledTransformerOnlyBf16Version: HuggingFaceVersion = {
  id: -10000189,
  name: 'v1.0',
  baseModel: 'LTXV 2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx_2_audio_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2711d0565a6f5ea0a08525cf2e0f157441b01da4f80d212a5a5533f3551f723f',
  },
  file: {
    url: 'https://huggingface.co/Kijai/LTXV2_comfy/resolve/main/diffusion_models/ltx-2-19b-distilled_transformer_only_bf16.safetensors',
    filename: 'ltx-2-19b-distilled_transformer_only_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'ltxv',
    sizeBytes: 37759394560,
    sha256: '2711d0565a6f5ea0a08525cf2e0f157441b01da4f80d212a5a5533f3551f723f',
  },
}

const ltx219bDistilledTransformerOnlyBf16Model: HuggingFaceModel = {
  id: -100089,
  name: 'LTX-2 19B Distilled Transformer Only BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 18614,
    thumbsUpCount: 464,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx_2_audio_to_video-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/LTXV2_comfy',
  description: 'LTX-2 19B Distilled 蒸馏视频生成 transformer',
  version: ltx219bDistilledTransformerOnlyBf16Version,
  versions: [ltx219bDistilledTransformerOnlyBf16Version],
}

// LTX-2.3 22B Dev 视频生成 transformer
const ltx2322bDevTransformerOnlyBf16Version: HuggingFaceVersion = {
  id: -10000190,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_obscura_remova_lora_remove_object_from_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '0c83957f8c79d49c52ff5e3c0980a759d4dd532563d62cab35fda2b247606bd2',
  },
  file: {
    url: 'https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/diffusion_models/ltx-2.3-22b-dev_transformer_only_bf16.safetensors',
    filename: 'ltx-2.3-22b-dev_transformer_only_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'ltxv',
    sizeBytes: 42020149760,
    sha256: '0c83957f8c79d49c52ff5e3c0980a759d4dd532563d62cab35fda2b247606bd2',
  },
}

const ltx2322bDevTransformerOnlyBf16Model: HuggingFaceModel = {
  id: -100090,
  name: 'LTX-2.3 22B Dev Transformer Only BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1059470,
    thumbsUpCount: 573,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_obscura_remova_lora_remove_object_from_video-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/LTX2.3_comfy',
  description: 'LTX-2.3 22B Dev 视频生成 transformer',
  version: ltx2322bDevTransformerOnlyBf16Version,
  versions: [ltx2322bDevTransformerOnlyBf16Version],
}

// OmniGen2 通用文生图/图像编辑
const omnigen2Fp16Version: HuggingFaceVersion = {
  id: -10000191,
  name: 'v1.0',
  baseModel: 'OmniGen2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_omnigen2_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/omnigen2_fp16.safetensors',
    filename: 'omnigen2_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'omnigen2',
    sizeBytes: 7934384176,
    sha256: '60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de',
  },
}

const omnigen2Fp16Model: HuggingFaceModel = {
  id: -100091,
  name: 'OmniGen2 FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 22989,
    thumbsUpCount: 30,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_omnigen2_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged',
  description: 'OmniGen2 通用文生图/图像编辑',
  version: omnigen2Fp16Version,
  versions: [omnigen2Fp16Version],
}

// Ovis-Image 文生图
const ovisImageBf16Version: HuggingFaceVersion = {
  id: -10000192,
  name: 'v1.0',
  baseModel: 'Ovis',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ovis_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'eb3d9e1b201412b3b527472cf82a2c5add6b5a40a37e94d99f11c381f18a9e2b',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Ovis-Image/resolve/main/split_files/diffusion_models/ovis_image_bf16.safetensors',
    filename: 'ovis_image_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'ovis',
    sizeBytes: 14740943536,
    sha256: 'eb3d9e1b201412b3b527472cf82a2c5add6b5a40a37e94d99f11c381f18a9e2b',
  },
}

const ovisImageBf16Model: HuggingFaceModel = {
  id: -100092,
  name: 'Ovis Image BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 7013,
    thumbsUpCount: 32,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ovis_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Ovis-Image',
  description: 'Ovis-Image 文生图',
  version: ovisImageBf16Version,
  versions: [ovisImageBf16Version],
}

// PiD Flux.1 1024→4096 像素级 4 步超分
const pidFlux11024To40964stepBf16Version: HuggingFaceVersion = {
  id: -10000193,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_pid_latent_upscale_dit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '17c282ed387edad7bfdd3189c5a17363d73e3d60b5e841dfded81c3b76e211ee',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/PixelDiT/resolve/main/diffusion_models/pid_flux1_1024_to_4096_4step_bf16.safetensors',
    filename: 'pid_flux1_1024_to_4096_4step_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'flux',
    sizeBytes: 2724747428,
    sha256: '17c282ed387edad7bfdd3189c5a17363d73e3d60b5e841dfded81c3b76e211ee',
  },
}

const pidFlux11024To40964stepBf16Model: HuggingFaceModel = {
  id: -100093,
  name: 'PiD Flux.1 1024 To 4096 4step BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 76527,
    thumbsUpCount: 135,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_pid_latent_upscale_dit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/PixelDiT',
  description: 'PiD Flux.1 1024→4096 像素级 4 步超分',
  version: pidFlux11024To40964stepBf16Version,
  versions: [pidFlux11024To40964stepBf16Version],
}

// PixelDiT 1.3B 1024px 像素空间文生图
const pixeldit1300m1024pxBf16Version: HuggingFaceVersion = {
  id: -10000194,
  name: 'v1.0',
  baseModel: 'PixelDiT',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_pixeldit_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd904bae12526c48a522a503b80668fbd45bae6398e9d6f3c2a3e76629552d4ff',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/PixelDiT/resolve/main/diffusion_models/pixeldit_1300m_1024px_bf16.safetensors',
    filename: 'pixeldit_1300m_1024px_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'pixeldit',
    sizeBytes: 2604985230,
    sha256: 'd904bae12526c48a522a503b80668fbd45bae6398e9d6f3c2a3e76629552d4ff',
  },
}

const pixeldit1300m1024pxBf16Model: HuggingFaceModel = {
  id: -100094,
  name: 'PixelDiT 1300m 1024px BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 76527,
    thumbsUpCount: 135,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_pixeldit_t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/PixelDiT',
  description: 'PixelDiT 1.3B 1024px 像素空间文生图',
  version: pixeldit1300m1024pxBf16Version,
  versions: [pixeldit1300m1024pxBf16Version],
}

// Qwen-Image 2512 文生图/编辑
const qwenImage2512Bf16Version: HuggingFaceVersion = {
  id: -10000195,
  name: 'v1.0',
  baseModel: 'Qwen Image 2512',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_text_prompt_to_360hdr.app-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'cbf55390fff27dbc785046d7007b04e0c5dd7421e7ef128f2831eacb53a8e075',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_bf16.safetensors',
    filename: 'qwen_image_2512_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 40861031488,
    sha256: 'cbf55390fff27dbc785046d7007b04e0c5dd7421e7ef128f2831eacb53a8e075',
  },
}

const qwenImage2512Bf16Model: HuggingFaceModel = {
  id: -100095,
  name: 'Qwen Image 2512 BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1502351,
    thumbsUpCount: 461,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_text_prompt_to_360hdr.app-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI',
  description: 'Qwen-Image 2512 文生图/编辑',
  version: qwenImage2512Bf16Version,
  versions: [qwenImage2512Bf16Version],
}

// Qwen-Image 2512 fp8 文生图/编辑
const qwenImage2512Fp8E4m3fnVersion: HuggingFaceVersion = {
  id: -10000196,
  name: 'v1.0',
  baseModel: 'Qwen Image 2512',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '5dc80554d5d83390046a2f4a94ece06afb7700bf7b0aaf8bde9769793875876b',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors',
    filename: 'qwen_image_2512_fp8_e4m3fn.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 20430679144,
    sha256: '5dc80554d5d83390046a2f4a94ece06afb7700bf7b0aaf8bde9769793875876b',
  },
}

const qwenImage2512Fp8E4m3fnModel: HuggingFaceModel = {
  id: -100096,
  name: 'Qwen Image 2512 FP8 E4M3FN',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1502351,
    thumbsUpCount: 461,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI',
  description: 'Qwen-Image 2512 fp8 文生图/编辑',
  version: qwenImage2512Fp8E4m3fnVersion,
  versions: [qwenImage2512Fp8E4m3fnVersion],
}

// Qwen-Image Edit 2509 fp8 图像编辑
const qwenImageEdit2509Fp8E4m3fnVersion: HuggingFaceVersion = {
  id: -10000197,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '318568f61951ab9da21100c7b896e3c1da67f0d2efad6421545e022cfaa2b2b4',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors',
    filename: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 20430698424,
    sha256: '318568f61951ab9da21100c7b896e3c1da67f0d2efad6421545e022cfaa2b2b4',
  },
}

const qwenImageEdit2509Fp8E4m3fnModel: HuggingFaceModel = {
  id: -100097,
  name: 'Qwen Image Edit 2509 FP8 E4M3FN',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: 'Qwen-Image Edit 2509 fp8 图像编辑',
  version: qwenImageEdit2509Fp8E4m3fnVersion,
  versions: [qwenImageEdit2509Fp8E4m3fnVersion],
}

// Qwen-Image Edit 2511 图像编辑
const qwenImageEdit2511Bf16Version: HuggingFaceVersion = {
  id: -10000198,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image-qwen_image_edit_2511_lora_inflation-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ae42d927b5fac4f278b9a894554c727e619727a63622976f2d95625be4bce08c',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors',
    filename: 'qwen_image_edit_2511_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 40861031560,
    sha256: 'ae42d927b5fac4f278b9a894554c727e619727a63622976f2d95625be4bce08c',
  },
}

const qwenImageEdit2511Bf16Model: HuggingFaceModel = {
  id: -100098,
  name: 'Qwen Image Edit 2511 BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image-qwen_image_edit_2511_lora_inflation-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: 'Qwen-Image Edit 2511 图像编辑',
  version: qwenImageEdit2511Bf16Version,
  versions: [qwenImageEdit2511Bf16Version],
}

// Qwen-Image Edit fp8 图像编辑
const qwenImageEditFp8E4m3fnVersion: HuggingFaceVersion = {
  id: -10000199,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '393c6743d1de2e9031b5197027b36116f2096958ccc0223526d34e1860266021',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_fp8_e4m3fn.safetensors',
    filename: 'qwen_image_edit_fp8_e4m3fn.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 20430635136,
    sha256: '393c6743d1de2e9031b5197027b36116f2096958ccc0223526d34e1860266021',
  },
}

const qwenImageEditFp8E4m3fnModel: HuggingFaceModel = {
  id: -100099,
  name: 'Qwen Image Edit FP8 E4M3FN',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: 'Qwen-Image Edit fp8 图像编辑',
  version: qwenImageEditFp8E4m3fnVersion,
  versions: [qwenImageEditFp8E4m3fnVersion],
}

// Qwen-Image fp8 文生图
const qwenImageFp8E4m3fnVersion: HuggingFaceVersion = {
  id: -10000200,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '98763a127701eb6fb59096f7742cb3aa7d64ed510b9f4e882d8351f8176e3ce3',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors',
    filename: 'qwen_image_fp8_e4m3fn.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 20430635136,
    sha256: '98763a127701eb6fb59096f7742cb3aa7d64ed510b9f4e882d8351f8176e3ce3',
  },
}

const qwenImageFp8E4m3fnModel: HuggingFaceModel = {
  id: -100100,
  name: 'Qwen Image FP8 E4M3FN',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 1502351,
    thumbsUpCount: 461,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI',
  description: 'Qwen-Image fp8 文生图',
  version: qwenImageFp8E4m3fnVersion,
  versions: [qwenImageFp8E4m3fnVersion],
}

// Qwen-Image Layered 分层图像生成
const qwenImageLayeredBf16Version: HuggingFaceVersion = {
  id: -10000201,
  name: 'v1.0',
  baseModel: 'Qwen Image Layered',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '736a424a7abe52613b1fb4445cad3cd4603dc00055ad5ec790e3b8b1550290fd',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_layered_bf16.safetensors',
    filename: 'qwen_image_layered_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 40861043888,
    sha256: '736a424a7abe52613b1fb4445cad3cd4603dc00055ad5ec790e3b8b1550290fd',
  },
}

const qwenImageLayeredBf16Model: HuggingFaceModel = {
  id: -100101,
  name: 'Qwen Image Layered BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 29699,
    thumbsUpCount: 63,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI',
  description: 'Qwen-Image Layered 分层图像生成',
  version: qwenImageLayeredBf16Version,
  versions: [qwenImageLayeredBf16Version],
}

// Qwen-Image Layered Control 分层控制图像生成
const qwenImageLayeredControlBf16Version: HuggingFaceVersion = {
  id: -10000202,
  name: 'v1.0',
  baseModel: 'Qwen Image Layered',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '63b1966f0423bdc94d87273b8958de91e0a8f642c635f9113632d09cae3aa4ad',
  },
  file: {
    url: 'https://huggingface.co/DiffSynth-Studio/Qwen-Image-Layered-Control/resolve/main/qwen_image_layered_control_bf16.safetensors',
    filename: 'qwen_image_layered_control_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'qwen',
    sizeBytes: 40861043888,
    sha256: '63b1966f0423bdc94d87273b8958de91e0a8f642c635f9113632d09cae3aa4ad',
  },
}

const qwenImageLayeredControlBf16Model: HuggingFaceModel = {
  id: -100102,
  name: 'Qwen Image Layered Control BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 19,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered_control-1.webp', type: 'image' }],
  user: { username: 'DiffSynth-Studio' },
  sourceUrl: 'https://huggingface.co/DiffSynth-Studio/Qwen-Image-Layered-Control',
  description: 'Qwen-Image Layered Control 分层控制图像生成',
  version: qwenImageLayeredControlBf16Version,
  versions: [qwenImageLayeredControlBf16Version],
}

// RT-DETR v4-X-HGNet 目标检测模型 (SDPose 用)
const rtDetrV4XHgnetFp16Version: HuggingFaceVersion = {
  id: -10000203,
  name: 'v1.0',
  baseModel: 'RT-DETR',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_sdpose_multi_person-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '581f9af9bbabb664d1891cbccd823308b176ecd409146f954dfa39af3bec2476',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/SDPose/resolve/main/diffusion_models/rt_detr_v4-x-hgnet_fp16.safetensors',
    filename: 'rt_detr_v4-x-hgnet_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'rtdetr',
    sizeBytes: 123968978,
    sha256: '581f9af9bbabb664d1891cbccd823308b176ecd409146f954dfa39af3bec2476',
  },
}

const rtDetrV4XHgnetFp16Model: HuggingFaceModel = {
  id: -100103,
  name: 'RT-DETR V4 X Hgnet FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 25964,
    thumbsUpCount: 34,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_sdpose_multi_person-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/SDPose',
  description: 'RT-DETR v4-X-HGNet 目标检测模型 (SDPose 用)',
  version: rtDetrV4XHgnetFp16Version,
  versions: [rtDetrV4XHgnetFp16Version],
}

// TripoSplat 单图生成 3D 高斯泼溅
const triposplatFp16Version: HuggingFaceVersion = {
  id: -10000204,
  name: 'v1.0',
  baseModel: 'TripoSplat',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_triposplat_image_to_gaussian_splat-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c870b97ac1d6bc9177608a5ec625e19ef9f3c5019aa68f64b0fb7803abcd6d20',
  },
  file: {
    url: 'https://huggingface.co/VAST-AI/TripoSplat/resolve/main/diffusion_models/triposplat_fp16.safetensors',
    filename: 'triposplat_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'triposplat',
    sizeBytes: 741106994,
    sha256: 'c870b97ac1d6bc9177608a5ec625e19ef9f3c5019aa68f64b0fb7803abcd6d20',
  },
}

const triposplatFp16Model: HuggingFaceModel = {
  id: -100104,
  name: 'Triposplat FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 112,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_triposplat_image_to_gaussian_splat-1.webp', type: 'image' }],
  user: { username: 'VAST-AI' },
  sourceUrl: 'https://huggingface.co/VAST-AI/TripoSplat',
  description: 'TripoSplat 单图生成 3D 高斯泼溅',
  version: triposplatFp16Version,
  versions: [triposplatFp16Version],
}

// VOID 视频物体删除 inpainting pass1
const voidPass1Version: HuggingFaceVersion = {
  id: -10000205,
  name: 'v1.0',
  baseModel: 'CogVideoX-Fun 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_void_video_inpainting-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f3fff936d57008c39054e37ae0db6a3fd3f48ccaf1291a186e28d8760d68e6f3',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/void-model/resolve/main/diffusion_models/void_pass1.safetensors',
    filename: 'void_pass1.safetensors',
    modelType: 'diffusion_models',
    architecture: 'cogvideox',
    sizeBytes: 11143025952,
    sha256: 'f3fff936d57008c39054e37ae0db6a3fd3f48ccaf1291a186e28d8760d68e6f3',
  },
}

const voidPass1Model: HuggingFaceModel = {
  id: -100105,
  name: 'Void Pass1',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 24,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_void_video_inpainting-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/void-model',
  description: 'VOID 视频物体删除 inpainting pass1',
  version: voidPass1Version,
  versions: [voidPass1Version],
}

// VOID 视频物体删除 inpainting pass2
const voidPass2Version: HuggingFaceVersion = {
  id: -10000206,
  name: 'v1.0',
  baseModel: 'CogVideoX-Fun 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_void_video_inpainting-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '884d96ae3be9e2c899f15446aee69260f56e21496c1005400fc6676701e67704',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/void-model/resolve/main/diffusion_models/void_pass2.safetensors',
    filename: 'void_pass2.safetensors',
    modelType: 'diffusion_models',
    architecture: 'cogvideox',
    sizeBytes: 11143025952,
    sha256: '884d96ae3be9e2c899f15446aee69260f56e21496c1005400fc6676701e67704',
  },
}

const voidPass2Model: HuggingFaceModel = {
  id: -100106,
  name: 'Void Pass2',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 24,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_void_video_inpainting-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/void-model',
  description: 'VOID 视频物体删除 inpainting pass2',
  version: voidPass2Version,
  versions: [voidPass2Version],
}

// Wan 2.1 FLF2V 首尾帧到视频 14B 720p
const wan21Flf2v720p14BFp16Version: HuggingFaceVersion = {
  id: -10000207,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/wan2.1_flf2v_720_f16-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'bf4ac25667d00f53f49df02c5771f5aa7801c1dcb9b3ccade1407687c426d030',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_flf2v_720p_14B_fp16.safetensors',
    filename: 'wan2.1_flf2v_720p_14B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 32792693440,
    sha256: 'bf4ac25667d00f53f49df02c5771f5aa7801c1dcb9b3ccade1407687c426d030',
  },
}

const wan21Flf2v720p14BFp16Model: HuggingFaceModel = {
  id: -100107,
  name: 'Wan 2.1 FLF2V 720p 14B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/wan2.1_flf2v_720_f16-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 FLF2V 首尾帧到视频 14B 720p',
  version: wan21Flf2v720p14BFp16Version,
  versions: [wan21Flf2v720p14BFp16Version],
}

// Wan 2.1 Fun-Camera 相机控制 1.3B
const wan21FunCameraV1113BBf16Version: HuggingFaceVersion = {
  id: -10000208,
  name: 'v1.0',
  baseModel: 'Wan Video 1.3B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_fun_camera_v1.1_1.3B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '1a648f6fbb543dd6ac9f2f9af1ca4bc1bbe460482ee4d7984d50565699e97398',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_fun_camera_v1.1_1.3B_bf16.safetensors',
    filename: 'wan2.1_fun_camera_v1.1_1.3B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 3232727784,
    sha256: '1a648f6fbb543dd6ac9f2f9af1ca4bc1bbe460482ee4d7984d50565699e97398',
  },
}

const wan21FunCameraV1113BBf16Model: HuggingFaceModel = {
  id: -100108,
  name: 'Wan 2.1 Fun Camera V1.1 1.3B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_fun_camera_v1.1_1.3B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 Fun-Camera 相机控制 1.3B',
  version: wan21FunCameraV1113BBf16Version,
  versions: [wan21FunCameraV1113BBf16Version],
}

// Wan 2.1 Fun-Camera 相机控制 14B
const wan21FunCameraV1114BBf16Version: HuggingFaceVersion = {
  id: -10000209,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_fun_camera_v1.1_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f519d276502dcdb0e657d32faca64a5bf7d47b3c2b2c9b12bb849e9e0f3c495f',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_fun_camera_v1.1_14B_bf16.safetensors',
    filename: 'wan2.1_fun_camera_v1.1_14B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 33796394608,
    sha256: 'f519d276502dcdb0e657d32faca64a5bf7d47b3c2b2c9b12bb849e9e0f3c495f',
  },
}

const wan21FunCameraV1114BBf16Model: HuggingFaceModel = {
  id: -100109,
  name: 'Wan 2.1 Fun Camera V1.1 14B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_fun_camera_v1.1_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 Fun-Camera 相机控制 14B',
  version: wan21FunCameraV1114BBf16Version,
  versions: [wan21FunCameraV1114BBf16Version],
}

// Wan 2.1 Fun-Control 视频控制 1.3B
const wan21FunControl13BBf16Version: HuggingFaceVersion = {
  id: -10000210,
  name: 'v1.0',
  baseModel: 'Wan Video 1.3B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/wan2.1_fun_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9ff6289322b41bf187206eac2a57e85ce85c9ee5bfe8bc44eabeaeb86b44129a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_fun_control_1.3B_bf16.safetensors',
    filename: 'wan2.1_fun_control_1.3B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 3129105448,
    sha256: '9ff6289322b41bf187206eac2a57e85ce85c9ee5bfe8bc44eabeaeb86b44129a',
  },
}

const wan21FunControl13BBf16Model: HuggingFaceModel = {
  id: -100110,
  name: 'Wan 2.1 Fun Control 1.3B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/wan2.1_fun_control-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 Fun-Control 视频控制 1.3B',
  version: wan21FunControl13BBf16Version,
  versions: [wan21FunControl13BBf16Version],
}

// Wan 2.1 Fun-Inpaint 视频修复 1.3B
const wan21FunInp13BBf16Version: HuggingFaceVersion = {
  id: -10000211,
  name: 'v1.0',
  baseModel: 'Wan Video 1.3B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/wan2.1_fun_inp-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8495d2b1673ffb18abb548a64ff3b0e4bd367734f653096f7a8a3ad46954d511',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_fun_inp_1.3B_bf16.safetensors',
    filename: 'wan2.1_fun_inp_1.3B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 3128957992,
    sha256: '8495d2b1673ffb18abb548a64ff3b0e4bd367734f653096f7a8a3ad46954d511',
  },
}

const wan21FunInp13BBf16Model: HuggingFaceModel = {
  id: -100111,
  name: 'Wan 2.1 Fun INP 1.3B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/wan2.1_fun_inp-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 Fun-Inpaint 视频修复 1.3B',
  version: wan21FunInp13BBf16Version,
  versions: [wan21FunInp13BBf16Version],
}

// Wan 2.1 i2v 480p 14B 图生视频
const wan21I2v480p14BFp16Version: HuggingFaceVersion = {
  id: -10000212,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_to_video_wan-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '27988f6b510eb8d5fdd7485671b54897f8683f2bba7a772c5671be21d3491253',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp16.safetensors',
    filename: 'wan2.1_i2v_480p_14B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 32791377504,
    sha256: '27988f6b510eb8d5fdd7485671b54897f8683f2bba7a772c5671be21d3491253',
  },
}

const wan21I2v480p14BFp16Model: HuggingFaceModel = {
  id: -100112,
  name: 'Wan 2.1 I2V 480p 14B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_to_video_wan-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 i2v 480p 14B 图生视频',
  version: wan21I2v480p14BFp16Version,
  versions: [wan21I2v480p14BFp16Version],
}

// Wan 2.1 t2v 1.3B 文生视频
const wan21T2v13BFp16Version: HuggingFaceVersion = {
  id: -10000213,
  name: 'v1.0',
  baseModel: 'Wan Video 1.3B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/text_to_video_wan-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'be531024cd9018cb5b48c40cfbb6a6191645b1c792eb8bf4f8c1c6e10f924dc5',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors',
    filename: 'wan2.1_t2v_1.3B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 2838303560,
    sha256: 'be531024cd9018cb5b48c40cfbb6a6191645b1c792eb8bf4f8c1c6e10f924dc5',
  },
}

const wan21T2v13BFp16Model: HuggingFaceModel = {
  id: -100113,
  name: 'Wan 2.1 T2V 1.3B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/text_to_video_wan-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 t2v 1.3B 文生视频',
  version: wan21T2v13BFp16Version,
  versions: [wan21T2v13BFp16Version],
}

// Wan 2.1 t2v 14B fp8 文生视频
const wan21T2v14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000214,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2e39adde59c5e0e90edbb35873126b0d67928b5c11c501e384e976d6dc597cce',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_14B_fp8_scaled.safetensors',
    filename: 'wan2.1_t2v_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 14293896178,
    sha256: '2e39adde59c5e0e90edbb35873126b0d67928b5c11c501e384e976d6dc597cce',
  },
}

const wan21T2v14BFp8ScaledModel: HuggingFaceModel = {
  id: -100114,
  name: 'Wan 2.1 T2V 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 t2v 14B fp8 文生视频',
  version: wan21T2v14BFp8ScaledVersion,
  versions: [wan21T2v14BFp8ScaledVersion],
}

// Wan 2.1 VACE 视频编辑 1.3B
const wan21Vace13BFp16Version: HuggingFaceVersion = {
  id: -10000215,
  name: 'v1.0',
  baseModel: 'Wan Video 1.3B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan_vace_14B_ref2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '640ccc0577e6a5d4bb15cd91b11b699ef914fc55f126c5a1c544e152130784f2',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_vace_1.3B_fp16.safetensors',
    filename: 'wan2.1_vace_1.3B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 4309519800,
    sha256: '640ccc0577e6a5d4bb15cd91b11b699ef914fc55f126c5a1c544e152130784f2',
  },
}

const wan21Vace13BFp16Model: HuggingFaceModel = {
  id: -100115,
  name: 'Wan 2.1 VACE 1.3B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan_vace_14B_ref2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 VACE 视频编辑 1.3B',
  version: wan21Vace13BFp16Version,
  versions: [wan21Vace13BFp16Version],
}

// Wan 2.1 VACE 视频编辑 14B
const wan21Vace14BFp16Version: HuggingFaceVersion = {
  id: -10000216,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_sirolim_seamless_loop-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f202a5c59b8a91ada1862c46a038214f1f7f216c61ec8350d25f69b919da4307',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_vace_14B_fp16.safetensors',
    filename: 'wan2.1_vace_14B_fp16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan21',
    sizeBytes: 34675323640,
    sha256: 'f202a5c59b8a91ada1862c46a038214f1f7f216c61ec8350d25f69b919da4307',
  },
}

const wan21Vace14BFp16Model: HuggingFaceModel = {
  id: -100116,
  name: 'Wan 2.1 VACE 14B FP16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_sirolim_seamless_loop-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 VACE 视频编辑 14B',
  version: wan21Vace14BFp16Version,
  versions: [wan21Vace14BFp16Version],
}

// Wan 2.2 Fun-Camera 相机控制 high_noise 14B (i2v)
const wan22FunCameraHighNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000217,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_camera-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '89a99cb5ab29e388f2e24fddac48eab4d88ca339d236c7a8d96aabacd0f525ae',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 15301408048,
    sha256: '89a99cb5ab29e388f2e24fddac48eab4d88ca339d236c7a8d96aabacd0f525ae',
  },
}

const wan22FunCameraHighNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100117,
  name: 'Wan 2.2 Fun Camera High Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_camera-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Camera 相机控制 high_noise 14B (i2v)',
  version: wan22FunCameraHighNoise14BFp8ScaledVersion,
  versions: [wan22FunCameraHighNoise14BFp8ScaledVersion],
}

// Wan 2.2 Fun-Camera 相机控制 low_noise 14B (i2v)
const wan22FunCameraLowNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000218,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_camera-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a2b7b361e3fad907958aa6ad662a3673bad5ffdce14706cffde4baabb98f9020',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 15301408048,
    sha256: 'a2b7b361e3fad907958aa6ad662a3673bad5ffdce14706cffde4baabb98f9020',
  },
}

const wan22FunCameraLowNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100118,
  name: 'Wan 2.2 Fun Camera Low Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_camera-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Camera 相机控制 low_noise 14B (i2v)',
  version: wan22FunCameraLowNoise14BFp8ScaledVersion,
  versions: [wan22FunCameraLowNoise14BFp8ScaledVersion],
}

// Wan 2.2 Fun-Control 视频控制 5B
const wan22FunControl5BBf16Version: HuggingFaceVersion = {
  id: -10000219,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 TI2V-5B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ace4718a7c87ee3e5606a68ab79142c4395e81aece76b8120bc886f0fbbe1d16',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_5B_bf16.safetensors',
    filename: 'wan2.2_fun_control_5B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_5b',
    sizeBytes: 10003303280,
    sha256: 'ace4718a7c87ee3e5606a68ab79142c4395e81aece76b8120bc886f0fbbe1d16',
  },
}

const wan22FunControl5BBf16Model: HuggingFaceModel = {
  id: -100119,
  name: 'Wan 2.2 Fun Control 5B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_control-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Control 视频控制 5B',
  version: wan22FunControl5BBf16Version,
  versions: [wan22FunControl5BBf16Version],
}

// Wan 2.2 Fun-Control 视频控制 high_noise 14B (i2v)
const wan22FunControlHighNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000220,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'aa2f6b6f4cfc8a75a273a075db31730530f93320a996b153b8825205c3a3c498',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 14296064656,
    sha256: 'aa2f6b6f4cfc8a75a273a075db31730530f93320a996b153b8825205c3a3c498',
  },
}

const wan22FunControlHighNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100120,
  name: 'Wan 2.2 Fun Control High Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_control-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Control 视频控制 high_noise 14B (i2v)',
  version: wan22FunControlHighNoise14BFp8ScaledVersion,
  versions: [wan22FunControlHighNoise14BFp8ScaledVersion],
}

// Wan 2.2 Fun-Control 视频控制 low_noise 14B (i2v)
const wan22FunControlLowNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000221,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '0f83c7b1cd6d509ff3504a8f604ca9d9876a8b1ed04f6e05095c4a7ccb9009cd',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 14296064656,
    sha256: '0f83c7b1cd6d509ff3504a8f604ca9d9876a8b1ed04f6e05095c4a7ccb9009cd',
  },
}

const wan22FunControlLowNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100121,
  name: 'Wan 2.2 Fun Control Low Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_control-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Control 视频控制 low_noise 14B (i2v)',
  version: wan22FunControlLowNoise14BFp8ScaledVersion,
  versions: [wan22FunControlLowNoise14BFp8ScaledVersion],
}

// Wan 2.2 Fun-Inpaint 视频修复 5B
const wan22FunInpaint5BBf16Version: HuggingFaceVersion = {
  id: -10000222,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 TI2V-5B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_inpaint-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '680a45b769e2e6ed0ef3710a32ad824baa85d546e534b6f49adcd2b32d42d29a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_inpaint_5B_bf16.safetensors',
    filename: 'wan2.2_fun_inpaint_5B_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_5b',
    sizeBytes: 10000937656,
    sha256: '680a45b769e2e6ed0ef3710a32ad824baa85d546e534b6f49adcd2b32d42d29a',
  },
}

const wan22FunInpaint5BBf16Model: HuggingFaceModel = {
  id: -100122,
  name: 'Wan 2.2 Fun Inpaint 5B BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_inpaint-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Inpaint 视频修复 5B',
  version: wan22FunInpaint5BBf16Version,
  versions: [wan22FunInpaint5BBf16Version],
}

// Wan 2.2 Fun-Inpaint 视频修复 high_noise 14B (i2v)
const wan22FunInpaintHighNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000223,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_inpaint-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '6106c137d8a921bc17d579c3e9deaa4fc4fadbc77fbe733f43ff19bb33ec3995',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 14294743520,
    sha256: '6106c137d8a921bc17d579c3e9deaa4fc4fadbc77fbe733f43ff19bb33ec3995',
  },
}

const wan22FunInpaintHighNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100123,
  name: 'Wan 2.2 Fun Inpaint High Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_inpaint-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Inpaint 视频修复 high_noise 14B (i2v)',
  version: wan22FunInpaintHighNoise14BFp8ScaledVersion,
  versions: [wan22FunInpaintHighNoise14BFp8ScaledVersion],
}

// Wan 2.2 Fun-Inpaint 视频修复 low_noise 14B (i2v)
const wan22FunInpaintLowNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000224,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_inpaint-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a3981f3e0f79c59fb3cffe1240ee34656bbc57e599101fac2b7140461037ab9c',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_inpaint_low_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_fun_inpaint_low_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 14294743520,
    sha256: 'a3981f3e0f79c59fb3cffe1240ee34656bbc57e599101fac2b7140461037ab9c',
  },
}

const wan22FunInpaintLowNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100124,
  name: 'Wan 2.2 Fun Inpaint Low Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_inpaint-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 Fun-Inpaint 视频修复 low_noise 14B (i2v)',
  version: wan22FunInpaintLowNoise14BFp8ScaledVersion,
  versions: [wan22FunInpaintLowNoise14BFp8ScaledVersion],
}

// Wan 2.2 i2v high_noise 14B 图生视频
const wan22I2vHighNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000225,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '6122e79d55e0f235698d11d657f3b196c5273c830da00b2b013c5a048d5e6a42',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 14294742832,
    sha256: '6122e79d55e0f235698d11d657f3b196c5273c830da00b2b013c5a048d5e6a42',
  },
}

const wan22I2vHighNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100125,
  name: 'Wan 2.2 I2V High Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 i2v high_noise 14B 图生视频',
  version: wan22I2vHighNoise14BFp8ScaledVersion,
  versions: [wan22I2vHighNoise14BFp8ScaledVersion],
}

// Wan 2.2 i2v low_noise 14B 图生视频
const wan22I2vLowNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000226,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '5471a457b6ac404202a5fbe6c11595a3d5641fc766b00f38763f72303fffc21e',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_i2v',
    sizeBytes: 14294742832,
    sha256: '5471a457b6ac404202a5fbe6c11595a3d5641fc766b00f38763f72303fffc21e',
  },
}

const wan22I2vLowNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100126,
  name: 'Wan 2.2 I2V Low Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 i2v low_noise 14B 图生视频',
  version: wan22I2vLowNoise14BFp8ScaledVersion,
  versions: [wan22I2vLowNoise14BFp8ScaledVersion],
}

// Wan 2.2 S2V 音频驱动视频 14B (基于 t2v)
const wan22S2v14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000227,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 T2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_s2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '140e75af5534ac3d91e710d9df756f7032addd64b341ba2c1c70e3e6da9aa216',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_s2v_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_s2v_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_t2v',
    sizeBytes: 16394832474,
    sha256: '140e75af5534ac3d91e710d9df756f7032addd64b341ba2c1c70e3e6da9aa216',
  },
}

const wan22S2v14BFp8ScaledModel: HuggingFaceModel = {
  id: -100127,
  name: 'Wan 2.2 S2V 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_s2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 S2V 音频驱动视频 14B (基于 t2v)',
  version: wan22S2v14BFp8ScaledVersion,
  versions: [wan22S2v14BFp8ScaledVersion],
}

// Wan 2.2 t2v high_noise 14B 文生视频
const wan22T2vHighNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000228,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 T2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_t2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'cad711ae211c8b23455ec68cd6a190a33a3d874234a77eb57266d73f8f0e6c9f',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_t2v',
    sizeBytes: 14293923632,
    sha256: 'cad711ae211c8b23455ec68cd6a190a33a3d874234a77eb57266d73f8f0e6c9f',
  },
}

const wan22T2vHighNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100128,
  name: 'Wan 2.2 T2V High Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_t2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 t2v high_noise 14B 文生视频',
  version: wan22T2vHighNoise14BFp8ScaledVersion,
  versions: [wan22T2vHighNoise14BFp8ScaledVersion],
}

// Wan 2.2 t2v low_noise 14B 文生视频
const wan22T2vLowNoise14BFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000229,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 T2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_t2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e71b96d7c82e638694c5e7fb98fac4bfb0e4ddc5fbbb4b1df40da8f0f1278a97',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
    filename: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
    modelType: 'diffusion_models',
    architecture: 'wan22_t2v',
    sizeBytes: 14293923632,
    sha256: 'e71b96d7c82e638694c5e7fb98fac4bfb0e4ddc5fbbb4b1df40da8f0f1278a97',
  },
}

const wan22T2vLowNoise14BFp8ScaledModel: HuggingFaceModel = {
  id: -100129,
  name: 'Wan 2.2 T2V Low Noise 14B FP8',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_t2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 t2v low_noise 14B 文生视频',
  version: wan22T2vLowNoise14BFp8ScaledVersion,
  versions: [wan22T2vLowNoise14BFp8ScaledVersion],
}

// Z-Image Turbo 快速文生图
const zImageTurboBf16Version: HuggingFaceVersion = {
  id: -10000230,
  name: 'v1.0',
  baseModel: 'ZImageTurbo',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors',
    filename: 'z_image_turbo_bf16.safetensors',
    modelType: 'diffusion_models',
    architecture: 'zimage',
    sizeBytes: 12309866400,
    sha256: '2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6',
  },
}

const zImageTurboBf16Model: HuggingFaceModel = {
  id: -100130,
  name: 'Z-Image Turbo BF16',
  type: 'DiffusionModel',
  metrics: {
    downloadCount: 5204347,
    thumbsUpCount: 801,
  },
  images: [],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/z_image_turbo',
  description: 'Z-Image Turbo 快速文生图',
  version: zImageTurboBf16Version,
  versions: [zImageTurboBf16Version],
}
// ── loras ────────────────────────────────────────────────────────────────────

// FireRed-Image-Edit 图像编辑模型 8 步 Lightning 加速 LoRA
const fireRedImageEdit10Lightning8stepsV10Version: HuggingFaceVersion = {
  id: -10000231,
  name: 'v1.0',
  baseModel: 'FireRed-Image-Edit-1.0',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_firered_image_edit1_1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'dc65fec1f5b92aa160deca7947c637b3e0f6016c1a22f87e1dabba053841cc7a',
  },
  file: {
    url: 'https://huggingface.co/FireRedTeam/FireRed-Image-Edit-1.0-ComfyUI/resolve/main/FireRed-Image-Edit-1.0-Lightning-8steps-v1.0.safetensors',
    filename: 'FireRed-Image-Edit-1.0-Lightning-8steps-v1.0.safetensors',
    modelType: 'loras',
    architecture: 'firered',
    sizeBytes: 849542744,
    sha256: 'dc65fec1f5b92aa160deca7947c637b3e0f6016c1a22f87e1dabba053841cc7a',
  },
}

const fireRedImageEdit10Lightning8stepsV10Model: HuggingFaceModel = {
  id: -100131,
  name: 'FireRed-Image-Edit 1.0 Lightning 8steps V1.0 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 789,
    thumbsUpCount: 30,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_firered_image_edit1_1-1.webp', type: 'image' }],
  user: { username: 'FireRedTeam' },
  sourceUrl: 'https://huggingface.co/FireRedTeam/FireRed-Image-Edit-1.0-ComfyUI',
  description: 'FireRed-Image-Edit 图像编辑模型 8 步 Lightning 加速 LoRA',
  version: fireRedImageEdit10Lightning8stepsV10Version,
  versions: [fireRedImageEdit10Lightning8stepsV10Version],
}

// Flux.2 dev Turbo 加速 LoRA (ByteZSzn, LoraLoaderModelOnly)
const flux2TurboLoRAComfyuiVersion: HuggingFaceVersion = {
  id: -10000232,
  name: 'v1.0',
  baseModel: 'Flux.2 Dev',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '011487390b8020baf22a9d543930c90d74a4809b7241bee6b0622777b17b413b',
  },
  file: {
    url: 'https://huggingface.co/ByteZSzn/Flux.2-Turbo-ComfyUI/resolve/main/Flux_2-Turbo-LoRA_comfyui.safetensors',
    filename: 'Flux_2-Turbo-LoRA_comfyui.safetensors',
    modelType: 'loras',
    architecture: 'flux2',
    sizeBytes: 2760814880,
    sha256: '011487390b8020baf22a9d543930c90d74a4809b7241bee6b0622777b17b413b',
  },
}

const flux2TurboLoRAComfyuiModel: HuggingFaceModel = {
  id: -100132,
  name: 'Flux 2 Turbo LoRA Comfyui',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 21,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  user: { username: 'ByteZSzn' },
  sourceUrl: 'https://huggingface.co/ByteZSzn/Flux.2-Turbo-ComfyUI',
  description: 'Flux.2 dev Turbo 加速 LoRA (ByteZSzn, LoraLoaderModelOnly)',
  version: flux2TurboLoRAComfyuiVersion,
  versions: [flux2TurboLoRAComfyuiVersion],
}

// 风格 LoRA, 将任意物体变成玩具/可动人偶 (触发词 "action the ...")
const qWENEDITACTIONV1Version: HuggingFaceVersion = {
  id: -10000233,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2511',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_qwen_image_edit_2511_systms_action-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '52287ccc0544b0fa611df7ee15c96f1320548b7eec5feed759f7ffbf7adeae3a',
  },
  file: {
    url: 'https://huggingface.co/systms/SYSTMS-ACTION-LoRA-Qwen-Image-Edit-2511/resolve/main/QWEN_EDIT_ACTION_V1.safetensors',
    filename: 'QWEN_EDIT_ACTION_V1.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 295146192,
    sha256: '52287ccc0544b0fa611df7ee15c96f1320548b7eec5feed759f7ffbf7adeae3a',
  },
}

const qWENEDITACTIONV1Model: HuggingFaceModel = {
  id: -100133,
  name: 'QWEN EDIT ACTION V1 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 16459,
    thumbsUpCount: 15,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_qwen_image_edit_2511_systms_action-1.webp', type: 'image' }],
  user: { username: 'systms' },
  sourceUrl: 'https://huggingface.co/systms/SYSTMS-ACTION-LoRA-Qwen-Image-Edit-2511',
  description: '风格 LoRA, 将任意物体变成玩具/可动人偶 (触发词 "action the ...")',
  version: qWENEDITACTIONV1Version,
  versions: [qWENEDITACTIONV1Version],
}

// 多角度/镜头移动控制 LoRA (dx8152, 无触发词)
const qwenEdit2509MultipleAnglesVersion: HuggingFaceVersion = {
  id: -10000234,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-1_click_multiple_scene_angles-v1.0-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e0cea9508025a39e41f50da0e7d10fbd9db182d057c745136a42ef8829914c8f',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors',
    filename: 'Qwen-Edit-2509-Multiple-angles.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 236117032,
    sha256: 'e0cea9508025a39e41f50da0e7d10fbd9db182d057c745136a42ef8829914c8f',
  },
}

const qwenEdit2509MultipleAnglesModel: HuggingFaceModel = {
  id: -100134,
  name: 'Qwen Edit 2509 Multiple Angles LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-1_click_multiple_scene_angles-v1.0-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: '多角度/镜头移动控制 LoRA (dx8152, 无触发词)',
  version: qwenEdit2509MultipleAnglesVersion,
  versions: [qwenEdit2509MultipleAnglesVersion],
}

// Qwen Image 2512 4 步蒸馏加速 LoRA (Lightning)
const qwenImage2512Lightning4stepsV10Fp32Version: HuggingFaceVersion = {
  id: -10000235,
  name: 'v1.0',
  baseModel: 'Qwen Image 2512',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ad12117461cb41e2ea637fec8df6392ce8e8550c47fbe2b829ed3deb98262066',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-2512-Lightning/resolve/main/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors',
    filename: 'Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 1698951104,
    sha256: 'ad12117461cb41e2ea637fec8df6392ce8e8550c47fbe2b829ed3deb98262066',
  },
}

const qwenImage2512Lightning4stepsV10Fp32Model: HuggingFaceModel = {
  id: -100135,
  name: 'Qwen Image 2512 Lightning 4steps V1.0 FP32 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 66578,
    thumbsUpCount: 227,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-2512-Lightning',
  description: 'Qwen Image 2512 4 步蒸馏加速 LoRA (Lightning)',
  version: qwenImage2512Lightning4stepsV10Fp32Version,
  versions: [qwenImage2512Lightning4stepsV10Fp32Version],
}

// 风格转写实 LoRA (Anything2Real, 任意画风转照片, 强度 0.75-0.9)
const qwenImageEdit2509Anything2RealAlphaVersion: HuggingFaceVersion = {
  id: -10000236,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-image_to_real-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '62ee14b063d53a24f842ef9f612b90ac7016df11027abe6266fab871bb44aae9',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Anything2RealAlpha.safetensors',
    filename: 'Qwen-Image-Edit-2509-Anything2RealAlpha.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 609646608,
    sha256: '62ee14b063d53a24f842ef9f612b90ac7016df11027abe6266fab871bb44aae9',
  },
}

const qwenImageEdit2509Anything2RealAlphaModel: HuggingFaceModel = {
  id: -100136,
  name: 'Qwen Image Edit 2509 Anything2RealAlpha LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-image_to_real-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: '风格转写实 LoRA (Anything2Real, 任意画风转照片, 强度 0.75-0.9)',
  version: qwenImageEdit2509Anything2RealAlphaVersion,
  versions: [qwenImageEdit2509Anything2RealAlphaVersion],
}

// 图像融合/产品溶图 LoRA (dx8152, 触发词 "溶图")
const qwenImageEdit2509FusionVersion: HuggingFaceVersion = {
  id: -10000237,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-qwen_image_edit-crop_and_stitch-fusion-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a0cd7db2cfc2133414ff6fae6978a4981c8114148d58f288fed25b4ef93b5dcd',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Fusion.safetensors',
    filename: 'Qwen-Image-Edit-2509-Fusion.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 236117032,
    sha256: 'a0cd7db2cfc2133414ff6fae6978a4981c8114148d58f288fed25b4ef93b5dcd',
  },
}

const qwenImageEdit2509FusionModel: HuggingFaceModel = {
  id: -100137,
  name: 'Qwen Image Edit 2509 Fusion LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-qwen_image_edit-crop_and_stitch-fusion-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: '图像融合/产品溶图 LoRA (dx8152, 触发词 "溶图")',
  version: qwenImageEdit2509FusionVersion,
  versions: [qwenImageEdit2509FusionVersion],
}

// 光照迁移/二次打光 LoRA (dx8152)
const qwenImageEdit2509LightMigrationVersion: HuggingFaceVersion = {
  id: -10000238,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-portrait_light_migration-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '202d76cfbf0f8e670154ef300b0f28e4a4bfdb94dd91a535f6ab73769314ae3f',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Light-Migration.safetensors',
    filename: 'Qwen-Image-Edit-2509-Light-Migration.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 236117032,
    sha256: '202d76cfbf0f8e670154ef300b0f28e4a4bfdb94dd91a535f6ab73769314ae3f',
  },
}

const qwenImageEdit2509LightMigrationModel: HuggingFaceModel = {
  id: -100138,
  name: 'Qwen Image Edit 2509 Light Migration LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-portrait_light_migration-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: '光照迁移/二次打光 LoRA (dx8152)',
  version: qwenImageEdit2509LightMigrationVersion,
  versions: [qwenImageEdit2509LightMigrationVersion],
}

// Qwen Image Edit 2509 4 步蒸馏加速 LoRA (Lightning)
const qwenImageEdit2509Lightning4stepsV10Bf16Version: HuggingFaceVersion = {
  id: -10000239,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2a32ce938ec71db2b49a817b4844ae86995569518dea56ee0ddc209cbe8e1377',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors',
    filename: 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 849608296,
    sha256: '2a32ce938ec71db2b49a817b4844ae86995569518dea56ee0ddc209cbe8e1377',
  },
}

const qwenImageEdit2509Lightning4stepsV10Bf16Model: HuggingFaceModel = {
  id: -100139,
  name: 'Qwen Image Edit 2509 Lightning 4steps V1.0 BF16 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 423522,
    thumbsUpCount: 818,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning',
  description: 'Qwen Image Edit 2509 4 步蒸馏加速 LoRA (Lightning)',
  version: qwenImageEdit2509Lightning4stepsV10Bf16Version,
  versions: [qwenImageEdit2509Lightning4stepsV10Bf16Version],
}

// Qwen Image Edit 2509 8 步蒸馏加速 LoRA (Lightning)
const qwenImageEdit2509Lightning8stepsV10Bf16Version: HuggingFaceVersion = {
  id: -10000240,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-image_to_real-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'b5c48ba90d22294cc4e20ea4a347496e2136295ad438ff79ad4fe841f28d7f72',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors',
    filename: 'Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 849608296,
    sha256: 'b5c48ba90d22294cc4e20ea4a347496e2136295ad438ff79ad4fe841f28d7f72',
  },
}

const qwenImageEdit2509Lightning8stepsV10Bf16Model: HuggingFaceModel = {
  id: -100140,
  name: 'Qwen Image Edit 2509 Lightning 8steps V1.0 BF16 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 423522,
    thumbsUpCount: 818,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates-image_to_real-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning',
  description: 'Qwen Image Edit 2509 8 步蒸馏加速 LoRA (Lightning)',
  version: qwenImageEdit2509Lightning8stepsV10Bf16Version,
  versions: [qwenImageEdit2509Lightning8stepsV10Bf16Version],
}

// 重打光 LoRA (dx8152, 触发词 "重新照明")
const qwenImageEdit2509RelightVersion: HuggingFaceVersion = {
  id: -10000241,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2509',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509_relight-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2a11c2b74ce0965abf35a8c8db52305072e970a689ca904b5a5b5a94d0aab86c',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Relight.safetensors',
    filename: 'Qwen-Image-Edit-2509-Relight.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 236117032,
    sha256: '2a11c2b74ce0965abf35a8c8db52305072e970a689ca904b5a5b5a94d0aab86c',
  },
}

const qwenImageEdit2509RelightModel: HuggingFaceModel = {
  id: -100141,
  name: 'Qwen Image Edit 2509 Relight LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 871659,
    thumbsUpCount: 453,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2509_relight-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI',
  description: '重打光 LoRA (dx8152, 触发词 "重新照明")',
  version: qwenImageEdit2509RelightVersion,
  versions: [qwenImageEdit2509RelightVersion],
}

// Qwen Image Edit 2511 4 步蒸馏加速 LoRA (Lightning)
const qwenImageEdit2511Lightning4stepsV10Bf16Version: HuggingFaceVersion = {
  id: -10000242,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2511',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2511-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
    filename: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 849608296,
    sha256: '22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f',
  },
}

const qwenImageEdit2511Lightning4stepsV10Bf16Model: HuggingFaceModel = {
  id: -100142,
  name: 'Qwen Image Edit 2511 Lightning 4steps V1.0 BF16 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 292394,
    thumbsUpCount: 504,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit_2511-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning',
  description: 'Qwen Image Edit 2511 4 步蒸馏加速 LoRA (Lightning)',
  version: qwenImageEdit2511Lightning4stepsV10Bf16Version,
  versions: [qwenImageEdit2511Lightning4stepsV10Bf16Version],
}

// Qwen Image Edit 4 步蒸馏加速 LoRA (Lightning 早期版)
const qwenImageEditLightning4stepsV10Bf16Version: HuggingFaceVersion = {
  id: -10000243,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd8132c32e7df906603dd6b072ff2fb0af88ab15ef0f3ac697a2011c8b47bbeb1',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors',
    filename: 'Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 849608296,
    sha256: 'd8132c32e7df906603dd6b072ff2fb0af88ab15ef0f3ac697a2011c8b47bbeb1',
  },
}

const qwenImageEditLightning4stepsV10Bf16Model: HuggingFaceModel = {
  id: -100143,
  name: 'Qwen Image Edit Lightning 4steps V1.0 BF16 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 423522,
    thumbsUpCount: 818,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_edit-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning',
  description: 'Qwen Image Edit 4 步蒸馏加速 LoRA (Lightning 早期版)',
  version: qwenImageEditLightning4stepsV10Bf16Version,
  versions: [qwenImageEditLightning4stepsV10Bf16Version],
}

// Qwen Image 4 步蒸馏加速 LoRA (Lightning)
const qwenImageLightning4stepsV10Version: HuggingFaceVersion = {
  id: -10000244,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512_controlnet-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9526e90d71c4290392feeccf3c2172cb77ab3a489f1faeb956637f97acb4c8b1',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Lightning-4steps-V1.0.safetensors',
    filename: 'Qwen-Image-Lightning-4steps-V1.0.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 1698951104,
    sha256: '9526e90d71c4290392feeccf3c2172cb77ab3a489f1faeb956637f97acb4c8b1',
  },
}

const qwenImageLightning4stepsV10Model: HuggingFaceModel = {
  id: -100144,
  name: 'Qwen Image Lightning 4steps V1.0 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 423522,
    thumbsUpCount: 818,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512_controlnet-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning',
  description: 'Qwen Image 4 步蒸馏加速 LoRA (Lightning)',
  version: qwenImageLightning4stepsV10Version,
  versions: [qwenImageLightning4stepsV10Version],
}

// Qwen Image 8 步蒸馏加速 LoRA (Lightning)
const qwenImageLightning8stepsV10Version: HuggingFaceVersion = {
  id: -10000245,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '07b5a999881437f63124979844ba1949ce2438f65b6220628a196a7d30a4fff9',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Lightning-8steps-V1.0.safetensors',
    filename: 'Qwen-Image-Lightning-8steps-V1.0.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 1698951104,
    sha256: '07b5a999881437f63124979844ba1949ce2438f65b6220628a196a7d30a4fff9',
  },
}

const qwenImageLightning8stepsV10Model: HuggingFaceModel = {
  id: -100145,
  name: 'Qwen Image Lightning 8steps V1.0 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 423522,
    thumbsUpCount: 818,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning',
  description: 'Qwen Image 8 步蒸馏加速 LoRA (Lightning)',
  version: qwenImageLightning8stepsV10Version,
  versions: [qwenImageLightning8stepsV10Version],
}

// 风格 LoRA, 让物体膨胀 (触发词 "inflate the ...")
const sYSTMSINFL8LoRAQwenImageEdit2511Version: HuggingFaceVersion = {
  id: -10000246,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2511',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '48cff1497edf7610c904a18d94e996f97466c8c3784de4e790a31f9d45f33998',
  },
  file: {
    url: 'https://huggingface.co/systms/SYSTMS-INFL8-LoRA-Qwen-Image-Edit-2511/resolve/main/SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors',
    filename: 'SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 295146200,
    sha256: '48cff1497edf7610c904a18d94e996f97466c8c3784de4e790a31f9d45f33998',
  },
}

const sYSTMSINFL8LoRAQwenImageEdit2511Model: HuggingFaceModel = {
  id: -100146,
  name: 'SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511',
  type: 'LORA',
  metrics: {
    downloadCount: 2666,
    thumbsUpCount: 19,
  },
  images: [],
  user: { username: 'systms' },
  sourceUrl: 'https://huggingface.co/systms/SYSTMS-INFL8-LoRA-Qwen-Image-Edit-2511',
  description: '',
  version: sYSTMSINFL8LoRAQwenImageEdit2511Version,
  versions: [sYSTMSINFL8LoRAQwenImageEdit2511Version],
}

// Wan 2.2 i2v 4 步加速 LoRA (high noise, Kijai 旧版)
const wan22LightningI2VA14B4stepsLoraHIGHFp16Version: HuggingFaceVersion = {
  id: -10000247,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '216cce62ecb5687d55fdc035b1cdbea01d1a9a8100ee924d2155cf1d64f1050b',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/LoRAs/Wan22-Lightning/old/Wan2.2-Lightning_I2V-A14B-4steps-lora_HIGH_fp16.safetensors',
    filename: 'Wan2.2-Lightning_I2V-A14B-4steps-lora_HIGH_fp16.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 613561776,
    sha256: '216cce62ecb5687d55fdc035b1cdbea01d1a9a8100ee924d2155cf1d64f1050b',
  },
}

const wan22LightningI2VA14B4stepsLoraHIGHFp16Model: HuggingFaceModel = {
  id: -100147,
  name: 'Wan 2.2 Lightning I2V A14B 4steps LoRA HIGH FP16',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.2 i2v 4 步加速 LoRA (high noise, Kijai 旧版)',
  version: wan22LightningI2VA14B4stepsLoraHIGHFp16Version,
  versions: [wan22LightningI2VA14B4stepsLoraHIGHFp16Version],
}

// Wan 2.2 i2v 4 步加速 LoRA (low noise, Kijai 旧版)
const wan22LightningI2VA14B4stepsLoraLOWFp16Version: HuggingFaceVersion = {
  id: -10000248,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: 'a3d474925042ec908c212c6c4c1e338637e27585c3970253f65b9638a9f5874b',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/LoRAs/Wan22-Lightning/old/Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16.safetensors',
    filename: 'Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 613561776,
    sha256: 'a3d474925042ec908c212c6c4c1e338637e27585c3970253f65b9638a9f5874b',
  },
}

const wan22LightningI2VA14B4stepsLoraLOWFp16Model: HuggingFaceModel = {
  id: -100148,
  name: 'Wan 2.2 Lightning I2V A14B 4steps LoRA LOW FP16',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.2 i2v 4 步加速 LoRA (low noise, Kijai 旧版)',
  version: wan22LightningI2VA14B4stepsLoraLOWFp16Version,
  versions: [wan22LightningI2VA14B4stepsLoraLOWFp16Version],
}

// Wan 2.1 T2V 14B CausVid 蒸馏 LoRA (实验性, v1)
const wan21CausVid14BT2VLoraRank32Version: HuggingFaceVersion = {
  id: -10000249,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_shane_video_restyle-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e5664f709f39b8352e8487e412efdac5c2fc283f21d06e289a19344daaaa198d',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_14B_T2V_lora_rank32.safetensors',
    filename: 'Wan21_CausVid_14B_T2V_lora_rank32.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 319116504,
    sha256: 'e5664f709f39b8352e8487e412efdac5c2fc283f21d06e289a19344daaaa198d',
  },
}

const wan21CausVid14BT2VLoraRank32Model: HuggingFaceModel = {
  id: -100149,
  name: 'Wan 2.1 CausVid 14B T2V LoRA Rank32',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_shane_video_restyle-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 T2V 14B CausVid 蒸馏 LoRA (实验性, v1)',
  version: wan21CausVid14BT2VLoraRank32Version,
  versions: [wan21CausVid14BT2VLoraRank32Version],
}

// Wan 2.1 T2V 14B CausVid 蒸馏 LoRA v2 (剪枝版, 仅 attention 层)
const wan21CausVid14BT2VLoraRank32V2Version: HuggingFaceVersion = {
  id: -10000250,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_shane_change_any_objects-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '3d6853cb7e7e9d6d35fb6c7163a85dab98e6c91d1341e8a3cf0bfb4e66dd68cc',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_14B_T2V_lora_rank32_v2.safetensors',
    filename: 'Wan21_CausVid_14B_T2V_lora_rank32_v2.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 204551064,
    sha256: '3d6853cb7e7e9d6d35fb6c7163a85dab98e6c91d1341e8a3cf0bfb4e66dd68cc',
  },
}

const wan21CausVid14BT2VLoraRank32V2Model: HuggingFaceModel = {
  id: -100150,
  name: 'Wan 2.1 CausVid 14B T2V LoRA Rank32 V2',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_shane_change_any_objects-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 T2V 14B CausVid 蒸馏 LoRA v2 (剪枝版, 仅 attention 层)',
  version: wan21CausVid14BT2VLoraRank32V2Version,
  versions: [wan21CausVid14BT2VLoraRank32V2Version],
}

// Wan 2.1 T2V 1.3B CausVid 蒸馏 LoRA (实验性)
const wan21CausVidBidirect2T2V13BLoraRank32Version: HuggingFaceVersion = {
  id: -10000251,
  name: 'v1.0',
  baseModel: 'Wan Video 1.3B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan_vace_14B_ref2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8e5331e780ffb16520bf1ff7ba90188ebd271a4698e5be8e618800e809cca704',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_bidirect2_T2V_1_3B_lora_rank32.safetensors',
    filename: 'Wan21_CausVid_bidirect2_T2V_1_3B_lora_rank32.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 91233416,
    sha256: '8e5331e780ffb16520bf1ff7ba90188ebd271a4698e5be8e618800e809cca704',
  },
}

const wan21CausVidBidirect2T2V13BLoraRank32Model: HuggingFaceModel = {
  id: -100151,
  name: 'Wan 2.1 CausVid Bidirect2 T2V 1 3B LoRA Rank32',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan_vace_14B_ref2v-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 T2V 1.3B CausVid 蒸馏 LoRA (实验性)',
  version: wan21CausVidBidirect2T2V13BLoraRank32Version,
  versions: [wan21CausVidBidirect2T2V13BLoraRank32Version],
}

// Wan 2.1 T2V 14B lightx2v CFG+步数蒸馏加速 LoRA (rank32)
const wan21T2V14BLightx2vCfgStepDistillLoraRank32Version: HuggingFaceVersion = {
  id: -10000252,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '914fafa5dded72e6c470d6f764b97fe4d71567dae7cc01d1181b310efd5c37a6',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors',
    filename: 'Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 316822496,
    sha256: '914fafa5dded72e6c470d6f764b97fe4d71567dae7cc01d1181b310efd5c37a6',
  },
}

const wan21T2V14BLightx2vCfgStepDistillLoraRank32Model: HuggingFaceModel = {
  id: -100152,
  name: 'Wan 2.1 T2V 14B LightX2V CFG Step Distill LoRA Rank32',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 T2V 14B lightx2v CFG+步数蒸馏加速 LoRA (rank32)',
  version: wan21T2V14BLightx2vCfgStepDistillLoraRank32Version,
  versions: [wan21T2V14BLightx2vCfgStepDistillLoraRank32Version],
}

// Wan 2.2 Animate 角色替换重打光 LoRA (relighting)
const wanAnimateRelightLoraFp16Version: HuggingFaceVersion = {
  id: -10000253,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_purz_wan22_animate_auto_character_replace-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'fc646c74c73f4b251f5fd9bc440ef21b03b27305f499966c68b2b3aa31498561',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/LoRAs/Wan22_relight/WanAnimate_relight_lora_fp16.safetensors',
    filename: 'WanAnimate_relight_lora_fp16.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 1436672440,
    sha256: 'fc646c74c73f4b251f5fd9bc440ef21b03b27305f499966c68b2b3aa31498561',
  },
}

const wanAnimateRelightLoraFp16Model: HuggingFaceModel = {
  id: -100153,
  name: 'Wan Animate Relight LoRA FP16',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_purz_wan22_animate_auto_character_replace-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.2 Animate 角色替换重打光 LoRA (relighting)',
  version: wanAnimateRelightLoraFp16Version,
  versions: [wanAnimateRelightLoraFp16Version],
}

// Qwen Image 2512 2 步 Turbo 加速 LoRA (Wuli 团队)
const wuliQwenImage2512TurboLoRA2stepsV10Bf16Version: HuggingFaceVersion = {
  id: -10000254,
  name: 'v1.0',
  baseModel: 'Qwen Image 2512',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_2512_with_2steps_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '76b5525a2babb2d96ca1fc37f5616f755cec51e7f71dac59294412f968565193',
  },
  file: {
    url: 'https://huggingface.co/Wuli-art/Qwen-Image-2512-Turbo-LoRA-2-Steps/resolve/main/Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors',
    filename: 'Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 2359534464,
    sha256: '76b5525a2babb2d96ca1fc37f5616f755cec51e7f71dac59294412f968565193',
  },
}

const wuliQwenImage2512TurboLoRA2stepsV10Bf16Model: HuggingFaceModel = {
  id: -100154,
  name: 'Wuli Qwen Image 2512 Turbo LoRA 2steps V1.0 BF16',
  type: 'LORA',
  metrics: {
    downloadCount: 21699,
    thumbsUpCount: 125,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_2512_with_2steps_lora-1.webp', type: 'image' }],
  user: { username: 'Wuli-art' },
  sourceUrl: 'https://huggingface.co/Wuli-art/Qwen-Image-2512-Turbo-LoRA-2-Steps',
  description: 'Qwen Image 2512 2 步 Turbo 加速 LoRA (Wuli 团队)',
  version: wuliQwenImage2512TurboLoRA2stepsV10Bf16Version,
  versions: [wuliQwenImage2512TurboLoRA2stepsV10Bf16Version],
}

// NVIDIA ChronoEdit 图像编辑模型 8 步蒸馏加速 LoRA (基于 Wan 2.1 I2V 14B)
const chronoeditDistillLoraVersion: HuggingFaceVersion = {
  id: -10000255,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v 720p',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '0af09f4b30ffeb8baddb3a18b279707520af89bb16eb9041ad97de432deb24f1',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/chronoedit_distill_lora.safetensors',
    filename: 'chronoedit_distill_lora.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 375905424,
    sha256: '0af09f4b30ffeb8baddb3a18b279707520af89bb16eb9041ad97de432deb24f1',
  },
}

const chronoeditDistillLoraModel: HuggingFaceModel = {
  id: -100155,
  name: 'Chrono Edit Distill LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'NVIDIA ChronoEdit 图像编辑模型 8 步蒸馏加速 LoRA (基于 Wan 2.1 I2V 14B)',
  version: chronoeditDistillLoraVersion,
  versions: [chronoeditDistillLoraVersion],
}

// FLUX.1 depth 深度条件控制 LoRA
const flux1DepthDevLoraVersion: HuggingFaceVersion = {
  id: -10000256,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_depth_lora_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '1938b38ea0fdd98080fa3e48beb2bedfbc7ad102d8b65e6614de704a46d8b907',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/split_files/loras/flux1-depth-dev-lora.safetensors',
    filename: 'flux1-depth-dev-lora.safetensors',
    modelType: 'loras',
    architecture: 'flux',
    sizeBytes: 1244440512,
    sha256: '1938b38ea0fdd98080fa3e48beb2bedfbc7ad102d8b65e6614de704a46d8b907',
  },
}

const flux1DepthDevLoraModel: HuggingFaceModel = {
  id: -100156,
  name: 'Flux.1 Depth Dev LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 399302,
    thumbsUpCount: 650,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux_depth_lora_example-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux1-dev',
  description: 'FLUX.1 depth 深度条件控制 LoRA',
  version: flux1DepthDevLoraVersion,
  versions: [flux1DepthDevLoraVersion],
}

// LTX-2 文本编码器 LoRA (Gemma 3 12B abliterated, rank 64)
const gemma312bItAbliteratedLoraRank64Bf16Version: HuggingFaceVersion = {
  id: -10000257,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '87bcabeac9bec9f374232b5122d6511c2b2112d479e50176149e944b3712eb4a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/loras/gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors',
    filename: 'gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 628203616,
    sha256: '87bcabeac9bec9f374232b5122d6511c2b2112d479e50176149e944b3712eb4a',
  },
}

const gemma312bItAbliteratedLoraRank64Bf16Model: HuggingFaceModel = {
  id: -100157,
  name: 'Gemma 3 12B IT Abliterated LoRA Rank64 BF16',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 142,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2',
  description: 'LTX-2 文本编码器 LoRA (Gemma 3 12B abliterated, rank 64)',
  version: gemma312bItAbliteratedLoraRank64Bf16Version,
  versions: [gemma312bItAbliteratedLoraRank64Bf16Version],
}

// LTX-2.3 搞笑风 LoRA, 给主体贴巨大"金鱼眼"贴纸 (触发词 googlyeyes)
const googlyeyesLtx23Rank32Step03000Version: HuggingFaceVersion = {
  id: -10000258,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '1c661427b2bbe15d7b78a0dedcb262a753e077cbc48b2f4b217ccc3bbb894225',
  },
  file: {
    url: 'https://huggingface.co/TheBurgstall/ltx-2.3-googlyeyes-lora/resolve/main/googlyeyes-ltx-2.3-rank32-step03000.safetensors',
    filename: 'googlyeyes-ltx-2.3-rank32-step03000.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 327287384,
    sha256: '1c661427b2bbe15d7b78a0dedcb262a753e077cbc48b2f4b217ccc3bbb894225',
  },
}

const googlyeyesLtx23Rank32Step03000Model: HuggingFaceModel = {
  id: -100158,
  name: 'googlyeyes-ltx-2.3-rank32-step03000',
  type: 'LORA',
  metrics: {
    downloadCount: 547,
    thumbsUpCount: 10,
  },
  images: [],
  user: { username: 'TheBurgstall' },
  sourceUrl: 'https://huggingface.co/TheBurgstall/ltx-2.3-googlyeyes-lora',
  description: '',
  version: googlyeyesLtx23Rank32Step03000Version,
  versions: [googlyeyesLtx23Rank32Step03000Version],
}

// 软糖(gummy)风格 LoRA, 把物体/动物变成半透明糖霜软糖
const gummycandyQwenVersion: HuggingFaceVersion = {
  id: -10000259,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_sugar_coated_gummy_style_qwen-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e4eafd58dbe861c12f13a45dbd12fed005b2d8d0f1a94f923b4556dc1cb9ddde',
  },
  file: {
    url: 'https://huggingface.co/enigmatic/gummycandy_qwen/resolve/main/gummycandy_qwen.safetensors',
    filename: 'gummycandy_qwen.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 590154464,
    sha256: 'e4eafd58dbe861c12f13a45dbd12fed005b2d8d0f1a94f923b4556dc1cb9ddde',
  },
}

const gummycandyQwenModel: HuggingFaceModel = {
  id: -100159,
  name: 'Gummy Candy Qwen LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 0,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_sugar_coated_gummy_style_qwen-1.webp', type: 'image' }],
  user: { username: 'enigmatic' },
  sourceUrl: 'https://huggingface.co/enigmatic/gummycandy_qwen',
  description: '软糖(gummy)风格 LoRA, 把物体/动物变成半透明糖霜软糖',
  version: gummycandyQwenVersion,
  versions: [gummycandyQwenVersion],
}

// 插画/漫画/动漫综合风格 LoRA (无需触发词)
const illustration10QwenImageVersion: HuggingFaceVersion = {
  id: -10000260,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_qwen_image_illustration_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a196b3f13321edfe116f8b6d0c191f4012dabd4bf83060109aa52ffff3aeaa1c',
  },
  file: {
    url: 'https://huggingface.co/alvdansen/illustration-1.0-qwen-image/resolve/main/illustration-1.0-qwen-image.safetensors',
    filename: 'illustration-1.0-qwen-image.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 774377312,
    sha256: 'a196b3f13321edfe116f8b6d0c191f4012dabd4bf83060109aa52ffff3aeaa1c',
  },
}

const illustration10QwenImageModel: HuggingFaceModel = {
  id: -100160,
  name: 'Illustration 1.0 Qwen Image LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 17,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_qwen_image_illustration_lora-1.webp', type: 'image' }],
  user: { username: 'alvdansen' },
  sourceUrl: 'https://huggingface.co/alvdansen/illustration-1.0-qwen-image',
  description: '插画/漫画/动漫综合风格 LoRA (无需触发词)',
  version: illustration10QwenImageVersion,
  versions: [illustration10QwenImageVersion],
}

// Wan 2.1 T2V 14B lightx2v CFG+步数蒸馏 LoRA (自适应 rank)
const lightx2v14BT2VCfgStepDistillLoraAdaptiveRankQuantile015Bf16Version: HuggingFaceVersion = {
  id: -10000261,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_product_scene_transformation-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2a7e5419ad4a4954eb7344bbdb85a86f1c989534a16fd961e769c4b812612995',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_14B_T2V_cfg_step_distill_lora_adaptive_rank_quantile_0.15_bf16.safetensors',
    filename: 'lightx2v_14B_T2V_cfg_step_distill_lora_adaptive_rank_quantile_0.15_bf16.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 2555119088,
    sha256: '2a7e5419ad4a4954eb7344bbdb85a86f1c989534a16fd961e769c4b812612995',
  },
}

const lightx2v14BT2VCfgStepDistillLoraAdaptiveRankQuantile015Bf16Model: HuggingFaceModel = {
  id: -100161,
  name: 'LightX2V 14B T2V CFG Step Distill LoRA Adaptive Rank Quantile 0.15 BF16',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_product_scene_transformation-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 T2V 14B lightx2v CFG+步数蒸馏 LoRA (自适应 rank)',
  version: lightx2v14BT2VCfgStepDistillLoraAdaptiveRankQuantile015Bf16Version,
  versions: [lightx2v14BT2VCfgStepDistillLoraAdaptiveRankQuantile015Bf16Version],
}

// Wan 2.1 I2V 14B 480p lightx2v CFG+步数蒸馏加速 LoRA (rank128)
const lightx2vI2V14B480pCfgStepDistillRank128Bf16Version: HuggingFaceVersion = {
  id: -10000262,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v 480p',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '5c324ada09cfa447844f5d9a57240463a515de38270ef40c7513d74be3e64e72',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors',
    filename: 'lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 1466506280,
    sha256: '5c324ada09cfa447844f5d9a57240463a515de38270ef40c7513d74be3e64e72',
  },
}

const lightx2vI2V14B480pCfgStepDistillRank128Bf16Model: HuggingFaceModel = {
  id: -100162,
  name: 'LightX2V I2V 14B 480p CFG Step Distill Rank128 BF16 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 I2V 14B 480p lightx2v CFG+步数蒸馏加速 LoRA (rank128)',
  version: lightx2vI2V14B480pCfgStepDistillRank128Bf16Version,
  versions: [lightx2vI2V14B480pCfgStepDistillRank128Bf16Version],
}

// Wan 2.1 I2V 14B 480p lightx2v CFG+步数蒸馏加速 LoRA (rank64)
const lightx2vI2V14B480pCfgStepDistillRank64Bf16Version: HuggingFaceVersion = {
  id: -10000263,
  name: 'v1.0',
  baseModel: 'Wan Video 14B i2v 480p',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_purz_wan22_animate_auto_character_replace-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '85c4a61c30e0497aa44b91d93a893b624708461a56fe5485183b28fa07e2dfb3',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
    filename: 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 738005744,
    sha256: '85c4a61c30e0497aa44b91d93a893b624708461a56fe5485183b28fa07e2dfb3',
  },
}

const lightx2vI2V14B480pCfgStepDistillRank64Bf16Model: HuggingFaceModel = {
  id: -100163,
  name: 'LightX2V I2V 14B 480p CFG Step Distill Rank64 BF16 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_purz_wan22_animate_auto_character_replace-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 I2V 14B 480p lightx2v CFG+步数蒸馏加速 LoRA (rank64)',
  version: lightx2vI2V14B480pCfgStepDistillRank64Bf16Version,
  versions: [lightx2vI2V14B480pCfgStepDistillRank64Bf16Version],
}

// Wan 2.1 T2V 14B lightx2v CFG+步数蒸馏 LoRA v2 (rank64)
const lightx2vT2V14BCfgStepDistillV2LoraRank64Bf16Version: HuggingFaceVersion = {
  id: -10000264,
  name: 'v1.0',
  baseModel: 'Wan Video 14B t2v',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '37d49218544b9e0bfb8e831d1399f451fbc5068aff6474f42a90c928363c3573',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors',
    filename: 'lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 630697104,
    sha256: '37d49218544b9e0bfb8e831d1399f451fbc5068aff6474f42a90c928363c3573',
  },
}

const lightx2vT2V14BCfgStepDistillV2LoraRank64Bf16Model: HuggingFaceModel = {
  id: -100164,
  name: 'LightX2V T2V 14B CFG Step Distill V2 LoRA Rank64 BF16',
  type: 'LORA',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 T2V 14B lightx2v CFG+步数蒸馏 LoRA v2 (rank64)',
  version: lightx2vT2V14BCfgStepDistillV2LoraRank64Bf16Version,
  versions: [lightx2vT2V14BCfgStepDistillV2LoraRank64Bf16Version],
}

// LTX-2 IC-LoRA Canny 边缘结构控制
const ltx219bIcLoraCannyControlVersion: HuggingFaceVersion = {
  id: -10000265,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a95878f53b9fc19e2a3043472f32cc9dd9674b04293abcad4d553fe6114a62e2',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Canny-Control/resolve/main/ltx-2-19b-ic-lora-canny-control.safetensors',
    filename: 'ltx-2-19b-ic-lora-canny-control.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 654465256,
    sha256: 'a95878f53b9fc19e2a3043472f32cc9dd9674b04293abcad4d553fe6114a62e2',
  },
}

const ltx219bIcLoraCannyControlModel: HuggingFaceModel = {
  id: -100165,
  name: 'LTX-2 19B Ic LoRA Canny Control',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 26,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_canny_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Canny-Control',
  description: 'LTX-2 IC-LoRA Canny 边缘结构控制',
  version: ltx219bIcLoraCannyControlVersion,
  versions: [ltx219bIcLoraCannyControlVersion],
}

// LTX-2 IC-LoRA 深度结构控制
const ltx219bIcLoraDepthControlVersion: HuggingFaceVersion = {
  id: -10000266,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_depth_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '16abe99187f46990e60fbd68cc2c23fe77af024b2701963fddba2d37324ed088',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Depth-Control/resolve/main/ltx-2-19b-ic-lora-depth-control.safetensors',
    filename: 'ltx-2-19b-ic-lora-depth-control.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 654465256,
    sha256: '16abe99187f46990e60fbd68cc2c23fe77af024b2701963fddba2d37324ed088',
  },
}

const ltx219bIcLoraDepthControlModel: HuggingFaceModel = {
  id: -100166,
  name: 'LTX-2 19B Ic LoRA Depth Control',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 25,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_depth_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Depth-Control',
  description: 'LTX-2 IC-LoRA 深度结构控制',
  version: ltx219bIcLoraDepthControlVersion,
  versions: [ltx219bIcLoraDepthControlVersion],
}

// LTX-2 IC-LoRA 姿态结构控制
const ltx219bIcLoraPoseControlVersion: HuggingFaceVersion = {
  id: -10000267,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_pose_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '61816bf0985d4470c456160deec65df69188ae45d553e5aa8f1252fc543bc8aa',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Pose-Control/resolve/main/ltx-2-19b-ic-lora-pose-control.safetensors',
    filename: 'ltx-2-19b-ic-lora-pose-control.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 654465256,
    sha256: '61816bf0985d4470c456160deec65df69188ae45d553e5aa8f1252fc543bc8aa',
  },
}

const ltx219bIcLoraPoseControlModel: HuggingFaceModel = {
  id: -100167,
  name: 'LTX-2 19B Ic LoRA Pose Control',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 32,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_pose_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Pose-Control',
  description: 'LTX-2 IC-LoRA 姿态结构控制',
  version: ltx219bIcLoraPoseControlVersion,
  versions: [ltx219bIcLoraPoseControlVersion],
}

// LTX-2 镜头运动控制 LoRA (Dolly Left 左移)
const ltx219bLoraCameraControlDollyLeftVersion: HuggingFaceVersion = {
  id: -10000268,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_i2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'fdd28ee1a53e5413d74b90064c7ec0fe98b78457b5da06c0c9c4ea5810d1f5f6',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Left/resolve/main/ltx-2-19b-lora-camera-control-dolly-left.safetensors',
    filename: 'ltx-2-19b-lora-camera-control-dolly-left.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 327309208,
    sha256: 'fdd28ee1a53e5413d74b90064c7ec0fe98b78457b5da06c0c9c4ea5810d1f5f6',
  },
}

const ltx219bLoraCameraControlDollyLeftModel: HuggingFaceModel = {
  id: -100168,
  name: 'LTX-2 19B LoRA Camera Control Dolly Left',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 13,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_i2v-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Dolly-Left',
  description: 'LTX-2 镜头运动控制 LoRA (Dolly Left 左移)',
  version: ltx219bLoraCameraControlDollyLeftVersion,
  versions: [ltx219bLoraCameraControlDollyLeftVersion],
}

// LTX-2.3 蒸馏 LoRA v1.1 (8 步, CFG=1)
const ltx2322bDistilledLora38411Version: HuggingFaceVersion = {
  id: -10000269,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_obscura_remova_lora_remove_object_from_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f5d4953f3386197a4b4f5abdb17616ff256171e8075c111d6e7d2dfa6e823b3a',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled-lora-384-1.1.safetensors',
    filename: 'ltx-2.3-22b-distilled-lora-384-1.1.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 7605507256,
    sha256: 'f5d4953f3386197a4b4f5abdb17616ff256171e8075c111d6e7d2dfa6e823b3a',
  },
}

const ltx2322bDistilledLora38411Model: HuggingFaceModel = {
  id: -100169,
  name: 'LTX-2.3 22B Distilled LoRA 384 1.1',
  type: 'LORA',
  metrics: {
    downloadCount: 1884441,
    thumbsUpCount: 1761,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_obscura_remova_lora_remove_object_from_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2.3',
  description: 'LTX-2.3 蒸馏 LoRA v1.1 (8 步, CFG=1)',
  version: ltx2322bDistilledLora38411Version,
  versions: [ltx2322bDistilledLora38411Version],
}

// LTX-2.3 蒸馏 LoRA (8 步, CFG=1)
const ltx2322bDistilledLora384Version: HuggingFaceVersion = {
  id: -10000270,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2943ab994f3c9d88052e5a2a34cca14e4a2dfc36b1d8c407931d52d5c25dd72b',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled-lora-384.safetensors',
    filename: 'ltx-2.3-22b-distilled-lora-384.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 7605507256,
    sha256: '2943ab994f3c9d88052e5a2a34cca14e4a2dfc36b1d8c407931d52d5c25dd72b',
  },
}

const ltx2322bDistilledLora384Model: HuggingFaceModel = {
  id: -100170,
  name: 'LTX-2.3 22B Distilled LoRA 384',
  type: 'LORA',
  metrics: {
    downloadCount: 1884441,
    thumbsUpCount: 1761,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2.3',
  description: 'LTX-2.3 蒸馏 LoRA (8 步, CFG=1)',
  version: ltx2322bDistilledLora384Version,
  versions: [ltx2322bDistilledLora384Version],
}

// LTX-2.3 IC-LoRA 视频画布外扩 (outpaint, 黑色区域填充)
const ltx2322bIcLoraOutpaintVersion: HuggingFaceVersion = {
  id: -10000271,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_lora_video_outpainting-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '32c5d3e0649aa4e89b192319f3c79460dfd2319d2859ca11fa6f88e983a81665',
  },
  file: {
    url: 'https://huggingface.co/oumoumad/LTX-2.3-22b-IC-LoRA-Outpaint/resolve/main/ltx-2.3-22b-ic-lora-outpaint.safetensors',
    filename: 'ltx-2.3-22b-ic-lora-outpaint.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 1308756416,
    sha256: '32c5d3e0649aa4e89b192319f3c79460dfd2319d2859ca11fa6f88e983a81665',
  },
}

const ltx2322bIcLoraOutpaintModel: HuggingFaceModel = {
  id: -100171,
  name: 'LTX-2.3 22B Ic LoRA Outpaint',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 103,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_lora_video_outpainting-1.webp', type: 'image' }],
  user: { username: 'oumoumad' },
  sourceUrl: 'https://huggingface.co/oumoumad/LTX-2.3-22b-IC-LoRA-Outpaint',
  description: 'LTX-2.3 IC-LoRA 视频画布外扩 (outpaint, 黑色区域填充)',
  version: ltx2322bIcLoraOutpaintVersion,
  versions: [ltx2322bIcLoraOutpaintVersion],
}

// LTX-2.3 IC-LoRA 统一结构控制 (canny+depth+pose, 参考降采样 0.5)
const ltx2322bIcLoraUnionControlRef05Version: HuggingFaceVersion = {
  id: -10000272,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_3_ic_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a1b888a87f661d27f08b394ae559e8e1050be33900bcc36a5cdf659e48f88d18',
  },
  file: {
    url: 'https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control/resolve/main/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors',
    filename: 'ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 654465352,
    sha256: 'a1b888a87f661d27f08b394ae559e8e1050be33900bcc36a5cdf659e48f88d18',
  },
}

const ltx2322bIcLoraUnionControlRef05Model: HuggingFaceModel = {
  id: -100172,
  name: 'LTX-2.3 22B Ic LoRA Union Control Ref0.5',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 100,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_3_ic_lora-1.webp', type: 'image' }],
  user: { username: 'Lightricks' },
  sourceUrl: 'https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control',
  description: 'LTX-2.3 IC-LoRA 统一结构控制 (canny+depth+pose, 参考降采样 0.5)',
  version: ltx2322bIcLoraUnionControlRef05Version,
  versions: [ltx2322bIcLoraUnionControlRef05Version],
}

// LTX-2.3 人物身份保持 LoRA (TalkVid-3K, 说话/口播场景)
const ltx23IdLoraTalkvid3kVersion: HuggingFaceVersion = {
  id: -10000273,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e5af73441743b4852f228b03e444888dff3da80d2666033af2367ab7bda6d8b9',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx-2.3-id-lora-talkvid-3k.safetensors',
    filename: 'ltx-2.3-id-lora-talkvid-3k.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 1157884304,
    sha256: 'e5af73441743b4852f228b03e444888dff3da80d2666033af2367ab7bda6d8b9',
  },
}

const ltx23IdLoraTalkvid3kModel: HuggingFaceModel = {
  id: -100173,
  name: 'LTX-2.3 Id LoRA TalkVid 3k',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 36,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2.3',
  description: 'LTX-2.3 人物身份保持 LoRA (TalkVid-3K, 说话/口播场景)',
  version: ltx23IdLoraTalkvid3kVersion,
  versions: [ltx23IdLoraTalkvid3kVersion],
}

// LTX-2 挤压变形风格 LoRA (触发词 "squish it")
const ltx2SquishVersion: HuggingFaceVersion = {
  id: -10000274,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_i2v_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '5ea13df1478ccc8cf6022a1e4671c7da4d3f503fd1dc25d887f827d6de527208',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/loras/ltx2-squish.safetensors',
    filename: 'ltx2-squish.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 428150664,
    sha256: '5ea13df1478ccc8cf6022a1e4671c7da4d3f503fd1dc25d887f827d6de527208',
  },
}

const ltx2SquishModel: HuggingFaceModel = {
  id: -100174,
  name: 'LTX-2 Squish LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 142,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_i2v_lora-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2',
  description: 'LTX-2 挤压变形风格 LoRA (触发词 "squish it")',
  version: ltx2SquishVersion,
  versions: [ltx2SquishVersion],
}

// LTX-2.3 场景/角色转场变形 LoRA (触发词 zhuanchang)
const ltx23TransitionVersion: HuggingFaceVersion = {
  id: -10000275,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_style_transition-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ba420d6fefafced8e317e2d6ff951b312b52f534377d016b491877a00b830d33',
  },
  file: {
    url: 'https://huggingface.co/valiantcat/LTX-2.3-Transition-LORA/resolve/main/ltx2.3-transition.safetensors',
    filename: 'ltx2.3-transition.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 390229424,
    sha256: 'ba420d6fefafced8e317e2d6ff951b312b52f534377d016b491877a00b830d33',
  },
}

const ltx23TransitionModel: HuggingFaceModel = {
  id: -100175,
  name: 'LTX-2.3 Transition LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 25264,
    thumbsUpCount: 161,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_style_transition-1.webp', type: 'image' }],
  user: { username: 'joyfox' },
  sourceUrl: 'https://huggingface.co/valiantcat/LTX-2.3-Transition-LORA',
  description: 'LTX-2.3 场景/角色转场变形 LoRA (触发词 zhuanchang)',
  version: ltx23TransitionVersion,
  versions: [ltx23TransitionVersion],
}

// LTX-2.3 蒸馏 LoRA v1.1 (动态 rank, 平均 111, bf16)
const ltx2322bDistilled11LoraDynamicFro09AvgRank111Bf16Version: HuggingFaceVersion = {
  id: -10000276,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_3_i2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '31e0c0195fb841bf31af78e8b60858f489e87ddcea4a5239abc80943da65e3ac',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors',
    filename: 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors',
    modelType: 'loras',
    architecture: 'ltxv',
    sizeBytes: 2741024390,
    sha256: '31e0c0195fb841bf31af78e8b60858f489e87ddcea4a5239abc80943da65e3ac',
  },
}

const ltx2322bDistilled11LoraDynamicFro09AvgRank111Bf16Model: HuggingFaceModel = {
  id: -100176,
  name: 'LTX-2.3 22B Distilled 1.1 LoRA Dynamic Fro09 Avg Rank 111 BF16',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 36,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx2_3_i2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2.3',
  description: 'LTX-2.3 蒸馏 LoRA v1.1 (动态 rank, 平均 111, bf16)',
  version: ltx2322bDistilled11LoraDynamicFro09AvgRank111Bf16Version,
  versions: [ltx2322bDistilled11LoraDynamicFro09AvgRank111Bf16Version],
}

// Z-Image Turbo 像素画风格 LoRA (触发词 "Pixel art style.")
const pixelArtStyleZImageTurboVersion: HuggingFaceVersion = {
  id: -10000277,
  name: 'v1.0',
  baseModel: 'ZImageTurbo',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/basic_switch_node-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '09b1b45ceed0202929bca528e51b50208d0160f4e9d2ba0f42cb7e739a43577f',
  },
  file: {
    url: 'https://huggingface.co/tarn59/pixel_art_style_lora_z_image_turbo/resolve/main/pixel_art_style_z_image_turbo.safetensors',
    filename: 'pixel_art_style_z_image_turbo.safetensors',
    modelType: 'loras',
    architecture: 'zimage',
    sizeBytes: 170128328,
    sha256: '09b1b45ceed0202929bca528e51b50208d0160f4e9d2ba0f42cb7e739a43577f',
  },
}

const pixelArtStyleZImageTurboModel: HuggingFaceModel = {
  id: -100177,
  name: 'Pixel Art Style Z-Image Turbo LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 13417,
    thumbsUpCount: 51,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/basic_switch_node-1.webp', type: 'image' }],
  user: { username: 'tarn59' },
  sourceUrl: 'https://huggingface.co/tarn59/pixel_art_style_lora_z_image_turbo',
  description: 'Z-Image Turbo 像素画风格 LoRA (触发词 "Pixel art style.")',
  version: pixelArtStyleZImageTurboVersion,
  versions: [pixelArtStyleZImageTurboVersion],
}

// 360° 全景 equirectangular 生成 LoRA (基于 Qwen Image 2512, rank128)
const qwen360Diffusion2512Int8Bf16V2Version: HuggingFaceVersion = {
  id: -10000278,
  name: 'v1.0',
  baseModel: 'Qwen Image 2512',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_qwen_Image_2512_360_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '11065421c2a4c8f503ee1be5d6dc0320a9ffb5bfaded2490813046fd2312578d',
  },
  file: {
    url: 'https://huggingface.co/ProGamerGov/qwen-360-diffusion/resolve/main/qwen-360-diffusion-2512-int8-bf16-v2.safetensors',
    filename: 'qwen-360-diffusion-2512-int8-bf16-v2.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 755039336,
    sha256: '11065421c2a4c8f503ee1be5d6dc0320a9ffb5bfaded2490813046fd2312578d',
  },
}

const qwen360Diffusion2512Int8Bf16V2Model: HuggingFaceModel = {
  id: -100178,
  name: 'Qwen 360 Diffusion 2512 INT8 BF16 V2 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 9726,
    thumbsUpCount: 54,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_qwen_Image_2512_360_lora-1.webp', type: 'image' }],
  user: { username: 'ProGamerGov' },
  sourceUrl: 'https://huggingface.co/ProGamerGov/qwen-360-diffusion',
  description: '360° 全景 equirectangular 生成 LoRA (基于 Qwen Image 2512, rank128)',
  version: qwen360Diffusion2512Int8Bf16V2Version,
  versions: [qwen360Diffusion2512Int8Bf16V2Version],
}

// 多角度相机控制 LoRA (fal, 96 机位, 触发词 <sks> 方位词)
const qwenImageEdit2511MultipleAnglesLoraVersion: HuggingFaceVersion = {
  id: -10000279,
  name: 'v1.0',
  baseModel: 'Qwen Image Edit 2511',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '42426ded4e25fd22879d9e198b857556445ef4ca56e8da3246d0345155bb6765',
  },
  file: {
    url: 'https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA/resolve/main/qwen-image-edit-2511-multiple-angles-lora.safetensors',
    filename: 'qwen-image-edit-2511-multiple-angles-lora.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 295140688,
    sha256: '42426ded4e25fd22879d9e198b857556445ef4ca56e8da3246d0345155bb6765',
  },
}

const qwenImageEdit2511MultipleAnglesLoraModel: HuggingFaceModel = {
  id: -100179,
  name: 'Qwen Image Edit 2511 Multiple Angles LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 59806,
    thumbsUpCount: 1497,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  user: { username: 'fal' },
  sourceUrl: 'https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA',
  description: '多角度相机控制 LoRA (fal, 96 机位, 触发词 <sks> 方位词)',
  version: qwenImageEdit2511MultipleAnglesLoraVersion,
  versions: [qwenImageEdit2511MultipleAnglesLoraVersion],
}

// Qwen Image 统一结构控制 LoRA (canny/depth/pose/lineart/softedge/normal/openpose)
const qwenImageUnionDiffsynthLoraVersion: HuggingFaceVersion = {
  id: -10000280,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_union_control_lora-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8683edcfe741277155989d505995314e0191c21b77c67a0dbc2980103bddbdd5',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-DiffSynth-ControlNets/resolve/main/split_files/loras/qwen_image_union_diffsynth_lora.safetensors',
    filename: 'qwen_image_union_diffsynth_lora.safetensors',
    modelType: 'loras',
    architecture: 'qwen',
    sizeBytes: 943906720,
    sha256: '8683edcfe741277155989d505995314e0191c21b77c67a0dbc2980103bddbdd5',
  },
}

const qwenImageUnionDiffsynthLoraModel: HuggingFaceModel = {
  id: -100180,
  name: 'Qwen Image Union DiffSynth LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 20020,
    thumbsUpCount: 78,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_union_control_lora-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-DiffSynth-ControlNets',
  description: 'Qwen Image 统一结构控制 LoRA (canny/depth/pose/lineart/softedge/normal/openpose)',
  version: qwenImageUnionDiffsynthLoraVersion,
  versions: [qwenImageUnionDiffsynthLoraVersion],
}

// Flux Fill 物体移除 LoRA (Object Removal v2.0, 需遮罩, 非商用)
const removalTimestepAlpha21740Version: HuggingFaceVersion = {
  id: -10000281,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux.1_fill_dev_OneReward-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9a51336bca7c6cf85a611209c4b01977a55c2add16ec4d0de2d3d7a2e00aa0fd',
  },
  file: {
    url: 'https://huggingface.co/lrzjason/ObjectRemovalFluxFill/resolve/main/removal_timestep_alpha-2-1740.safetensors',
    filename: 'removal_timestep_alpha-2-1740.safetensors',
    modelType: 'loras',
    architecture: 'flux',
    sizeBytes: 89746016,
    sha256: '9a51336bca7c6cf85a611209c4b01977a55c2add16ec4d0de2d3d7a2e00aa0fd',
  },
}

const removalTimestepAlpha21740Model: HuggingFaceModel = {
  id: -100181,
  name: 'Removal Timestep Alpha 2 1740 LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 80,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux.1_fill_dev_OneReward-1.webp', type: 'image' }],
  user: { username: 'lrzjason' },
  sourceUrl: 'https://huggingface.co/lrzjason/ObjectRemovalFluxFill',
  description: 'Flux Fill 物体移除 LoRA (Object Removal v2.0, 需遮罩, 非商用)',
  version: removalTimestepAlpha21740Version,
  versions: [removalTimestepAlpha21740Version],
}

// 字节跳动 USO 统一风格/主体定制 LoRA (需配合 projector model patch)
const usoFlux1DitLoraV1Version: HuggingFaceVersion = {
  id: -10000282,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_dev_uso_reference_image_gen-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a03fa8430997f1c371c2471b133bdc03433a50564e0a29c096217077b0309e41',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/USO_1.0_Repackaged/resolve/main/split_files/loras/uso-flux1-dit-lora-v1.safetensors',
    filename: 'uso-flux1-dit-lora-v1.safetensors',
    modelType: 'loras',
    architecture: 'flux',
    sizeBytes: 478187816,
    sha256: 'a03fa8430997f1c371c2471b133bdc03433a50564e0a29c096217077b0309e41',
  },
}

const usoFlux1DitLoraV1Model: HuggingFaceModel = {
  id: -100182,
  name: 'Uso Flux.1 Dit LoRA V1',
  type: 'LORA',
  metrics: {
    downloadCount: 29216,
    thumbsUpCount: 18,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_dev_uso_reference_image_gen-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/USO_1.0_Repackaged',
  description: '字节跳动 USO 统一风格/主体定制 LoRA (需配合 projector model patch)',
  version: usoFlux1DitLoraV1Version,
  versions: [usoFlux1DitLoraV1Version],
}

// Wan 2.2 i2v 4 步蒸馏 LoRA (high noise, rank64, lightx2v)
const wan22I2vA14bHighNoiseLoraRank64Lightx2v4step1022Version: HuggingFaceVersion = {
  id: -10000283,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_mjm_airt_machIne-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '887c3bdeb74e83859c920438e16ca31f39ab18ce189abc5f0e36f8348c5bbb19',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/resolve/main/wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors',
    filename: 'wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 634645944,
    sha256: '887c3bdeb74e83859c920438e16ca31f39ab18ce189abc5f0e36f8348c5bbb19',
  },
}

const wan22I2vA14bHighNoiseLoraRank64Lightx2v4step1022Model: HuggingFaceModel = {
  id: -100183,
  name: 'Wan 2.2 I2V A14b High Noise LoRA Rank64 LightX2V 4step 1022',
  type: 'LORA',
  metrics: {
    downloadCount: 200994,
    thumbsUpCount: 275,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_mjm_airt_machIne-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Wan2.2-Distill-Loras',
  description: 'Wan 2.2 i2v 4 步蒸馏 LoRA (high noise, rank64, lightx2v)',
  version: wan22I2vA14bHighNoiseLoraRank64Lightx2v4step1022Version,
  versions: [wan22I2vA14bHighNoiseLoraRank64Lightx2v4step1022Version],
}

// Wan 2.2 i2v 4 步蒸馏 LoRA (low noise, rank64, lightx2v)
const wan22I2vA14bLowNoiseLoraRank64Lightx2v4step1022Version: HuggingFaceVersion = {
  id: -10000284,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_mjm_airt_machIne-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8833bd4fd7c8eabebf0bc8ee5cfaf47f4f310ce116928a02c1adf8941dd4b0f1',
  },
  file: {
    url: 'https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/resolve/main/wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors',
    filename: 'wan2.2_i2v_A14b_low_noise_lora_rank64_lightx2v_4step_1022.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 739472104,
    sha256: '8833bd4fd7c8eabebf0bc8ee5cfaf47f4f310ce116928a02c1adf8941dd4b0f1',
  },
}

const wan22I2vA14bLowNoiseLoraRank64Lightx2v4step1022Model: HuggingFaceModel = {
  id: -100184,
  name: 'Wan 2.2 I2V A14b Low Noise LoRA Rank64 LightX2V 4step 1022',
  type: 'LORA',
  metrics: {
    downloadCount: 200994,
    thumbsUpCount: 275,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_mjm_airt_machIne-1.webp', type: 'image' }],
  user: { username: 'lightx2v' },
  sourceUrl: 'https://huggingface.co/lightx2v/Wan2.2-Distill-Loras',
  description: 'Wan 2.2 i2v 4 步蒸馏 LoRA (low noise, rank64, lightx2v)',
  version: wan22I2vA14bLowNoiseLoraRank64Lightx2v4step1022Version,
  versions: [wan22I2vA14bLowNoiseLoraRank64Lightx2v4step1022Version],
}

// Wan 2.2 i2v 4 步加速 LoRA (low noise, ComfyUI 官方 repackaged)
const wan22I2vLightx2v4stepsLoraV1LowNoiseVersion: HuggingFaceVersion = {
  id: -10000285,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 I2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '024f21de095bc8fad9809ded3e9e49a2e170dcf27075da8145ba7d60d8aab7f9',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    filename: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    modelType: 'loras',
    architecture: 'wan22_i2v',
    sizeBytes: 1226977424,
    sha256: '024f21de095bc8fad9809ded3e9e49a2e170dcf27075da8145ba7d60d8aab7f9',
  },
}

const wan22I2vLightx2v4stepsLoraV1LowNoiseModel: HuggingFaceModel = {
  id: -100185,
  name: 'Wan 2.2 I2V LightX2V 4steps LoRA V1 Low Noise',
  type: 'LORA',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_rob_split_stack_qwen_multi_wan22-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 i2v 4 步加速 LoRA (low noise, ComfyUI 官方 repackaged)',
  version: wan22I2vLightx2v4stepsLoraV1LowNoiseVersion,
  versions: [wan22I2vLightx2v4stepsLoraV1LowNoiseVersion],
}

// Wan 2.2 t2v 4 步加速 LoRA v1.1 (high noise)
const wan22T2vLightx2v4stepsLoraV11HighNoiseVersion: HuggingFaceVersion = {
  id: -10000286,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 T2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_s2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '698321cb86bd30c4af06c9b84e656a1048c8cb54e06d50694536fb5de37fde41',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    filename: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    modelType: 'loras',
    architecture: 'wan22_t2v',
    sizeBytes: 1226977424,
    sha256: '698321cb86bd30c4af06c9b84e656a1048c8cb54e06d50694536fb5de37fde41',
  },
}

const wan22T2vLightx2v4stepsLoraV11HighNoiseModel: HuggingFaceModel = {
  id: -100186,
  name: 'Wan 2.2 T2V LightX2V 4steps LoRA V1.1 High Noise',
  type: 'LORA',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_s2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 t2v 4 步加速 LoRA v1.1 (high noise)',
  version: wan22T2vLightx2v4stepsLoraV11HighNoiseVersion,
  versions: [wan22T2vLightx2v4stepsLoraV11HighNoiseVersion],
}

// Wan 2.2 t2v 4 步加速 LoRA v1.1 (low noise)
const wan22T2vLightx2v4stepsLoraV11LowNoiseVersion: HuggingFaceVersion = {
  id: -10000287,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2 T2V-A14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_t2v-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ec95216e614b3c132c11bfb387b11feedf62163150ccc9068bca8a189771e75a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
    filename: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
    modelType: 'loras',
    architecture: 'wan22_t2v',
    sizeBytes: 1226977424,
    sha256: 'ec95216e614b3c132c11bfb387b11feedf62163150ccc9068bca8a189771e75a',
  },
}

const wan22T2vLightx2v4stepsLoraV11LowNoiseModel: HuggingFaceModel = {
  id: -100187,
  name: 'Wan 2.2 T2V LightX2V 4steps LoRA V1.1 Low Noise',
  type: 'LORA',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_t2v-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 t2v 4 步加速 LoRA v1.1 (low noise)',
  version: wan22T2vLightx2v4stepsLoraV11LowNoiseVersion,
  versions: [wan22T2vLightx2v4stepsLoraV11LowNoiseVersion],
}

// Wan 2.1 A14B RGBA 透明通道(alpha)生成 LoRA
const wanAlpha21RgbaLoraVersion: HuggingFaceVersion = {
  id: -10000288,
  name: 'v1.0',
  baseModel: 'Wan Video 14B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '45d6347c4ff6ea975a43ef447eeb1e73d313224601350899369cc3fec1709931',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/loras/wan_alpha_2.1_rgba_lora.safetensors',
    filename: 'wan_alpha_2.1_rgba_lora.safetensors',
    modelType: 'loras',
    architecture: 'wan21',
    sizeBytes: 311648408,
    sha256: '45d6347c4ff6ea975a43ef447eeb1e73d313224601350899369cc3fec1709931',
  },
}

const wanAlpha21RgbaLoraModel: HuggingFaceModel = {
  id: -100188,
  name: 'Wan Alpha 2.1 RGBA LoRA',
  type: 'LORA',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 A14B RGBA 透明通道(alpha)生成 LoRA',
  version: wanAlpha21RgbaLoraVersion,
  versions: [wanAlpha21RgbaLoraVersion],
}
// ── controlnet ───────────────────────────────────────────────────────────────

// Qwen-Image-2512 的 Fun Union ControlNet (Canny/HED/Depth/Pose/MLSD/Scribble/Gray)
const qwenImage2512FunControlnetUnion2602Version: HuggingFaceVersion = {
  id: -10000289,
  name: 'v1.0',
  baseModel: 'Qwen Image 2512',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512_controlnet-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '0d1ac366efaa27dec070b3a8ebe9a41b5ebc567913dee71ed992e7032f66dc37',
  },
  file: {
    url: 'https://huggingface.co/alibaba-pai/Qwen-Image-2512-Fun-Controlnet-Union/resolve/main/Qwen-Image-2512-Fun-Controlnet-Union-2602.safetensors',
    filename: 'Qwen-Image-2512-Fun-Controlnet-Union-2602.safetensors',
    modelType: 'controlnet',
    architecture: 'qwen',
    sizeBytes: 3512432536,
    sha256: '0d1ac366efaa27dec070b3a8ebe9a41b5ebc567913dee71ed992e7032f66dc37',
  },
}

const qwenImage2512FunControlnetUnion2602Model: HuggingFaceModel = {
  id: -100189,
  name: 'Qwen Image 2512 Fun Controlnet Union 2602',
  type: 'ControlNet',
  metrics: {
    downloadCount: 12190,
    thumbsUpCount: 52,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_Image_2512_controlnet-1.webp', type: 'image' }],
  user: { username: 'alibaba-pai' },
  sourceUrl: 'https://huggingface.co/alibaba-pai/Qwen-Image-2512-Fun-Controlnet-Union',
  description: 'Qwen-Image-2512 的 Fun Union ControlNet (Canny/HED/Depth/Pose/MLSD/Scribble/Gray)',
  version: qwenImage2512FunControlnetUnion2602Version,
  versions: [qwenImage2512FunControlnetUnion2602Version],
}

// Qwen-Image 的 InstantX ControlNet (Inpainting 重绘)
const qwenImageInstantXControlNetInpaintingVersion: HuggingFaceVersion = {
  id: -10000290,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_instantx_inpainting_controlnet-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '49c01aafe6545c1f6e7627a724c8fb13357fe74efee235622158f0a8f30e5458',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-InstantX-ControlNets/resolve/main/split_files/controlnet/Qwen-Image-InstantX-ControlNet-Inpainting.safetensors',
    filename: 'Qwen-Image-InstantX-ControlNet-Inpainting.safetensors',
    modelType: 'controlnet',
    architecture: 'qwen',
    sizeBytes: 4234599432,
    sha256: '49c01aafe6545c1f6e7627a724c8fb13357fe74efee235622158f0a8f30e5458',
  },
}

const qwenImageInstantXControlNetInpaintingModel: HuggingFaceModel = {
  id: -100190,
  name: 'Qwen Image InstantX ControlNet Inpainting',
  type: 'ControlNet',
  metrics: {
    downloadCount: 28872,
    thumbsUpCount: 40,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_instantx_inpainting_controlnet-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-InstantX-ControlNets',
  description: 'Qwen-Image 的 InstantX ControlNet (Inpainting 重绘)',
  version: qwenImageInstantXControlNetInpaintingVersion,
  versions: [qwenImageInstantXControlNetInpaintingVersion],
}

// Qwen-Image 的 InstantX Union ControlNet (多条件统一)
const qwenImageInstantXControlNetUnionVersion: HuggingFaceVersion = {
  id: -10000291,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_instantx_controlnet-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd51dca0073366a675108d5b83c3b7ef941cf2214c9a1c95c23f1e9a228ddbdb0',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-InstantX-ControlNets/resolve/main/split_files/controlnet/Qwen-Image-InstantX-ControlNet-Union.safetensors',
    filename: 'Qwen-Image-InstantX-ControlNet-Union.safetensors',
    modelType: 'controlnet',
    architecture: 'qwen',
    sizeBytes: 3536027816,
    sha256: 'd51dca0073366a675108d5b83c3b7ef941cf2214c9a1c95c23f1e9a228ddbdb0',
  },
}

const qwenImageInstantXControlNetUnionModel: HuggingFaceModel = {
  id: -100191,
  name: 'Qwen Image InstantX ControlNet Union',
  type: 'ControlNet',
  metrics: {
    downloadCount: 28872,
    thumbsUpCount: 40,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_instantx_controlnet-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-InstantX-ControlNets',
  description: 'Qwen-Image 的 InstantX Union ControlNet (多条件统一)',
  version: qwenImageInstantXControlNetUnionVersion,
  versions: [qwenImageInstantXControlNetUnionVersion],
}

// SD 3.5 Large 的模糊 ControlNet
const sd35LargeControlnetBlurVersion: HuggingFaceVersion = {
  id: -10000292,
  name: 'v1.0',
  baseModel: 'SD 3.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_blur-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '43d71c6f570d93e04a2d00711c530c74dcd7eef5d322efaab967c2d8296854dc',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-controlnets_ComfyUI_repackaged/resolve/main/split_files/controlnet/sd3.5_large_controlnet_blur.safetensors',
    filename: 'sd3.5_large_controlnet_blur.safetensors',
    modelType: 'controlnet',
    architecture: 'sd3',
    sizeBytes: 8654590644,
    sha256: '43d71c6f570d93e04a2d00711c530c74dcd7eef5d322efaab967c2d8296854dc',
  },
}

const sd35LargeControlnetBlurModel: HuggingFaceModel = {
  id: -100192,
  name: 'SD 3.5 Large Controlnet Blur',
  type: 'ControlNet',
  metrics: {
    downloadCount: 7034,
    thumbsUpCount: 4,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/sd3.5_large_blur-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/stable-diffusion-3.5-controlnets_ComfyUI_repackaged',
  description: 'SD 3.5 Large 的模糊 ControlNet',
  version: sd35LargeControlnetBlurVersion,
  versions: [sd35LargeControlnetBlurVersion],
}
// ── vae ──────────────────────────────────────────────────────────────────────

// Wan 2.1 官方 VAE (fp32 版), 精度更高但体积更大
const wan21VAEFp32Version: HuggingFaceVersion = {
  id: -10000293,
  name: 'v1.0',
  baseModel: 'Wan Video 2.1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_ingi_infl8-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'fd1531e31cdd20af005a9fb66e69afe4ea481a6db9b07cd889ece2e1ca2e67b9',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_fp32.safetensors',
    filename: 'Wan2_1_VAE_fp32.safetensors',
    modelType: 'vae',
    architecture: 'wan21',
    sizeBytes: 507591244,
    sha256: 'fd1531e31cdd20af005a9fb66e69afe4ea481a6db9b07cd889ece2e1ca2e67b9',
  },
}

const wan21VAEFp32Model: HuggingFaceModel = {
  id: -100193,
  name: 'Wan 2.1 VAE FP32',
  type: 'VAE',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_ingi_infl8-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'Wan 2.1 官方 VAE (fp32 版), 精度更高但体积更大',
  version: wan21VAEFp32Version,
  versions: [wan21VAEFp32Version],
}

// Ace-Step 1.5 音乐生成模型的音频 VAE
const ace15VaeVersion: HuggingFaceVersion = {
  id: -10000294,
  name: 'v1.0',
  baseModel: 'Ace Step',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '6de92e3a862acd287e08b024ac90f0783a8635451b728721a33ff03565bcb2bb',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/vae/ace_1.5_vae.safetensors',
    filename: 'ace_1.5_vae.safetensors',
    modelType: 'vae',
    architecture: 'acestep',
    sizeBytes: 337431732,
    sha256: '6de92e3a862acd287e08b024ac90f0783a8635451b728721a33ff03565bcb2bb',
  },
}

const ace15VaeModel: HuggingFaceModel = {
  id: -100194,
  name: 'ACE 1.5 VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'Ace-Step 1.5 音乐生成模型的音频 VAE',
  version: ace15VaeVersion,
  versions: [ace15VaeVersion],
}

// VOID 视频抠除模型 (基于 CogVideoX-2b) 的 VAE
const cogvideoxVaeVersion: HuggingFaceVersion = {
  id: -10000295,
  name: 'v1.0',
  baseModel: 'CogVideoX',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_void_video_inpainting-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'bd47d57ad948ff80da0af0cb2e4dcdef65073aba59bccfd383ada9a7d1c02024',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/void-model/resolve/main/vae/cogvideox_vae.safetensors',
    filename: 'cogvideox_vae.safetensors',
    modelType: 'vae',
    architecture: 'cogvideox',
    sizeBytes: 431221142,
    sha256: 'bd47d57ad948ff80da0af0cb2e4dcdef65073aba59bccfd383ada9a7d1c02024',
  },
}

const cogvideoxVaeModel: HuggingFaceModel = {
  id: -100195,
  name: 'CogVideoX VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 24,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_void_video_inpainting-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/void-model',
  description: 'VOID 视频抠除模型 (基于 CogVideoX-2b) 的 VAE',
  version: cogvideoxVaeVersion,
  versions: [cogvideoxVaeVersion],
}

// FLUX.2 系列专用的 Tripo VAE (也用于 TripoSplat 3D 管线)
const flux2VaeVersion: HuggingFaceVersion = {
  id: -10000296,
  name: 'v1.0',
  baseModel: 'Flux.2 Dev',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_triposplat_image_to_gaussian_splat-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'd64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5',
  },
  file: {
    url: 'https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/flux2-vae.safetensors',
    filename: 'flux2-vae.safetensors',
    modelType: 'vae',
    architecture: 'flux2',
    sizeBytes: 336213556,
    sha256: 'd64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5',
  },
}

const flux2VaeModel: HuggingFaceModel = {
  id: -100196,
  name: 'Flux.2 VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 112,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_triposplat_image_to_gaussian_splat-1.webp', type: 'image' }],
  user: { username: 'VAST-AI' },
  sourceUrl: 'https://huggingface.co/VAST-AI/TripoSplat',
  description: 'FLUX.2 系列专用的 Tripo VAE (也用于 TripoSplat 3D 管线)',
  version: flux2VaeVersion,
  versions: [flux2VaeVersion],
}

// FLUX.2 Small Decoder — 蒸馏版小解码器 VAE (解码更快、省显存)
const fullEncoderSmallDecoderVersion: HuggingFaceVersion = {
  id: -10000297,
  name: 'v1.0',
  baseModel: 'Flux.2 Dev',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62',
  },
  file: {
    url: 'https://huggingface.co/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors',
    filename: 'full_encoder_small_decoder.safetensors',
    modelType: 'vae',
    architecture: 'flux2',
    sizeBytes: 249519092,
    sha256: 'ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62',
  },
}

const fullEncoderSmallDecoderModel: HuggingFaceModel = {
  id: -100197,
  name: 'Full Encoder Small Decoder',
  type: 'VAE',
  metrics: {
    downloadCount: 200507,
    thumbsUpCount: 165,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  user: { username: 'black-forest-labs' },
  sourceUrl: 'https://huggingface.co/black-forest-labs/FLUX.2-small-decoder',
  description: 'FLUX.2 Small Decoder — 蒸馏版小解码器 VAE (解码更快、省显存)',
  version: fullEncoderSmallDecoderVersion,
  versions: [fullEncoderSmallDecoderVersion],
}

// 混元视频 HunyuanVideo 的 VAE (bf16)
const hunyuanVideoVaeBf16Version: HuggingFaceVersion = {
  id: -10000298,
  name: 'v1.0',
  baseModel: 'Hunyuan Video',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hunyuan_video_text_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e8f8553275406d84ccf22e7a47601650d8f98bdb8aa9ccfdd6506b57a9701aed',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged/resolve/main/split_files/vae/hunyuan_video_vae_bf16.safetensors',
    filename: 'hunyuan_video_vae_bf16.safetensors',
    modelType: 'vae',
    architecture: 'hunyuan',
    sizeBytes: 492984198,
    sha256: 'e8f8553275406d84ccf22e7a47601650d8f98bdb8aa9ccfdd6506b57a9701aed',
  },
}

const hunyuanVideoVaeBf16Model: HuggingFaceModel = {
  id: -100198,
  name: 'HunyuanVideo VAE BF16',
  type: 'VAE',
  metrics: {
    downloadCount: 77386,
    thumbsUpCount: 243,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hunyuan_video_text_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged',
  description: '混元视频 HunyuanVideo 的 VAE (bf16)',
  version: hunyuanVideoVaeBf16Version,
  versions: [hunyuanVideoVaeBf16Version],
}

// 混元视频 1.5 (HunyuanVideo 1.5 / Capybara) 的 VAE
const hunyuanvideo15VaeFp16Version: HuggingFaceVersion = {
  id: -10000299,
  name: 'v1.0',
  baseModel: 'Hunyuan Video 1.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e7c3091949c27e2d55ae6d5df917b99dadfebbf308e5a50d0ade0d16c90297ae',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/vae/hunyuanvideo15_vae_fp16.safetensors',
    filename: 'hunyuanvideo15_vae_fp16.safetensors',
    modelType: 'vae',
    architecture: 'hunyuan',
    sizeBytes: 2521292758,
    sha256: 'e7c3091949c27e2d55ae6d5df917b99dadfebbf308e5a50d0ade0d16c90297ae',
  },
}

const hunyuanvideo15VaeFp16Model: HuggingFaceModel = {
  id: -100199,
  name: 'Hunyuanvideo15 VAE FP16',
  type: 'VAE',
  metrics: {
    downloadCount: 450910,
    thumbsUpCount: 94,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged',
  description: '混元视频 1.5 (HunyuanVideo 1.5 / Capybara) 的 VAE',
  version: hunyuanvideo15VaeFp16Version,
  versions: [hunyuanvideo15VaeFp16Version],
}

// Qwen-Image-Layered 分层 RGBA 分解模型的专属 VAE
const qwenImageLayeredVaeVersion: HuggingFaceVersion = {
  id: -10000300,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'c5320595fc61859ccdd0282184208f7b781c983b8ce4c6bc3e7723a807d3d28d',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI/resolve/main/split_files/vae/qwen_image_layered_vae.safetensors',
    filename: 'qwen_image_layered_vae.safetensors',
    modelType: 'vae',
    architecture: 'qwen',
    sizeBytes: 253816616,
    sha256: 'c5320595fc61859ccdd0282184208f7b781c983b8ce4c6bc3e7723a807d3d28d',
  },
}

const qwenImageLayeredVaeModel: HuggingFaceModel = {
  id: -100200,
  name: 'Qwen Image Layered VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 29699,
    thumbsUpCount: 63,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_layered-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI',
  description: 'Qwen-Image-Layered 分层 RGBA 分解模型的专属 VAE',
  version: qwenImageLayeredVaeVersion,
  versions: [qwenImageLayeredVaeVersion],
}

// Qwen-Image 系列 VAE (Qwen-Image 2.0/Edit/2512 共用)
const qwenImageVaeVersion: HuggingFaceVersion = {
  id: -10000301,
  name: 'v1.0',
  baseModel: 'Qwen Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image-qwen_image_edit_2511_lora_inflation-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors',
    filename: 'qwen_image_vae.safetensors',
    modelType: 'vae',
    architecture: 'qwen',
    sizeBytes: 253806246,
    sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
  },
}

const qwenImageVaeModel: HuggingFaceModel = {
  id: -100201,
  name: 'Qwen Image VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 1502351,
    thumbsUpCount: 461,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image-qwen_image_edit_2511_lora_inflation-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI',
  description: 'Qwen-Image 系列 VAE (Qwen-Image 2.0/Edit/2512 共用)',
  version: qwenImageVaeVersion,
  versions: [qwenImageVaeVersion],
}

// TripoSplat 3D 高斯泼溅生成的 VAE 解码器
const triposplatVaeDecoderFp16Version: HuggingFaceVersion = {
  id: -10000302,
  name: 'v1.0',
  baseModel: 'TripoSplat',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_triposplat_image_to_gaussian_splat-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ed0d0c3d43b599e326845d0ec70f3cf77be9a55e2d97627ac3b34d2830763cc8',
  },
  file: {
    url: 'https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/triposplat_vae_decoder_fp16.safetensors',
    filename: 'triposplat_vae_decoder_fp16.safetensors',
    modelType: 'vae',
    architecture: 'triposplat',
    sizeBytes: 576148442,
    sha256: 'ed0d0c3d43b599e326845d0ec70f3cf77be9a55e2d97627ac3b34d2830763cc8',
  },
}

const triposplatVaeDecoderFp16Model: HuggingFaceModel = {
  id: -100202,
  name: 'Triposplat VAE Decoder FP16',
  type: 'VAE',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 112,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/3d_triposplat_image_to_gaussian_splat-1.webp', type: 'image' }],
  user: { username: 'VAST-AI' },
  sourceUrl: 'https://huggingface.co/VAST-AI/TripoSplat',
  description: 'TripoSplat 3D 高斯泼溅生成的 VAE 解码器',
  version: triposplatVaeDecoderFp16Version,
  versions: [triposplatVaeDecoderFp16Version],
}

// Wan 2.2 5B 专属 VAE (16×16×4 压缩)
const wan22VaeVersion: HuggingFaceVersion = {
  id: -10000303,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_control-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors',
    filename: 'wan2.2_vae.safetensors',
    modelType: 'vae',
    architecture: 'wan22_5b',
    sizeBytes: 1409400960,
    sha256: 'e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156',
  },
}

const wan22VaeModel: HuggingFaceModel = {
  id: -100203,
  name: 'Wan 2.2 VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_control-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.2 5B 专属 VAE (16×16×4 压缩)',
  version: wan22VaeVersion,
  versions: [wan22VaeVersion],
}

// Wan 2.1 VAE (Wan 2.2 14B 复用同款)
const wan21Vae2Version: HuggingFaceVersion = {
  id: -10000304,
  name: 'v1.0',
  baseModel: 'Wan Video 2.1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors',
    filename: 'wan_2.1_vae.safetensors',
    modelType: 'vae',
    architecture: 'wan21',
    sizeBytes: 253815318,
    sha256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b',
  },
}

const wan21Vae2Model: HuggingFaceModel = {
  id: -100204,
  name: 'Wan 2.1 VAE',
  type: 'VAE',
  metrics: {
    downloadCount: 5505573,
    thumbsUpCount: 827,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_chrono_edit_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
  description: 'Wan 2.1 VAE (Wan 2.2 14B 复用同款)',
  version: wan21Vae2Version,
  versions: [wan21Vae2Version],
}

// Wan 2.1 Alpha 的 Alpha 通道 VAE (透明通道)
const wanAlpha21VaeAlphaChannelVersion: HuggingFaceVersion = {
  id: -10000305,
  name: 'v1.0',
  baseModel: 'Wan Video 2.1 Alpha',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '5695e8d8abbc5680fe3eefbf6c1885c989df40d1d3c83c29e87ae5b363f0c0a7',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_alpha_2.1_vae_alpha_channel.safetensors',
    filename: 'wan_alpha_2.1_vae_alpha_channel.safetensors',
    modelType: 'vae',
    architecture: 'wan21',
    sizeBytes: 253806246,
    sha256: '5695e8d8abbc5680fe3eefbf6c1885c989df40d1d3c83c29e87ae5b363f0c0a7',
  },
}

const wanAlpha21VaeAlphaChannelModel: HuggingFaceModel = {
  id: -100205,
  name: 'Wan Alpha 2.1 VAE Alpha Channel',
  type: 'VAE',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 Alpha 的 Alpha 通道 VAE (透明通道)',
  version: wanAlpha21VaeAlphaChannelVersion,
  versions: [wanAlpha21VaeAlphaChannelVersion],
}

// Wan 2.1 Alpha 的 RGB 通道 VAE
const wanAlpha21VaeRgbChannelVersion: HuggingFaceVersion = {
  id: -10000306,
  name: 'v1.0',
  baseModel: 'Wan Video 2.1 Alpha',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a61795bd0cd2ef02074cda8f4898d5efd34d804b7ac6974d8b2975c5678de371',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_alpha_2.1_vae_rgb_channel.safetensors',
    filename: 'wan_alpha_2.1_vae_rgb_channel.safetensors',
    modelType: 'vae',
    architecture: 'wan21',
    sizeBytes: 253806246,
    sha256: 'a61795bd0cd2ef02074cda8f4898d5efd34d804b7ac6974d8b2975c5678de371',
  },
}

const wanAlpha21VaeRgbChannelModel: HuggingFaceModel = {
  id: -100206,
  name: 'Wan Alpha 2.1 VAE Rgb Channel',
  type: 'VAE',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2.1_alpha_t2v_14B-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'Wan 2.1 Alpha 的 RGB 通道 VAE',
  version: wanAlpha21VaeRgbChannelVersion,
  versions: [wanAlpha21VaeRgbChannelVersion],
}
// ── text_encoders ────────────────────────────────────────────────────────────

// ByT5-small 字形/文本渲染编码器, HunyuanVideo 1.5 双 CLIP 之一 (HunyuanImage 2.1 同样使用)
const byt5SmallGlyphxlFp16Version: HuggingFaceVersion = {
  id: -10000307,
  name: 'v1.0',
  baseModel: 'Hunyuan Video',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '516910bb4c9b225370290e40585d1b0e6c8cd3583690f7eec2f7fb593990fb48',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors',
    filename: 'byt5_small_glyphxl_fp16.safetensors',
    modelType: 'text_encoders',
    architecture: 'hunyuan',
    sizeBytes: 438643184,
    sha256: '516910bb4c9b225370290e40585d1b0e6c8cd3583690f7eec2f7fb593990fb48',
  },
}

const byt5SmallGlyphxlFp16Model: HuggingFaceModel = {
  id: -100207,
  name: 'ByT5 Small Glyphxl FP16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 450910,
    thumbsUpCount: 94,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged',
  description: 'ByT5-small 字形/文本渲染编码器, HunyuanVideo 1.5 双 CLIP 之一 (HunyuanImage 2.1 同样使用)',
  version: byt5SmallGlyphxlFp16Version,
  versions: [byt5SmallGlyphxlFp16Version],
}

// CLIP-G 文本编码器, HiDream I1 四编码器之一
const clipGHidreamVersion: HuggingFaceVersion = {
  id: -10000308,
  name: 'v1.0',
  baseModel: 'HiDream',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '3771e70e36450e5199f30bad61a53faae85a2e02606974bcda0a6a573c0519d5',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/clip_g_hidream.safetensors',
    filename: 'clip_g_hidream.safetensors',
    modelType: 'text_encoders',
    architecture: 'hidream',
    sizeBytes: 1389743104,
    sha256: '3771e70e36450e5199f30bad61a53faae85a2e02606974bcda0a6a573c0519d5',
  },
}

const clipGHidreamModel: HuggingFaceModel = {
  id: -100208,
  name: 'CLIP-G HiDream',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'CLIP-G 文本编码器, HiDream I1 四编码器之一',
  version: clipGHidreamVersion,
  versions: [clipGHidreamVersion],
}

// CLIP-L 文本编码器, HiDream I1 四编码器之一
const clipLHidreamVersion: HuggingFaceVersion = {
  id: -10000309,
  name: 'v1.0',
  baseModel: 'HiDream',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '706fdb88e22e18177b207837c02f4b86a652abca0302821f2bfa24ac6aea4f71',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/clip_l_hidream.safetensors',
    filename: 'clip_l_hidream.safetensors',
    modelType: 'text_encoders',
    architecture: 'hidream',
    sizeBytes: 247586528,
    sha256: '706fdb88e22e18177b207837c02f4b86a652abca0302821f2bfa24ac6aea4f71',
  },
}

const clipLHidreamModel: HuggingFaceModel = {
  id: -100209,
  name: 'CLIP-L HiDream',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'CLIP-L 文本编码器, HiDream I1 四编码器之一',
  version: clipLHidreamVersion,
  versions: [clipLHidreamVersion],
}

// ERNIE-Image 提示词增强文本编码器
const ernieImagePromptEnhancerVersion: HuggingFaceVersion = {
  id: -10000310,
  name: 'v1.0',
  baseModel: 'Ernie',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e823e002626858be92e6600609f72fde33c5f21d3c6574721ce9f41bf1c50771',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ernie-image-prompt-enhancer.safetensors',
    filename: 'ernie-image-prompt-enhancer.safetensors',
    modelType: 'text_encoders',
    architecture: 'ernie',
    sizeBytes: 6877439999,
    sha256: 'e823e002626858be92e6600609f72fde33c5f21d3c6574721ce9f41bf1c50771',
  },
}

const ernieImagePromptEnhancerModel: HuggingFaceModel = {
  id: -100210,
  name: 'Ernie Image Prompt Enhancer',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 190,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ERNIE-Image',
  description: 'ERNIE-Image 提示词增强文本编码器',
  version: ernieImagePromptEnhancerVersion,
  versions: [ernieImagePromptEnhancerVersion],
}

// Gemma-4 E4B 指令文本编码器, HiDream O1 使用
const gemma4E4bItFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000311,
  name: 'v1.0',
  baseModel: 'HiDream-O1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_hidream_o1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'bf0b4fa2e41a25684dc9e9b256cd505564f02fed09be3da95ce024e653e2c52b',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors',
    filename: 'gemma4_e4b_it_fp8_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'hidream',
    sizeBytes: 9057782194,
    sha256: 'bf0b4fa2e41a25684dc9e9b256cd505564f02fed09be3da95ce024e653e2c52b',
  },
}

const gemma4E4bItFp8ScaledModel: HuggingFaceModel = {
  id: -100211,
  name: 'Gemma4 E4B IT FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 4079,
    thumbsUpCount: 50,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_hidream_o1-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/gemma-4',
  description: 'Gemma-4 E4B 指令文本编码器, HiDream O1 使用',
  version: gemma4E4bItFp8ScaledVersion,
  versions: [gemma4E4bItFp8ScaledVersion],
}

// Gemma-2-2B + ELM 文本编码器, NVIDIA PixelDiT 使用
const gemma22bItElmBf16Version: HuggingFaceVersion = {
  id: -10000312,
  name: 'v1.0',
  baseModel: 'PixelDiT',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_pixeldit_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e7ae59c203c392db4aa4e27783e924ec3225eb563392260cf747e1130ffcdb88',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/PixelDiT/resolve/main/text_encoders/gemma_2_2b_it_elm_bf16.safetensors',
    filename: 'gemma_2_2b_it_elm_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'pixeldit',
    sizeBytes: 5232958571,
    sha256: 'e7ae59c203c392db4aa4e27783e924ec3225eb563392260cf747e1130ffcdb88',
  },
}

const gemma22bItElmBf16Model: HuggingFaceModel = {
  id: -100212,
  name: 'Gemma 2 2B IT Elm BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 76527,
    thumbsUpCount: 135,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_pixeldit_t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/PixelDiT',
  description: 'Gemma-2-2B + ELM 文本编码器, NVIDIA PixelDiT 使用',
  version: gemma22bItElmBf16Version,
  versions: [gemma22bItElmBf16Version],
}

// Gemma-2-2B + ELM FP8 文本编码器, NVIDIA PixelDiT 使用
const gemma22bItElmFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000313,
  name: 'v1.0',
  baseModel: 'PixelDiT',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_pid_latent_upscale_dit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '87692b2ab1714028e29910ea645d96db656505ca0805051048d2298b225c02d1',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/PixelDiT/resolve/main/text_encoders/gemma_2_2b_it_elm_fp8_scaled.safetensors',
    filename: 'gemma_2_2b_it_elm_fp8_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'pixeldit',
    sizeBytes: 2618902308,
    sha256: '87692b2ab1714028e29910ea645d96db656505ca0805051048d2298b225c02d1',
  },
}

const gemma22bItElmFp8ScaledModel: HuggingFaceModel = {
  id: -100213,
  name: 'Gemma 2 2B IT Elm FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 76527,
    thumbsUpCount: 135,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/utility_pid_latent_upscale_dit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/PixelDiT',
  description: 'Gemma-2-2B + ELM FP8 文本编码器, NVIDIA PixelDiT 使用',
  version: gemma22bItElmFp8ScaledVersion,
  versions: [gemma22bItElmFp8ScaledVersion],
}

// Gemma-3-12B 指令文本编码器, LTX-2 19B 使用 (LTX-2.3 共用)
const gemma312BItVersion: HuggingFaceVersion = {
  id: -10000314,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_lora_googly_eyes-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '56eaa964a0d9325d2dc9ecaf7759bfaf0fac78ae36c789bed6e03e275a3729ec',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it.safetensors',
    filename: 'gemma_3_12B_it.safetensors',
    modelType: 'text_encoders',
    architecture: 'ltxv',
    sizeBytes: 24379468890,
    sha256: '56eaa964a0d9325d2dc9ecaf7759bfaf0fac78ae36c789bed6e03e275a3729ec',
  },
}

const gemma312BItModel: HuggingFaceModel = {
  id: -100214,
  name: 'Gemma 3 12B IT',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 142,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_lora_googly_eyes-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2',
  description: 'Gemma-3-12B 指令文本编码器, LTX-2 19B 使用 (LTX-2.3 共用)',
  version: gemma312BItVersion,
  versions: [gemma312BItVersion],
}

// Gemma-3-12B FP4 指令文本编码器, LTX-2 19B 使用 (LTX-2.3 共用)
const gemma312BItFp4MixedVersion: HuggingFaceVersion = {
  id: -10000315,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'aaca463d11e6d8d2a4bdb0d6299214c15ef78a3f73e0ef8113d5a9d0219b3f6d',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors',
    filename: 'gemma_3_12B_it_fp4_mixed.safetensors',
    modelType: 'text_encoders',
    architecture: 'ltxv',
    sizeBytes: 9447702218,
    sha256: 'aaca463d11e6d8d2a4bdb0d6299214c15ef78a3f73e0ef8113d5a9d0219b3f6d',
  },
}

const gemma312BItFp4MixedModel: HuggingFaceModel = {
  id: -100215,
  name: 'Gemma 3 12B IT FP4 Mixed',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 142,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_image_speech_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2',
  description: 'Gemma-3-12B FP4 指令文本编码器, LTX-2 19B 使用 (LTX-2.3 共用)',
  version: gemma312BItFp4MixedVersion,
  versions: [gemma312BItFp4MixedVersion],
}

// Gemma-3-12B FP8 指令文本编码器, LTX-2 19B 使用 (LTX-2.3 共用)
const gemma312BItFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000316,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx_2_audio_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '60216ce97c01c3a8753c2dfd0a89fc76e16fbe446d1a32ef8f1b528ac8bae466',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp8_scaled.safetensors',
    filename: 'gemma_3_12B_it_fp8_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'ltxv',
    sizeBytes: 13205434827,
    sha256: '60216ce97c01c3a8753c2dfd0a89fc76e16fbe446d1a32ef8f1b528ac8bae466',
  },
}

const gemma312BItFp8ScaledModel: HuggingFaceModel = {
  id: -100216,
  name: 'Gemma 3 12B IT FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 142,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx_2_audio_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ltx-2',
  description: 'Gemma-3-12B FP8 指令文本编码器, LTX-2 19B 使用 (LTX-2.3 共用)',
  version: gemma312BItFp8ScaledVersion,
  versions: [gemma312BItFp8ScaledVersion],
}

// Gemma-3-4B 文本编码器, NewBie-Image Exp0.1 (Lumina-Image 2.0 系) 使用
const gemma34bItBf16Version: HuggingFaceVersion = {
  id: -10000317,
  name: 'v1.0',
  baseModel: 'NewBie-Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_newbieimage_exp0_1-t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9ca0ed0c8b0093357c044fc528f439d369fb1029200dcd8011328771e8af8d6e',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/NewBie-image-Exp0.1_repackaged/resolve/main/split_files/text_encoders/gemma_3_4b_it_bf16.safetensors',
    filename: 'gemma_3_4b_it_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'newbie',
    sizeBytes: 7765267250,
    sha256: '9ca0ed0c8b0093357c044fc528f439d369fb1029200dcd8011328771e8af8d6e',
  },
}

const gemma34bItBf16Model: HuggingFaceModel = {
  id: -100217,
  name: 'Gemma 3 4B IT BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 29840,
    thumbsUpCount: 16,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_newbieimage_exp0_1-t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/NewBie-image-Exp0.1_repackaged',
  description: 'Gemma-3-4B 文本编码器, NewBie-Image Exp0.1 (Lumina-Image 2.0 系) 使用',
  version: gemma34bItBf16Version,
  versions: [gemma34bItBf16Version],
}

// GPT-OSS-20B NVFP4 文本编码器, Microsoft Lens 使用
const gptOss20bNvfp4Version: HuggingFaceVersion = {
  id: -10000318,
  name: 'v1.0',
  baseModel: 'Lens',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_lens_t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '103d7759c720627e5ffdcb0d885595695085dad4201fa6a522a84d4b86335ca0',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Lens/resolve/main/text_encoders/gpt_oss_20b_nvfp4.safetensors',
    filename: 'gpt_oss_20b_nvfp4.safetensors',
    modelType: 'text_encoders',
    architecture: 'lens',
    sizeBytes: 13236981318,
    sha256: '103d7759c720627e5ffdcb0d885595695085dad4201fa6a522a84d4b86335ca0',
  },
}

const gptOss20bNvfp4Model: HuggingFaceModel = {
  id: -100218,
  name: 'GPT OSS 20B NVFP4',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 21695,
    thumbsUpCount: 54,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_lens_t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Lens',
  description: 'GPT-OSS-20B NVFP4 文本编码器, Microsoft Lens 使用',
  version: gptOss20bNvfp4Version,
  versions: [gptOss20bNvfp4Version],
}

// Jina-CLIP-v2 编码器, NewBie-Image Exp0.1 双编码器之一
const jinaClipV2Bf16Version: HuggingFaceVersion = {
  id: -10000319,
  name: 'v1.0',
  baseModel: 'NewBie-Image',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_newbieimage_exp0_1-t2i-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '149c302aecd9cda9985f16f1330611925f1f7875dcdbe57df296f210e6ab0d73',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/NewBie-image-Exp0.1_repackaged/resolve/main/split_files/text_encoders/jina_clip_v2_bf16.safetensors',
    filename: 'jina_clip_v2_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'newbie',
    sizeBytes: 1121730691,
    sha256: '149c302aecd9cda9985f16f1330611925f1f7875dcdbe57df296f210e6ab0d73',
  },
}

const jinaClipV2Bf16Model: HuggingFaceModel = {
  id: -100219,
  name: 'Jina CLIP V2 BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 29840,
    thumbsUpCount: 16,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_newbieimage_exp0_1-t2i-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/NewBie-image-Exp0.1_repackaged',
  description: 'Jina-CLIP-v2 编码器, NewBie-Image Exp0.1 双编码器之一',
  version: jinaClipV2Bf16Version,
  versions: [jinaClipV2Bf16Version],
}

// Llama-3.1-8B 指令文本编码器, HiDream I1 四编码器之一
const llama318bInstructFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000320,
  name: 'v1.0',
  baseModel: 'HiDream',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9f86897bbeb933ef4fd06297740edb8dd962c94efcd92b373a11460c33765ea6',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors',
    filename: 'llama_3.1_8b_instruct_fp8_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'hidream',
    sizeBytes: 9081258056,
    sha256: '9f86897bbeb933ef4fd06297740edb8dd962c94efcd92b373a11460c33765ea6',
  },
}

const llama318bInstructFp8ScaledModel: HuggingFaceModel = {
  id: -100220,
  name: 'Llama 3.1 8B Instruct FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 128982,
    thumbsUpCount: 215,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hidream_e1_1-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI',
  description: 'Llama-3.1-8B 指令文本编码器, HiDream I1 四编码器之一',
  version: llama318bInstructFp8ScaledVersion,
  versions: [llama318bInstructFp8ScaledVersion],
}

// LLaVA-Llama3 多模态文本编码器, HunyuanVideo 2.0 双 CLIP 之一
const llavaLlama3Fp8ScaledVersion: HuggingFaceVersion = {
  id: -10000321,
  name: 'v1.0',
  baseModel: 'Hunyuan Video',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hunyuan_video_text_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '2f0c3ad255c282cead3f078753af37d19099cafcfc8265bbbd511f133e7af250',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged/resolve/main/split_files/text_encoders/llava_llama3_fp8_scaled.safetensors',
    filename: 'llava_llama3_fp8_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'hunyuan',
    sizeBytes: 9091392483,
    sha256: '2f0c3ad255c282cead3f078753af37d19099cafcfc8265bbbd511f133e7af250',
  },
}

const llavaLlama3Fp8ScaledModel: HuggingFaceModel = {
  id: -100221,
  name: 'LLaVA Llama3 FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 77386,
    thumbsUpCount: 243,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/hunyuan_video_text_to_video-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged',
  description: 'LLaVA-Llama3 多模态文本编码器, HunyuanVideo 2.0 双 CLIP 之一',
  version: llavaLlama3Fp8ScaledVersion,
  versions: [llavaLlama3Fp8ScaledVersion],
}

// LTX-2 19B 蒸馏版 embeddings 连接器 (Gemma-3 嵌入转 LTX 格式)
const ltx219bEmbeddingsConnectorDistillBf16Version: HuggingFaceVersion = {
  id: -10000322,
  name: 'v1.0',
  baseModel: 'LTXV2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx_2_audio_to_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '8990ec3fe88396ca33ac1795c89b1771d88190e51e24084b21f54b25399acbed',
  },
  file: {
    url: 'https://huggingface.co/Kijai/LTXV2_comfy/resolve/main/text_encoders/ltx-2-19b-embeddings_connector_distill_bf16.safetensors',
    filename: 'ltx-2-19b-embeddings_connector_distill_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'ltxv',
    sizeBytes: 2862983784,
    sha256: '8990ec3fe88396ca33ac1795c89b1771d88190e51e24084b21f54b25399acbed',
  },
}

const ltx219bEmbeddingsConnectorDistillBf16Model: HuggingFaceModel = {
  id: -100222,
  name: 'LTX-2 19B Embeddings Connector Distill BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 18614,
    thumbsUpCount: 464,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_ltx_2_audio_to_video-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/LTXV2_comfy',
  description: 'LTX-2 19B 蒸馏版 embeddings 连接器 (Gemma-3 嵌入转 LTX 格式)',
  version: ltx219bEmbeddingsConnectorDistillBf16Version,
  versions: [ltx219bEmbeddingsConnectorDistillBf16Version],
}

// LTX-2.3 文本投影模块 (Gemma-3 嵌入转 LTX 2.3 格式)
const ltx23TextProjectionBf16Version: HuggingFaceVersion = {
  id: -10000323,
  name: 'v1.0',
  baseModel: 'LTXV 2.3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_obscura_remova_lora_remove_object_from_video-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '911d59bb4cb7708179c9a0045ea0fe41212ecfb77aed3a02702b7c0a8274911f',
  },
  file: {
    url: 'https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/text_encoders/ltx-2.3_text_projection_bf16.safetensors',
    filename: 'ltx-2.3_text_projection_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'ltxv',
    sizeBytes: 2312149072,
    sha256: '911d59bb4cb7708179c9a0045ea0fe41212ecfb77aed3a02702b7c0a8274911f',
  },
}

const ltx23TextProjectionBf16Model: HuggingFaceModel = {
  id: -100223,
  name: 'LTX-2.3 Text Projection BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 1059470,
    thumbsUpCount: 573,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template_ltx2_3_obscura_remova_lora_remove_object_from_video-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/LTX2.3_comfy',
  description: 'LTX-2.3 文本投影模块 (Gemma-3 嵌入转 LTX 2.3 格式)',
  version: ltx23TextProjectionBf16Version,
  versions: [ltx23TextProjectionBf16Version],
}

// Ministral-3-3B 文本编码器, ERNIE-Image 提示理解使用
const ministral33bVersion: HuggingFaceVersion = {
  id: -10000324,
  name: 'v1.0',
  baseModel: 'Ernie',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '49a750a128863854eac7d85e1a277a7b44bf6ec3646405b84686dfeeca3708ca',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ministral-3-3b.safetensors',
    filename: 'ministral-3-3b.safetensors',
    modelType: 'text_encoders',
    architecture: 'ernie',
    sizeBytes: 7717637511,
    sha256: '49a750a128863854eac7d85e1a277a7b44bf6ec3646405b84686dfeeca3708ca',
  },
}

const ministral33bModel: HuggingFaceModel = {
  id: -100224,
  name: 'Ministral 3 3B',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 190,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ernie_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ERNIE-Image',
  description: 'Ministral-3-3B 文本编码器, ERNIE-Image 提示理解使用',
  version: ministral33bVersion,
  versions: [ministral33bVersion],
}

// Mistral-3-Small 文本编码器, Flux.2 Dev 使用
const mistral3SmallFlux2Bf16Version: HuggingFaceVersion = {
  id: -10000325,
  name: 'v1.0',
  baseModel: 'Flux.2 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '7d79902f60b1aeb3a6de2cfad02f4367b5e300a1387de3d03ac717cfa3df117c',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors',
    filename: 'mistral_3_small_flux2_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux2',
    sizeBytes: 35584897447,
    sha256: '7d79902f60b1aeb3a6de2cfad02f4367b5e300a1387de3d03ac717cfa3df117c',
  },
}

const mistral3SmallFlux2Bf16Model: HuggingFaceModel = {
  id: -100225,
  name: 'Mistral 3 Small Flux.2 BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 1505066,
    thumbsUpCount: 285,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-dev',
  description: 'Mistral-3-Small 文本编码器, Flux.2 Dev 使用',
  version: mistral3SmallFlux2Bf16Version,
  versions: [mistral3SmallFlux2Bf16Version],
}

// Mistral-3-Small FP8 文本编码器, Flux.2 Dev 使用
const mistral3SmallFlux2Fp8Version: HuggingFaceVersion = {
  id: -10000326,
  name: 'v1.0',
  baseModel: 'Flux.2 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_fp8-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'e3467b7d912a234fb929cdf215dc08efdb011810b44bc21081c4234cc75b370e',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors',
    filename: 'mistral_3_small_flux2_fp8.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux2',
    sizeBytes: 18034640095,
    sha256: 'e3467b7d912a234fb929cdf215dc08efdb011810b44bc21081c4234cc75b370e',
  },
}

const mistral3SmallFlux2Fp8Model: HuggingFaceModel = {
  id: -100226,
  name: 'Mistral 3 Small Flux.2 FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 1505066,
    thumbsUpCount: 285,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_fp8-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-dev',
  description: 'Mistral-3-Small FP8 文本编码器, Flux.2 Dev 使用',
  version: mistral3SmallFlux2Fp8Version,
  versions: [mistral3SmallFlux2Fp8Version],
}

// Ovis 2.5 多模态文本编码器, Ovis-Image 使用
const ovis25Version: HuggingFaceVersion = {
  id: -10000327,
  name: 'v1.0',
  baseModel: 'Ovis',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ovis_text_to_image-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f453ee5e7a25cb23cf2adf7aae3e5b405f22097cb67f2cfcca029688cb3f740d',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Ovis-Image/resolve/main/split_files/text_encoders/ovis_2.5.safetensors',
    filename: 'ovis_2.5.safetensors',
    modelType: 'text_encoders',
    architecture: 'ovis',
    sizeBytes: 5140950080,
    sha256: 'f453ee5e7a25cb23cf2adf7aae3e5b405f22097cb67f2cfcca029688cb3f740d',
  },
}

const ovis25Model: HuggingFaceModel = {
  id: -100227,
  name: 'Ovis 2.5',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 7013,
    thumbsUpCount: 32,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_ovis_text_to_image-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Ovis-Image',
  description: 'Ovis 2.5 多模态文本编码器, Ovis-Image 使用',
  version: ovis25Version,
  versions: [ovis25Version],
}

// Qwen3.5-2B LLM 文本模型 (图像描述/提示词反推等 LLM 用途)
const qwen352bBf16Version: HuggingFaceVersion = {
  id: -10000328,
  name: 'v1.0',
  baseModel: 'Qwen 3.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_stable_audio_3_medium-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'aa33250c4fc64891ddfaba3a314fd9542ea371843c387178b425fbcc5ed680b1',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_2b_bf16.safetensors',
    filename: 'qwen3.5_2b_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'qwen35',
    sizeBytes: 4548221488,
    sha256: 'aa33250c4fc64891ddfaba3a314fd9542ea371843c387178b425fbcc5ed680b1',
  },
}

const qwen352bBf16Model: HuggingFaceModel = {
  id: -100228,
  name: 'Qwen3.5 2B BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 62320,
    thumbsUpCount: 33,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_stable_audio_3_medium-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen3.5',
  description: 'Qwen3.5-2B LLM 文本模型 (图像描述/提示词反推等 LLM 用途)',
  version: qwen352bBf16Version,
  versions: [qwen352bBf16Version],
}

// Qwen3.5-4B LLM 文本模型 (图像描述/提示词反推等 LLM 用途)
const qwen354bBf16Version: HuggingFaceVersion = {
  id: -10000329,
  name: 'v1.0',
  baseModel: 'Qwen 3.5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/llm_qwen3_5_text_gen-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '9fb3ae42003750fe2d16350259a3ec07761d6d13a8e2b244a6e22fa9d8050841',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_4b_bf16.safetensors',
    filename: 'qwen3.5_4b_bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'qwen35',
    sizeBytes: 9319828320,
    sha256: '9fb3ae42003750fe2d16350259a3ec07761d6d13a8e2b244a6e22fa9d8050841',
  },
}

const qwen354bBf16Model: HuggingFaceModel = {
  id: -100229,
  name: 'Qwen3.5 4B BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 62320,
    thumbsUpCount: 33,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/llm_qwen3_5_text_gen-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen3.5',
  description: 'Qwen3.5-4B LLM 文本模型 (图像描述/提示词反推等 LLM 用途)',
  version: qwen354bBf16Version,
  versions: [qwen354bBf16Version],
}

// Qwen-0.6B 文本编码器, AceStep 1.5 音频模型使用
const qwen06bAce15Version: HuggingFaceVersion = {
  id: -10000330,
  name: 'v1.0',
  baseModel: 'ACE Audio',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'fd4590c82153b8ddb67e15a2e7aaa8afa8b83a858c8a9b82a4831063156aa7a7',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_0.6b_ace15.safetensors',
    filename: 'qwen_0.6b_ace15.safetensors',
    modelType: 'text_encoders',
    architecture: 'acestep',
    sizeBytes: 1191588248,
    sha256: 'fd4590c82153b8ddb67e15a2e7aaa8afa8b83a858c8a9b82a4831063156aa7a7',
  },
}

const qwen06bAce15Model: HuggingFaceModel = {
  id: -100230,
  name: 'Qwen 0.6B Ace15',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'Qwen-0.6B 文本编码器, AceStep 1.5 音频模型使用',
  version: qwen06bAce15Version,
  versions: [qwen06bAce15Version],
}

// Qwen-1.7B 文本编码器, AceStep 1.5 音频模型使用
const qwen17bAce15Version: HuggingFaceVersion = {
  id: -10000331,
  name: 'v1.0',
  baseModel: 'ACE Audio',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: 'ed63e9247d1f55f3ace04fa11e95b085fc82d459c82c5626f0b2e37b91ebd710',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_1.7b_ace15.safetensors',
    filename: 'qwen_1.7b_ace15.safetensors',
    modelType: 'text_encoders',
    architecture: 'acestep',
    sizeBytes: 3708523360,
    sha256: 'ed63e9247d1f55f3ace04fa11e95b085fc82d459c82c5626f0b2e37b91ebd710',
  },
}

const qwen17bAce15Model: HuggingFaceModel = {
  id: -100231,
  name: 'Qwen 1.7B Ace15',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'Qwen-1.7B 文本编码器, AceStep 1.5 音频模型使用',
  version: qwen17bAce15Version,
  versions: [qwen17bAce15Version],
}

// Qwen2.5-VL-7B 多模态文本编码器, HunyuanImage 2.1 使用 (Qwen-Image / HunyuanVideo 1.5 共用)
const qwen25Vl7bVersion: HuggingFaceVersion = {
  id: -10000332,
  name: 'v1.0',
  baseModel: 'Hunyuan Image 2.1',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'cfafd739459bc86257397259f612a9aee88e5b98e85b5c0d0d1717e898b3463a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/HunyuanImage_2.1_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b.safetensors',
    filename: 'qwen_2.5_vl_7b.safetensors',
    modelType: 'text_encoders',
    architecture: 'hunyuanimage',
    sizeBytes: 16584415576,
    sha256: 'cfafd739459bc86257397259f612a9aee88e5b98e85b5c0d0d1717e898b3463a',
  },
}

const qwen25Vl7bModel: HuggingFaceModel = {
  id: -100232,
  name: 'Qwen 2.5 VL 7B',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 19769,
    thumbsUpCount: 25,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/Image_capybara_v0_1_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/HunyuanImage_2.1_ComfyUI',
  description: 'Qwen2.5-VL-7B 多模态文本编码器, HunyuanImage 2.1 使用 (Qwen-Image / HunyuanVideo 1.5 共用)',
  version: qwen25Vl7bVersion,
  versions: [qwen25Vl7bVersion],
}

// Qwen2.5-VL-7B FP8 多模态文本编码器, Qwen-Image 使用 (HunyuanVideo 1.5 / HunyuanImage 2.1 共用)
const qwen25Vl7bFp8ScaledVersion: HuggingFaceVersion = {
  id: -10000333,
  name: 'v1.0',
  baseModel: 'Qwen',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image-qwen_image_edit_2511_lora_inflation-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors',
    filename: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    modelType: 'text_encoders',
    architecture: 'qwen',
    sizeBytes: 9384670680,
    sha256: 'cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4',
  },
}

const qwen25Vl7bFp8ScaledModel: HuggingFaceModel = {
  id: -100233,
  name: 'Qwen 2.5 VL 7B FP8',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 1502351,
    thumbsUpCount: 461,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image-qwen_image_edit_2511_lora_inflation-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI',
  description: 'Qwen2.5-VL-7B FP8 多模态文本编码器, Qwen-Image 使用 (HunyuanVideo 1.5 / HunyuanImage 2.1 共用)',
  version: qwen25Vl7bFp8ScaledVersion,
  versions: [qwen25Vl7bFp8ScaledVersion],
}

// Qwen2.5-VL 文本编码器, OmniGen2 使用
const qwen25VlFp16Version: HuggingFaceVersion = {
  id: -10000334,
  name: 'v1.0',
  baseModel: 'OmniGen 2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_omnigen2_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_fp16.safetensors',
    filename: 'qwen_2.5_vl_fp16.safetensors',
    modelType: 'text_encoders',
    architecture: 'omnigen',
    sizeBytes: 7509337224,
    sha256: 'ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3',
  },
}

const qwen25VlFp16Model: HuggingFaceModel = {
  id: -100234,
  name: 'Qwen 2.5 VL FP16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 22989,
    thumbsUpCount: 30,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_omnigen2_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Omnigen2_ComfyUI_repackaged',
  description: 'Qwen2.5-VL 文本编码器, OmniGen2 使用',
  version: qwen25VlFp16Version,
  versions: [qwen25VlFp16Version],
}

// Qwen3-0.6B 文本编码器, Anima 使用
const qwen306bBaseVersion: HuggingFaceVersion = {
  id: -10000335,
  name: 'v1.0',
  baseModel: 'Anima',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_anima_base_v1-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba',
  },
  file: {
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors',
    filename: 'qwen_3_06b_base.safetensors',
    modelType: 'text_encoders',
    architecture: 'anima',
    sizeBytes: 1192135096,
    sha256: 'cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba',
  },
}

const qwen306bBaseModel: HuggingFaceModel = {
  id: -100235,
  name: 'Qwen 3 06B Base',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 826747,
    thumbsUpCount: 2020,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_anima_base_v1-1.webp', type: 'image' }],
  user: { username: 'circlestone-labs' },
  sourceUrl: 'https://huggingface.co/circlestone-labs/Anima',
  description: 'Qwen3-0.6B 文本编码器, Anima 使用',
  version: qwen306bBaseVersion,
  versions: [qwen306bBaseVersion],
}

// Qwen3-4B 文本编码器, Z-Image Turbo 使用 (Flux.2 Klein 4B 共用同一 Qwen3-4B)
const qwen34bVersion: HuggingFaceVersion = {
  id: -10000336,
  name: 'v1.0',
  baseModel: 'ZImageTurbo',
  images: [],
  trainedWords: [],
  hashes: {
    SHA256: '6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors',
    filename: 'qwen_3_4b.safetensors',
    modelType: 'text_encoders',
    architecture: 'zimage',
    sizeBytes: 8044982048,
    sha256: '6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a',
  },
}

const qwen34bModel: HuggingFaceModel = {
  id: -100236,
  name: 'Qwen 3 4B',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 5204347,
    thumbsUpCount: 801,
  },
  images: [],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/z_image_turbo',
  description: 'Qwen3-4B 文本编码器, Z-Image Turbo 使用 (Flux.2 Klein 4B 共用同一 Qwen3-4B)',
  version: qwen34bVersion,
  versions: [qwen34bVersion],
}

// Qwen3-8B 文本编码器, Flux.2 Klein 9B 使用
const qwen38bVersion: HuggingFaceVersion = {
  id: -10000337,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 9B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_doc_workbox_klein_9b_image_extend-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'f0ff9239d56269ca1d05e5f86da6a79fac111af464955681f11c7ab0ec5ef6c1',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b.safetensors',
    filename: 'qwen_3_8b.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux2',
    sizeBytes: 16381517176,
    sha256: 'f0ff9239d56269ca1d05e5f86da6a79fac111af464955681f11c7ab0ec5ef6c1',
  },
}

const qwen38bModel: HuggingFaceModel = {
  id: -100237,
  name: 'Qwen 3 8B',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 178,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_doc_workbox_klein_9b_image_extend-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b',
  description: 'Qwen3-8B 文本编码器, Flux.2 Klein 9B 使用',
  version: qwen38bVersion,
  versions: [qwen38bVersion],
}

// Qwen3-8B FP8 文本编码器, Flux.2 Klein 9B 使用
const qwen38bFp8mixedVersion: HuggingFaceVersion = {
  id: -10000338,
  name: 'v1.0',
  baseModel: 'Flux.2 Klein 9B',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_9b_kv_image_edit-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'abad16806e0cbabc54e0325d6565847443fe396d5f0be38bb3cd3fe75a1201d6',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors',
    filename: 'qwen_3_8b_fp8mixed.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux2',
    sizeBytes: 8664848742,
    sha256: 'abad16806e0cbabc54e0325d6565847443fe396d5f0be38bb3cd3fe75a1201d6',
  },
}

const qwen38bFp8mixedModel: HuggingFaceModel = {
  id: -100238,
  name: 'Qwen 3 8B FP8 Mixed',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 178,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_flux2_klein_9b_kv_image_edit-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/flux2-klein-9B',
  description: 'Qwen3-8B FP8 文本编码器, Flux.2 Klein 9B 使用',
  version: qwen38bFp8mixedVersion,
  versions: [qwen38bFp8mixedVersion],
}

// Qwen-4B 文本编码器, AceStep 1.5 音频模型使用
const qwen4bAce15Version: HuggingFaceVersion = {
  id: -10000339,
  name: 'v1.0',
  baseModel: 'ACE Audio',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'ffe5ffb855086c2ab55e467e9859fb01894781020a0376484dd19de166b79873',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_4b_ace15.safetensors',
    filename: 'qwen_4b_ace15.safetensors',
    modelType: 'text_encoders',
    architecture: 'acestep',
    sizeBytes: 8379154232,
    sha256: 'ffe5ffb855086c2ab55e467e9859fb01894781020a0376484dd19de166b79873',
  },
}

const qwen4bAce15Model: HuggingFaceModel = {
  id: -100239,
  name: 'Qwen 4B Ace15',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 300985,
    thumbsUpCount: 158,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_ace_step1_5_xl_base-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
  description: 'Qwen-4B 文本编码器, AceStep 1.5 音频模型使用',
  version: qwen4bAce15Version,
  versions: [qwen4bAce15Version],
}

// T5-Base 通用文本编码器, Stable Audio Open 1.0 等音频工作流使用
const t5BaseVersion: HuggingFaceVersion = {
  id: -10000340,
  name: 'v1.0',
  baseModel: 'T5',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_stable_audio_example-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: 'a90903540cc02cbeb7ff9f823f1a80eb778c7e22426a0e620b01c77a5ec8f5b4',
  },
  file: {
    url: 'https://huggingface.co/ComfyUI-Wiki/t5-base/resolve/main/t5-base.safetensors',
    filename: 't5-base.safetensors',
    modelType: 'text_encoders',
    architecture: 't5',
    sizeBytes: 891646390,
    sha256: 'a90903540cc02cbeb7ff9f823f1a80eb778c7e22426a0e620b01c77a5ec8f5b4',
  },
}

const t5BaseModel: HuggingFaceModel = {
  id: -100240,
  name: 'T5 Base',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 1,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_stable_audio_example-1.webp', type: 'image' }],
  user: { username: 'ComfyUI-Wiki' },
  sourceUrl: 'https://huggingface.co/ComfyUI-Wiki/t5-base',
  description: 'T5-Base 通用文本编码器, Stable Audio Open 1.0 等音频工作流使用',
  version: t5BaseVersion,
  versions: [t5BaseVersion],
}

// T5+Gemma UL2 文本编码器, Stable Audio 3.0 使用
const t5gemmaBBUl2Version: HuggingFaceVersion = {
  id: -10000341,
  name: 'v1.0',
  baseModel: 'Stable Audio 3',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_stable_audio_3_medium-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '1e1eba25be8872edb0d3c6335c6658fd6388e7b14b60da6e454e404cfcd8150e',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/text_encoders/t5gemma_b_b_ul2.safetensors',
    filename: 't5gemma_b_b_ul2.safetensors',
    modelType: 'text_encoders',
    architecture: 'stableaudio',
    sizeBytes: 1187264003,
    sha256: '1e1eba25be8872edb0d3c6335c6658fd6388e7b14b60da6e454e404cfcd8150e',
  },
}

const t5gemmaBBUl2Model: HuggingFaceModel = {
  id: -100241,
  name: 'T5gemma B B Ul2',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 39,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/audio_stable_audio_3_medium-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/stable-audio-3',
  description: 'T5+Gemma UL2 文本编码器, Stable Audio 3.0 使用',
  version: t5gemmaBBUl2Version,
  versions: [t5gemmaBBUl2Version],
}

// T5-XXL 文本编码器, Flux 1 双 CLIP 之一 (Chroma / HiDream 共用)
const t5xxlFp16Version: HuggingFaceVersion = {
  id: -10000342,
  name: 'v1.0',
  baseModel: 'Flux.1 D',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_krea_dev-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635',
  },
  file: {
    url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors',
    filename: 't5xxl_fp16.safetensors',
    modelType: 'text_encoders',
    architecture: 'flux',
    sizeBytes: 9787841024,
    sha256: '6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635',
  },
}

const t5xxlFp16Model: HuggingFaceModel = {
  id: -100242,
  name: 'T5-XXL FP16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 0,
    thumbsUpCount: 1383,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/flux1_krea_dev-1.webp', type: 'image' }],
  user: { username: 'comfyanonymous' },
  sourceUrl: 'https://huggingface.co/comfyanonymous/flux_text_encoders',
  description: 'T5-XXL 文本编码器, Flux 1 双 CLIP 之一 (Chroma / HiDream 共用)',
  version: t5xxlFp16Version,
  versions: [t5xxlFp16Version],
}

// UM-T5-XXL 文本编码器, Wan 2.1/2.2 全系使用
const umt5XxlEncBf16Version: HuggingFaceVersion = {
  id: -10000343,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '4fa971faf306cad919033d5bbe192e571dc08452f800cbf2ec3c73977c01b2cc',
  },
  file: {
    url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/umt5-xxl-enc-bf16.safetensors',
    filename: 'umt5-xxl-enc-bf16.safetensors',
    modelType: 'text_encoders',
    architecture: 'wan22',
    sizeBytes: 11361845464,
    sha256: '4fa971faf306cad919033d5bbe192e571dc08452f800cbf2ec3c73977c01b2cc',
  },
}

const umt5XxlEncBf16Model: HuggingFaceModel = {
  id: -100243,
  name: 'UMT5 XXL Enc BF16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 1773916,
    thumbsUpCount: 2468,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/template-Animation_Trajectory_Control_Wan_ATI-1.webp', type: 'image' }],
  user: { username: 'Kijai' },
  sourceUrl: 'https://huggingface.co/Kijai/WanVideo_comfy',
  description: 'UM-T5-XXL 文本编码器, Wan 2.1/2.2 全系使用',
  version: umt5XxlEncBf16Version,
  versions: [umt5XxlEncBf16Version],
}

// UM-T5-XXL FP16 文本编码器, Wan 2.1/2.2 全系使用
const umt5XxlFp16Version: HuggingFaceVersion = {
  id: -10000344,
  name: 'v1.0',
  baseModel: 'Wan Video 2.2',
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_product_scene_transformation-1.webp', type: 'image' }],
  trainedWords: [],
  hashes: {
    SHA256: '7b8850f1961e1cf8a77cca4c964a358d303f490833c6c087d0cff4b2f99db2af',
  },
  file: {
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp16.safetensors',
    filename: 'umt5_xxl_fp16.safetensors',
    modelType: 'text_encoders',
    architecture: 'wan22',
    sizeBytes: 11366399385,
    sha256: '7b8850f1961e1cf8a77cca4c964a358d303f490833c6c087d0cff4b2f99db2af',
  },
}

const umt5XxlFp16Model: HuggingFaceModel = {
  id: -100244,
  name: 'UMT5 XXL FP16',
  type: 'TextEncoder',
  metrics: {
    downloadCount: 2264284,
    thumbsUpCount: 948,
  },
  images: [{ url: 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/templates_product_scene_transformation-1.webp', type: 'image' }],
  user: { username: 'Comfy-Org' },
  sourceUrl: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  description: 'UM-T5-XXL FP16 文本编码器, Wan 2.1/2.2 全系使用',
  version: umt5XxlFp16Version,
  versions: [umt5XxlFp16Version],
}

export const HUGGINGFACE_MODELS: HuggingFaceModel[] = [
  sdXlBaseModel,
  sd15PrunedModel,
  flux1DevFp8Model,
  flux2DevFp8Model,
  zImageModel,
  wan22_5bModel,
  flux2TurboLoraModel,
  ltx2DistillLoraModel,
  wan22I2vLightningLoraModel,
  sd35CannyCnModel,
  sd35DepthCnModel,
  wan21VaeModel,
  fluxAeVaeModel,
  sdVaeFtMseModel,
  fluxClipLModel,
  fluxT5xxlFp8Model,
  wanUmt5Model,
  realEsrganModel,
  ultraSharpModel,
  dreamShaper8PrunedModel,
  juggernautXLV9RunDiffusionPhotoV2Model,
  netaYumev35PretrainedAllInOneModel,
  flux1SchnellFp8Model,
  hidreamO1ImageBf16Model,
  hidreamO1ImageDevFp8ScaledModel,
  juggernautXLV9Rdphoto2LightningModel,
  ltx219bDevFp8Model,
  ltx219bDevModel,
  ltx219bDistilledModel,
  ltx2322bDevFp8Model,
  ltx2322bDevModel,
  ltx2322bDistilledFp8Model,
  ltxVideo2bV095Model,
  ltxVideo2bV09Model,
  sd35LargeFp8ScaledModel,
  sdXlRefiner10Model,
  sdXlTurbo10Fp16Model,
  svdXtModel,
  chroma1HDFp8mixedModel,
  fireRedImageEdit11TransformerModel,
  newBieImageExp01Bf16Model,
  wan21WanMoveFp8ScaledE4m3fnKJModel,
  wan21I2V14B480pFp8E4m3fnScaledKJModel,
  wan21I2VATI14BFp8E4m3fnModel,
  wan21VACEModule14BBf16Model,
  wan22Animate14BFp8E4m3fnScaledKJModel,
  acestepV15TurboModel,
  acestepV15XlBaseBf16Model,
  acestepV15XlSftBf16Model,
  acestepV15XlTurboBf16Model,
  animaBaseV10Model,
  animaPreview3BaseModel,
  capybaraV01Model,
  causalForcingFramewiseModel,
  chromaRadianceX0Model,
  chronoEdit14BFp16Model,
  ernieImageTurboModel,
  ernieImageModel,
  flux2Klein4bFp8Model,
  flux2Klein4bModel,
  flux2Klein9bKvFp8Model,
  flux2KleinBase4bFp8Model,
  flux2KleinBase4bModel,
  flux1FillDevOneRewardTransformerFp8Model,
  flux1CannyDevModel,
  flux1DevKontextFp8ScaledModel,
  flux1DevModel,
  flux1FillDevModel,
  flux1KreaDevFp8ScaledModel,
  flux1SchnellModel,
  hidreamE11Bf16Model,
  hidreamE1FullBf16Model,
  hidreamI1DevFp8Model,
  hidreamI1FastFp8Model,
  hidreamI1FullFp8Model,
  humo17BFp8E4m3fnModel,
  hunyuanVideoT2v720pBf16Model,
  hunyuanvideo151080pSrDistilledFp16Model,
  hunyuanvideo15720pI2vFp16Model,
  hunyuanvideo15720pT2vFp16Model,
  kandinsky5liteI2v5sModel,
  kandinsky5liteT2iModel,
  kandinsky5liteT2vSft5sModel,
  lensBf16Model,
  lensTurboBf16Model,
  longcatImageBf16Model,
  longcatImageEditBf16Model,
  lotusDepthDV11Model,
  ltx219bDistilledTransformerOnlyBf16Model,
  ltx2322bDevTransformerOnlyBf16Model,
  omnigen2Fp16Model,
  ovisImageBf16Model,
  pidFlux11024To40964stepBf16Model,
  pixeldit1300m1024pxBf16Model,
  qwenImage2512Bf16Model,
  qwenImage2512Fp8E4m3fnModel,
  qwenImageEdit2509Fp8E4m3fnModel,
  qwenImageEdit2511Bf16Model,
  qwenImageEditFp8E4m3fnModel,
  qwenImageFp8E4m3fnModel,
  qwenImageLayeredBf16Model,
  qwenImageLayeredControlBf16Model,
  rtDetrV4XHgnetFp16Model,
  triposplatFp16Model,
  voidPass1Model,
  voidPass2Model,
  wan21Flf2v720p14BFp16Model,
  wan21FunCameraV1113BBf16Model,
  wan21FunCameraV1114BBf16Model,
  wan21FunControl13BBf16Model,
  wan21FunInp13BBf16Model,
  wan21I2v480p14BFp16Model,
  wan21T2v13BFp16Model,
  wan21T2v14BFp8ScaledModel,
  wan21Vace13BFp16Model,
  wan21Vace14BFp16Model,
  wan22FunCameraHighNoise14BFp8ScaledModel,
  wan22FunCameraLowNoise14BFp8ScaledModel,
  wan22FunControl5BBf16Model,
  wan22FunControlHighNoise14BFp8ScaledModel,
  wan22FunControlLowNoise14BFp8ScaledModel,
  wan22FunInpaint5BBf16Model,
  wan22FunInpaintHighNoise14BFp8ScaledModel,
  wan22FunInpaintLowNoise14BFp8ScaledModel,
  wan22I2vHighNoise14BFp8ScaledModel,
  wan22I2vLowNoise14BFp8ScaledModel,
  wan22S2v14BFp8ScaledModel,
  wan22T2vHighNoise14BFp8ScaledModel,
  wan22T2vLowNoise14BFp8ScaledModel,
  zImageTurboBf16Model,
  fireRedImageEdit10Lightning8stepsV10Model,
  flux2TurboLoRAComfyuiModel,
  qWENEDITACTIONV1Model,
  qwenEdit2509MultipleAnglesModel,
  qwenImage2512Lightning4stepsV10Fp32Model,
  qwenImageEdit2509Anything2RealAlphaModel,
  qwenImageEdit2509FusionModel,
  qwenImageEdit2509LightMigrationModel,
  qwenImageEdit2509Lightning4stepsV10Bf16Model,
  qwenImageEdit2509Lightning8stepsV10Bf16Model,
  qwenImageEdit2509RelightModel,
  qwenImageEdit2511Lightning4stepsV10Bf16Model,
  qwenImageEditLightning4stepsV10Bf16Model,
  qwenImageLightning4stepsV10Model,
  qwenImageLightning8stepsV10Model,
  sYSTMSINFL8LoRAQwenImageEdit2511Model,
  wan22LightningI2VA14B4stepsLoraHIGHFp16Model,
  wan22LightningI2VA14B4stepsLoraLOWFp16Model,
  wan21CausVid14BT2VLoraRank32Model,
  wan21CausVid14BT2VLoraRank32V2Model,
  wan21CausVidBidirect2T2V13BLoraRank32Model,
  wan21T2V14BLightx2vCfgStepDistillLoraRank32Model,
  wanAnimateRelightLoraFp16Model,
  wuliQwenImage2512TurboLoRA2stepsV10Bf16Model,
  chronoeditDistillLoraModel,
  flux1DepthDevLoraModel,
  gemma312bItAbliteratedLoraRank64Bf16Model,
  googlyeyesLtx23Rank32Step03000Model,
  gummycandyQwenModel,
  illustration10QwenImageModel,
  lightx2v14BT2VCfgStepDistillLoraAdaptiveRankQuantile015Bf16Model,
  lightx2vI2V14B480pCfgStepDistillRank128Bf16Model,
  lightx2vI2V14B480pCfgStepDistillRank64Bf16Model,
  lightx2vT2V14BCfgStepDistillV2LoraRank64Bf16Model,
  ltx219bIcLoraCannyControlModel,
  ltx219bIcLoraDepthControlModel,
  ltx219bIcLoraPoseControlModel,
  ltx219bLoraCameraControlDollyLeftModel,
  ltx2322bDistilledLora38411Model,
  ltx2322bDistilledLora384Model,
  ltx2322bIcLoraOutpaintModel,
  ltx2322bIcLoraUnionControlRef05Model,
  ltx23IdLoraTalkvid3kModel,
  ltx2SquishModel,
  ltx23TransitionModel,
  ltx2322bDistilled11LoraDynamicFro09AvgRank111Bf16Model,
  pixelArtStyleZImageTurboModel,
  qwen360Diffusion2512Int8Bf16V2Model,
  qwenImageEdit2511MultipleAnglesLoraModel,
  qwenImageUnionDiffsynthLoraModel,
  removalTimestepAlpha21740Model,
  usoFlux1DitLoraV1Model,
  wan22I2vA14bHighNoiseLoraRank64Lightx2v4step1022Model,
  wan22I2vA14bLowNoiseLoraRank64Lightx2v4step1022Model,
  wan22I2vLightx2v4stepsLoraV1LowNoiseModel,
  wan22T2vLightx2v4stepsLoraV11HighNoiseModel,
  wan22T2vLightx2v4stepsLoraV11LowNoiseModel,
  wanAlpha21RgbaLoraModel,
  qwenImage2512FunControlnetUnion2602Model,
  qwenImageInstantXControlNetInpaintingModel,
  qwenImageInstantXControlNetUnionModel,
  sd35LargeControlnetBlurModel,
  wan21VAEFp32Model,
  ace15VaeModel,
  cogvideoxVaeModel,
  flux2VaeModel,
  fullEncoderSmallDecoderModel,
  hunyuanVideoVaeBf16Model,
  hunyuanvideo15VaeFp16Model,
  qwenImageLayeredVaeModel,
  qwenImageVaeModel,
  triposplatVaeDecoderFp16Model,
  wan22VaeModel,
  wan21Vae2Model,
  wanAlpha21VaeAlphaChannelModel,
  wanAlpha21VaeRgbChannelModel,
  byt5SmallGlyphxlFp16Model,
  clipGHidreamModel,
  clipLHidreamModel,
  ernieImagePromptEnhancerModel,
  gemma4E4bItFp8ScaledModel,
  gemma22bItElmBf16Model,
  gemma22bItElmFp8ScaledModel,
  gemma312BItModel,
  gemma312BItFp4MixedModel,
  gemma312BItFp8ScaledModel,
  gemma34bItBf16Model,
  gptOss20bNvfp4Model,
  jinaClipV2Bf16Model,
  llama318bInstructFp8ScaledModel,
  llavaLlama3Fp8ScaledModel,
  ltx219bEmbeddingsConnectorDistillBf16Model,
  ltx23TextProjectionBf16Model,
  ministral33bModel,
  mistral3SmallFlux2Bf16Model,
  mistral3SmallFlux2Fp8Model,
  ovis25Model,
  qwen352bBf16Model,
  qwen354bBf16Model,
  qwen06bAce15Model,
  qwen17bAce15Model,
  qwen25Vl7bModel,
  qwen25Vl7bFp8ScaledModel,
  qwen25VlFp16Model,
  qwen306bBaseModel,
  qwen34bModel,
  qwen38bModel,
  qwen38bFp8mixedModel,
  qwen4bAce15Model,
  t5BaseModel,
  t5gemmaBBUl2Model,
  t5xxlFp16Model,
  umt5XxlEncBf16Model,
  umt5XxlFp16Model,

  // ── MiniMax H3 (2026-08 新发布, generated-models 快照未收录, 手动补) ──
  ...(() => {
    const t = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/'
    const repo = 'https://huggingface.co/Comfy-Org/MiniMax-H3'
    const mk = (id: number, vid: number, name: string, type: string, baseModel: string,
                arch: string, modelType: string, fn: string, path: string, size: number,
                sha: string, verName: string, desc: string, thumb: string) => {
      const v = { id: vid, name: verName, baseModel, images: [{ url: thumb, type: 'image' as const }],
                  trainedWords: [] as string[], hashes: { SHA256: sha },
                  file: { url: `${repo}/resolve/main/${path}`, filename: fn, modelType, architecture: arch, sizeBytes: size, sha256: sha } }
      return { id, name, type, metrics: { downloadCount: 3139920, thumbsUpCount: 886 },
               images: [{ url: thumb, type: 'image' as const }], user: { username: 'Comfy-Org' },
               sourceUrl: repo, description: desc, version: v, versions: [v] } as any
    }
    return [
      mk(-100245, -10000345, 'MiniMax H3 FL2V FP8', 'DiffusionModel', 'MiniMax H3', 'minimax_h3',
         'diffusion_models', 'minimax_h3_fl2va_pruned_fp8_scaled.safetensors', 'diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors',
         20958205608, '12944c1f7791637e7de12208aef04da82bd26b95271b1b47d817364315ade993', 'fp8',
         'MiniMax H3 图生视频 (FL2V), pruned FP8 量化版, 音视频一体生成', t + 'video_minimax_h3_i2v-1.webp'),
      mk(-100246, -10000346, 'MiniMax H3 REF2V FP8', 'DiffusionModel', 'MiniMax H3', 'minimax_h3',
         'diffusion_models', 'minimax_h3_ref2va_pruned_fp8_scaled.safetensors', 'diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors',
         20958205608, 'f86f2f79ebd2d76eb8eeb46091e83982e6ff51d255747e7b16e92834b392b8e9', 'fp8',
         'MiniMax H3 参考视频生成 (REF2V), pruned FP8 量化版, 参考图/视频驱动生成', t + 'video_minimax_h3_r2v-1.webp'),
      mk(-100247, -10000347, 'MiniMax H3 FL2V BF16', 'DiffusionModel', 'MiniMax H3', 'minimax_h3',
         'diffusion_models', 'minimax_h3_fl2va_pruned_bf16.safetensors', 'diffusion_models/minimax_h3_fl2va_pruned_bf16.safetensors',
         40225724176, 'a32572fb90b5508b201ec7c2eddcc184b13ddfd3c6f6d2cf06a0b46535d541b4', 'bf16',
         'MiniMax H3 图生视频 (FL2V), pruned BF16 完整版, 高精度', t + 'video_minimax_h3_i2v-1.webp'),
      mk(-100248, -10000348, 'MiniMax H3 Qwen3-VL 32B TE', 'TextEncoder', 'MiniMax H3', 'minimax_h3',
         'text_encoders', 'qwen3vl_32b_minimax_h3_bf16.safetensors', 'text_encoders/qwen3vl_32b_minimax_h3_bf16.safetensors',
         51506295256, '600d567f6a9629c8574e8e7041b199bdd9c59a986afa7906910a81919610607d', 'bf16',
         'MiniMax H3 文本编码器 (Qwen3-VL 32B), BF16', t + 'video_minimax_h3_t2v-1.webp'),
      mk(-100249, -10000349, 'MiniMax H3 Video VAE', 'VAE', 'MiniMax H3', 'minimax_h3',
         'vae', 'minimax_h3_video_vae_fp16.safetensors', 'vae/minimax_h3_video_vae_fp16.safetensors',
         5207808496, '7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522', 'fp16',
         'MiniMax H3 视频编解码器 VAE, FP16', t + 'video_minimax_h3_i2v-1.webp'),
    ]
  })(),



  // ── 未收录补充: A类(Krea-2/Mage-Flow/Qwen3-VL/MelBandRoFormer) + B类图像(CLIP-Vision/Redux/SigCLIP/USO) ──
  ...(() => {
    const mk = (id: number, vid: number, name: string, type: string, baseModel: string,
                arch: string, modelType: string, fn: string, repo: string, path: string,
                size: number, sha: string, verName: string, desc: string, thumb: string,
                dl: number, likes: number, author: string) => {
      const img = thumb ? [{ url: thumb, type: 'image' as const }] : []
      const v = { id: vid, name: verName, baseModel, images: [...img] as any,
                  trainedWords: [] as string[], hashes: { SHA256: sha },
                  file: { url: 'https://huggingface.co/' + repo + '/resolve/main/' + path, filename: fn, modelType, architecture: arch, sizeBytes: size, sha256: sha } }
      return { id, name, type, metrics: { downloadCount: dl, thumbsUpCount: likes },
               images: [...img] as any, user: { username: author },
               sourceUrl: 'https://huggingface.co/' + repo, description: desc, version: v, versions: [v] } as any
    }
    return [
    mk(-100250, -10000350, 'Qwen3-VL 4B FP8', 'TextEncoder', 'Krea 2', 'krea2',
         'text_encoders', 'qwen3vl_4b_fp8_scaled.safetensors', 'Comfy-Org/Qwen3-VL', 'text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
         5242467968, '54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094', 'fp8',
         'Qwen3-VL 4B 视觉语言模型 FP8 量化, Krea-2/Mage-Flow 共用文本编码器', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/image_krea2_turbo_t2i.png', 0, 49, 'Comfy-Org'),
    mk(-100251, -10000351, 'Qwen3-VL 4B BF16', 'TextEncoder', 'Mage-Flow', 'mage_flow',
         'text_encoders', 'qwen3vl_4b_bf16.safetensors', 'Comfy-Org/Qwen3-VL', 'text_encoders/qwen3vl_4b_bf16.safetensors',
         8875719384, '36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34', 'bf16',
         'Qwen3-VL 4B 视觉语言模型 BF16, Krea-2/Mage-Flow 共用文本编码器', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/Mage_flow.png', 0, 49, 'Comfy-Org'),
    mk(-100252, -10000352, 'Krea 2 Turbo FP8', 'DiffusionModel', 'Krea 2', 'krea2',
         'diffusion_models', 'krea2_turbo_fp8_scaled.safetensors', 'Comfy-Org/Krea-2', 'diffusion_models/krea2_turbo_fp8_scaled.safetensors',
         13141730784, 'eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1', 'fp8',
         'Krea 2 Turbo 文生图主模型 FP8 量化版, Krea 官方 2026-06 发布', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/image_krea2_turbo_t2i.png', 10, 417, 'Comfy-Org'),
    mk(-100253, -10000353, 'Krea 2 Turbo INT8', 'DiffusionModel', 'Krea 2', 'krea2',
         'diffusion_models', 'krea2_turbo_int8_convrot.safetensors', 'Comfy-Org/Krea-2', 'diffusion_models/krea2_turbo_int8_convrot.safetensors',
         13492686496, '8e4eeda70dd5037ab1ba2bef6b417f9f901e26093117cf397f741fc1fdaaf3f1', 'int8',
         'Krea 2 Turbo 文生图主模型 INT8 量化版, 更快更省显存', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/image_krea2_turbo_t2i_int8.png', 10, 417, 'Comfy-Org'),
    mk(-100254, -10000354, 'Krea 2 Darkbrush LoRA', 'LORA', 'Krea 2', 'krea2',
         'loras', 'krea2_darkbrush.safetensors', 'Comfy-Org/Krea-2', 'loras/krea2_darkbrush.safetensors',
         469291992, 'f47c4316dd93af66e0518c93b582f459571d4925b519133770c73a52cd5db7c6', 'v1.0',
         'Krea 2 水墨风格 LoRA', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/image_krea2_turbo_t2i.png', 10, 417, 'Comfy-Org'),
    mk(-100255, -10000355, 'Krea 2 Style Reference LoRA', 'LORA', 'Krea 2', 'krea2',
         'loras', 'krea2_style_reference.safetensors', 'Comfy-Org/Krea-2', 'loras/krea2_style_reference.safetensors',
         457111760, 'f50df5a9e62e4be8aa926a63dd5bb1a64770c4004f763c1208007ae13daa82b8', 'v1.0',
         'Krea 2 风格参考 LoRA', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/thumbnail/image_krea2_turbo_int8_image_style_reference.png', 10, 417, 'Comfy-Org'),
    mk(-100256, -10000344, 'Mage-Flow INT8', 'DiffusionModel', 'Mage-Flow', 'mage_flow',
         'diffusion_models', 'mage_flow_int8_convrot.safetensors', 'Comfy-Org/Mage-Flow', 'diffusion_models/mage_flow_int8_convrot.safetensors',
         4159146848, 'e081068163d7793b7e0d54ae2a773d3ac1c0d5b099c09b69dcbff36448485ae8', 'int8',
         'Mage-Flow 4B 文生图主模型 INT8, 微软开源, 原生 512-2048 分辨率', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/Mage_flow.png', 103268, 120, 'Comfy-Org'),
    mk(-100257, -10000343, 'Mage-Flow Turbo INT8', 'DiffusionModel', 'Mage-Flow', 'mage_flow',
         'diffusion_models', 'mage_flow_turbo_int8_convrot.safetensors', 'Comfy-Org/Mage-Flow', 'diffusion_models/mage_flow_turbo_int8_convrot.safetensors',
         4159146840, '327c3967a5190ea52e453ec3dd81ba168e37a2a0ff2c763aa3e9260bbbe1913c', 'int8',
         'Mage-Flow Turbo 4 步蒸馏 INT8, 约 0.6s/图 (A100)', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/Mage_flow_turbo.png', 103268, 120, 'Comfy-Org'),
    mk(-100258, -10000342, 'Mage-Flow VAE BF16', 'VAE', 'Mage-Flow', 'mage_flow',
         'vae', 'mage_flow_vae_bf16.safetensors', 'Comfy-Org/Mage-Flow', 'vae/mage_flow_vae_bf16.safetensors',
         345053056, '34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0', 'bf16',
         'Mage-Flow 专属 VAE, BF16', 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/output/Mage_flow.png', 103268, 120, 'Comfy-Org'),
    mk(-100259, -10000341, 'MelBandRoFormer FP16', 'DiffusionModel', 'MelBandRoFormer', 'unknown',
         'diffusion_models', 'MelBandRoformer_fp16.safetensors', 'Kijai/MelBandRoFormer_comfy', 'MelBandRoformer_fp16.safetensors',
         456479072, '6119aef379a6c7264e0b37db65ae1e6488b8ca4a00baf56d6d244737b8488226', 'fp16',
         'MelBandRoFormer 音乐人声/伴奏分离模型, 需 ComfyUI-MelBandRoFormer 自定义节点', '', 89830, 43, 'Kijai'),
    mk(-100260, -10000340, 'CLIP-Vision H', 'TextEncoder', 'Wan 2.1', 'wan21',
         'text_encoders', 'clip_vision_h.safetensors', 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', 'split_files/clip_vision/clip_vision_h.safetensors',
         1264219396, '64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161', 'v1.0',
         'CLIP-ViT-H 视觉编码器, Wan 2.1 图生视频使用', '', 2236045, 948, 'Comfy-Org'),
    mk(-100261, -10000339, 'Flux.1 Redux Dev', 'DiffusionModel', 'Flux.1 D', 'flux',
         'diffusion_models', 'flux1-redux-dev.safetensors', 'Comfy-Org/flux1-redux-dev', 'flux1-redux-dev.safetensors',
         129063232, 'a1b3bdcb4bdc58ce04874b9ca776d61fc3e914bb6beab41efb63e4e2694dca45', 'dev',
         'Flux.1 Redux Dev 风格迁移模型', '', 5351, 6, 'Comfy-Org'),
    mk(-100262, -10000338, 'CLIP-Vision G', 'TextEncoder', 'SDXL', 'sdxl',
         'text_encoders', 'clip_vision_g.safetensors', 'comfyanonymous/clip_vision_g', 'clip_vision_g.safetensors',
         3689911098, '9908329b3ead722a693ea400fab1d7c9ec91d6736fd194a94d20d793457f9c2e', 'v1.0',
         'CLIP-ViT-G 视觉编码器, SDXL Revision 使用', '', 0, 76, 'comfyanonymous'),
    mk(-100263, -10000337, 'SigCLIP Vision Patch14 384', 'TextEncoder', 'Flux.1 D', 'flux',
         'text_encoders', 'sigclip_vision_patch14_384.safetensors', 'Comfy-Org/HunyuanVideo_1.5_repackaged', 'split_files/clip_vision/sigclip_vision_patch14_384.safetensors',
         856505640, '1fee501deabac72f0ed17610307d7131e3e9d1e838d0363aa3c2b97a6e03fb33', 'v1.0',
         'SigCLIP 视觉编码器, Flux.1 USO/Redux 使用', '', 447893, 94, 'Comfy-Org'),
    mk(-100264, -10000336, 'USO Flux.1 Projector V1', 'DiffusionModel', 'Flux.1 D', 'flux',
         'diffusion_models', 'uso-flux1-projector-v1.safetensors', 'Comfy-Org/USO_1.0_Repackaged', 'split_files/model_patches/uso-flux1-projector-v1.safetensors',
         21548200, '9a0dfcd6644e3acaf6995625562ab0af1f9cf048bf739c7e5822ee106fb44311', 'v1.0',
         'USO 1.0 projector, Flux.1 Dev 参考图生成', '', 28770, 18, 'Comfy-Org')
    ]
  })(),
]