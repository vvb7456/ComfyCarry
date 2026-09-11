<script setup lang="ts">
/**
 * ListPagination — 服务端分页的纯展示控件，与 ListRow 组合使用。
 *
 * 居中单组布局: 上一页箭头 + 「当前页 / 总页数」+ 下一页箭头。
 * 总数由所在分区的计数承载, 这里不再重复显示。
 * 组件只负责合法页码、首末页与 loading 禁用；请求与列表数据由调用方负责。
 * total <= pageSize 时整体隐藏，空列表（total=0）由页面空态承接。
 *
 * 用法：
 *   <ListPagination
 *     :page="page"
 *     :page-size="5"
 *     :total="total"
 *     :loading="loading"
 *     @update:page="page = $event"
 *   />
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from './BaseButton.vue'
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'ListPagination' })

const props = withDefaults(defineProps<{
  /** 从 1 开始的当前页 */
  page: number
  pageSize: number
  total: number
  loading?: boolean
}>(), {
  loading: false,
})

const emit = defineEmits<{ 'update:page': [page: number] }>()

const { t } = useI18n({ useScope: 'global' })

const totalPages = computed(() => {
  if (!props.pageSize || props.pageSize <= 0) return 1
  return Math.max(1, Math.ceil(props.total / props.pageSize))
})

// 只有一页（含空列表）时隐藏整个翻页区域
const visible = computed(() => props.total > props.pageSize)

// 归一化传入的越界页码：显示与派发都收敛到 [1, totalPages]
const currentPage = computed(() => {
  const n = Math.floor(Number(props.page)) || 1
  return Math.min(Math.max(1, n), totalPages.value)
})

const canPrev = computed(() => !props.loading && currentPage.value > 1)
const canNext = computed(() => !props.loading && currentPage.value < totalPages.value)

function go(target: number) {
  if (props.loading || target < 1 || target > totalPages.value) return
  if (target === currentPage.value) return
  emit('update:page', target)
}
</script>

<template>
  <div v-if="visible" class="list-pagination">
    <BaseButton
      variant="ghost"
      size="sm"
      icon-only
      :disabled="!canPrev"
      :aria-label="t('common.pagination.prev')"
      @click="go(currentPage - 1)"
    >
      <MsIcon name="chevron_left" />
    </BaseButton>
    <span class="list-pagination__page">
      {{ t('common.pagination.page_of', { page: currentPage, total: totalPages }) }}
    </span>
    <BaseButton
      variant="ghost"
      size="sm"
      icon-only
      :disabled="!canNext"
      :aria-label="t('common.pagination.next')"
      @click="go(currentPage + 1)"
    >
      <MsIcon name="chevron_right" />
    </BaseButton>
  </div>
</template>

<style scoped>
/* 居中单组: 箭头 + 页码 + 箭头 (标准分页形态); 小字、静音色 */
.list-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding-top: 10px;
  font-size: var(--text-xs);
  color: var(--t3);
}

.list-pagination__page {
  font-family: var(--font-tabular);
  white-space: nowrap;
  min-width: 5.5em;
  text-align: center;
}
</style>
