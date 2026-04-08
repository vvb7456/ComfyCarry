<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ModelMeta, ModelMetaImage, ModelMetaVersion } from '@/types/models'
import { MODEL_CATEGORY_COLORS } from '@/utils/constants'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import Badge from '@/components/ui/Badge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import DownloadButton from './DownloadButton.vue'
import { useToast } from '@/composables/useToast'
import { useDownloads } from '@/composables/useDownloads'

defineOptions({ name: 'ModelMetaModal' })

const props = defineProps<{
  modelValue: boolean
  meta: ModelMeta | null
  showDownload?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  preview: [images: string[], index: number]
}>()

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const { getVersionState, downloadOne } = useDownloads()

// ── Version switching ──
const selectedVersionId = ref<string | number | undefined>()

const hasMultipleVersions = computed(() => (props.meta?.versions?.length || 0) > 1)

const versionOptions = computed(() =>
  (props.meta?.versions || []).map(v => ({
    value: String(v.id),
    label: v.name + (v.baseModel ? ` (${v.baseModel})` : ''),
  })),
)

const activeVersion = computed<ModelMetaVersion | undefined>(() => {
  const versions = props.meta?.versions
  if (!versions?.length) return undefined
  const sel = selectedVersionId.value
  if (sel != null) {
    const found = versions.find(v => String(v.id) === String(sel))
    if (found) return found
  }
  // Fallback: match meta.versionId
  if (props.meta?.versionId) {
    return versions.find(v => String(v.id) === String(props.meta!.versionId))
  }
  return versions[0]
})

// Use version-specific data when available, fallback to top-level meta
const displayImages = computed<ModelMetaImage[]>(() =>
  activeVersion.value?.images?.length ? activeVersion.value.images : (props.meta?.images || []),
)

// Full-size URLs for gallery preview navigation (images + videos)
const galleryImageUrls = computed(() =>
  displayImages.value.map(img => fullImageUrl(img.url)),
)

const displayTrainedWords = computed<string[]>(() =>
  activeVersion.value?.trainedWords?.length ? activeVersion.value.trainedWords : (props.meta?.trainedWords || []),
)

const displayBaseModel = computed(() =>
  activeVersion.value?.baseModel || props.meta?.baseModel || '',
)

const displayVersionName = computed(() =>
  activeVersion.value?.name || props.meta?.versionName || '',
)

const displaySha256 = computed(() =>
  activeVersion.value?.hashes?.SHA256 || props.meta?.sha256 || '',
)

// ── Download button state for current version ──
const dlBtnState = computed(() => {
  const vid = activeVersion.value?.id ?? props.meta?.versionId
  const mid = props.meta?.id
  if (!mid || !vid) return 'idle' as const
  return getVersionState(mid, vid)
})

function handleDownload() {
  const mid = props.meta?.id
  const vid = activeVersion.value?.id ?? props.meta?.versionId
  if (!mid) return
  const mtype = (props.meta?.type || 'Checkpoint').toLowerCase()
  downloadOne(String(mid), mtype, vid ? Number(vid) : undefined)
}

// ── Trigger word selection ──
const selectedWords = ref(new Set<string>())
const twListRef = ref<HTMLElement>()
const twCollapsed = ref(true)
const twOverflows = ref(false)

watch(() => props.modelValue, (open) => {
  if (open) {
    selectedWords.value = new Set()
    twCollapsed.value = true
    twOverflows.value = false
    selectedVersionId.value = undefined
    nextTick(() => {
      const el = twListRef.value
      if (el) twOverflows.value = el.scrollHeight > el.clientHeight + 2
    })
  }
})

// Reset trigger words state when version changes
watch(activeVersion, () => {
  selectedWords.value = new Set()
  twCollapsed.value = true
  twOverflows.value = false
  nextTick(() => {
    const el = twListRef.value
    if (el) twOverflows.value = el.scrollHeight > el.clientHeight + 2
  })
})

function toggleWord(word: string) {
  const s = selectedWords.value
  if (s.has(word)) s.delete(word)
  else s.add(word)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('common.clipboard_copied'), 'success')
  } catch { /* ignore */ }
}

function copySelectedWords() {
  if (!selectedWords.value.size) {
    toast(t('models.meta.select_first'), 'warning')
    return
  }
  copyText([...selectedWords.value].join(', '))
}

function copyAllWords() {
  copyText(displayTrainedWords.value.join(', '))
}

// ── Image URL helpers ──
function resolveImageUrl(url: string, full = false): string {
  if (!url) return ''
  if (url.startsWith('/') || url.startsWith('http')) return url
  const width = full ? '' : '/width=450'
  return `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${url}${width}/default.jpg`
}

function fullImageUrl(url: string): string {
  return resolveImageUrl(url, true)
}

