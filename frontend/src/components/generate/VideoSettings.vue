<script setup lang="ts">
import { computed, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GenerateModelKey } from '@/composables/generate/keys'
import BaseSelect from '@/components/form/BaseSelect.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import RangeField from '@/components/form/RangeField.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'VideoSettings' })

const props = withDefaults(defineProps<{
  /** 禁用全部控件 (与 BasicSettings.disabled 语义一致) */
  disabled?: boolean
  /** 起始画面原始宽高；异步加载完成前为 0。 */
  refWidth?: number
  refHeight?: number
}>(), {
  disabled: false,
  refWidth: 0,
  refHeight: 0,
})

const { t } = useI18n({ useScope: 'global' })
const { state, config } = inject(GenerateModelKey)!
const video = computed(() => state.value.video!)
const vd = computed(() => config.value.videoDefaults!)

/* ── 像素预算 (W×H): 架构可覆盖 (minimax_h3.maxPixels); 缺省 921600 (Wan 720p) ── */
const PIXEL_BUDGET = 921600
const pixelBudget = computed(() => vd.value.maxPixels ?? PIXEL_BUDGET)

/** 哨兵值 — 与图像页 state.resolution 的 'custom' 同构 */
const RES_FIT = 'ref'
const RES_CUSTOM = 'custom'

/* ── 整除吸附: 取最近 divisor 倍数 (14B%16 / 5B%32) ── */
function snap(v: number, d: number): number {
  return Math.max(d, Math.round(v / d) * d)
}

/**
 * 「贴合起始画面」的尺寸推导。
 *   1. 连续解: w/h = refRatio, w×h ≤ budget, 最大化面积 → h = sqrt(budget/refRatio)
 *   2. 各自整除吸附到最近 divisor 倍数
 *   3. 吸附后若超预算: 从较大边减一个 divisor 直到 ≤ 预算 (硬约束, 否则提交校验会拒)
 * 无法做到零裁切 —— 吸附残差约 1~2%, 但相对固定档位的 16%/60% 不是一个量级。
 */
function deriveFitSize(refW: number, refH: number, budget: number, d: number): { w: number; h: number } {
  const ratio = refW / refH
  const hCont = Math.sqrt(budget / ratio)
  let w = snap(ratio * hCont, d)
  let h = snap(hCont, d)
  let guard = 0
  while (w * h > budget && guard++ < 64) {
    if (w >= h) w -= d
    else h -= d
  }
  return { w, h }
}

const hasRef = computed(() => props.refWidth > 0 && props.refHeight > 0)

const fitSize = computed(() => {
  if (!hasRef.value) return null
  return deriveFitSize(props.refWidth, props.refHeight, pixelBudget.value, vd.value.divisor)
})

type Orient = 'landscape' | 'portrait' | 'square'

const presetEntries = computed(() => {
  const out: { value: string; label: string; width: number; height: number }[] = []
  const presets = vd.value.presets
  for (const tier of Object.keys(presets)) {
    for (const orient of ['landscape', 'portrait', 'square'] as Orient[]) {
      const p = presets[tier]?.[orient]
      if (!p) continue
      out.push({
        value: `${p.width}x${p.height}`,
        label: t('generate.video.res_preset', { w: p.width, h: p.height }),
        width: p.width,
        height: p.height,
      })
    }
  }
  return out
})

const resolutionOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  if (video.value.refImage) {
    opts.push({
      value: RES_FIT,
      label: t('generate.video.res_fit_option', { w: fitSize.value?.w ?? video.value.width, h: fitSize.value?.h ?? video.value.height }),
    })
  }
  for (const e of presetEntries.value) opts.push({ value: e.value, label: e.label })
  opts.push({ value: RES_CUSTOM, label: t('generate.basic.custom') })
  return opts
})

const resolution = computed<string>({
  get: () => video.value.resolution || (fitSize.value ? RES_FIT : presetEntries.value[0]?.value ?? RES_CUSTOM),
  set: (v: string) => { video.value.resolution = v },
})
const isCustom = computed(() => resolution.value === RES_CUSTOM)

/** 把选中项落成实际宽高 (custom 不动 — 保留用户已输入的值) */
function applyResolution(v: string) {
  if (v === RES_CUSTOM) return
  if (v === RES_FIT) {
    if (!fitSize.value) return
    video.value.width = fitSize.value.w
    video.value.height = fitSize.value.h
    return
  }
  const [w, h] = v.split('x').map(Number)
  if (w && h) {
    video.value.width = w
    video.value.height = h
  }
}

function onResolutionChange(v: string) {
  resolution.value = v
  applyResolution(v)
}

