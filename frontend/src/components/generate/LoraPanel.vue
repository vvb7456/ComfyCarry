<script setup lang="ts">
/**
 * LoraPanel — Displays selected LoRAs with strength sliders + Add button.
 *
 * Legacy behavior (图像架构, mediaType==='image', 一字不变):
 * - Horizontal card grid with preview + strength slider + delete
 * - "Add LoRA" card at the end
 * - Click card image → (future) open model details
 * - Click delete → remove LoRA (auto-disables if last one removed)
 *
 * Video behavior (mediaType==='video'):
 * 卡片与图像架构**完全同构**, 只多一个「段徽章」—— 决定这个 LoRA 挂到哪一段采样器
 * (双段 / 仅高噪 / 仅低噪, 写入 loras[].apply), 点击循环切换, 默认双段。
 *
 * high/low 两段权重在文件层面完全无法区分 (字节数/头部长度/张量 key 全同且无元数据),
 * 靠文件名猜出来的配对与角色都是噪声。段归属一律由用户显式指定。
 *
 * 加速件过滤: Lightning 加速件物理落在 loras/ 目录, 视频架构下用 COMPONENT_FILENAMES
 * 同源过滤 (精确文件名集合, 不是模式匹配), 不出现在卡片列表中。
 */
import { computed, inject, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import type { LoraItem } from '@/composables/generate/useGenerateOptions'
import type { LoraEntry } from '@/stores/generate'
import { MODEL_TYPES } from '@/config/model-types'
import { COMPONENT_FILENAMES } from '@/config/component-registry'
import AddCard from '@/components/ui/AddCard.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'LoraPanel' })

const emit = defineEmits<{
  openPicker: []
  detail: [name: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)
const options = inject(GenerateOptionsKey)!

// ── 架构判定 ──
// store.activeModelType 是当前 tab 的架构 (LoraPanel 在 ModelTab 内, 一 tab 一实例)。
// isVideo 决定是否启用视频配对折叠; 图像架构恒走原逻辑 (回归保护)。
const isVideo = computed(
  () => MODEL_TYPES[store.activeModelType]?.mediaType === 'video',
)

// 只有双权重条目 (14B) 才存在 high/low 噪声段概念。5B 是单权重架构, 其 LoRA
// 不分段 —— 若对它做段推导, 文件名含 "high_" 的普通 LoRA 会被误标「仅高噪」。
const isPaired = computed(
  () => isVideo.value && MODEL_TYPES[store.activeModelType]?.dualUnet === true,
)

function getLoraInfo(name: string): LoraItem | undefined {
  return options.loras.value.find(l => l.name === name)
}

function getDisplayName(name: string): string {
  const info = getLoraInfo(name)
  const infoName = info?.info?.name
  if (infoName && typeof infoName === 'string') return infoName
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  return base.replace(/\.[^.]+$/, '')
}

function getPreviewUrl(name: string): string | null {
  const info = getLoraInfo(name)
  if (!info) return null
  if (info.preview) return `/api/local_models/preview?path=${encodeURIComponent(info.preview)}`
  // CivitAI fallback
  const civitImg = (info.info as Record<string, unknown>)?.images as Array<Record<string, unknown>> | undefined
  const first = civitImg?.[0]
  if (first?.url && typeof first.url === 'string' && first.url.startsWith('http')) return first.url
  return null
}

function isPreviewVideo(name: string): boolean {
  const info = getLoraInfo(name)
  if (!info || info.preview) return false
  const civitImg = (info.info as Record<string, unknown>)?.images as Array<Record<string, unknown>> | undefined
  return civitImg?.[0]?.type === 'video'
}

function removeLora(index: number) {
  state.value.loras.splice(index, 1)
}

function toggleEnabled(index: number) {
  state.value.loras[index].enabled = !state.value.loras[index].enabled
}

function updateStrength(index: number, value: number) {
  state.value.loras[index].strength = value
}

// ── Inline strength editing ──
const editingIndex = ref<number | null>(null)
const editRef = ref<HTMLInputElement | null>(null)

function setEditRef(el: unknown) {
  editRef.value = el as HTMLInputElement | null
}

async function startStrengthEdit(index: number) {
  editingIndex.value = index
  await nextTick()
  if (editRef.value) {
    editRef.value.focus()
    editRef.value.select()
  }
}

function commitStrengthEdit(index: number, e: Event) {
  const raw = parseFloat((e.target as HTMLInputElement).value)
  editingIndex.value = null
  if (isNaN(raw)) return
  state.value.loras[index].strength = Math.max(0, Math.min(2, Math.round(raw * 20) / 20))
}

function cancelStrengthEdit() {
  editingIndex.value = null
}

// ════════════════════════════════════════════════════════════════════════════
// 视频架构: LoRA 段徽章 (无配对、无推断)
// ════════════════════════════════════════════════════════════════════════════

function basename(name: string): string {
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
}

/**
 * 加速件过滤源: COMPONENT_FILENAMES (精确文件名集合, 不是模式匹配)。
 * 加速件物理落在 loras/ 目录, 会混进 LoRA 列表, 视频架构下需过滤。
 */
function isAccelerator(name: string): boolean {
  return COMPONENT_FILENAMES.has(basename(name))
}

/**
 * 渲染用的 LoRA 列表 —— 图像与视频共用一个模板分支, 差别只在这里。
 * 携带 index 是因为所有写操作 (强度/启用/删除) 都按 state.loras 的真实下标进行,
 * 而视频侧过滤掉了加速件, 下标会错位。
 */
const visibleLoras = computed<{ lora: LoraEntry; index: number }[]>(() => {
  const all = state.value.loras.map((lora, index) => ({ lora, index }))
  if (!isVideo.value) return all
  return all.filter(x => !isAccelerator(x.lora.name))
})

/**
 * 段归属 (loras[].apply): 这是**真实的工作流参数** —— 决定该 LoRA 挂到哪一段采样器,
 * 不是从文件名猜出来的。默认恒 'both', 由用户点徽章显式改。
 */
function initApply(lora: LoraEntry): 'high' | 'low' | 'both' {
  if (lora.apply === 'high' || lora.apply === 'low' || lora.apply === 'both') {
    return lora.apply
  }
  lora.apply = 'both'
  return 'both'
}

/** apply 字段 → 段徽章 i18n key。 */
function applyBadgeKey(apply: 'high' | 'low' | 'both'): string {
  return apply === 'both'
    ? 'generate.video.seg_both'
    : apply === 'high'
      ? 'generate.video.seg_high'
      : 'generate.video.seg_low'
}

/** 点击段徽章循环切换: 双段 → 仅高噪 → 仅低噪 → 双段。 */
function cycleApply(lora: LoraEntry) {
  const cur = initApply(lora)
  lora.apply = cur === 'both' ? 'high' : cur === 'high' ? 'low' : 'both'
}
</script>

<template>
  <div class="lora-panel">
    <!-- 图像与视频**同一套卡片**: 唯一差异是视频双权重架构多一个段徽章。 -->
    <div class="lora-grid">
      <div
        v-for="{ lora, index } in visibleLoras"
        :key="lora.name"
        class="lora-card"
        :class="{ 'lora-card--disabled': !lora.enabled }"
      >
        <div class="lora-card__img" @click="emit('detail', lora.name)">
          <template v-if="getPreviewUrl(lora.name)">
            <video
              v-if="isPreviewVideo(lora.name)"
              :src="getPreviewUrl(lora.name)!"
              muted autoplay loop playsinline disablepictureinpicture preload="metadata"
              class="lora-card__media"
            />
            <img
              v-else
              :src="getPreviewUrl(lora.name)!"
              alt=""
              loading="lazy"
              class="lora-card__media"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
          </template>
          <div v-if="!getPreviewUrl(lora.name)" class="lora-card__no-img">
            <MsIcon name="extension" color="none" />
          </div>

          <!-- 段徽章: 仅双权重视频架构 (14B)。5B 单权重无分段概念, 图像架构同理。
               点击循环 双段 → 仅高噪 → 仅低噪。 -->
          <div v-if="isPaired" class="lora-card__seg-badges">
            <button
              class="lora-card__badge lora-card__badge--seg"
              @click.stop="cycleApply(lora)"
            >
              {{ t(applyBadgeKey(initApply(lora))) }}
            </button>
          </div>

          <!-- Disable toggle (top-left) -->
          <button
            class="lora-card__toggle"
            :title="lora.enabled ? t('generate.lora.disable') : t('generate.lora.enable')"
            @click.stop="toggleEnabled(index)"
          >
            <MsIcon :name="lora.enabled ? 'visibility' : 'visibility_off'" color="none" />
          </button>
          <!-- Delete button (top-right) -->
          <button
            class="lora-card__del"
            :title="t('generate.lora.remove')"
            @click.stop="removeLora(index)"
          >
            <MsIcon name="close" color="none" />
          </button>
        </div>
        <div class="lora-card__body">
          <div class="lora-card__name text-truncate" :title="getDisplayName(lora.name)">
            {{ getDisplayName(lora.name) }}
          </div>
          <div class="lora-card__strength">
            <input
              type="range"
              :value="lora.strength"
              min="0"
              max="2"
              step="0.05"
              @input="updateStrength(index, parseFloat(($event.target as HTMLInputElement).value))"
            />
            <span class="lora-card__str-val" :class="{ 'lora-card__str-val--editable': editingIndex !== index }" @click="startStrengthEdit(index)">
              <input
                v-if="editingIndex === index"
                :ref="setEditRef"
                type="number"
                class="lora-card__str-edit"
                :value="lora.strength"
                min="0" max="2" step="0.05"
                @blur="commitStrengthEdit(index, $event)"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                @keydown.escape.prevent="cancelStrengthEdit"
              />
              <template v-else>{{ lora.strength.toFixed(2) }}</template>
            </span>
          </div>
        </div>
      </div>

      <!-- Add LoRA card -->
      <AddCard
        :label="t('generate.lora.add')"
        class="lora-add-card"
        @click="emit('openPicker')"
      />
    </div>
  </div>
</template>

<style scoped>
.lora-panel {
  /* inherits parent padding from gen-module-panel */
}

.lora-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--sp-2);
}

