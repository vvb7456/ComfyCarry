/**
 * 依赖品牌图标表 —— 品牌 id → 素材 URL 的单一来源。
 *
 * 素材经 Vite 静态资源处理 (默认导出 URL, 构建时哈希带缓存)。
 * 单色版走 CSS mask 跟随文字色 (身份位), 彩色版用于选择位;
 * 新增品牌只改这里, 不要在页面里零散写 <img src>。
 *
 * 素材来源、授权与画布归一化说明见 assets/brand/SOURCES.md。
 */
import awsColor from '@/assets/brand/aws-color.svg'
import civitaiMono from '@/assets/brand/civitai-mono.svg'
import cloudflareColor from '@/assets/brand/cloudflare-color.svg'
import comfyuiColor from '@/assets/brand/comfyui-color.svg'
import comfyuiMono from '@/assets/brand/comfyui-mono.svg'
import dockerMono from '@/assets/brand/docker-mono.svg'
import dropboxColor from '@/assets/brand/dropbox-color.svg'
import githubMono from '@/assets/brand/github-mono.svg'
import googleDriveColor from '@/assets/brand/googledrive-color.svg'
import hfMono from '@/assets/brand/hf-mono.svg'
import jupyterColor from '@/assets/brand/jupyter-color.svg'
import jupyterMono from '@/assets/brand/jupyter-mono.svg'
import oneDriveColor from '@/assets/brand/onedrive-color.svg'

export interface BrandAsset {
  /** 品牌显示名, 仅用于可读性与排查 */
  label: string
  /** 单色素材 URL (24×24 画布, 图形占 84%), 配合 mask 使用 */
  mono?: string
  /** 官方彩色素材 URL, 原比例与配色 */
  color?: string
}

export const BRAND_ASSETS = {
  comfyui: { label: 'ComfyUI', mono: comfyuiMono, color: comfyuiColor },
  jupyter: { label: 'Jupyter', mono: jupyterMono, color: jupyterColor },
  hf: { label: 'Hugging Face', mono: hfMono },
  civitai: { label: 'CivitAI', mono: civitaiMono },
  googledrive: { label: 'Google Drive', color: googleDriveColor },
  onedrive: { label: 'OneDrive', color: oneDriveColor },
  dropbox: { label: 'Dropbox', color: dropboxColor },
  aws: { label: 'AWS', color: awsColor },
  cloudflare: { label: 'Cloudflare R2', color: cloudflareColor },
  github: { label: 'GitHub', mono: githubMono },
  docker: { label: 'Docker', mono: dockerMono },
} as const satisfies Record<string, BrandAsset>

export type BrandName = keyof typeof BRAND_ASSETS
