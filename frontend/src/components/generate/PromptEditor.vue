<script setup lang="ts">
/**
 * PromptEditor — Positive / Negative prompt textareas + toolbar
 *
 * Features:
 *  - Positive textarea with bottom toolbar (variable buttons)
 *  - Optional negative textarea (controlled via `showNegative` prop)
 *  - Help button → opens syntax help modal (BaseModal)
 *  - Toolbar buttons are configurable via `tools` prop (array of ToolButton)
 *  - Each textarea auto‑resizes vertically (CSS resize: vertical)
 *  - Focus border highlight (--ac color)
 *  - Responsive: mobile hides tool labels, shows icons only
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MODEL_TYPES } from '@/config/model-types'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

defineOptions({ name: 'PromptEditor' })

export interface ToolButton {
  key: string
  icon: string
  label: string
  title?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  positive: string
  negative: string
  showNegative?: boolean
  promptStyle?: 'tags' | 'natural'
  /** 模型条目 key: 存在 generate.placeholders.positive_<key> 时优先于 promptStyle 通用占位;
   *  同时用于派生 mediaType (视频占位判据) */
  modelType?: string
  tools?: ToolButton[]
}>(), {
  showNegative: true,
  promptStyle: 'tags',
  modelType: '',
  tools: () => [],
})

const emit = defineEmits<{
  'update:positive': [value: string]
  'update:negative': [value: string]
  'tool': [key: string]
}>()

const { t, te } = useI18n({ useScope: 'global' })

/** 媒体类型派生: 从 modelType 反查 MODEL_TYPES。判据基于 mediaType (非 promptStyle):
 *  - krea2/zimage: modelType → mediaType='image' → 不命中视频占位 (走 promptStyle 通用占位)
 *  - wan22_*: modelType → mediaType='video' → 命中视频占位
 *  两个判据不混用: promptStyle 管工具栏收敛, mediaType 管视频专属文案。 */
const mediaType = computed<'image' | 'video'>(() =>
  props.modelType && MODEL_TYPES[props.modelType]?.mediaType === 'video' ? 'video' : 'image',
)

/** 占位符解析优先级:
 *  1. 按模型 key 的专用占位 (placeholders.positive_<key>) — 最高, 覆盖一切
 *  2. 视频架构专属运动引导 (prompt.video_ph) — 仅 mediaType==='video', 基于 mediaType 而非 promptStyle
 *  3. promptStyle 通用占位 (tags→positive_placeholder / natural→positive_placeholder_natural)
 *
 *  边界: krea2/zimage 是 natural+image → 走 3 (positive_placeholder_natural), 不命中 2;
 *        wan22 是 natural+video → 走 2 (video_ph)。两个判据不混用。
 */
const positivePlaceholder = computed(() => {
  const perModelKey = `generate.placeholders.positive_${props.modelType}`
  if (props.modelType && te(perModelKey)) return t(perModelKey)
  if (mediaType.value === 'video' && te('generate.prompt.video_ph')) return t('generate.prompt.video_ph')
  return props.promptStyle === 'natural'
    ? t('generate.prompt.positive_placeholder_natural')
    : t('generate.prompt.positive_placeholder')
})

/** 负面占位符同样按模型 key 解析 (placeholders.negative_<key>) > 视频专属 > 通用 negative_placeholder */
const negativePlaceholder = computed(() => {
  const perModelKey = `generate.placeholders.negative_${props.modelType}`
  if (props.modelType && te(perModelKey)) return t(perModelKey)
  if (mediaType.value === 'video' && te('generate.prompt.negative_video_ph')) return t('generate.prompt.negative_video_ph')
  return t('generate.prompt.negative_placeholder')
})

const helpOpen = ref(false)
const posRef = ref<HTMLTextAreaElement | null>(null)
const negRef = ref<HTMLTextAreaElement | null>(null)

