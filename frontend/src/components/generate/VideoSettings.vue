<script setup lang="ts">
/**
 * VideoSettings — 视频专属基础设置。
 *
 * 分辨率收敛为一个 BaseSelect, 与图像页同构。
 * 「清晰度档下拉 + 方向分段 + 跟随胶囊」三个控件本质上只是在决定 latent 尺寸,
 * 那是分辨率字段的职责, 不该另立概念。「贴合起始画面」只是下拉里的一个动态选项,
 * 与 `自定义...` 同性质。
 *
 * 字段顺序 (分辨率在上、步数/CFG 在下):
 *   速度 → 分辨率 → 时长 → 步数/CFG
 * 步数/CFG 置末尾另有收益: 切速度档时增删发生在末尾, 上方控件不跳动。
 *
 * 样式: label 一律 .field-lbl 同款 (.78rem/500/--t2);
 *       说明文字一律进 HelpTip 不占行;
 *       动态附属信息 (帧数) 做 label 徽章, 不塞进滑块 marks。
 *
 * 数据走 store (与 BasicSettings 同模式); 起始画面原尺寸由父组件经 refWidth/refHeight 传入。
 * 档位值全部来自 config.videoDefaults.presets, 不硬编码。
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import type { ModelTypeConfig } from '@/config/model-types'
import BaseSelect from '@/components/form/BaseSelect.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import RangeField from '@/components/form/RangeField.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'VideoSettings' })

const props = withDefaults(defineProps<{
  /** 禁用全部控件 (与 BasicSettings.disabled 语义一致) */
  disabled?: boolean
  /** 起始画面原始宽高 (0 = 无起始画面 → 分辨率下拉不出现「贴合起始画面」项) */
  refWidth?: number
  refHeight?: number
}>(), {
  disabled: false,
  refWidth: 0,
  refHeight: 0,
})

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const config = computed<ModelTypeConfig>(() => store.currentConfig)
const state = computed(() => store.currentState)
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

/* ── 速度档 (仅 speedToggle=true 的 14B 条目) ── */
const hasSpeed = computed(() => !!vd.value.speedToggle)
/** 快速档: 步数/CFG 被锁定 (4 步 / cfg 1.0), 故仅标准档渲染两个滑块 */
const isFast = computed(() => state.value.fast)

const speedOptions = computed(() => [
  { value: 'fast', label: t('generate.video.speed_fast') },
  { value: 'std', label: t('generate.video.speed_std') },
])
const speedValue = computed<string>(() => (isFast.value ? 'fast' : 'std'))
function onSpeedChange(v: string) {
  state.value.fast = (v === 'fast')
}

/* ── 分辨率 (单个 BaseSelect) ── */

/** 起始画面是否就位 —— 决定「贴合起始画面」项是否出现 (t2v 永远不出现) */
const hasRef = computed(() => props.refWidth > 0 && props.refHeight > 0)

/** 贴合项的推导尺寸 (无起始画面时为 null) */
const fitSize = computed(() => {
  if (!hasRef.value) return null
  return deriveFitSize(props.refWidth, props.refHeight, pixelBudget.value, vd.value.divisor)
})

type Orient = 'landscape' | 'portrait' | 'square'
const ORIENT_KEYS: Record<Orient, string> = {
  landscape: 'generate.video.orient_landscape',
  portrait: 'generate.video.orient_portrait',
  square: 'generate.video.orient_square',
}

/** 全部档位预设摊平成下拉项 (来自 videoDefaults.presets, 不硬编码) */
const presetEntries = computed(() => {
  const out: { value: string; label: string; width: number; height: number }[] = []
  const presets = vd.value.presets
  for (const tier of Object.keys(presets)) {
    for (const orient of ['landscape', 'portrait', 'square'] as Orient[]) {
      const p = presets[tier]?.[orient]
      if (!p) continue
      out.push({
        value: `${p.width}x${p.height}`,
        label: t('generate.video.res_preset', {
          w: p.width, h: p.height, orient: t(ORIENT_KEYS[orient]), tier,
        }),
        width: p.width,
        height: p.height,
      })
    }
  }
  return out
})

