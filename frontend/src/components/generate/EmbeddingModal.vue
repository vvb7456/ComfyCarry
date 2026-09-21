<script setup lang="ts">
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
    icon="token"
    icon-color="none"
    size="lg"
    width="640px"
    density="default"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <FilterInput
      v-model="picker.search.value"
      :placeholder="t('generate.embedding.search_placeholder')"
      full
      class="emb-search"
    />

    <div class="emb-list">
      <div v-if="picker.loading.value" class="emb-empty">
        <Spinner size="md" />
        <span>{{ t('generate.embedding.loading') }}</span>
      </div>

      <div v-else-if="picker.embeddings.value.length === 0" class="emb-empty">
        <MsIcon name="warning" size="lg" color="var(--t3)" />
        <span>{{ t('generate.embedding.load_failed') }}</span>
      </div>

      <div v-else-if="picker.filtered.value.length === 0" class="emb-empty">
        <MsIcon name="search_off" size="lg" color="var(--t3)" />
        <span>{{ t('generate.embedding.no_match') }}</span>
      </div>

      <div
        v-for="item in picker.filtered.value"
        v-else
        :key="item.path"
        class="emb-row"
      >
        <div class="emb-row__name text-truncate" :title="item.path">{{ item.name }}</div>

        <div class="emb-row__size">{{ formatSize(item.size) }}</div>

        <NumberInput
          :model-value="getWeight(item.name)"
          :min="0.1"
          :max="2.0"
          :step="0.1"
          class="emb-row__weight"
          @update:model-value="setWeight(item.name, $event)"
        />

        <button
          type="button"
          class="emb-insert-btn"
          :title="t('generate.embedding.to_positive_title')"
          :aria-label="t('generate.embedding.to_positive_title')"
          @click="onInsert(item, 'positive')"
        >
          {{ t('generate.embedding.to_positive') }}
        </button>
        <button
          type="button"
          class="emb-insert-btn"
          :title="t('generate.embedding.to_negative_title')"
          :aria-label="t('generate.embedding.to_negative_title')"
          @click="onInsert(item, 'negative')"
        >
          {{ t('generate.embedding.to_negative') }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.emb-search {
  margin-bottom: var(--sp-3);
}

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
  min-width: 0;
}

.emb-row__size {
  font-size: var(--text-xs);
  color: var(--t3);
  white-space: nowrap;
  min-width: 60px;
  text-align: right;
}

.emb-row__weight {
  width: 70px;
  flex-shrink: 0;
}

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
