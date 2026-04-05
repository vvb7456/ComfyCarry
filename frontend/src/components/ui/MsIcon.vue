<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'MsIcon' })

const props = defineProps<{
  /** Material Symbols icon name */
  name: string
  /** Size variant: xxs(12) | xs(16) | sm(18, default) | md(20) | lg(32) | xl(48) */
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Override color. Pass explicit color value, or 'none' to inherit from parent */
  color?: string
}>()

/**
 * Global icon color palette — matches legacy ICON_COLORS from core.js
 * Categories: green(success), red(danger), amber(warning), blue(info),
 * purple(tools), pink(creative), cyan(tech), orange(notebook),
 * yellow(files/keys), muted(system)
 */
const ICON_COLORS: Record<string, string> = {
  // Green: success / active / positive
  check_circle: 'var(--green)', check: 'var(--green)', play_arrow: '#34d399',
  cloud_sync: '#34d399', sync: '#34d399', trending_up: '#34d399',
  cloud_upload: '#34d399', settings_input_antenna: '#34d399',
  add: '#34d399', save: '#34d399', public: '#34d399',
  refresh: '#34d399', arrow_upward: '#34d399',
  // Red: danger / close / stop
  close: 'var(--red)', stop: 'var(--red)', cancel: 'var(--red)', error: 'var(--red)',
  // Amber-Orange: warning / pending / loading
  warning: 'var(--amber)', hourglass_top: 'var(--amber)', timer: '#fb923c',
  bolt: '#fb923c', restart_alt: '#fb923c', pause: '#fbbf24', queue: '#fb923c',
  assignment: '#fb923c', celebration: '#fbbf24',
  // Blue: info / links / download / cloud
  download: '#60a5fa', upload: '#60a5fa', link: '#60a5fa', info: '#60a5fa',
  cloud: '#60a5fa', cloud_download: '#60a5fa', language: '#60a5fa', search: '#60a5fa', visibility: '#60a5fa',
  zoom_in: '#60a5fa', storage: '#60a5fa', content_copy: '#60a5fa', dns: '#60a5fa',
  content_paste: '#60a5fa', arrow_downward: '#60a5fa',
  // Purple: tools / config / meta
  extension: '#a78bfa', inventory_2: '#a78bfa', label: '#a78bfa',
  dashboard: '#8b5cf6', monitoring: '#8b5cf6', package_2: '#a78bfa', edit: '#a78bfa',
  rule: '#a78bfa',
  // Pink: creative / media
  palette: '#f472b6', image: '#f472b6', videocam: '#f472b6',
  brush: '#f472b6', push_pin: '#f472b6', thumb_up: '#f472b6',
  auto_awesome: '#ffb4b4',
  // Cyan: tech
  terminal: '#22d3ee', memory: '#22d3ee', developer_board: '#22d3ee',
  smart_toy: '#60a5fa',
  // Orange: notebook
  book_2: '#fb923c', build: '#fb923c',
  deployed_code: '#34d399',
  // Yellow: files / keys / stars
  key: '#fbbf24', lock: '#fbbf24', folder: '#fbbf24', folder_open: '#fbbf24',
  pan_tool: '#fbbf24', star: '#fbbf24',
  wifi_tethering: '#34d399',
  // Muted: system / generic
  settings: '#94a3b8', tune: '#94a3b8', description: '#94a3b8',
  receipt_long: '#94a3b8', person: '#94a3b8', schedule: '#94a3b8',
  hard_drive_2: '#94a3b8', image_not_supported: '#94a3b8', history: '#94a3b8',
  logout: '#94a3b8', arrow_back: '#94a3b8',
}

const sizeClass = computed(() => {
  if (!props.size || props.size === 'sm') return 'ms-sm'
  if (props.size === 'md') return ''
  return `ms-${props.size}`
})

const iconStyle = computed(() => {
  if (props.color === 'none') return undefined
  const c = props.color || ICON_COLORS[props.name]
  return c ? { color: c } : undefined
})
</script>

<template>
  <span class="ms" :class="sizeClass" :style="iconStyle">{{ name }}</span>
</template>
