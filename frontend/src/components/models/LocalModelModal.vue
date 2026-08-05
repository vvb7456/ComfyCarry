<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'
import type { LocalModel, LocalModelDetail, LocalModelImage } from '@/composables/useLocalModels'
import BaseModal from '@/components/ui/BaseModal.vue'
import Badge from '@/components/ui/Badge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { fmtBytes } from '@/utils/format'
import { MODEL_CATEGORY_COLORS } from '@/utils/constants'
import { useClipboard } from '@/composables/useClipboard'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'LocalModelModal' })

const props = defineProps<{
  modelValue: boolean
  model?: LocalModel | null
  modelId?: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  preview: [images: string[], index: number]
}>()

const { get, post } = useApiFetch()
const { copy } = useClipboard()
const { toast } = useToast()
const { t } = useI18n({ useScope: 'global' })
const detail = ref<LocalModelDetail | null>(null)
const loading = ref(false)
const enriching = ref(false)
const error = ref('')
const selectedWords = ref(new Set<string>())
const twListRef = ref<HTMLElement>()
const twCollapsed = ref(true)
const twOverflows = ref(false)

const previewUrl = computed(() => {
  const model = detail.value || props.model
  if (!model?.has_preview) return ''
  return model.preview_url || `/api/local_models/${model.id}/preview`
})

const images = computed<LocalModelImage[]>(() => detail.value?.images || [])
const visibleLinks = computed(() =>
  (detail.value?.links || []).filter(link => link.type !== 'civitai_api'),
)
const galleryUrls = computed(() => {
  const out: string[] = []
  if (previewUrl.value) out.push(previewUrl.value)
  for (const image of images.value) if (image.url) out.push(image.url)
  return out
})

const displayName = computed(() => detail.value?.display_name || props.model?.display_name || props.model?.filename || 'Model')

function sourceLabel() {
  const source = detail.value?.source
  if (!source?.type) return ''
  return source.type
}

function resetTriggerWords() {
  selectedWords.value = new Set()
  twCollapsed.value = true
  twOverflows.value = false
  void nextTick(() => {
    const el = twListRef.value
    if (el) twOverflows.value = el.scrollHeight > el.clientHeight + 2
  })
}

function asDetail(data: unknown): LocalModelDetail | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as Record<string, unknown>
  const value = (payload.model || payload.detail || payload) as Record<string, unknown>
  if (typeof value.id !== 'number') return null
  return {
    ...(value as unknown as LocalModelDetail),
    trigger_words: Array.isArray(value.trigger_words) ? value.trigger_words.filter((x): x is string => typeof x === 'string') : [],
    trigger_sources: value.trigger_sources && typeof value.trigger_sources === 'object'
      ? value.trigger_sources as Record<string, string[]>
      : {},
    source: value.source && typeof value.source === 'object'
      ? value.source as LocalModelDetail['source']
      : { type: '', model_id: '', version_id: '', version_name: '' },
    links: Array.isArray(value.links) ? value.links as LocalModelDetail['links'] : [],
    images: Array.isArray(value.images) ? value.images as LocalModelImage[] : [],
  }
}

function rowAsDetail(model: LocalModel): LocalModelDetail {
  return {
    ...model,
    sha256: '',
    trigger_words: [],
    trigger_sources: {},
    source: { type: '', model_id: '', version_id: '', version_name: '' },
    links: [],
    images: [],
  }
}

