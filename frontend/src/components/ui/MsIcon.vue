<script setup lang="ts">
import { computed } from 'vue'
import { ICON_CODEPOINTS } from '@/config/icon-codepoints'

defineOptions({ name: 'MsIcon' })

const props = defineProps<{
  /** Material Symbols icon name */
  name: string
  /** Size variant: xxs(12) | xs(16) | sm(18, default) | md(20) | lg(32) | xl(48) */
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** 着色。默认继承父级文字色; 仅在表达状态时显式传入语义色变量 */
  color?: string
}>()

/**
 * 图标默认不着色 —— 继承父级文字色。
 *
 * 旧实现有一张 icon name → color 的全局映射表 (73 个硬编码 hex), 任何图标
 * 不传 color 就按名字自动上色。后果是一屏 7~8 种色相, 语义色被稀释:
 * 当 `add` 也是绿的、`search` 也是蓝的, "绿=正常/红=异常" 就失去了指示作用。
 *
 * 现在颜色只用于表达状态, 且必须由调用方显式传入 —— 通常传语义变量
 * (var(--green)/var(--amber)/var(--red)/var(--blue)), 其余一律继承。
 */

/**
 * 图标语义约定 (全仓库审计见 docs/ICON_AUDIT_20260912.md §4.3/§4.5):
 *
 * 身份: 服务身份统一走 config/serviceIdentity.ts, 禁止各页自建 iconMap;
 *       模型 view_in_ar · 版本 new_releases · 构建 commit · 日志 subject · Canny line_curve · 深度 terrain · LoRA layers
 * 动作: 关闭 close · 取消异步任务 cancel · 从列表/配置移除 remove_circle · 真删除 delete (需 confirm 守卫)
 *       清空全部 delete_sweep · 重试失败动作 replay · 刷新数据 refresh · 重启服务 restart_alt · 重连/重生成凭证 autorenew
 *       站内跳转 arrow_forward · 打开外链 open_in_new · 对象启用/禁用 toggle_on/toggle_off
 * 状态: 成功 check_circle · 错误 error · 服务端错误 error_outline · 离线 cloud_off · 无结果 search_off
 * 空态: 无历史 history · 无文件 folder_off · 无可下载版本 file_download_off · 待下载 pending
 * 媒体: 生成任务/生成能力 videocam · 视频文件/媒体资产/结果 movie
 * 进程: 暂停/恢复 pause/play_arrow · 服务启停 play_arrow/stop
 *
 * hover 约定: 非破坏性按钮一律中性反馈 (表面 --bg3/--bg4, 浮层 --overlay-dark),
 * 不得用 red/amber 等语义色做 hover 暗示; 只有 confirm 守卫过的危险操作才用 danger 变体。
 */

const sizeClass = computed(() => {
  if (!props.size || props.size === 'sm') return 'ms-sm'
  if (props.size === 'md') return ''
  return `ms-${props.size}`
})

const iconChar = computed(() => ICON_CODEPOINTS[props.name] || props.name)

const iconStyle = computed(() => {
  // 'none' 保留为显式"继承"写法 (与默认行为一致, 兼容既有调用点)
  if (!props.color || props.color === 'none') return undefined
  return { color: props.color }
})
</script>

<template>
  <span class="ms" :class="sizeClass" :style="iconStyle">{{ iconChar }}</span>
</template>
