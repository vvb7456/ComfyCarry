<script setup lang="ts">
/**
 * ModelPickerModal — Shared modal for Checkpoint (single-select) and LoRA (multi-select).
 *
 * Features:
 * - Search: filename, displayName, trigger_words (LoRA only)
 * - Folder chips: auto-extracted from model paths
 * - Preview images: local → CivitAI fallback → placeholder
 * - Architecture tag: baseModel from CivitAI info, or detected arch
 * - Selection: single-click (checkpoint) or toggle + confirm (LoRA)
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import ChipSelect, { type ChipOption } from '@/components/ui/ChipSelect.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'ModelPickerModal' })

export interface PickerModelItem {
  name: string
  preview: string | null
  arch: string
  triggers?: string | null
  info?: Record<string, unknown> | null
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  icon?: string
  items: PickerModelItem[]
  /** Multi-select mode (LoRA). Single-select (Checkpoint) by default. */
  multi?: boolean
  /** Currently selected names (for highlighting in grid) */
  selected?: Set<string>
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Count label for multi-select footer */
  countLabel?: string
}>(), {
  icon: 'deployed_code',
  multi: false,
  searchPlaceholder: '',
  countLabel: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Single-select: user clicked a model */
  select: [name: string]
  /** Multi-select: user toggled a model */
  toggle: [name: string]
  /** Multi-select: user confirmed selection */
  confirm: []
}>()

const { t } = useI18n({ useScope: 'global' })

// ── Search ──
const search = ref('')

// ── Folder filter ──
const activeFolder = ref('')

const folders = computed<ChipOption[]>(() => {
  const set = new Set<string>()
  for (const m of props.items) {
    const idx = m.name.indexOf('/')
    if (idx > 0) set.add(m.name.substring(0, idx))
  }
  return [...set].sort().map(f => ({ value: f, label: f }))
})

// ── Filtered items ──
const filtered = computed(() => {
  let list = props.items

  // Folder filter
  if (activeFolder.value) {
    list = list.filter(m => m.name.startsWith(activeFolder.value + '/'))
  }

  // Search
  const q = search.value.toLowerCase().trim()
  if (q) {
    list = list.filter(m => {
      const displayName = getDisplayName(m).toLowerCase()
      const basename = m.name.toLowerCase()
      const triggers = m.triggers?.toLowerCase() || ''
      return basename.includes(q) || displayName.includes(q) || triggers.includes(q)
    })
  }

  return list
})

// ── Reset state on open ──
watch(() => props.modelValue, (open) => {
  if (open) {
    search.value = ''
    activeFolder.value = ''
  }
})

// ── Helpers ──
function getDisplayName(item: PickerModelItem): string {
  const infoName = item.info?.name
  if (infoName && typeof infoName === 'string') return infoName
  const base = item.name.includes('/') ? item.name.slice(item.name.lastIndexOf('/') + 1) : item.name
  return base.replace(/\.[^.]+$/, '')
}

function getPreviewUrl(item: PickerModelItem): string | null {
  if (item.preview) return `/api/local_models/preview?path=${encodeURIComponent(item.preview)}`
  // CivitAI fallback
  const civitImg = (item.info as Record<string, unknown>)?.images as Array<Record<string, unknown>> | undefined
  const first = civitImg?.[0]
  if (first?.url && typeof first.url === 'string' && first.url.startsWith('http')) return first.url
  return null
}

function getModelTag(item: PickerModelItem): string {
  const baseModel = (item.info as Record<string, unknown>)?.baseModel
  if (baseModel && typeof baseModel === 'string') return baseModel
  if (item.arch && item.arch !== 'unknown') {
    const labels: Record<string, string> = { sd15: 'SD 1.5', sdxl: 'SDXL', flux: 'Flux', sd3: 'SD3' }
    return labels[item.arch] || item.arch
  }
  return ''
}

function isArchTag(item: PickerModelItem): boolean {
  const baseModel = (item.info as Record<string, unknown>)?.baseModel
  return !(baseModel && typeof baseModel === 'string')
}

function isPreviewVideo(item: PickerModelItem): boolean {
  if (item.preview) return false
  const civitImg = (item.info as Record<string, unknown>)?.images as Array<Record<string, unknown>> | undefined
  return civitImg?.[0]?.type === 'video'
}

