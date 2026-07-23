<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { MODEL_TYPES } from '@/config/model-types'
import { componentsForSlot, stemOf, type ComponentSlot, type ComponentFile } from '@/config/component-registry'
import type { SelectOption } from '@/components/form/BaseSelect.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseInput from '@/components/form/BaseInput.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import SeedInput from '@/components/generate/SeedInput.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'AdvancedSettings' })

const props = defineProps<{
  disabled?: boolean
  /** Anima 专用：额外在顶部展示 CLIP + VAE 两项 split-file 选择 */
  showSplitModels?: boolean
  /** DualCLIPLoader (flux1): showSplitModels 时额外渲染第二个 CLIP select */
  dualClip?: boolean
  /** Checkpoint 系专属: 在主 2×3 网格上方新增 [Clip Skip | VAE] 对称条件行 */
  showClipSkipVae?: boolean
  /** 本 tab 的架构 key; 缺省时回退 store.activeModelType (过渡期兼容) */
  modelType?: string
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

const arch = computed(() => props.modelType || store.activeModelType)

/* ── Format ── */
const formatOptions = [
  { value: 'png', label: '' },
  { value: 'jpeg', label: '' },
  { value: 'webp', label: '' },
  { value: 'tiff', label: '' },
  { value: 'bmp', label: '' },
]

function formatLabel(key: string): string {
  return t(`generate.advanced.format_${key}`)
}

/* ── CLIP / VAE (split-file architectures) — 三分组 (本架构组件/兼容版本/其他文件) ── */
function basenameNoExt(name: string): string {
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  return base.replace(/\.[^.]+$/, '')
}

function fileBaseName(name: string): string {
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

const GROUP_OFFICIAL = 'generate.advanced.clip_group_official'
const GROUP_COMPAT = 'generate.advanced.clip_group_compat'
const GROUP_OTHER = 'generate.advanced.clip_group_other'

interface SlotConfig {
  group: number // 1 = official, 2 = compat, 3 = other
  file: ComponentFile | null // 组1命中时的文件 (用于 hint)
}

/**
 * 给定 slot 与候选列表，构造三分组并排好序的 SelectOption[]。
 * 整合包架构 (registry 无条目) → 不分组，平铺全量。
 */
function buildSlotOptions(slot: ComponentSlot, candidates: { name: string }[]): SelectOption[] {
  const files = componentsForSlot(arch.value, slot)
  if (files.length === 0) {
    return candidates.map(c => ({ value: c.name, label: basenameNoExt(c.name) }))
  }

  // 预计算官方文件的判定集合
  const officialFilenames = new Set(files.map(f => f.filename))
  const officialStems = new Set<string>()
  for (const f of files) {
    officialStems.add(stemOf(f.filename))
    officialStems.add(f.stem)
  }

  const configs: SlotConfig[] = candidates.map(c => {
    const base = fileBaseName(c.name)
    if (officialFilenames.has(base)) {
      const f = files.find(x => x.filename === base) || null
      return { group: 1, file: f }
    }
    if (officialStems.has(stemOf(base))) {
      return { group: 2, file: null }
    }
    return { group: 3, file: null }
  })

  // 稳定排序: 组1→组2→组3, 组内保持原顺序
  const ordered = candidates.map((_, i) => i)
  ordered.sort((a, b) => configs[a].group - configs[b].group)

  return ordered.map(i => {
    const c = candidates[i]
    const cfg = configs[i]
    const base = basenameNoExt(c.name)
    const opt: SelectOption = { value: c.name, label: base }
    if (cfg.group === 1) {
      opt.label = `★ ${base}`
      opt.group = t(GROUP_OFFICIAL)
      if (cfg.file) opt.hint = formatBytes(cfg.file.bytes)
    } else if (cfg.group === 2) {
      opt.label = `☆ ${base}`
      opt.group = t(GROUP_COMPAT)
    } else {
      opt.group = t(GROUP_OTHER)
    }
    return opt
  })
}

/** 判断某个值是否落在组 3 (其他文件) */
function isOtherGroup(slot: ComponentSlot, candidates: { name: string }[], value: string): boolean {
  // 未选择任何文件时不算"不兼容" (空值不该触发警告)
  if (!value) return false
  const files = componentsForSlot(arch.value, slot)
  if (files.length === 0) return false
  const base = fileBaseName(value)
  if (files.some(f => f.filename === base)) return false
  const stems = new Set<string>()
  for (const f of files) {
    stems.add(stemOf(f.filename))
    stems.add(f.stem)
  }
  return !stems.has(stemOf(base))
}

/** 三分组已排好序的完整列表 (组1 本架构组件 → 组2 兼容版本 → 组3 其他文件)。
 *  不再做折叠/裁剪: 全部平铺, 官方组件天然在首位。 */
const clipOptions = computed(() => buildSlotOptions('clip', options.clips.value))
const clip2Options = computed(() => buildSlotOptions('clip2', options.clips.value))
const vaeOptions = computed(() => buildSlotOptions('vae', options.vaes.value))

const archLabel = computed(() => MODEL_TYPES[arch.value]?.label ?? arch.value)
const clipIncompatible = computed(() => isOtherGroup('clip', options.clips.value, state.value.clip))
const clip2Incompatible = computed(() => isOtherGroup('clip2', options.clips.value, state.value.clip2))
const vaeIncompatible = computed(() => isOtherGroup('vae', options.vaes.value, state.value.vae))
const hasRegistry = computed(() =>
  componentsForSlot(arch.value, 'clip').length > 0 ||
  componentsForSlot(arch.value, 'clip2').length > 0 ||
  componentsForSlot(arch.value, 'vae').length > 0)

/* ── Clip Skip + VAE 覆盖 (checkpoint 系专属) ── */
// B1: 选项 1/2/3/4 (显示 "1 (默认)" / "2" ...); VAE 首项 "跟随 Checkpoint" (值空) + 全量 VAE 列表 (仅排序不裁剪)
const clipSkipOptions = computed(() => [
  { value: 1, label: t('generate.advanced.clip_skip_default') },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
])
const vaeOverrideOptions = computed(() => [
  { value: '', label: t('generate.advanced.vae_override_follow') },
  ...vaeOptions.value,
])</script>

<template>
  <details class="adv-settings" :class="{ 'adv-settings--disabled': disabled }">
    <summary class="adv-summary">
      <MsIcon name="expand_more" color="none" class="adv-summary__arrow" />
      {{ t('generate.advanced.title') }}
    </summary>

    <div class="adv-body">
      <!-- Row 0 (Anima only): CLIP + VAE split-file selectors -->
      <div v-if="showSplitModels" class="adv-split-grid" :class="{ 'adv-split-grid--3': dualClip }">
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.basic.clip') }}
            <HelpTip :text="t('generate.advanced.clip_filter_help')" />
            <span
              v-if="hasRegistry && clipIncompatible"
              class="adv-warn"
              :title="t('generate.advanced.clip_incompatible', { arch: archLabel })"
            >{{ t('generate.advanced.clip_incompatible', { arch: archLabel }) }}</span>
          </label>
          <BaseSelect
            :model-value="state.clip"
            :options="clipOptions"
            :disabled="disabled"
            :placeholder="t('generate.basic.select_clip')"
            @update:model-value="state.clip = String($event)"
          />
        </div>
        <div v-if="dualClip" class="field-group">
          <label class="field-lbl">
            {{ t('generate.basic.clip2') }}
            <HelpTip :text="t('generate.advanced.clip_filter_help')" />
            <span
              v-if="hasRegistry && clip2Incompatible"
              class="adv-warn"
              :title="t('generate.advanced.clip_incompatible', { arch: archLabel })"
            >{{ t('generate.advanced.clip_incompatible', { arch: archLabel }) }}</span>
          </label>
          <BaseSelect
            :model-value="state.clip2"
            :options="clip2Options"
            :disabled="disabled"
            :placeholder="t('generate.basic.select_clip')"
            @update:model-value="state.clip2 = String($event)"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.basic.vae') }}
            <HelpTip :text="t('generate.advanced.clip_filter_help')" />
            <span
              v-if="hasRegistry && vaeIncompatible"
              class="adv-warn"
              :title="t('generate.advanced.vae_incompatible', { arch: archLabel })"
            >{{ t('generate.advanced.vae_incompatible', { arch: archLabel }) }}</span>
          </label>
          <BaseSelect
            :model-value="state.vae"
            :options="vaeOptions"
            :disabled="disabled"
            :placeholder="t('generate.basic.select_vae')"
            @update:model-value="state.vae = String($event)"
          />
        </div>
      </div>

      <!-- Row 0b (checkpoint 系专属): Clip Skip + VAE 覆盖 (主 2×3 网格上方, 1fr 1fr 对称) -->
      <div v-if="showClipSkipVae" class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.clip_skip') }}
            <HelpTip :text="t('generate.advanced.clip_skip_help')" />
          </label>
          <BaseSelect
            :model-value="state.clipSkip"
            :options="clipSkipOptions"
            :disabled="disabled"
            @update:model-value="state.clipSkip = Number($event)"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.vae_override') }}
            <HelpTip :text="t('generate.advanced.vae_override_help')" />
          </label>
          <BaseSelect
            :model-value="state.vaeOverride"
            :options="vaeOverrideOptions"
            :disabled="disabled"
            searchable
            :search-placeholder="t('generate.basic.search_vae')"
            teleport
            @update:model-value="state.vaeOverride = String($event)"
          />
        </div>
      </div>

      <!-- Row 1: Sampler + Scheduler -->
      <div class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.sampler') }}
            <HelpTip :text="t('generate.advanced.sampler_help')" />
          </label>
          <BaseSelect
            :model-value="state.sampler"
            :options="options.samplers.value"
            :disabled="disabled"
            searchable
            :search-placeholder="t('generate.advanced.sampler_search')"
            teleport
            @update:model-value="state.sampler = String($event)"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.scheduler') }}
            <HelpTip :text="t('generate.advanced.scheduler_help')" />
          </label>
          <BaseSelect
            :model-value="state.scheduler"
            :options="options.schedulers.value"
            :disabled="disabled"
            searchable
            :search-placeholder="t('generate.advanced.scheduler_search')"
            teleport
            @update:model-value="state.scheduler = String($event)"
          />
        </div>
      </div>

      <!-- Row 2: Seed + Batch -->
      <div class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.seed') }}
            <HelpTip :text="t('generate.advanced.seed_help')" />
            <span class="seed-mode-badge">
              {{ state.seedMode === 'random' ? t('generate.advanced.seed_random') : t('generate.advanced.seed_fixed') }}
            </span>
          </label>
          <SeedInput
            :model-value="state.seedValue"
            :mode="state.seedMode"
            :disabled="disabled"
            @update:model-value="state.seedValue = $event"
            @update:mode="state.seedMode = $event"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.batch') }}
            <HelpTip :text="t('generate.advanced.batch_help')" />
          </label>
          <NumberInput
            :model-value="state.batch"
            :min="1"
            :max="16"
            :step="1"
            :disabled="disabled"
            @update:model-value="state.batch = $event"
          />
        </div>
      </div>

      <!-- Row 3: Format + Prefix -->
      <div class="adv-2col">
        <div class="field-group">
          <label class="field-lbl">{{ t('generate.advanced.format') }}</label>
          <BaseSelect
            :model-value="state.format"
            :options="formatOptions.map(o => ({ ...o, label: formatLabel(o.value) }))"
            :disabled="disabled"
            @update:model-value="state.format = String($event)"
          />
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.advanced.prefix') }}
            <HelpTip :text="t('generate.advanced.prefix_help')" />
          </label>
          <BaseInput
            :model-value="state.prefix"
            :disabled="disabled"
            mono
            @update:model-value="state.prefix = $event"
          />
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.adv-settings {
  padding-top: 0;
}

.adv-settings--disabled {
  opacity: .55;
  pointer-events: none;
}

/* ── Summary ── */
.adv-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t2);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.adv-summary::-webkit-details-marker {
  display: none;
}

.adv-summary__arrow {
  font-size: .9rem;
  color: var(--t3);
  transition: transform .2s;
}

.adv-settings[open] .adv-summary__arrow {
  transform: rotate(0deg);
}

.adv-settings:not([open]) .adv-summary__arrow {
  transform: rotate(-90deg);
}

/* ── Body ── */
.adv-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
}

/* ── 2-col grid ── */
.adv-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

/* ── split-file grid: 2 项 (CLIP/VAE) 或 3 项 (CLIP/CLIP2/VAE) 自适应 ── */
.adv-split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}
.adv-split-grid--3 {
  grid-template-columns: 1fr 1fr 1fr;
}

@media (max-width: 600px) {
  .adv-2col,
  .adv-split-grid,
  .adv-split-grid--3 {
    grid-template-columns: 1fr;
  }
}

/* ── Field ── */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-lbl {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}


/* ── Incompatible warning ── */
/* 不兼容提示: 跟在 label 的 HelpTip 右侧, 留间距; 过长时省略 (完整文案见 title) */
.adv-warn {
  margin-left: 6px;
  min-width: 0;
  flex: 1 1 auto;
  font-size: .7rem;
  font-weight: 400;
  color: var(--amber);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Seed mode badge ── */
.seed-mode-badge {
  font-size: .65rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg3);
  color: var(--t3);
  margin-left: 2px;
}
</style>