/* Ensure add-card matches selected LoRA card height */
.lora-grid :deep(.lora-add-card) {
  aspect-ratio: 3 / 4;
}

.lora-card {
  background: var(--bg3);
  border: 2px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  position: relative;
  transition: border-color .15s;
}

.lora-card:hover {
  border-color: color-mix(in srgb, var(--ac) 50%, var(--bd));
}

/* Disabled state */
.lora-card--disabled {
  opacity: .45;
}

.lora-card--disabled .lora-card__img img {
  filter: grayscale(.6);
}

.lora-card__img {
  width: 100%;
  aspect-ratio: 3 / 3.38;
  background: var(--bg-in, var(--bg2));
  overflow: hidden;
  position: relative;
  cursor: pointer;
}

.lora-card__img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lora-card__media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lora-card__no-img {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  opacity: .25;
  font-size: 1.8rem;
}

.lora-card__del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--overlay);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t-inv);
  opacity: 0;
  transition: opacity .15s, background .15s;
  z-index: 2;
  padding: 0;
}

.lora-card:hover .lora-card__del {
  opacity: 1;
}

.lora-card__del:hover {
  background: var(--red);
}

/* Disable toggle button (top-left) */
.lora-card__toggle {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--overlay);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t-inv);
  opacity: 0;
  transition: opacity .15s, background .15s;
  z-index: 2;
  padding: 0;
  font-size: 13px;
}

