<script setup lang="ts">
/**
 * LoraPanel — Displays selected LoRAs with strength sliders + Add button.
 *
 * Legacy behavior:
 * - Horizontal card grid with preview + strength slider + delete
 * - "Add LoRA" card at the end
 * - Click card image → (future) open model details
 * - Click delete → remove LoRA (auto-disables if last one removed)
 */
import { computed, inject, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import type { LoraItem } from '@/composables/generate/useGenerateOptions'
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
</script>

<template>
  <div class="lora-panel">
    <div class="lora-grid">
      <!-- Selected LoRA cards -->
      <div
        v-for="(lora, i) in state.loras"
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
          <!-- Disable toggle (top-left) -->
          <button
            class="lora-card__toggle"
            :title="lora.enabled ? t('generate.lora.disable') : t('generate.lora.enable')"
            @click.stop="toggleEnabled(i)"
          >
            <MsIcon :name="lora.enabled ? 'visibility' : 'visibility_off'" color="none" />
          </button>
          <!-- Delete button (top-right) -->
          <button
            class="lora-card__del"
            :title="t('generate.lora.remove')"
            @click.stop="removeLora(i)"
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
              @input="updateStrength(i, parseFloat(($event.target as HTMLInputElement).value))"
            />
            <span class="lora-card__str-val" :class="{ 'lora-card__str-val--editable': editingIndex !== i }" @click="startStrengthEdit(i)">
              <input
                v-if="editingIndex === i"
                :ref="setEditRef"
                type="number"
                class="lora-card__str-edit"
                :value="lora.strength"
                min="0" max="2" step="0.05"
                @blur="commitStrengthEdit(i, $event)"
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