/** 下拉选项: [贴合起始画面] → 6 个档位预设 → 自定义 */
const resolutionOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  if (fitSize.value) {
    opts.push({
      value: RES_FIT,
      label: t('generate.video.res_fit_option', {
        w: fitSize.value.w, h: fitSize.value.h, label: t('generate.video.res_fit'),
      }),
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

/**
 * 尺寸同步 (immediate): 选中贴合项时, 起始画面尺寸一变就重算宽高;
 * 图被移除 (5B 切文生 / 用户清除) 时贴合项从下拉消失, 选中值会悬空 → 回落到第一个档位。
 * 这个 watch 只做"让状态自洽", 不改变用户的选择。
 */
watch(
  () => [props.refWidth, props.refHeight] as const,
  () => {
    if (resolution.value !== RES_FIT) return
    if (hasRef.value) {
      applyResolution(RES_FIT)
    } else {
      const fallback = presetEntries.value[0]?.value
      if (fallback) {
        resolution.value = fallback
        applyResolution(fallback)
      }
    }
  },
  { immediate: true },
)

/**
 * 换图 → 自动选中「贴合起始画面」。
 *
 * 判据刻意是 refImage 文件名而非尺寸, 且**不加 immediate**:
 * 尺寸是异步探测出来的, 0→N 这个跃迁在"首次上传"和"切回本 tab 重新挂载"时都会发生,
 * 用尺寸做判据会在每次切 tab 时把用户手选的 720p 档冲回贴合项。
 * 用文件名 + 无 immediate: 组件挂载时以当前值为基线不触发, 只有真正换了图才切。
 */
watch(
  () => video.value.refImage,
  (name) => {
    if (!name) return
    resolution.value = RES_FIT
    // 尺寸此刻可能还没探测回来; 上面的 immediate watch 会在尺寸到位时补算宽高。
    applyResolution(RES_FIT)
  },
)

/* ── 自定义宽高: 实时整除吸附 + 像素预算约束 ── */
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

/* ── 时长 (步进 0.5s, 1 → maxDurationS, frames = fps×duration + 1) ── */
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
  <div class="video-settings" :class="{ 'video-settings--disabled': disabled }">
    <!-- 速度 (仅 speedToggle=true) -->
    <div v-if="hasSpeed" class="field-group">
      <label class="field-lbl">
        {{ t('generate.video.speed') }}
        <HelpTip :text="t('generate.video.speed_help')" />
      </label>
      <SegmentedControl
        :options="speedOptions"
        :model-value="speedValue"
        size="sm"
        block
        :disabled="disabled"
        @update:model-value="onSpeedChange(String($event))"
      />
    </div>

    <!-- 分辨率: 单下拉 (含贴合项 / 6 档预设 / 自定义); 与图像页 res-row 同构 -->
    <div class="field-group">
      <label class="field-lbl">
        {{ t('generate.basic.resolution') }}
        <HelpTip :text="t('generate.video.res_help')" />
      </label>
      <div class="res-row">
        <BaseSelect
          :model-value="resolution"
          :options="resolutionOptions"
          :disabled="disabled"
          @update:model-value="onResolutionChange(String($event))"
        />
        <div v-if="isCustom" class="vs-custom-size">
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
          <span class="vs-custom-size__x">×</span>
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

    <!-- 时长 (步进 0.5s; 帧数走 label 徽章) -->
    <div class="field-group">
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
          <span class="vs-badge">{{ t('generate.video.frames_hint', { frames: frameCount, fps }) }}</span>
        </template>
      </RangeField>
    </div>

    <!-- 步数 / CFG (仅标准档; 置于末尾 → 切档时上方控件不跳动) -->
    <div v-if="hasSpeed && !isFast" class="vs-slider-row">
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
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.video-settings--disabled {
  opacity: .55;
  pointer-events: none;
}

/* 字段块 / 标签 — 与 BasicSettings、AdvancedSettings 同款 */
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

/* 动态附属信息徽章 (帧数) — 与 AdvancedSettings 的 seed-mode-badge 同款 */
.vs-badge {
  font-size: .65rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg3);
  color: var(--t3);
  margin-left: 2px;
  white-space: nowrap;
}

/* 分辨率行 — 与 BasicSettings res-row 同款: 左 select 右自定义宽高, 各占右列一半 */
.res-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2);
  align-items: start;
}

/* 自定义宽高 (与 BasicSettings custom-size 同款) */
.vs-custom-size {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 两个 input 等宽, 与 ×(固定字符宽) 一起自然填满容器剩余宽度 */
.vs-custom-size :deep(.number-input) {
  flex: 1;
}

.vs-custom-size__x {
  font-size: .78rem;
  color: var(--t3);
  flex-shrink: 0;
}

/* 步数/CFG 并排 */
.vs-slider-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

@media (max-width: 600px) {
  .vs-slider-row {
    grid-template-columns: 1fr;
  }
}
</style>
