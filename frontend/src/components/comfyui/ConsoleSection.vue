<script setup lang="ts">
/**
 * ConsoleSection — ComfyUI 日志分区 (C08)。
 *
 * 运行页最后一块: 日志 (SectionHeader 折叠标题, 默认展开),
 * 数据源沿用现有 useLogStream 的 comfy 历史 + SSE 流。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLogStream } from '@/composables/useLogStream'
import LogPanel from '@/components/ui/LogPanel.vue'
import SectionHeader from '@/components/ui/SectionHeader.vue'

defineOptions({ name: 'ConsoleSection' })

const { t } = useI18n({ useScope: 'global' })

const logOpen = ref(true)

const { lines: logLines, status: logStatus, hasMore: logHasMore, loadingMore: logLoadingMore, prepending: logPrepending, onScroll: logOnScroll, start: logStart, stop: logStop } = useLogStream({
  historyUrl: '/api/logs/comfy',
  streamUrl: '/api/logs/comfy/stream',
  classify(line) {
    if (/error|exception|traceback/i.test(line)) return 'log-error'
    if (/warn/i.test(line)) return 'log-warn'
    if (/loaded|model|checkpoint|lora/i.test(line)) return 'log-info'
    return ''
  },
})

onMounted(() => { logStart() })
onUnmounted(() => { logStop() })
</script>

<template>
  <SectionHeader icon="terminal" collapsible v-model:expanded="logOpen">
    {{ t('comfyui.sections.log') }}
  </SectionHeader>
  <LogPanel
    v-show="logOpen"
    :lines="logLines"
    :status="logStatus"
    :has-more="logHasMore"
    :loading-more="logLoadingMore"
    :prepending="logPrepending"
    :on-scroll="logOnScroll"
    height="clamp(18rem, 42vh, 32rem)"
  />
</template>
