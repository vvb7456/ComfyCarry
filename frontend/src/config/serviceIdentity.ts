/**
 * 服务身份图标单一来源 —— 侧栏、Dashboard 服务卡/诊断、Tunnel 服务行共用。
 *
 * 返回品牌 mark (BrandName) 或 MsIcon 名 (IconName) 二选一:
 *   - 有官方 mark 的服务 (ComfyUI / Jupyter) 用品牌单色图标;
 *   - 其余服务继续用 Material Symbols 语义图标。
 * 页面通过 components/ui/ServiceIdentityIcon.vue 渲染, 不在各页各写一份 iconMap。
 *
 * MsIcon 名必须同时出现在 frontend/icons.txt (字体子集清单), 否则 IconName 类型会报错。
 */
import type { BrandName } from '@/config/brand-icons'
import type { IconName } from '@/config/icon-codepoints'

export interface ServiceIdentity {
  brand?: BrandName
  icon?: IconName
}

const SERVICE_IDENTITY: Record<string, ServiceIdentity> = {
  dashboard: { icon: 'dashboard' },
  comfycarry: { icon: 'dashboard' },
  comfyui: { brand: 'comfyui' },
  comfy: { brand: 'comfyui' },
  jupyter: { brand: 'jupyter' },
  jupyterlab: { brand: 'jupyter' },
  sync: { icon: 'cloud_sync' },
  'sync-worker': { icon: 'cloud_sync' },
  tunnel: { icon: 'vpn_lock' },
  'cf-tunnel': { icon: 'vpn_lock' },
  'cf-tunnel-next': { icon: 'vpn_lock' },
  ssh: { icon: 'key' },
}

export function serviceIdentity(name: string, fallback: IconName = 'dns'): ServiceIdentity {
  return SERVICE_IDENTITY[name.toLowerCase()] ?? { icon: fallback }
}
