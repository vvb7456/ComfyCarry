<script setup lang="ts">
/**
 * ProductTour — 产品导览通用组件：聚光灯遮罩 + 气泡对话框。
 *
 * 结构（规范 §4.1）：Teleport 到 body 的两个 fixed 元素 ——
 *   1. .tour-spot 聚光洞：本体透明，四周压暗靠 box-shadow 200vmax spread；
 *   2. .tour-bubble 气泡：floating-ui 按 virtual element（洞的 rect）定位。
 *
 * 定位（规范 §4.3）：reference 用 virtual element（洞的 rect 一份数据两处用），
 * 每步先 scrollIntoView 目标 → 测 rect → update() 重算气泡；滚动/resize 时
 * 重测跟随（capture scroll 覆盖所有滚动容器，先例 HelpTip.vue 的 onScroll）。
 *
 * 目标解析（规范 §4.2 关键）：ModelTab 全量 v-show 挂载，同一 data-tour 会
 * 命中多个（每个架构 tab 各一份），隐藏 tab 的 rect 为 0 —— 必须 querySelectorAll
 * 遍历取第一个可见者；全部不可见则降级为居中欢迎卡形态，不崩溃。
 */
import {
  computed, nextTick, onBeforeUnmount, ref, watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useFloating, offset, flip, shift, type VirtualElement } from '@floating-ui/vue'
import BaseButton from './BaseButton.vue'

defineOptions({ name: 'ProductTour' })

// 类型从组件文件导出（先例：DropdownMenu.vue 导出 DropdownMenuItem）
export interface TourStep {
  /** 聚光目标的 CSS 选择器；缺省 = 欢迎卡（屏幕居中，无聚光洞） */
  target?: string
  /** 气泡首选方位，floating-ui flip/shift 兜底 */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  title: string
  body: string
}

const props = defineProps<{
  /** steps[0] 约定为欢迎卡（无 target，不显示步数点、不显示「上一步」） */
  steps: TourStep[]
  /** v-model:active */
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 结束原因：skip = 跳过/Esc；finish = 走完最后一步 */
  close: [reason: 'skip' | 'finish']
}>()

const { t } = useI18n({ useScope: 'global' })

/** 当前步骤；watch(modelValue) 为 true 时归零起步 */
const index = ref(0)
/** props.steps 别名（模板 + 定位逻辑多处引用） */
const steps = computed(() => props.steps)

// ── 聚光洞 rect（虚拟 reference：气泡与洞共用一份数据）─────────────
const spotRect = ref({ top: 0, left: 0, width: 0, height: 0 })
// virtual element 用 ref 包裹（useFloating 的 reference 需要 Ref 形式;
// getter 每次读取 spotRect.value 最新值, 洞 rect 变化后 update() 即重算）
const virtualEl = ref<VirtualElement>({
  getBoundingClientRect: () => {
    const r = spotRect.value
    // DOMRect 形状，floating-ui 按此定位气泡
    return {
      x: r.left, y: r.top,
      top: r.top, left: r.left, bottom: r.top + r.height, right: r.left + r.width,
      width: r.width, height: r.height,
      toJSON: () => r,
    }
  },
})

const bubbleRef = ref<HTMLElement | null>(null)
/** 洞是否为"视口居中"形态（欢迎卡 / 目标不可见） */
const isCenterSpot = ref(true)
/** 气泡可显示: 每次步骤切换后 floating update() 完成才显示,
 *  防 floating-ui 初始 (0,0) 与切换时的旧位置闪现 */
const bubbleReady = ref(false)
/** placement 随步骤变化（MaybeRefOrGetter, getter 形式先例: BaseSelect 传常量, 这里需动态） */
const placement = computed(() => steps.value[index.value]?.placement ?? 'bottom')
const { floatingStyles, update } = useFloating(virtualEl, bubbleRef, {
  placement,
  middleware: [offset(12), flip(), shift({ padding: 16 })],
})
/** 气泡样式: floatingStyles + 完成定位才可见（防初始 (0,0) / 切换旧位闪现）;
 *  居中模式（欢迎卡）不走 floating, 由 .tour-bubble--center 直接视口居中 */