async function loadDetail(model: LocalModel | null, modelId?: number | null) {
  const id = modelId ?? model?.id
  if (!id) {
    detail.value = null
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  resetTriggerWords()
  try {
    const data = await get<unknown>(`/api/local_models/${id}`)
    detail.value = asDetail(data) || (model ? rowAsDetail(model) : null)
    resetTriggerWords()
    if (!data) error.value = t('models.local.detail_failed')
  } finally {
    loading.value = false
  }
}

async function enrich() {
  const model = detail.value || props.model
  if (!model || !model.can_fetch_info || enriching.value) return
  enriching.value = true
  try {
    const data = await post<unknown>(`/api/local_models/${model.id}/enrich`)
    const updated = asDetail(data)
    if (updated) {
      detail.value = updated
      resetTriggerWords()
    } else if (data) {
      await loadDetail(model)
    }
  } finally {
    enriching.value = false
  }
}

watch(() => [props.modelValue, props.model?.id, props.modelId] as const, ([open]) => {
  if (open) void loadDetail(props.model || null, props.modelId)
}, { immediate: true })

function toggleWord(word: string) {
  const next = new Set(selectedWords.value)
  if (next.has(word)) next.delete(word)
  else next.add(word)
  selectedWords.value = next
}

async function copyWords(words: string[]) {
  if (!words.length) {
    toast(t('models.meta.select_first'), 'warning')
    return
  }
  await copy(words.join(', '))
}

function copyAllWords() {
  void copyWords(detail.value?.trigger_words || [])
}

function copySelectedWords() {
  void copyWords([...selectedWords.value])
}

function imageMeta(image: LocalModelImage) {
  return image.meta || {}
}

function hasCaption(image: LocalModelImage) {
  const meta = imageMeta(image)
  return !!(meta.seed || meta.steps || meta.cfg_scale || meta.sampler || meta.model || meta.prompt || meta.negative_prompt)
}

function openImage(index: number) {
  emit('preview', galleryUrls.value, index)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="displayName"
    size="xl"
    width="clamp(720px, 55vw, 960px)"
    density="roomy"
    scroll="content"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="local-modal-status">{{ t('models.local.loading') }}</div>
    <div v-else-if="error" class="local-modal-status local-modal-error">{{ error }}</div>
    <template v-if="detail">
      <div class="lm-tags">
        <Badge v-if="detail.category" :color="MODEL_CATEGORY_COLORS[detail.category]">{{ detail.category.toUpperCase() }}</Badge>
        <Badge v-if="detail.base_model">{{ detail.base_model }}</Badge>
        <Badge v-else-if="detail.architecture && detail.architecture !== 'unknown'">{{ detail.architecture }}</Badge>
        <BaseButton v-if="detail.can_fetch_info && !detail.has_info" size="sm" :disabled="enriching" @click="enrich">{{ enriching ? t('models.local.enriching') : t('models.local.fetch_info') }}</BaseButton>
      </div>

      <table class="lm-table">
        <tbody>
          <tr v-if="detail.source.model_id"><td>ID</td><td>{{ detail.source.model_id }}</td></tr>
          <tr><td>{{ t('models.meta.file') }}</td><td class="lm-mono">{{ detail.relative_path }}</td></tr>
          <tr><td>{{ t('models.local.size') }}</td><td>{{ fmtBytes(detail.size_bytes) }}</td></tr>
          <tr v-if="detail.sha256"><td>SHA256</td><td class="lm-mono">{{ detail.sha256 }}</td></tr>
          <tr v-if="sourceLabel()"><td>{{ t('models.local.source') }}</td><td>{{ sourceLabel() }}</td></tr>
          <tr v-if="detail.source.version_name"><td>{{ t('models.meta.version') }}</td><td>{{ detail.source.version_name }}</td></tr>
          <tr v-for="link in visibleLinks" :key="link.type + link.url">
            <td>{{ link.type === 'civitai_web' ? t('models.local.civitai_link') : link.type }}</td>
            <td><a :href="link.url" target="_blank" rel="noopener">{{ link.type === 'civitai_web' ? t('models.local.open_civitai') : link.url }} ↗</a></td>
          </tr>
        </tbody>
      </table>

      <section v-if="detail.trigger_words.length" class="lm-section">
        <div class="lm-section-title"><MsIcon name="label" size="sm" /> {{ t('models.meta.trigger_words') }}</div>
        <div class="lm-word-actions">
          <span class="lm-word-count">{{ selectedWords.size ? t('models.meta.selected_count', { count: selectedWords.size }) : t('models.meta.click_to_select') }}</span>
          <BaseButton size="sm" variant="success" @click="copySelectedWords">{{ t('models.meta.copy_selected') }}</BaseButton>
          <BaseButton size="sm" @click="copyAllWords">{{ t('models.meta.copy_all') }}</BaseButton>
        </div>
        <div ref="twListRef" class="lm-words" :class="{ collapsed: twCollapsed }">
          <button v-for="word in detail.trigger_words" :key="word" class="lm-word" :class="{ selected: selectedWords.has(word) }" @click="toggleWord(word)">{{ word }}</button>
        </div>
        <button v-if="twOverflows" class="lm-word-toggle" :aria-expanded="!twCollapsed" @click="twCollapsed = !twCollapsed">
          {{ twCollapsed ? t('models.meta.expand_all', { count: detail.trigger_words.length }) : t('models.meta.collapse') }}
        </button>
      </section>

      <section v-if="galleryUrls.length" class="lm-section">
        <div class="lm-section-title"><MsIcon name="image" size="sm" /> {{ t('models.meta.sample_images') }}</div>
        <div class="lm-gallery">
          <figure v-if="previewUrl" class="lm-image" @click="openImage(0)"><img :src="previewUrl" alt="" loading="lazy"></figure>
          <figure v-for="(image, index) in images" :key="image.url + index" class="lm-image" @click="openImage(index + (previewUrl ? 1 : 0))">
            <video v-if="image.type === 'video'" :src="image.url" muted loop playsinline preload="metadata" />
            <span v-if="image.type === 'video'" class="lm-video-badge"><MsIcon name="videocam" size="sm" /> {{ t('models.meta.video') }}</span>
            <img v-else :src="image.url" alt="" loading="lazy">
            <figcaption v-if="hasCaption(image)" class="lm-caption">
              <template v-if="imageMeta(image).seed"><label>Seed</label>{{ imageMeta(image).seed }}</template>
              <template v-if="imageMeta(image).steps"><label>Steps</label>{{ imageMeta(image).steps }}</template>
              <template v-if="imageMeta(image).cfg_scale"><label>CFG</label>{{ imageMeta(image).cfg_scale }}</template>
              <template v-if="imageMeta(image).sampler"><label>Sampler</label>{{ imageMeta(image).sampler }}</template>
              <template v-if="imageMeta(image).model"><label>Model</label>{{ imageMeta(image).model }}</template>
              <template v-if="imageMeta(image).prompt"><label>Positive</label><span class="lm-prompt" @click.stop="copyWords([imageMeta(image).prompt!])" :title="t('models.meta.click_to_copy')">{{ imageMeta(image).prompt }}</span></template>
              <template v-if="imageMeta(image).negative_prompt"><label>Negative</label><span class="lm-prompt" @click.stop="copyWords([imageMeta(image).negative_prompt!])" :title="t('models.meta.click_to_copy')">{{ imageMeta(image).negative_prompt }}</span></template>
            </figcaption>
          </figure>
        </div>
      </section>
    </template>
  </BaseModal>
</template>

<style scoped>
.local-modal-status { padding: 28px 0; color: var(--t2); text-align: center; }
.local-modal-error { color: var(--er); }
.lm-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.lm-table { width: 100%; font-size: var(--text-base); border-collapse: collapse; margin-bottom: var(--sp-4); }
.lm-table td { padding: 7px 10px; border-bottom: 1px solid var(--bd); vertical-align: top; }
.lm-table td:first-child { color: var(--t3); white-space: nowrap; width: 100px; font-weight: 500; }
.lm-table a { color: var(--ac); word-break: break-all; }
.lm-mono { word-break: break-all; font-family: monospace; font-size: .78rem; }
.lm-section { margin-top: var(--sp-4); }
.lm-section-title { font-size: .88rem; font-weight: 600; display: flex; align-items: center; gap: var(--sp-1); margin-bottom: 8px; }
.lm-word-actions { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.lm-word-count { color: var(--t3); font-size: var(--text-sm); margin-right: auto; }
.lm-words { display: flex; flex-wrap: wrap; gap: 6px; transition: max-height .25s ease; }
.lm-words.collapsed { max-height: 34px; overflow: hidden; }
.lm-word { border: 1px solid var(--bd); border-radius: var(--r-sm); background: var(--bg3); color: var(--t1); padding: 4px 8px; cursor: pointer; }
.lm-word.selected { border-color: var(--ac); background: color-mix(in srgb, var(--ac) 18%, transparent); }
.lm-word-toggle { background: none; border: none; color: var(--ac); cursor: pointer; font-size: var(--text-sm); padding: var(--sp-1) 0; margin-top: 2px; }
.lm-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-top: 10px; }
.lm-image { margin: 0; border-radius: var(--rs); overflow: hidden; background: var(--bg2); border: 1px solid var(--bd); position: relative; cursor: zoom-in; }
.lm-image img, .lm-image video { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
.lm-video-badge { position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,.65); color: #fff; padding: 2px 8px; border-radius: var(--r-xs); font-size: .75rem; display: flex; align-items: center; gap: var(--sp-1); }
.lm-caption { padding: var(--sp-2); font-size: var(--text-xs); color: var(--t3); line-height: 1.4; }
.lm-caption label { color: var(--t2); font-weight: 500; display: block; margin-top: var(--sp-1); }
.lm-prompt { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-all; cursor: pointer; }
.lm-prompt:hover { -webkit-line-clamp: unset; line-clamp: unset; }
</style>
