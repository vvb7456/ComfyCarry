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
import { useRouter } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FilterInput from '@/components/ui/FilterInput.vue'
import ChipSelect, { type ChipOption } from '@/components/ui/ChipSelect.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { ARCH_LABELS, effectiveArch, familyRoot } from '@/config/model-types'
import { useConfirm } from '@/composables/useConfirm'

defineOptions({ name: 'ModelPickerModal' })

export interface PickerModelItem {
  name: string
  preview: string | null
  arch: string
  triggers?: string | null
  info?: Record<string, unknown> | null
  packaging?: 'checkpoint' | 'split'
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
  /** Current tab's arch (archFilter[0]); when set, arch chips default + mismatch confirm */
  currentArch?: string
  /** 当前架构的运行组件是否缺失 (拆分形态卡片显示提示角标) */
  componentsMissing?: boolean
  /** §5.3 两形态并存时显示形态过滤 chip + 卡片徽章 */
  showPackagingFilter?: boolean
}>(), {
  icon: 'deployed_code',
  multi: false,
  searchPlaceholder: '',
  countLabel: '',
  currentArch: '',
  componentsMissing: false,
  showPackagingFilter: false,
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
const { confirm } = useConfirm()

// ── Search ──
const search = ref('')

// ── Arch filter ──
const activeArch = ref('')
// §5.3 Packaging filter (仅两形态并存时启用)
const activePackaging = ref<'checkpoint' | 'split' | ''>('')

// ── Arch chips (dynamic from items' effectiveArch field) ──
const archOptions = computed<ChipOption[]>(() => {
  const set = new Set<string>()
  for (const m of props.items) {
    const ea = effectiveArch(m)
    if (ea) set.add(ea)
  }
  // sort by ARCH_LABELS key order, unknown last
  const known = [...set].filter(a => a !== 'unknown')
    .sort((a, b) => {
      const ia = Object.keys(ARCH_LABELS).indexOf(a)
      const ib = Object.keys(ARCH_LABELS).indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  const unknown = set.has('unknown') ? ['unknown'] : []
  return [...known, ...unknown].map(a => ({
    value: a,
    label: a === 'unknown' ? t('generate.picker.arch_unknown') : (ARCH_LABELS[a] || a),
  }))
})

// §5.3 形态过滤 chip options (checkpoint=整合包 clay / split=拆分 teal)
const packagingOptions = computed<ChipOption[]>(() => [
  { value: 'checkpoint', label: t('generate.picker.packaging_checkpoint') },
  { value: 'split', label: t('generate.picker.packaging_split') },
])

// ── Filtered items ──
const filtered = computed(() => {
  let list = props.items

  // Arch filter (against effectiveArch)
  if (activeArch.value) {
    list = list.filter(m => effectiveArch(m) === activeArch.value)
  }

  // §5.3 Packaging filter (仅 showPackagingFilter 时生效)
  if (props.showPackagingFilter && activePackaging.value) {
    list = list.filter(m => (m.packaging ?? 'split') === activePackaging.value)
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
    activePackaging.value = ''
    // default to currentArch if present in items' effectiveArchs, else '全部'
    const archs = new Set(props.items.map(m => effectiveArch(m)))
    activeArch.value = (props.currentArch && archs.has(props.currentArch))
      ? props.currentArch : ''
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
  const ea = effectiveArch(item)
  if (ea && ea !== 'unknown') {
    return ARCH_LABELS[ea] || ea
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

async function onCardClick(item: PickerModelItem) {
  // 三级架构拦截 (规格 F4):
  //  1. 跨硬架构 (effectiveArch 与 currentArch 的家族根不同): 强警告
  //  2. 同家族软架构错配 (家族根同为 sdxl, 子架构不同且双方都明确): 软提醒
  //  3. 家族根同为 sdxl 但一方为通用 'sdxl' (无 sidecar/通用模型): 不拦截
  //  4. unknown: 现有 unknown confirm 不变
  // 多选模式下取消勾选不拦截 (移除不兼容项无需确认)
  const isDeselect = props.multi && props.selected?.has(item.name)
  if (props.currentArch && !isDeselect) {
    const itemEffArch = effectiveArch(item)
    if (itemEffArch !== props.currentArch) {
      const itemRoot = familyRoot(itemEffArch)
      const currentRoot = familyRoot(props.currentArch)

      if (itemEffArch === 'unknown') {
        // (4) unknown confirm 不变
        const ok = await confirm({
          title: t('generate.picker.arch_mismatch_title'),
          message: t('generate.picker.arch_unknown_desc'),
          dontAskKey: 'picker_arch_mismatch',
        })
        if (!ok) return
      } else if (itemRoot !== currentRoot) {
        // (1) 跨硬架构: 强警告文案不变
        const ok = await confirm({
          title: t('generate.picker.arch_mismatch_title'),
          message: t('generate.picker.arch_mismatch_desc', {
            model_arch: ARCH_LABELS[itemEffArch] || itemEffArch,
            tab_arch: ARCH_LABELS[props.currentArch] || props.currentArch,
          }),
          dontAskKey: 'picker_arch_mismatch',
        })
        if (!ok) return
      } else if (itemEffArch !== 'sdxl' && props.currentArch !== 'sdxl') {
        // (2) 同家族软架构错配: 双方都明确 (非通用 sdxl) → 软提醒
        const ok = await confirm({
          title: t('generate.picker.arch_mismatch_title'),
          message: t('generate.picker.subarch_mismatch_desc', {
            model_arch: ARCH_LABELS[itemEffArch] || itemEffArch,
            tab_arch: ARCH_LABELS[props.currentArch] || props.currentArch,
          }),
          dontAskKey: 'picker_arch_mismatch',
        })
        if (!ok) return
      }
      // (3) 家族根同为 sdxl 但一方为通用 'sdxl': 不拦截, 直接放行
    }
  }
  if (props.multi) {
    emit('toggle', item.name)
  } else {
    emit('select', item.name)
  }
}

function close() {
  emit('update:modelValue', false)
}

// ── Modal mode (list / empty only; component-state removed) ─────────────────
const router = useRouter()

const currentArchLabel = computed(() => {
  if (!props.currentArch) return ''
  return ARCH_LABELS[props.currentArch] || props.currentArch
})

const isItemsEmpty = computed(() => props.items.length === 0)

function goToDownloadPage() {
  close()
  router.push({ name: 'models' })
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
    <!-- ── ① 空态: 该 arch 两目录皆空 ── -->
    <div v-if="isItemsEmpty" class="picker-empty-state">
      <MsIcon name="cloud_download" color="none" class="picker-empty-icon" />
      <div class="picker-empty-title">{{ t('generate.picker.empty_title', { arch: currentArchLabel }) }}</div>
      <div class="picker-empty-desc">{{ t('generate.picker.empty_desc') }}</div>
      <BaseButton variant="primary" @click="goToDownloadPage">
        <MsIcon name="open_in_new" size="sm" color="none" /> {{ t('generate.picker.go_to_downloads') }}
      </BaseButton>
    </div>

    <!-- ── ③ 列表态 ── -->
    <template v-else>
      <!-- Search + Chips -->
      <div class="picker-toolbar">
        <FilterInput
          v-model="search"
          :placeholder="searchPlaceholder"
          class="picker-search"
        />
        <ChipSelect
          v-if="archOptions.length > 1"
          :options="archOptions"
          :model-value="activeArch"
          :all-option="t('generate.picker.arch_all')"
          :collapsed-rows="1"
          class="picker-chips"
          @update:model-value="activeArch = $event as string"
        />
        <!-- §5.3 形态过滤 chip (仅两形态并存时显示) -->
        <ChipSelect
          v-if="showPackagingFilter"
          :options="packagingOptions"
          :model-value="activePackaging"
          :all-option="t('generate.picker.arch_all')"
          :collapsed-rows="1"
          class="picker-chips picker-chips--packaging"
          @update:model-value="activePackaging = ($event || '') as 'checkpoint' | 'split' | ''"
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
              <!-- §5.3 形态徽章 (整合包=clay / 拆分=teal, 仅两形态并存时显示) -->
              <span
                v-if="showPackagingFilter && item.packaging"
                class="model-card__pkg-badge"
                :class="`model-card__pkg-badge--${item.packaging}`"
              >
                {{ item.packaging === 'checkpoint'
                  ? t('generate.picker.packaging_checkpoint')
                  : t('generate.picker.packaging_split') }}
              </span>
              <div v-if="multi" class="model-card__check">
                <MsIcon name="check" color="none" />
              </div>
              <!-- 组件缺失提示角标 (拆分形态, 左下角, 不阻断) -->
              <span
                v-if="componentsMissing && (item.packaging ?? 'split') === 'split'"
                class="model-card__dep-hint"
                :title="t('generate.picker.component_hint')"
              >
                <MsIcon name="warning" size="sm" color="none" />
              </span>
            </div>
            <div class="model-card__body">
              <div class="model-card__name text-truncate">{{ getDisplayName(item) }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

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

/* §5.3 形态徽章 (右上角, 整合包=clay 棕 / 拆分=teal 青) */
.model-card__pkg-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  font-size: .55rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  line-height: 1.4;
  max-width: calc(100% - 32px);
  overflow: hidden;
  text-overflow: ellipsis;
}
.model-card__pkg-badge--checkpoint {
  background: #b45309;
  color: #fff;
}
.model-card__pkg-badge--split {
  background: #0d9488;
  color: #fff;
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

/* ── 空态 (该 arch 两目录皆空) ── */
.picker-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-8) var(--sp-4);
  text-align: center;
}

.picker-empty-icon {
  font-size: 3.5rem;
  color: var(--ac);
  opacity: .55;
}

.picker-empty-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
}

.picker-empty-desc {
  font-size: .85rem;
  color: var(--t3);
}

/* 组件缺失提示角标 (拆分形态, 左下角, 不阻断选择) */
.model-card__dep-hint {
  position: absolute;
  bottom: 4px;
  left: 4px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--amber, #f59e0b);
  pointer-events: none;
}
</style>