function onCardClick(item: PickerModelItem) {
  if (props.multi) {
    emit('toggle', item.name)
  } else {
    emit('select', item.name)
  }
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="title"
    :icon="icon"
    size="lg"
    density="default"
    scroll="none"
  >
    <!-- Search + Chips -->
    <div class="picker-toolbar">
      <FilterInput
        v-model="search"
        :placeholder="searchPlaceholder"
        class="picker-search"
      />
      <ChipSelect
        v-if="folders.length > 0"
        :options="folders"
        :model-value="activeFolder"
        :all-option="t('common.filter.all')"
        :collapsed-rows="1"
        class="picker-chips"
        @update:model-value="activeFolder = $event as string"
      />
    </div>

    <!-- Grid -->
    <div class="picker-grid-wrap">
      <div v-if="filtered.length === 0" class="picker-empty">
        <MsIcon name="deployed_code_alert" color="none" />
        <span>{{ t('common.no_results') }}</span>
      </div>
      <div v-else class="picker-grid">
        <div
          v-for="item in filtered"
          :key="item.name"
          class="model-card"
          :class="{ 'model-card--selected': selected?.has(item.name) }"
          :title="getDisplayName(item)"
          @click="onCardClick(item)"
        >
          <div class="model-card__img">
            <template v-if="getPreviewUrl(item)">
              <video
                v-if="isPreviewVideo(item)"
                :src="getPreviewUrl(item)!"
                muted autoplay loop playsinline disablepictureinpicture preload="metadata"
                class="model-card__media"
              />
              <img
                v-else
                :src="getPreviewUrl(item)!"
                alt=""
                loading="lazy"
                class="model-card__media"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
            </template>
            <div v-if="!getPreviewUrl(item)" class="model-card__no-img">
              <MsIcon name="image_not_supported" color="none" />
            </div>
            <span v-if="getModelTag(item)" class="model-card__tag" :class="{ dim: isArchTag(item) }">
              {{ getModelTag(item) }}
            </span>
            <div v-if="multi" class="model-card__check">
              <MsIcon name="check" color="none" />
            </div>
          </div>
          <div class="model-card__body">
            <div class="model-card__name text-truncate">{{ getDisplayName(item) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer (multi-select only) -->
    <template v-if="multi" #footer>
      <span class="picker-count">{{ countLabel }}</span>
      <BaseButton @click="close">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton variant="primary" @click="emit('confirm')">{{ t('common.btn.confirm') }}</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.picker-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}

.picker-search {
  width: 100%;
}

.picker-chips {
  margin: 0;
}

/* Grid wrapper with scroll */
.picker-grid-wrap {
  overflow-y: auto;
  max-height: min(55vh, 520px);
  padding-right: 4px;
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--sp-2);
}

.picker-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-6);
  color: var(--t3);
  font-size: .85rem;
}

/* ── Model Card ── */
.model-card {
  background: var(--bg3);
  border: 2px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  cursor: pointer;
  transition: border-color .15s, transform .15s, box-shadow .15s;
  position: relative;
}

.model-card:hover {
  border-color: var(--ac);
  transform: translateY(-1px);
  box-shadow: var(--sh);
}

.model-card--selected {
  border-color: var(--ac);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ac) 30%, transparent);
}

.model-card__img {
  width: 100%;
  aspect-ratio: 4 / 5;
  background: var(--bg-in, var(--bg2));
  overflow: hidden;
  position: relative;
}

.model-card__img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.model-card__media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.model-card__no-img {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  opacity: .25;
  font-size: 1.8rem;
}

/* Architecture tag */
.model-card__tag {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  font-size: .58rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--ac);
  color: #fff;
  white-space: nowrap;
  max-width: calc(100% - 32px);
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  line-height: 1.4;
}

.model-card__tag.dim {
  background: var(--overlay);
  color: var(--t-inv-2);
}

/* Check mark (multi-select) */
.model-card__check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ac);
  color: #fff;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.model-card--selected .model-card__check {
  display: flex;
}

.model-card__body {
  padding: 6px 7px;
}

.model-card__name {
  font-size: .73rem;
  font-weight: 600;
  color: var(--t1);
}

/* Footer count */
.picker-count {
  margin-right: auto;
  font-size: .8rem;
  color: var(--t3);
}
</style>
