// MsIcon 名必须同时出现在 frontend/icons.txt (字体子集清单), 否则 IconName 类型会报错。
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