/** Insert text at current cursor position in the specified textarea */
function insertAtCursor(target: 'positive' | 'negative', text: string) {
  const ta = target === 'positive' ? posRef.value : negRef.value
  if (!ta) return

  const pos = ta.selectionStart ?? ta.value.length
  const before = ta.value.slice(0, pos)
  const after = ta.value.slice(pos)
  const sep = before && !before.endsWith(' ') && !before.endsWith(',') ? ', ' : ''
  const newValue = before + sep + text + after
  const newPos = pos + sep.length + text.length

  if (target === 'positive') {
    emit('update:positive', newValue)
  } else {
    emit('update:negative', newValue)
  }

  // Restore focus and cursor position after Vue re-render
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(newPos, newPos)
  })
}

defineExpose({ insertAtCursor })
</script>

<template>
  <div class="prompt-editor">
    <!-- Section header -->
    <div class="gen-s-hdr">
      <MsIcon name="notes" class="hdr-icon" />
      {{ t('generate.prompt.title') }}
      <button class="prompt-help-btn" :title="t('generate.prompt.syntax_help_title')" @click="helpOpen = true">
        <MsIcon name="help_outline" size="sm" color="none" />
      </button>
      <!-- 标题行右端槽 — 视频 5B 的文生/图生开关挂这里。
           选它是因为切到文生时左侧媒体栏整块消失, 开关必须待在不随之移动的位置。 -->
      <div v-if="$slots['header-actions']" class="prompt-hdr-actions">
        <slot name="header-actions" />
      </div>
    </div>

    <!-- Unified prompt container: toolbar + (media | fields) -->
    <div class="prompt-container">
      <!-- Toolbar (above everything, full width) -->
      <div v-if="tools.length" class="prompt-toolbar">
        <button
          v-for="tool in tools"
          :key="tool.key"
          class="prompt-tool-btn"
          :title="tool.title"
          :disabled="tool.disabled"
          @click="emit('tool', tool.key)"
        >
          <MsIcon :name="tool.icon" color="var(--ac)" class="tool-icon" />
          <span class="tool-label">{{ tool.label }}</span>
        </button>
      </div>

      <!-- 分栏 — 左=媒体槽 (视频起始画面), 中=正/负输入框, 右=media-right 槽
           (H3 尾帧; 首帧 | 提示词 | 尾帧 三栏)。
           未传 media 槽时 .prompt-media 不渲染, .prompt-fields 独占整宽,
           渲染结果与分栏改造前逐像素一致 (图像架构回归保护)。 -->
      <div class="prompt-body" :class="{ 'prompt-body--3col': $slots['media-right'] }">
        <div v-if="$slots.media" class="prompt-media">
          <slot name="media" />
        </div>

        <div class="prompt-fields">
          <!-- Positive prompt -->
          <div class="prompt-label">
            {{ t('generate.prompt.positive_label') }}
          </div>
          <!-- 单框模式 (无负面提示词的架构): 正面框加倍占满原双框空间 -->
          <textarea
            ref="posRef"
            class="prompt-textarea"
            :rows="showNegative ? 4 : 9"
            :value="positive"
            :placeholder="positivePlaceholder"
            @input="emit('update:positive', ($event.target as HTMLTextAreaElement).value)"
          />

          <!-- Negative prompt -->
          <div v-if="showNegative" class="prompt-label prompt-label--neg">
            {{ t('generate.prompt.negative_label') }}
          </div>
          <textarea
            v-if="showNegative"
            ref="negRef"
            class="prompt-textarea"
            rows="4"
            :value="negative"
            :placeholder="negativePlaceholder"
            @input="emit('update:negative', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <!-- 右媒体栏 (H3 尾帧): 首帧 | 提示词 | 尾帧 三栏 -->
        <div v-if="$slots['media-right']" class="prompt-media prompt-media--right">
          <slot name="media-right" />
        </div>
      </div>
    </div>

    <!-- Syntax help modal -->
    <BaseModal v-model="helpOpen" :title="t('generate.prompt.help_modal_title')" icon="help_outline" size="lg">
      <div class="help-content">
        <!-- 基础语法: 按 promptStyle 区分 tag 系 (A1111) 与自然语言系 -->
        <template v-if="promptStyle === 'natural'">
          <div class="help-section-title">{{ t('generate.prompt.help.natural_title') }}</div>
          <table class="help-table">
            <tr v-for="row in [
              { key: 'natural_sentence', example: 'A silver-haired girl in a flowing dress stands on a cliff at sunset, cinematic lighting' },
              { key: 'natural_order', example: '' },
              { key: 'natural_detail', example: '' },
              { key: 'natural_no_weight', example: '' },
            ]" :key="row.key">
              <td class="help-label">{{ t(`generate.prompt.help.${row.key}`) }}</td>
              <td>
                <code v-if="row.example">{{ row.example }}</code>
                <br v-if="row.example" />
                <span class="help-desc">{{ t(`generate.prompt.help.${row.key}_desc`) }}</span>
              </td>
            </tr>
          </table>
        </template>
        <template v-else>
          <div class="help-section-title">{{ t('generate.prompt.help.basic_title') }}</div>
          <table class="help-table">
            <tr v-for="row in [
              { key: 'comma', example: '1girl, long hair, blue sky' },
              { key: 'weight_up', example: '(masterpiece:1.4)' },
              { key: 'weight_down', example: '(blurry:0.5)' },
              { key: 'embedding', example: 'embedding:easynegative' },
              { key: 'quality', example: '' },
            ]" :key="row.key">
              <td class="help-label">{{ t(`generate.prompt.help.${row.key}`) }}</td>
              <td>
                <code v-if="row.example">{{ row.example }}</code>
                <br v-if="row.example" />
                <span class="help-desc">{{ t(`generate.prompt.help.${row.key}_desc`) }}</span>
              </td>
            </tr>
          </table>
        </template>

        <!-- 随机提示词 -->
        <div class="help-section-title">{{ t('generate.prompt.help.random_title') }}</div>
        <table class="help-table">
          <tr v-for="row in [
            { key: 'random_pick', example: '{red|green|blue} hair' },
            { key: 'random_weight', example: '{0.8::masterpiece|0.2::best quality}' },
            { key: 'random_multi', example: '{2$$cat|dog|bird}' },
            { key: 'wildcard', example: '__hair_color__ hair' },
            { key: 'wildcard_sub', example: '__sdxl/quality__' },
            { key: 'wildcard_multi', example: '{2$$__hair_color__}' },
            { key: 'variable_lock', example: '${c=!{red|blue}} ${c} dress, ${c} shoes' },
            { key: 'nesting', example: '{a {big|small} cat|a {red|blue} ball}' },
          ]" :key="row.key">
            <td class="help-label">{{ t(`generate.prompt.help.${row.key}`) }}</td>
            <td>
              <code>{{ row.example }}</code><br />
              <span class="help-desc">{{ t(`generate.prompt.help.${row.key}_desc`) }}</span>
            </td>
          </tr>
        </table>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.prompt-editor {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* ── Section header ── */
.gen-s-hdr {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t2);
}
.hdr-icon { font-size: .9rem; color: var(--t3); }