const bubbleStyle = computed(() => ({
  ...floatingStyles.value,
  visibility: bubbleReady.value ? ('visible' as const) : ('hidden' as const),
}))

// ── 目标解析（§4.2）─────────────────────────────────────────────
/**
 * 解析当前步骤目标的全部可见元素。同一 data-tour 可能命中多个（v-show 隐藏
 * tab 的 rect 为 0），也可能一条选择器串命中多处（如基础+高级设置的并集照亮）；
 * 全部不可见 / 解析失败 → 空数组，按欢迎卡降级居中。
 */
function resolveTargetEls(selector: string | undefined): HTMLElement[] {
  if (!selector) return []
  const els = document.querySelectorAll<HTMLElement>(selector)
  const visible: HTMLElement[] = []
  for (const el of els) {
    const rect = el.getBoundingClientRect()
    // v-show 隐藏元素 rect 为 0；offsetParent 判据对 fixed 容器失效, 用尺寸判据
    if (rect.width > 0 && rect.height > 0) visible.push(el)
  }
  return visible
}

/** 外扩 6px 的聚光洞 */
const SPOT_PAD = 6

async function applyStep(hideUntilPositioned: boolean) {
  const step = steps.value[index.value]
  const els = resolveTargetEls(step?.target)
  if (els.length) {
    // 多目标（并集照亮整段区域, 如基础+高级设置）; 单目标退化为自身 rect
    let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity
    for (const el of els) {
      const r = el.getBoundingClientRect()
      top = Math.min(top, r.top)
      left = Math.min(left, r.left)
      bottom = Math.max(bottom, r.bottom)
      right = Math.max(right, r.right)
    }
    isCenterSpot.value = false
    spotRect.value = {
      top: top - SPOT_PAD,
      left: left - SPOT_PAD,
      width: right - left + SPOT_PAD * 2,
      height: bottom - top + SPOT_PAD * 2,
    }
  } else {
    // 降级：视口中心 0×0（.tour-spot--center 变体只留 200vmax 遮罩）
    isCenterSpot.value = true
    spotRect.value = {
      top: window.innerHeight / 2,
      left: window.innerWidth / 2,
      width: 0,
      height: 0,
    }
  }
  // rect 变化后重算气泡位置。hideUntilPositioned 仅在步骤切换/首次激活时为真
  // （防初始 (0,0) 与旧位闪现）; 滚动跟随重定位不隐藏, 否则高频 scroll 下闪烁
  if (hideUntilPositioned) bubbleReady.value = false
  await update()
  bubbleReady.value = true
}

/** 步骤进入：先滚动到目标（smooth），滚动过程中 scroll 事件会连续触发跟随 */
async function goTo(i: number) {
  const step = props.steps[i]
  if (!step) return
  index.value = i
  // 滚动与定位必须用同一个可见元素 —— querySelector 首个命中的可能是
  // v-show 隐藏 tab 的副本（display:none, scrollIntoView 无效）
  const els = resolveTargetEls(step.target)
  els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  // 等 smooth 滚动推进后再测 rect（后续由 scroll 监听持续追赶）
  await nextTick()
  await applyStep(true)
  focusPrimary()
}

// steps 由页面侧 i18n computed 生成, 语言切换时文本就地更新, 无需重置 index；
// 但气泡内容随 props 变化即可, 定位不受影响。
//
// ── 持续跟随（§4.3）─────────────────────────────────────────────
/** capture 捕获所有滚动容器（不止 window），smooth 滚动中连续触发，洞/气泡全程跟随 */
function onReposition() {
  if (!props.modelValue) return
  void applyStep(false)
}

/** 焦点圈: 激活/切步后把焦点移到气泡主按钮, Tab 在气泡内循环, 不漏到遮罩背后 */
function focusPrimary() {
  void nextTick(() => {
    bubbleRef.value?.querySelector<HTMLElement>('.base-btn--primary')?.focus()
  })
}

