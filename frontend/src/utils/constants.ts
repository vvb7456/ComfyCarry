export const CIVITAI_API_BASE = 'https://civitai.com/api/v1'

/** Model category → badge color mapping (used by Badge component across pages) */
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
}