/* 标题行右端槽 (5B 文生/图生开关) */
.prompt-hdr-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

/* ── Unified prompt container ── */
.prompt-container {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  transition: border-color .15s;
  min-width: 0;
}
.prompt-container:focus-within {
  border-color: var(--bd-f);
}


/* ── Toolbar (top) ── */
.prompt-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  background: var(--bg2);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
  overflow-x: auto;
}
.prompt-toolbar::-webkit-scrollbar { display: none; }
/* 右对齐但保持溢出可滚动 (justify-content:flex-end 会让左侧溢出内容不可达) */
.prompt-toolbar > :first-child { margin-left: auto; }

/* ── 分栏 body ── */
.prompt-body {
  display: flex;
  align-items: stretch;
  min-width: 0;
}

/* 媒体栏 (视频起始画面; H3 时左右各一栏, 提示词夹中间)。仅在传入对应槽时渲染。
   栏内纵向排布 (小标题 + 上传区); 单个子项 (wan22) 时渲染结果与旧版一致。 */
.prompt-media {
  flex: 0 0 150px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border-right: 1px solid var(--bd);
  background: var(--bg2);
  min-width: 0;
}
.prompt-media--right { border-right: none; border-left: 1px solid var(--bd); }
.prompt-media > :deep(.upload-zone) { flex: 1; min-width: 0; min-height: 0; }

