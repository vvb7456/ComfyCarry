<script setup lang="ts">
/**
 * EmbeddingModal — Browse and insert embeddings into prompts.
 *
 * Layout: 640px BaseModal with search bar + scrollable list.
 * Each row: name | size | weight spinner | [→ 正向] [→ 负向]
 *
 * Legacy: gen-emb-modal in dashboard.html + _openEmbeddingModal / _insertEmbedding in page-generate.js
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseEmbeddingPickerReturn, EmbeddingItem } from '@/composables/generate/useEmbeddingPicker'
import BaseModal from '@/components/ui/BaseModal.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import FilterInput from '@/components/ui/FilterInput.vue'

defineOptions({ name: 'EmbeddingModal' })

const props = defineProps<{
  modelValue: boolean
  picker: UseEmbeddingPickerReturn
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  insert: [token: string, target: 'positive' | 'negative']
}>()

const { t } = useI18n({ useScope: 'global' })

// Per-item weight (defaults to 1.0, tracked locally)
const weights = ref<Record<string, number>>({})

function getWeight(name: string): number {
  return weights.value[name] ?? 1.0
}

function setWeight(name: string, val: number) {
  weights.value[name] = val
}

function onInsert(item: EmbeddingItem, target: 'positive' | 'negative') {
  const w = getWeight(item.name)
  const token = w === 1.0
    ? `embedding:${item.name}`
    : `(embedding:${item.name}:${w})`
  emit('insert', token, target)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('generate.embedding.title')"
    icon="link"
    icon-color="none"
    width="640px"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Search bar -->
    <FilterInput
      v-model="picker.search.value"
      :placeholder="t('generate.embedding.search_placeholder')"
      class="emb-search"
    />

    <!-- List area -->
    <div class="emb-list">
      <!-- Loading -->
      <div v-if="picker.loading.value" class="emb-empty">
        <Spinner size="md" />
        <span>{{ t('generate.embedding.loading') }}</span>
      </div>

      <!-- Load failed / empty -->
      <div v-else-if="picker.embeddings.value.length === 0" class="emb-empty">
        <MsIcon name="warning" size="lg" color="var(--t3)" />
        <span>{{ t('generate.embedding.load_failed') }}</span>
      </div>

      <!-- No match -->
      <div v-else-if="picker.filtered.value.length === 0" class="emb-empty">
        <MsIcon name="search_off" size="lg" color="var(--t3)" />
        <span>{{ t('generate.embedding.no_match') }}</span>
      </div>

      <!-- Items -->
      <div
        v-for="item in picker.filtered.value"
        v-else
        :key="item.path"
        class="emb-row"
      >
        <!-- Name -->
        <div class="emb-row__name" :title="item.path">{{ item.name }}</div>

        <!-- Size -->
        <div class="emb-row__size">{{ formatSize(item.size) }}</div>

        <!-- Weight -->
        <NumberInput
          :model-value="getWeight(item.name)"
          :min="0.1"
          :max="2.0"
          :step="0.1"
          class="emb-row__weight"
          @update:model-value="setWeight(item.name, $event)"
        />

        <!-- Insert buttons -->
        <button
          class="emb-insert-btn"
          :title="t('generate.embedding.to_positive_title')"
          @click="onInsert(item, 'positive')"
        >
          {{ t('generate.embedding.to_positive') }}
        </button>
        <button
          class="emb-insert-btn"
          :title="t('generate.embedding.to_negative_title')"
          @click="onInsert(item, 'negative')"
        >
          {{ t('generate.embedding.to_negative') }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
/* ── Search ── */
.emb-search {
  margin-bottom: var(--sp-3);
}

/* ── List ── */
.emb-list {
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.emb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--t3);
  font-size: var(--text-sm);
}

/* ── Row ── */
.emb-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 8px 4px;
  border-bottom: 1px solid var(--bd);
}

.emb-row:last-child {
  border-bottom: none;
}

.emb-row__name {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.emb-row__size {
  font-size: var(--text-xs);
  color: var(--t3);
  white-space: nowrap;
  min-width: 60px;
  text-align: right;
}

/* ── Weight ── */
.emb-row__weight {
  width: 70px;
  flex-shrink: 0;
}

/* ── Insert buttons ── */
.emb-insert-btn {
  font-size: var(--text-xs);
  color: var(--ac);
  background: transparent;
  border: 1px solid var(--ac);
  border-radius: var(--r-sm);
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.emb-insert-btn:hover {
  background: var(--ac);
  color: var(--bg);
}
</style>
