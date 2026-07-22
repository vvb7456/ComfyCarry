<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { MODEL_TYPES } from '@/config/model-types'
import { COMPONENT_FILENAMES } from '@/composables/generate/modelDepConfigs'
import BaseSelect from '@/components/form/BaseSelect.vue'
import BaseInput from '@/components/form/BaseInput.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import SeedInput from '@/components/generate/SeedInput.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'AdvancedSettings' })

defineProps<{
  disabled?: boolean
  /** Anima 专用：额外在顶部展示 CLIP + VAE 两项 split-file 选择 */
  showSplitModels?: boolean
  /** DualCLIPLoader (flux1): showSplitModels 时额外渲染第二个 CLIP select */
  dualClip?: boolean
  /** Checkpoint 系专属: 在主 2×3 网格上方新增 [Clip Skip | VAE] 对称条件行 */
  showClipSkipVae?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

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

/* ── CLIP / VAE (split-file architectures) — 推荐置顶 + 其他折叠 ── */
function basenameNoExt(name: string) {
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  return base.replace(/\.[^.]+$/, '')
}

// CLIP/TE 推荐名: 文本编码器族 (t5xxl / clip_l / qwen / mistral)
const RECOMMENDED_CLIP_PATTERN = /(t5xxl|clip_l|qwen|mistral)/i
// VAE 推荐名: VAE 文件 (含 vae 或以 ae. 开头), 不含 TE 名 (否则会把 t5xxl 等误推为 VAE)
const RECOMMENDED_VAE_PATTERN = /(vae|^ae\.)/i

const currentDefaultModels = computed(() =>
  MODEL_TYPES[store.activeModelType]?.defaultModels ?? {},
)

function fileBaseName(name: string): string {
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
}

function isRecommendedClip(name: string, slot: 'clip' | 'clip2'): boolean {
  const base = fileBaseName(name)
  const dm = currentDefaultModels.value
  const dmTarget = slot === 'clip2' ? dm.clip2 : dm.clip
  if (dmTarget && base === dmTarget) return true
  if (COMPONENT_FILENAMES.has(base)) return true
  return RECOMMENDED_CLIP_PATTERN.test(base)
}

function isRecommendedVae(name: string): boolean {
  const base = fileBaseName(name)
  if (currentDefaultModels.value.vae && base === currentDefaultModels.value.vae) return true
  if (COMPONENT_FILENAMES.has(base)) return true
  return RECOMMENDED_VAE_PATTERN.test(base)
}

interface ClipOption { value: string; label: string }

function buildClipLabel(name: string, recommended: boolean): string {
  const base = basenameNoExt(name)
  return recommended ? `★ ${base}` : base
}

const allClipOptions = computed<ClipOption[]>(() => {
  const recFlags = options.clips.value.map(c => isRecommendedClip(c.name, 'clip'))
  return options.clips.value.map((c, i) => ({
    value: c.name,
    label: buildClipLabel(c.name, recFlags[i]),
  }))
})
const allVaeOptions = computed<ClipOption[]>(() => {
  const recFlags = options.vaes.value.map(v => isRecommendedVae(v.name))
  return options.vaes.value.map((v, i) => ({
    value: v.name,
    label: buildClipLabel(v.name, recFlags[i]),
  }))
})

const recommendedClipOptions = computed<ClipOption[]>(() => {
  const recs = options.clips.value
    .filter(c => isRecommendedClip(c.name, 'clip'))
    .map(c => ({ value: c.name, label: buildClipLabel(c.name, true) }))
  return recs.length ? recs : allClipOptions.value
})
const recommendedVaeOptions = computed<ClipOption[]>(() => {
  const recs = options.vaes.value
    .filter(v => isRecommendedVae(v.name))
    .map(v => ({ value: v.name, label: buildClipLabel(v.name, true) }))
  return recs.length ? recs : allVaeOptions.value
})

const showAllClips = ref(false)
const showAllVaes = ref(false)

const clipOptions = computed<ClipOption[]>(() =>
  showAllClips.value ? allClipOptions.value : recommendedClipOptions.value,
)
const vaeOptions = computed<ClipOption[]>(() =>
  showAllVaes.value ? allVaeOptions.value : recommendedVaeOptions.value,
)

const hasOtherClips = computed(() => recommendedClipOptions.value.length < allClipOptions.value.length)
const hasOtherVaes = computed(() => recommendedVaeOptions.value.length < allVaeOptions.value.length)

/* ── Clip Skip + VAE 覆盖 (checkpoint 系专属) ── */
// B1: 选项 1/2/3/4 (显示 "1 (默认)" / "2" ...); VAE 首项 "跟随 Checkpoint" (值空) + options.vaes 列表
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
          </label>
          <BaseSelect
            :model-value="state.clip"
            :options="clipOptions"
            :disabled="disabled"
            :placeholder="t('generate.basic.select_clip')"
            @update:model-value="state.clip = String($event)"
          />
          <button
            v-if="hasOtherClips"
            type="button"
            class="adv-toggle"
            @click="showAllClips = !showAllClips"
          >
            <MsIcon :name="showAllClips ? 'unfold_less' : 'unfold_more'" size="sm" color="var(--ac)" />
            {{ showAllClips ? t('generate.advanced.clip_filter_recommended_only') : t('generate.advanced.clip_filter_show_all') }}
          </button>
        </div>
        <div v-if="dualClip" class="field-group">
          <label class="field-lbl">
            {{ t('generate.basic.clip2') }}
            <HelpTip :text="t('generate.advanced.clip_filter_help')" />
          </label>
          <BaseSelect
            :model-value="state.clip2"
            :options="clipOptions"
            :disabled="disabled"
            :placeholder="t('generate.basic.select_clip')"
            @update:model-value="state.clip2 = String($event)"
          />
          <button
            v-if="hasOtherClips"
            type="button"
            class="adv-toggle"
            @click="showAllClips = !showAllClips"
          >
            <MsIcon :name="showAllClips ? 'unfold_less' : 'unfold_more'" size="sm" color="var(--ac)" />
            {{ showAllClips ? t('generate.advanced.clip_filter_recommended_only') : t('generate.advanced.clip_filter_show_all') }}
          </button>
        </div>
        <div class="field-group">
          <label class="field-lbl">
            {{ t('generate.basic.vae') }}
            <HelpTip :text="t('generate.advanced.clip_filter_help')" />
          </label>
          <BaseSelect
            :model-value="state.vae"
            :options="vaeOptions"
            :disabled="disabled"
            :placeholder="t('generate.basic.select_vae')"
            @update:model-value="state.vae = String($event)"
          />
          <button
            v-if="hasOtherVaes"
            type="button"
            class="adv-toggle"
            @click="showAllVaes = !showAllVaes"
          >
            <MsIcon :name="showAllVaes ? 'unfold_less' : 'unfold_more'" size="sm" color="var(--ac)" />
            {{ showAllVaes ? t('generate.advanced.clip_filter_recommended_only') : t('generate.advanced.clip_filter_show_all') }}
          </button>
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
  font-size: .78rem;
  font-weight: 500;
  color: var(--t2);
}

.adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: none;
  border: none;
  padding: 0;
  font-size: .7rem;
  font-weight: 500;
  color: var(--ac);
  cursor: pointer;
  align-self: flex-start;
}

.adv-toggle:hover { text-decoration: underline; }

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
