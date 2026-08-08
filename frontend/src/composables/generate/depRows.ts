import type { DepRow } from './useDependencyStatus'
import {
  requiredComponents,
  componentsForSlot,
  type ComponentFile,
  type ComponentContext,
} from '@/config/component-registry'
import { HF_VERSION_INDEX } from '@/config/huggingface-models'

/**
 * 运行组件 (拆分形态的 UNet 外挂件) → 依赖行。
 *
 * 依赖状态机与展示组件都是通用的, 架构相关的知识 (哪个文件是文本编码器/VAE/
 * 加速件) 在这里一次性折进行的 hint, 组件侧不再认识 registry。
 *
 * 文件携带白名单锚点 (hf), 下载走 huggingface 统一通道。
 */
export function componentDepRows(
  arch: string,
  ctx: ComponentContext | undefined,
  t: (key: string) => string,
): DepRow[] {
  const files = requiredComponents(arch, undefined, ctx)
  return files.map<DepRow>(f => ({
    id: f.id,
    label: f.label,
    hint: roleText(arch, f, t),
    bytes: f.bytes,
    required: true,
    files: [{ filename: f.filename, url: f.url, subdir: f.subdir, hf: HF_VERSION_INDEX.get(f.hfVersionId) }],
    meta: f,
  }))
}

/** 该文件在架构里承担的角色文案 (文本编码器 1/2、VAE、音频 VAE、加速件) */
function roleText(arch: string, f: ComponentFile, t: (key: string) => string): string {
  const inSlot = (slot: 'clip' | 'clip2' | 'vae' | 'audio_vae' | 'lightning') =>
    componentsForSlot(arch, slot).some(x => x.id === f.id)

  if (inSlot('clip')) {
    // 该架构有 clip2 → 本件是"文本编码器 1", 否则是唯一的"文本编码器"
    return componentsForSlot(arch, 'clip2').length > 0
      ? t('generate.components.role_text_encoder_1')
      : t('generate.components.role_text_encoder')
  }
  if (inSlot('clip2')) return t('generate.components.role_text_encoder_2')
  if (inSlot('vae')) return t('generate.components.role_vae')
  if (inSlot('audio_vae')) return t('generate.components.role_audio_vae')
  if (inSlot('lightning')) return t('generate.components.fast_files_hint')
  return ''
}