// 激活/关闭的统一挂卸口（单一 watch, 避免多个重复 watch 分散维护）
watch(
  () => props.modelValue,
  (active) => {
    if (active) {
      index.value = 0
      window.addEventListener('scroll', onReposition, true)
      window.addEventListener('resize', onReposition)
      document.addEventListener('keydown', onKeydown)
      // 等 Teleport 渲染后首测（洞/气泡 v-if 由 modelValue 驱动）
      void nextTick().then(() => { applyStep(true); focusPrimary() })
    } else {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
      document.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true },
)

// ── 步骤驱动 ──────────────────────────────────────────────────
const isWelcome = computed(() => index.value === 0)
const isLast = computed(() => index.value === props.steps.length - 1)
const currentStep = computed(() => props.steps[index.value])
/** 步数点只对应正式步骤（steps.length - 1 个），当前点 = index - 1 */
const formalSteps = computed(() => props.steps.length - 1)

function nextStep() {
  if (isLast.value) {
    finish()
  } else {
    void goTo(index.value + 1)
  }
}

function prevStep() {
  if (index.value >= 1) void goTo(index.value - 1)
}

function close(reason: 'skip' | 'finish') {
  emit('update:modelValue', false)
  emit('close', reason)
}

function skip() {
  close('skip')
}

function finish() {
  close('finish')
}

// ── 键盘（active 时挂全局 keydown）──────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (!props.modelValue) return
  if (e.key === 'Escape') {
    e.preventDefault()
    skip()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    nextStep()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    // 欢迎卡时忽略上一步
    if (index.value >= 1) prevStep()
  } else if (e.key === 'Tab') {
    // Tab 圈在气泡内循环, 不让焦点走到遮罩背后的页面元素
    const focusables = bubbleRef.value?.querySelectorAll<HTMLElement>('button')
    if (!focusables?.length) return
    e.preventDefault()
    const idx = Array.prototype.indexOf.call(focusables, document.activeElement)
    const nextIdx = e.shiftKey
      ? (idx <= 0 ? focusables.length - 1 : idx - 1)
      : (idx === focusables.length - 1 ? 0 : idx + 1)
    focusables[nextIdx].focus()
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onReposition, true)
  window.removeEventListener('resize', onReposition)
})

// 步骤徽章编号（正式步骤显示 index，欢迎卡无徽章）
const badgeNumber = computed(() => index.value)
</script>

<template>
  <Teleport to="body">
    <template v-if="modelValue">
      <!-- 聚光洞：本体透明, 四周压暗靠 box-shadow 200vmax spread（任意滚动位置全覆盖） -->
      <div
        class="tour-spot"
        :class="{ 'tour-spot--center': isCenterSpot }"
        :style="{
          top: `${spotRect.top}px`,
          left: `${spotRect.left}px`,
          width: `${spotRect.width}px`,
          height: `${spotRect.height}px`,
        }"
      />

      <!-- 全屏透明拦截层: 四周暗色由聚光洞的 box-shadow 画出, 投影不参与
           点击判定, 必须铺一层透明 fixed 才能真正拦住暗区点击（§4.4） -->
      <div class="tour-mask" />

      <!-- 气泡：居中模式（欢迎卡）由 --center 变体视口居中, 不走 floating;
           其余由 floatingStyles (fixed) 定位, 定位完成前隐藏防闪现 -->
      <div
        ref="bubbleRef"
        class="tour-bubble"
        :class="{ 'tour-bubble--center': isCenterSpot }"
        :style="isCenterSpot ? undefined : bubbleStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-bubble-title"
      >
        <div class="tour-bubble__head">
          <span v-if="!isWelcome" class="tour-bubble__badge">{{ badgeNumber }}</span>
          <div id="tour-bubble-title" class="tour-bubble__title">{{ currentStep?.title }}</div>
        </div>
        <div class="tour-bubble__body">{{ currentStep?.body }}</div>
        <div class="tour-bubble__foot">
          <BaseButton variant="ghost" size="sm" @click="skip">
            {{ t('generate.tour.btn_skip') }}
          </BaseButton>
          <!-- 步数点只对应正式步骤, 欢迎卡不显示（§4.5） -->
          <div v-if="!isWelcome" class="tour-bubble__dots" aria-hidden="true">
            <span
              v-for="n in formalSteps"
              :key="n"
              class="tour-dot"
              :class="{ active: n - 1 === index - 1 }"
            />
          </div>
          <div class="tour-bubble__nav">
            <BaseButton v-if="!isWelcome" variant="default" size="sm" @click="prevStep">
              {{ t('generate.tour.btn_prev') }}
            </BaseButton>
            <BaseButton variant="primary" size="sm" @click="nextStep">
              {{ isWelcome ? t('generate.tour.btn_start') : (isLast ? t('generate.tour.btn_done') : t('generate.tour.btn_next')) }}
            </BaseButton>
          </div>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
