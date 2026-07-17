<script setup lang="ts">
/**
 * PromptHistoryModal — Browse and apply prompt history / favorites.
 *
 * Two tabs: History and Favorites.
 * Each item row shows positive/negative prompt preview, relative time,
 * favorite toggle, delete, and click-to-apply.
 */
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePromptLibrary } from '@/composables/generate/usePromptLibrary'
import { useConfirm } from '@/composables/useConfirm'
import type { PromptHistoryItem } from '@/types/prompt-library'
import BaseModal from '@/components/ui/BaseModal.vue'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'

defineOptions({ name: 'PromptHistoryModal' })

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [item: { positive: string; negative: string }]
}>()

const { t } = useI18n({ useScope: 'global' })
const { confirm } = useConfirm()
const lib = usePromptLibrary()

const SIZE = 10

const activeTab = ref<'history' | 'favorites'>('history')
const page = ref(1)
const items = ref<PromptHistoryItem[]>([])
const total = ref(0)
const loading = ref(false)
const loadingId = ref<number | null>(null)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / SIZE)))

const tabs = computed(() => [
  { key: 'history', label: t('prompt-library.history_modal.tab_history') },
  { key: 'favorites', label: t('prompt-library.history_modal.tab_favorites') },
])

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return t('prompt-library.history_modal.just_now')
  if (diff < 3600) return t('prompt-library.history_modal.minutes_ago', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('prompt-library.history_modal.hours_ago', { n: Math.floor(diff / 3600) })
  if (diff < 2592000) return t('prompt-library.history_modal.days_ago', { n: Math.floor(diff / 86400) })
  return new Date(timestamp * 1000).toLocaleDateString()
}

async function loadData() {
  loading.value = true
  try {
    const apiType = activeTab.value === 'favorites' ? 'favorite' : activeTab.value
    const resp = await lib.fetchHistory(apiType, page.value, SIZE)
    if (resp) {
      items.value = resp.items ?? []
      total.value = resp.total ?? 0
    } else {
      items.value = []
      total.value = 0
    }
  } finally {
    loading.value = false
  }
}

async function onToggleFavorite(item: PromptHistoryItem) {
  if (loadingId.value !== null) return
  loadingId.value = item.id
  try {
    await lib.toggleFavorite(item)
    await loadData()
  } finally {
    loadingId.value = null
  }
}

async function onDelete(item: PromptHistoryItem) {
  if (loadingId.value !== null) return
  const yes = await confirm({
    message: t('prompt-library.history_modal.confirm_delete'),
    variant: 'danger',
  })
  if (!yes) return
  loadingId.value = item.id
  try {
    await lib.deleteHistory(item.id)
    await loadData()
  } finally {
    loadingId.value = null
  }
}

function onApply(item: PromptHistoryItem) {
  emit('apply', { positive: item.positive, negative: item.negative })
}

function onTabChange(key: string) {
  if (key === 'history' || key === 'favorites') {
    activeTab.value = key
    page.value = 1
    loadData()
  }
}

function prevPage() {
  if (page.value > 1) {
    page.value--
    loadData()
  }
}

function nextPage() {
  if (page.value < totalPages.value) {
    page.value++
    loadData()
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      page.value = 1
      loadData()
    }
  },
)
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('prompt-library.history_modal.title')"
    icon="history"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <TabSwitcher
      :model-value="activeTab"
      :tabs="tabs"
      @update:model-value="onTabChange"
    />

    <div class="phm-list">
      <div v-if="loading" class="phm-loading">
        <Spinner size="md" />
        <span>{{ t('prompt-library.history_modal.loading') }}</span>
      </div>

      <EmptyState
        v-else-if="items.length === 0"
        icon="draft"
        :message="t('prompt-library.history_modal.empty')"
        density="compact"
      />

      <template v-else>
        <div
          v-for="item in items"
          :key="item.id"
          class="phm-item"
          @click="onApply(item)"
        >
          <div class="phm-item__content">
            <div class="phm-item__positive">{{ item.positive }}</div>
            <div v-if="item.negative" class="phm-item__negative">{{ item.negative }}</div>
            <div class="phm-item__time">{{ formatRelativeTime(item.created_at) }}</div>
          </div>
          <div class="phm-item__actions" @click.stop>
            <button
              class="phm-action-btn"
              :title="item.is_favorite ? t('prompt-library.history_modal.unfavorite') : t('prompt-library.history_modal.favorite')"
              :disabled="loadingId === item.id"
              @click="onToggleFavorite(item)"
            >
              <MsIcon
                name="star"
                size="xs"
                :color="item.is_favorite ? undefined : 'var(--t3)'"
              />
            </button>
            <button
              class="phm-action-btn phm-action-btn--danger"
              :title="t('prompt-library.history_modal.delete')"
              :disabled="loadingId === item.id"
              @click="onDelete(item)"
            >
              <MsIcon name="delete" size="xs" color="none" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="!loading && items.length > 0" class="phm-pagination">
      <button
        class="phm-page-btn"
        :disabled="page <= 1"
        @click="prevPage"
      >{{ t('prompt-library.history_modal.prev') }}</button>
      <span class="phm-page-info">{{ t('prompt-library.history_modal.page', { page, total: totalPages }) }}</span>
      <button
        class="phm-page-btn"
        :disabled="page >= totalPages"
        @click="nextPage"
      >{{ t('prompt-library.history_modal.next') }}</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.phm-list {
  min-height: 200px;
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.phm-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6) 0;
  color: var(--t3);
  font-size: var(--text-sm);
}

.phm-item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg);
  cursor: pointer;
  transition: border-color .15s;
}
.phm-item:hover {
  border-color: var(--ac);
}

.phm-item__content {
  flex: 1;
  min-width: 0;
}

.phm-item__positive {
  color: var(--t1);
  font-size: var(--text-sm);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
}

.phm-item__negative {
  color: var(--t3);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.phm-item__time {
  color: var(--t3);
  font-size: var(--text-xs);
  margin-top: 4px;
  opacity: .7;
}

.phm-item__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.phm-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: none;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--t2);
  transition: color .15s, background .15s;
}
.phm-action-btn:hover {
  color: var(--t1);
  background: var(--bg3);
}
.phm-action-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}
.phm-action-btn--danger:hover {
  color: var(--red);
}

.phm-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding-top: var(--sp-3);
}

.phm-page-btn {
  padding: 4px 12px;
  border: 1px solid var(--bd);
  border-radius: var(--r-sm);
  background: var(--bg);
  color: var(--t2);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: color .15s, border-color .15s;
}
.phm-page-btn:hover:not(:disabled) {
  color: var(--t1);
  border-color: var(--ac);
}
.phm-page-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.phm-page-info {
  color: var(--t3);
  font-size: var(--text-sm);
  white-space: nowrap;
}
</style>
