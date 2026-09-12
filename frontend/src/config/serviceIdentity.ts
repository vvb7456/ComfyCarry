/**
 * 服务身份图标单一来源 —— 侧栏、Dashboard 服务卡/诊断、Tunnel 服务行共用。
 *
 * 新增服务时只在此登记, 禁止在各页面各写一份 iconMap, 避免同一服务跨页不同图标。
 * 图标语义约定见 components/ui/MsIcon.vue 顶部注释。
 *
 * 图标名必须同时出现在 frontend/icons.txt (字体子集清单), 否则 IconName 类型会报错。
 */
import type { IconName } from '@/config/icon-codepoints'

const SERVICE_IDENTITY: Record<string, IconName> = {
  dashboard: 'dashboard',
  comfycarry: 'dashboard',
  comfyui: 'terminal',
  comfy: 'terminal',
  jupyter: 'book_2',
  jupyterlab: 'book_2',
  sync: 'cloud_sync',
  'sync-worker': 'cloud_sync',
  tunnel: 'vpn_lock',
  'cf-tunnel': 'vpn_lock',
  ssh: 'key',
}

export function serviceIcon(name: string, fallback: IconName = 'dns'): IconName {
  return SERVICE_IDENTITY[name.toLowerCase()] ?? fallback
}