/* ── 全屏拦截层 ──
   透明不参与视觉（暗色由聚光洞的投影负责）, 只负责拦截暗区点击 */
.tour-mask {
  position: fixed;
  inset: 0;
  z-index: 10098;
  background: transparent;
}

/* ── 聚光洞 ── */
.tour-spot {
  position: fixed;
  z-index: 10099;
  border-radius: calc(var(--r-lg) + 2px);
  /* 本体透明, 四周压暗: 2px ac 高亮环 + 200vmax 遮罩 (保证任意滚动位置全覆盖) */
  box-shadow: 0 0 0 2px var(--ac), 0 0 0 200vmax var(--overlay-dark);
  transition: top .3s ease, left .3s ease, width .3s ease, height .3s ease;
  /* 拦截洞内外一切页面点击, 防导览期间误操作; 气泡自身可点击 */
  pointer-events: auto;
}
/* 欢迎卡 / 目标不可见: 洞退化为视口中心 0×0, 只留 200vmax 遮罩、无 ac 环 */
.tour-spot--center { box-shadow: 0 0 0 200vmax var(--overlay-dark); }

/* ── 气泡 ── */
.tour-bubble {
  /* position: fixed 由 floatingStyles 覆写 */
  z-index: 10100; /* --z-float(10000) 之上, 先例 HelpTip 硬编码 10000 */
  width: min(92vw, 340px);
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  box-shadow: var(--sh);
  padding: var(--sp-4);
  box-sizing: border-box;
  /* 入场只做淡入: 不用 translateY, 避免与 --center 的 translate(-50%,-50%) 冲突 */
  animation: tour-bubble-in .2s ease;
}
/* 欢迎卡 / 目标不可见: fixed 视口居中 (按浏览器视口计算, 与页面滚动无关) */
.tour-bubble--center {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
@keyframes tour-bubble-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.tour-bubble__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 8px);
  margin-bottom: 6px;
}
/* 步骤徽章: 对齐 gen-arch-logo__letter 规格 (22×22, 6px 圆角, ac 渐变白字) */
.tour-bubble__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--ac), var(--ac2));
  color: #fff;
  font-size: var(--text-xs, .72rem);
  font-weight: 600;
}

.tour-bubble__title { font-size: var(--text-md); font-weight: 600; color: var(--t1); }
/* pre-line: 欢迎卡文案含 \n 段落换行（§6），仅折行不折叠空格 */
.tour-bubble__body  { font-size: var(--text-sm); color: var(--t2); line-height: 1.55; white-space: pre-line; }

.tour-bubble__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 8px);
  margin-top: var(--sp-4);
}
.tour-bubble__dots {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
}
.tour-dot  { width: 6px; height: 6px; border-radius: 50%; background: var(--bd); }
.tour-dot.active { background: var(--ac); }

.tour-bubble__nav {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 8px);
  /* 欢迎卡无步数点占位, margin-left:auto 把「开始」推到右端 */
  margin-left: auto;
}
</style>