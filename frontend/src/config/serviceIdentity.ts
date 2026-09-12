/**
 * 服务身份图标单一来源 —— 侧栏、Dashboard 服务卡/诊断、Tunnel 服务行共用。
 *
 * 新增服务时只在此登记, 禁止在各页面各写一份 iconMap, 避免同一服务跨页不同图标。
 * 图标语义约定见 components/ui/MsIcon.vue 顶部注释。
 *
 * 注意: 这里是动态映射, build-fonts.sh 不会自动提取这些图标名;
 * 所有取值必须有其他静态调用点或已列入 icons.txt, 新增服务时需一并确认。
 */

const SERVICE_IDENTITY: Record<string, string> = {
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

export function serviceIcon(name: string, fallback = 'dns'): string {
  return SERVICE_IDENTITY[name.toLowerCase()] ?? fallback
}
