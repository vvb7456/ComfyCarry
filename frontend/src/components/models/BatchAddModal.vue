<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useToast } from '@/composables/useToast'
import { useApiFetch } from '@/composables/useApiFetch'
import { useDownloads, type CartItem } from '@/composables/useDownloads'

defineOptions({ name: 'BatchAddModal' })

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { toast } = useToast()
const { get } = useApiFetch()
const { addToCart } = useDownloads()

const inputText = ref('')
const loading = ref(false)

// ── Parse IDs/URLs from text ──

const CIVITAI_URL_RE = /civitai\.com\/models\/(\d+)(?:.*[?&]modelVersionId=(\d+))?/
const ID_RE = /^\d+$/

interface ParsedId {
  modelId: string
  versionId?: string
}

const parsedIds = computed(() => {
  const ids: ParsedId[] = []
  const seen = new Set<string>()
  for (const line of inputText.value.split(/[\n,;]+/)) {
    const text = line.trim()
    if (!text) continue
    const urlMatch = text.match(CIVITAI_URL_RE)
    if (urlMatch) {
      const id = urlMatch[1]
      const vid = urlMatch[2]
      const key = vid ? `${id}:${vid}` : id
      if (!seen.has(key)) { seen.add(key); ids.push({ modelId: id, versionId: vid }) }
      continue
    }
    if (ID_RE.test(text) && !seen.has(text)) {
      seen.add(text)
      ids.push({ modelId: text })
    }
  }
  return ids
})

const parsedCount = computed(() => parsedIds.value.length)

// ── Submit ──

async function submit() {
  if (!parsedIds.value.length) return
  loading.value = true
  let added = 0
  try {
    for (const { modelId, versionId } of parsedIds.value) {
      // Fetch model info from CivitAI
      const data = await get<any>(`https://civitai.com/api/v1/models/${modelId}`)
      if (!data) continue
      const versions = data.modelVersions || []
      const ver = versionId
        ? versions.find((v: any) => String(v.id) === versionId) || versions[0]
        : versions[0]
      const imgs = ver?.images || data.images || []
      const imgUrl = imgs[0]?.url
        ? (imgs[0].url.startsWith('http') ? imgs[0].url : `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${imgs[0].url}/width=450/default.jpg`)
        : ''

      const item: CartItem = {
        modelId: String(data.id),
        name: data.name || 'Unknown',
        type: data.type || 'Checkpoint',
        imageUrl: imgUrl,
        versionId: ver?.id,
        versionName: ver?.name,
        baseModel: ver?.baseModel,
        allVersions: versions.map((v: any) => ({ id: v.id, name: v.name, baseModel: v.baseModel })),
      }
      if (addToCart(item)) added++
    }
    toast(t('models.downloads.batch_added', { count: added }), 'success')
    inputText.value = ''
    emit('update:modelValue', false)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="t('models.downloads.batch_modal_title')"
    size="md"
  >
    <p class="bam-hint">{{ t('models.downloads.batch_modal_hint') }}</p>
    <ul class="bam-examples">
      <li><code>12345</code></li>
      <li><code>https://civitai.com/models/12345</code></li>
      <li><code>https://civitai.com/models/12345?modelVersionId=67890</code></li>
    </ul>
    <textarea
      v-model="inputText"
      class="bam-textarea"
      rows="8"
      :placeholder="t('models.downloads.batch_modal_placeholder')"
      :disabled="loading"
    />
    <div class="bam-status">
      {{ t('models.downloads.batch_modal_parsed', { count: parsedCount }) }}
    </div>

    <template #footer>
      <BaseButton @click="emit('update:modelValue', false)" :disabled="loading">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton variant="primary" :disabled="!parsedCount || loading" :loading="loading" @click="submit">
        {{ t('models.downloads.batch_modal_submit') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.bam-hint {
  font-size: var(--text-sm);
  color: var(--t2);
  margin-bottom: 6px;
}

.bam-examples {
  font-size: var(--text-xs);
  color: var(--t3);
  margin: 0 0 12px 16px;
  list-style: disc;
}

.bam-examples code {
  font-size: var(--text-xs);
  background: var(--bg-in);
  padding: 1px 4px;
  border-radius: 3px;
}

.bam-textarea {
  width: 100%;
  font-size: var(--text-sm);
  font-family: inherit;
  background: var(--bg-in);
  color: var(--t1);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  padding: 10px 12px;
  resize: vertical;
  outline: none;
}
.bam-textarea:focus {
  border-color: var(--ac);
}

.bam-status {
  font-size: var(--text-xs);
  color: var(--t3);
  margin-top: 8px;
}
</style>