/* 三栏形态 (H3 首尾帧): 首帧 | 提示词 | 尾帧 ≈ 1:4:1。
   媒体列上限 150px (与单栏形态同宽), min-width 保底 pick 形态可用性;
   宽容器时余量全部归提示词列。 */
.prompt-body--3col .prompt-media { flex: 1 1 0; min-width: 104px; max-width: 150px; }
.prompt-body--3col .prompt-fields { flex: 4 1 0; }

/* 右栏: 正/负输入框。无媒体槽时独占整宽 = 分栏前的原布局。 */
.prompt-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

@media (max-width: 600px) {
  .prompt-body { flex-direction: column; }
  /* 三栏退回纵向堆叠; 媒体列高度自适应 (下限 180px): 单上传区 (wan22) 内容
     不足 180px 时仍撑满 180px 与旧版一致; H3 两栏各自独立渲染, 不裁切。 */
  .prompt-media,
  .prompt-body--3col .prompt-media {
    flex: 0 0 auto;
    height: auto;
    min-height: 180px;
    min-width: 0;
    max-width: none;
    border-right: none;
    border-left: none;
    border-bottom: 1px solid var(--bd);
  }
  .prompt-media--right { border-bottom: none; border-top: 1px solid var(--bd); }
}

/* ── Textarea ── */
.prompt-textarea {
  border: none;
  outline: none;
  box-shadow: none;
  background: var(--bg-in);
  color: var(--t1);
  font-size: .85rem;
  line-height: 1.5;
  padding: var(--sp-2) var(--sp-3);
  min-height: 60px;
  resize: vertical;
  font-family: inherit;
}
.prompt-textarea::placeholder {
  color: var(--t3);
  opacity: .7;
}

/* ── Label row ── */
.prompt-label {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: .66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t3);
  background: var(--bg2);
}
.prompt-label--neg {
  border-top: 1px solid var(--bd);
}

/* ── Tool button ── */
.prompt-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--t2);
  font-size: .72rem;
  cursor: pointer;
  white-space: nowrap;
  transition: color .15s, background .15s;
}
.prompt-tool-btn .tool-icon { color: var(--ac); font-size: .85rem; }
.prompt-tool-btn:hover:not(:disabled) {
  color: var(--t1);
  background: var(--bg3);
}
.prompt-tool-btn:disabled {
  opacity: .3;
  cursor: not-allowed;
}
.tool-label {
  font-size: .74rem;
  font-weight: 500;
}

@media (max-width: 768px) {
  .prompt-toolbar > :first-child { margin-left: 0; }
  .tool-label { display: none; }
}

/* ── Help button ── */
.prompt-help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  transition: color .15s, background .15s;
}
.prompt-help-btn:hover {
  color: var(--ac);
  background: var(--bg3);
}

/* ── Help modal content ── */
.help-content {
  font-size: .88rem;
  line-height: 1.7;
}
.help-section-title {
  font-weight: 600;
  color: var(--t1);
  margin-bottom: 8px;
}
.help-section-title:not(:first-child) {
  margin-top: 16px;
}
.help-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}
.help-table td {
  padding: 7px 6px;
  border-bottom: 1px solid var(--bd);
  vertical-align: top;
}
.help-table tr:last-child td {
  border-bottom: none;
}
.help-label {
  font-weight: 600;
  white-space: nowrap;
  color: var(--ac);
}
.help-desc {
  color: var(--t3);
}
.help-content code {
  font-family: monospace;
  font-size: .84rem;
  background: var(--bg3);
  padding: 1px 5px;
  border-radius: 3px;
}
</style>