function isVideo(img: ModelMetaImage): boolean {
  return img.type === 'video'
}

function hasCaption(img: ModelMetaImage): boolean {
  return !!(img.seed || img.steps || img.cfg || img.sampler || img.model || img.positive || img.negative)
}

function badgeColor(type?: string): string | undefined {
  if (!type) return undefined
  return MODEL_CATEGORY_COLORS[type]
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="meta?.name || t('models.meta.title')"
    size="xl"
    width="clamp(720px, 55vw, 960px)"
    density="roomy"
    scroll="content"
  >
    <template v-if="meta">
      <!-- Tags -->
      <div class="mm-tags">
        <Badge v-if="meta.type" :color="badgeColor(meta.type)">{{ meta.type.toUpperCase() }}</Badge>
        <Badge v-if="displayBaseModel">{{ displayBaseModel }}</Badge>
      </div>

      <!-- Info Table -->
      <table class="mm-table">
        <tbody>
          <tr v-if="meta.id">
            <td>ID</td>
            <td>{{ meta.id }}</td>
          </tr>
          <!-- Version row: selector + download button when CivitAI, plain text otherwise -->
          <tr v-if="hasMultipleVersions || displayVersionName">
            <td>{{ t('models.meta.version') }}</td>
            <td>
              <div class="mm-version-row">
                <BaseSelect
                  v-if="hasMultipleVersions"
                  :options="versionOptions"
                  :model-value="String(activeVersion?.id ?? '')"
                  @update:model-value="selectedVersionId = String($event)"
                  size="sm"
                  class="mm-version-select"
                />
                <span v-else>{{ displayVersionName }}</span>
                <!-- Download button (only when opened from CivitAI context) -->
                <DownloadButton
                  v-if="showDownload && meta.civitaiUrl"
                  :state="dlBtnState"
                  @download="handleDownload"
                />
              </div>
            </td>
          </tr>
          <tr v-if="meta.author">
            <td>{{ t('models.meta.author') }}</td>
            <td>{{ meta.author }}</td>
          </tr>
          <tr v-if="meta.civitaiUrl">
            <td>{{ t('models.meta.link') }}</td>
            <td><a :href="meta.civitaiUrl" target="_blank" rel="noopener">{{ t('models.meta.view_on_civitai') }} ↗</a></td>
          </tr>
          <tr v-if="displaySha256">
            <td>SHA256</td>
            <td class="mm-hash">{{ displaySha256 }}</td>
          </tr>
          <tr v-if="meta.stats">
            <td>{{ t('models.meta.stats') }}</td>
            <td>
              <MsIcon name="download" class="ms-sm" /> {{ (meta.stats.downloads || 0).toLocaleString() }}
              &nbsp;
              <MsIcon name="thumb_up" class="ms-sm" /> {{ (meta.stats.likes || 0).toLocaleString() }}
            </td>
          </tr>
          <tr v-if="meta.filename">
            <td>{{ t('models.meta.file') }}</td>
            <td class="mm-hash">{{ meta.filename }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Trigger Words -->
      <div v-if="displayTrainedWords.length" class="mm-section">
        <div class="mm-section-header">
          <div class="mm-section-title">
            <MsIcon name="label" class="ms-sm" />
            {{ t('models.meta.trigger_words') }}
          </div>
          <div class="mm-tw-actions">
            <span class="mm-tw-count">
              {{ selectedWords.size > 0
                ? t('models.meta.selected_count', { count: selectedWords.size })
                : t('models.meta.click_to_select') }}
            </span>
            <BaseButton size="sm" variant="success" @click="copySelectedWords">
              {{ t('models.meta.copy_selected') }}
            </BaseButton>
            <BaseButton size="sm" @click="copyAllWords">
              {{ t('models.meta.copy_all') }}
            </BaseButton>
          </div>
        </div>
        <ul ref="twListRef" class="mm-tw-list" :class="{ collapsed: twCollapsed }">
          <li
            v-for="word in displayTrainedWords"
            :key="word"
            class="mm-tw-item"
            :class="{ selected: selectedWords.has(word) }"
            @click="toggleWord(word)"
          >
            {{ word }}
          </li>
        </ul>
        <button v-if="twOverflows" class="mm-tw-toggle" :aria-expanded="!twCollapsed" @click="twCollapsed = !twCollapsed">
          {{ twCollapsed ? t('models.meta.expand_all', { count: displayTrainedWords.length }) : t('models.meta.collapse') }}
        </button>
      </div>

      <!-- Image Gallery -->
      <div v-if="displayImages.length" class="mm-section">
        <div class="mm-section-title">
          <MsIcon name="image" class="ms-sm" />
          {{ t('models.meta.sample_images') }}
        </div>
        <div class="mm-gallery">
          <figure v-for="(img, i) in displayImages" :key="i" class="mm-figure" @click="emit('preview', galleryImageUrls, i)">
            <template v-if="isVideo(img)">
              <video
                :src="fullImageUrl(img.url)"
                muted loop playsinline disablepictureinpicture preload="metadata"
              />
              <span class="mm-video-badge">
                <MsIcon name="videocam" class="ms-sm" /> {{ t('models.meta.video') }}
              </span>
            </template>
            <img
              v-else
              :src="resolveImageUrl(img.url)"
              alt=""
              loading="lazy"
            />
            <figcaption v-if="hasCaption(img)" class="mm-caption">
              <template v-if="img.seed"><label>Seed</label>{{ img.seed }}</template>
              <template v-if="img.steps"><label>Steps</label>{{ img.steps }}</template>
              <template v-if="img.cfg"><label>CFG</label>{{ img.cfg }}</template>
              <template v-if="img.sampler"><label>Sampler</label>{{ img.sampler }}</template>
              <template v-if="img.model"><label>Model</label>{{ img.model }}</template>
              <template v-if="img.positive">
                <label>Positive</label>
                <span class="mm-prompt" @click.stop="copyText(img.positive!)" :title="t('models.meta.click_to_copy')">{{ img.positive }}</span>
              </template>
              <template v-if="img.negative">
                <label>Negative</label>
                <span class="mm-prompt" @click.stop="copyText(img.negative!)" :title="t('models.meta.click_to_copy')">{{ img.negative }}</span>
              </template>
            </figcaption>
          </figure>
        </div>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
/* Tags */
.mm-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }

/* Version row */
.mm-version-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mm-version-select {
  flex: 1;
  min-width: 0;
}

/* Info table */
.mm-table { width: 100%; font-size: var(--text-base); border-collapse: collapse; margin-bottom: var(--sp-4); }
.mm-table td { padding: 7px 10px; border-bottom: 1px solid var(--bd); vertical-align: top; }
.mm-table td:first-child { color: var(--t3); white-space: nowrap; width: 100px; font-weight: 500; }
.mm-table a { color: var(--ac); }
.mm-hash { word-break: break-all; font-family: monospace; font-size: .75rem; }

/* Sections */
.mm-section { margin-top: var(--sp-4); }
.mm-section-header {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: var(--sp-2);
}
.mm-section-title {
  font-size: .88rem; font-weight: 600; color: var(--t1);
  display: flex; align-items: center; gap: var(--sp-1);
}

/* Trigger words */
.mm-tw-actions { display: flex; align-items: center; gap: 6px; }
.mm-tw-count { font-size: var(--text-sm); color: var(--t3); }
.mm-tw-list {
  display: flex; flex-wrap: wrap; gap: 6px;
  list-style: none; margin-top: var(--sp-2); padding: 0;
  transition: max-height .25s ease;
}
.mm-tw-list.collapsed { max-height: 34px; overflow: hidden; }
.mm-tw-item {
  background: var(--bg4); border: 1px solid var(--bd); border-radius: var(--r-sm);
  padding: 4px 10px; font-size: .82rem; cursor: pointer;
  transition: all .15s; user-select: none;
}
.mm-tw-item:hover { border-color: var(--ac); color: var(--ac); }
.mm-tw-item.selected { background: var(--acg); border-color: var(--ac); color: var(--ac); }
.mm-tw-toggle {
  background: none; border: none; color: var(--ac); cursor: pointer;
  font-size: var(--text-sm); padding: var(--sp-1) 0; margin-top: 2px;
}
.mm-tw-toggle:hover { text-decoration: underline; }

/* Gallery */
.mm-gallery {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px; margin-top: 10px;
}
.mm-figure {
  margin: 0; border-radius: var(--rs); overflow: hidden;
  background: var(--bg2); border: 1px solid var(--bd); position: relative;
}
.mm-figure img,
.mm-figure video {
  width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block;
}
.mm-figure { cursor: zoom-in; }
.mm-figure video { cursor: pointer; }
.mm-video-badge {
  position: absolute; top: 6px; left: 6px;
  background: rgba(0, 0, 0, .65); color: #fff;
  padding: 2px 8px; border-radius: var(--r-xs); font-size: .75rem;
  display: flex; align-items: center; gap: var(--sp-1);
}
.mm-caption {
  padding: var(--sp-2); font-size: var(--text-xs); color: var(--t3); line-height: 1.4;
}
.mm-caption label {
  color: var(--t2); font-weight: 500; display: block; margin-top: var(--sp-1);
}
.mm-prompt {
  display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-all; cursor: pointer;
}
.mm-prompt:hover { -webkit-line-clamp: unset; line-clamp: unset; }
</style>
