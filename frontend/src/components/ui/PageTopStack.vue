<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ name: 'PageTopStack' })

withDefaults(defineProps<{ enabled?: boolean }>(), { enabled: true })

const toolbarTarget = ref<HTMLDivElement | null>(null)
defineExpose({ toolbarTarget })
</script>

<template>
  <div class="page-top-stack" :class="{ 'page-top-stack--enabled': enabled }">
    <slot />
    <div ref="toolbarTarget" class="page-top-stack__toolbar" />
  </div>
</template>

<style scoped>
.page-top-stack {
  display: contents;
}

.page-top-stack--enabled {
  display: flow-root;
  position: sticky;
  top: 0;
  z-index: 20;
  margin-top: calc(-1 * var(--page-body-pt));
  padding-top: var(--page-body-pt);
}

/* 完整遮挡顶部区域及其原有留白, 不向内容区外溢。
   羽化收进 toolbar 12px 下留白的末段: 未滚动时不压首行内容,
   滚动时内容在留白内渐隐淡出。仅底衬渐隐, 不裁剪控件。 */
.page-top-stack--enabled::before {
  content: '';
  position: absolute;
  inset: 0 calc(-1 * var(--page-pad));
  z-index: -1;
  pointer-events: none;
  background: var(--bg-ambient);
  background-attachment: fixed;
  mask-image: linear-gradient(to bottom, black calc(100% - 8px), transparent);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 8px), transparent);
}

/* 内层 PageHeaderRow 由页面传 :sticky="false", 无需此处覆盖 */

.page-top-stack__toolbar {
  display: flow-root;
}
</style>