// 图片尺寸异步到达；只有用户选了「贴合」才同步，不把加载中的零尺寸当作清除图片。
watch(
  [resolution, fitSize],
  () => {
    if (resolution.value === RES_FIT && hasRef.value) applyResolution(RES_FIT)
  },
  { immediate: true },
)

function onCustomWidth(raw: number) {
  const d = vd.value.divisor
  let w = snap(raw, d)
  const maxW = Math.floor(pixelBudget.value / video.value.height / d) * d
  if (w > maxW) w = maxW
  video.value.width = w
}
function onCustomHeight(raw: number) {
  const d = vd.value.divisor
  let h = snap(raw, d)
  const maxH = Math.floor(pixelBudget.value / video.value.width / d) * d
  if (h > maxH) h = maxH
  video.value.height = h
}

const fps = computed(() => vd.value.fps)
const maxDur = computed(() => vd.value.maxDurationS)
/** 时长滑块下限 / 步进: 架构可覆盖 (H3 整数秒 4-15); 缺省 1 / 0.5 (Wan) */
const durationMin = computed(() => vd.value.durationMin ?? 1)
const durationStep = computed(() => vd.value.durationStep ?? 0.5)
/**
 * 帧数徽章。缺省 frames = round(fps×duration) + 1 (Wan 惯例);
 * 若 vd.frameGrid 存在 (H3 = 17), 帧数对齐到 (offset + k×grid) 网格:
 *   n = round(fps×durationS), 从 n 起向上找第一个满足 (n−offset) % grid === 0 的值。
 */
const frameCount = computed(() => {
  const grid = vd.value.frameGrid
  if (grid) {
    const offset = vd.value.frameGridOffset ?? 0
    let n = Math.round(fps.value * video.value.durationS)
    while ((n - offset) % grid !== 0) n++
    return n
  }
  return Math.round(fps.value * video.value.durationS) + 1
})
/** 刻度是静态量程标记, 只放端点与中点 —— 帧数是动态值, 走 label 徽章 */
const durationMarkFormat = (v: number) => `${v}s`
</script>

<template>
  <div class="video-settings">
    <div class="field-group resolution-field">
      <div class="field-lbl">
        {{ t('generate.basic.resolution') }}
        <HelpTip :text="t('generate.video.res_help')" />
      </div>
      <div class="res-row" :class="{ 'res-row--custom': isCustom }">
        <BaseSelect
          :model-value="resolution"
          :options="resolutionOptions"
          :disabled="disabled"
          @update:model-value="onResolutionChange(String($event))"
        />
        <div v-if="isCustom" class="custom-size">
          <NumberInput
            :model-value="video.width"
            :min="vd.divisor"
            :max="4096"
            :step="vd.divisor"
            :disabled="disabled"
            :placeholder="t('generate.basic.width')"
            center
            @update:model-value="onCustomWidth($event)"
          />
          <span class="custom-size__x">×</span>
          <NumberInput
            :model-value="video.height"
            :min="vd.divisor"
            :max="4096"
            :step="vd.divisor"
            :disabled="disabled"
            :placeholder="t('generate.basic.height')"
            center
            @update:model-value="onCustomHeight($event)"
          />
        </div>
      </div>
    </div>

    <div class="slider-row" :class="{ 'slider-row--3': config.guidance !== 'none' }">
      <RangeField
        :model-value="video.durationS"
        :min="durationMin"
        :max="maxDur"
        :step="durationStep"
        :label="t('generate.video.duration')"
        :marks="2"
        :mark-format="durationMarkFormat"
        :value-format="(v: number) => `${v}s`"
        :disabled="disabled"
        @update:model-value="video.durationS = $event"
      >
        <template #label-append>
          <span class="vs-badge" :title="t('generate.video.frames_hint', { frames: frameCount, fps })">{{ t('generate.video.frames_hint', { frames: frameCount, fps }) }}</span>
        </template>
      </RangeField>
      <RangeField
        :model-value="state.steps"
        :min="1"
        :max="100"
        :step="1"
        :label="t('generate.basic.steps')"
        :marks="2"
        editable
        :disabled="disabled"
        @update:model-value="state.steps = $event"
      />
      <RangeField
        v-if="config.guidance !== 'none'"
        :model-value="state.cfg"
        :min="1"
        :max="20"
        :step="0.5"
        :label="t('generate.basic.cfg_scale')"
        :marks="2"
        :value-format="(v: number) => v.toFixed(1)"
        editable
        :disabled="disabled"
        @update:model-value="state.cfg = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.video-settings {
  display: contents;
}

.vs-badge {
  font-size: .65rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg3);
  color: var(--t3);
  margin-left: 2px;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
