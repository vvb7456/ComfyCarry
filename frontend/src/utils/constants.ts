export const CIVITAI_API_BASE = 'https://civitai.com/api/v1'

/** Model category → badge color mapping (used by Badge component across pages) */
export const MODEL_CATEGORY_COLORS: Record<string, string> = {
  checkpoints: '#f472b6',
  loras: '#60a5fa',
  embeddings: '#22d3ee',
  controlnet: '#fb923c',
  vae: '#22c55e',
  upscale_models: '#a855f7',
}