.lora-card:hover .lora-card__toggle {
  opacity: 1;
}

.lora-card--disabled .lora-card__toggle {
  opacity: 1;
  background: var(--overlay-dark);
}

.lora-card__toggle:hover {
  background: var(--amber, #f59e0b);
}

.lora-card__body {
  padding: 6px 7px;
}

.lora-card__name {
  font-size: .73rem;
  font-weight: 600;
  color: var(--t1);
}


.lora-card__strength {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
}

.lora-card__strength input[type=range] {
  flex: 1;
  min-width: 0;
  height: 3px;
}

.lora-card__str-val {
  flex: 0 0 auto;
  min-width: 28px;
  text-align: right;
  font-family: 'IBM Plex Mono', monospace;
  font-size: .65rem;
  color: var(--ac);
  font-weight: 600;
  padding: 0 2px;
  border-radius: 3px;
  transition: background .15s;
}
.lora-card__str-val--editable {
  cursor: pointer;
}
.lora-card__str-val--editable:hover {
  background: var(--bg-in);
}
.lora-card__str-edit {
  width: 3.5ch;
  padding: 0 1px;
  border: 1px solid var(--ac);
  border-radius: 3px;
  background: var(--bg-in);
  color: var(--ac);
  font: inherit;
  text-align: right;
  outline: none;
  -moz-appearance: textfield;
  appearance: textfield;
}
.lora-card__str-edit::-webkit-inner-spin-button,
.lora-card__str-edit::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* ═══ 视频段徽章 ═══ */
/* 徽章区: 左上角, toggle (top:4px left:4px, 22px) 下方, 不重叠 */
.lora-card__seg-badges {
  position: absolute;
  top: 30px;
  left: 4px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: calc(100% - 8px);
}

/* 通用徽章风格: font-size:.6rem; font-weight:600; padding:1px 6px; border-radius:999px */
.lora-card__badge {
  font-size: .6rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
  max-width: 100%;
}


/* 段标记: accent 系, 可点击 */
.lora-card__badge--seg {
  background: var(--ac);
  color: #fff;
  border: none;
  cursor: pointer;
  transition: filter .15s;
  font: inherit;
  text-align: left;
}
.lora-card__badge--seg:hover {
  filter: brightness(1.12);
}
.lora-card__badge--seg:active {
  filter: brightness(0.92);
}


/* Add card matching grid item height */
.lora-add-card {
  min-height: 0;
  aspect-ratio: auto;
}

.lora-add-card :deep(.add-card) {
  height: 100%;
  min-height: 180px;
}
</style>
