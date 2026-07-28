<script setup lang="ts">
/**
 * DownloadDirModal — 下载目录裁决。
 *
 * 后端在无法从 Civitai 元数据判定文件用途时返回 409 + needs_classification,
 * 由本 modal 让用户逐文件指定目标目录, 选完后带 dir_keys 重新提交下载。
 *
 * 判定契约见 docs/DOWNLOAD_CLASSIFICATION_SPEC.md。
 *
 * 设计要点:
 *  - 候选目录**只排序不预选**。这一层存在的前提就是「机器没有把握」,
 *    预选等于换个方式替用户做决定。
 *  - 文件名即 Civitai 详情页链接 —— 判断用途要看的就是那一页。
 *  - 说明只进标题旁的 HelpTip, 不占正文行;
 *    且讲的是**怎么选** (哪种权重放哪个目录), 不是「为什么要问你」——
 *    后者对用户没有可操作性。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/form/BaseSelect.vue'
import HelpTip from '@/components/ui/HelpTip.vue'

defineOptions({ name: 'DownloadDirModal' })

export interface PendingFile {
  filename: string
  size_kb?: number | null
  model_type?: string
  file_type?: string
  base_model?: string
  suggested_dir_keys?: string[]
}

export interface DirOption {
  key: string
  path: string
}

const props = defineProps<{
  modelValue: boolean
  civitaiUrl?: string
  pendingFiles: PendingFile[]
  dirOptions: DirOption[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [dirKeys: Record<string, string>]
}>()

const { t } = useI18n({ useScope: 'global' })

/** filename → 用户选定的 dir_key。刻意初始为空 —— 不预选。 */
const choices = ref<Record<string, string>>({})

watch(
  () => props.pendingFiles,
  (files) => {
    const next: Record<string, string> = {}
    for (const f of files || []) next[f.filename] = ''
    choices.value = next
  },
  { immediate: true, deep: false },
)

/** 候选排在前、其余按字母序；两段之间插一个分组头。 */
function optionsFor(file: PendingFile) {
  const suggested = file.suggested_dir_keys || []
  const byKey = new Map(props.dirOptions.map(o => [o.key, o]))
  const head = suggested
    .filter(k => byKey.has(k))
    .map(k => ({
      value: k,
      label: k,
      hint: byKey.get(k)!.path,
      group: t('models.dl_dir.group_likely'),
    }))
  const seen = new Set(suggested)
  const rest = props.dirOptions
    .filter(o => !seen.has(o.key))
    .map(o => ({
      value: o.key,
      label: o.key,
      hint: o.path,
      group: t('models.dl_dir.group_all'),
    }))
  return [...head, ...rest]
}

const allChosen = computed(() =>
  (props.pendingFiles || []).every(f => !!choices.value[f.filename]),
)

function fmtSize(kb?: number | null): string {
  if (!kb || kb <= 0) return ''
  const mb = kb / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`
}

/** 元数据里实际填了什么 —— 用户判断的原始依据, 原样展示不加工。 */
function metaLine(f: PendingFile): string {
  return [f.model_type, f.file_type, f.base_model].filter(Boolean).join(' · ')
}

function onConfirm() {
  if (!allChosen.value) return
  emit('confirm', { ...choices.value })
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    size="lg"
    icon="folder_open"
    :title="t('models.dl_dir.title')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #title-extra>
      <HelpTip :text="t('models.dl_dir.intro_help')" wide />
    </template>

    <div class="dl-dir">
      <div v-for="f in pendingFiles" :key="f.filename" class="dl-dir__row">
        <div class="dl-dir__file">
          <!-- 文件名即详情页入口 —— 用户判断用途要看的就是那一页 -->
          <a
            v-if="civitaiUrl"
            class="dl-dir__name dl-dir__name--link"
            :href="civitaiUrl"
            target="_blank"
            rel="noopener noreferrer"
            :title="f.filename"
          >{{ f.filename }}</a>
          <div v-else class="dl-dir__name" :title="f.filename">{{ f.filename }}</div>
          <div class="dl-dir__meta">
            <span>{{ metaLine(f) }}</span>
            <span v-if="fmtSize(f.size_kb)">{{ fmtSize(f.size_kb) }}</span>
          </div>
        </div>
        <BaseSelect
          v-model="choices[f.filename]"
          class="dl-dir__pick"
          :options="optionsFor(f)"
          :placeholder="t('models.dl_dir.placeholder')"
          :search-placeholder="t('models.dl_dir.search')"
          searchable
          teleport
        />
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('update:modelValue', false)">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!allChosen || submitting"
        :loading="submitting"
        @click="onConfirm"
      >
        {{ t('models.dl_dir.confirm') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.dl-dir {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.dl-dir__row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--bd);
  border-radius: 8px;
  background: var(--bg2);
}

.dl-dir__file {
  flex: 1 1 auto;
  min-width: 0;
}

.dl-dir__name--link {
  color: inherit;
  text-decoration: none;
}

.dl-dir__name--link:hover {
  color: var(--ac);
  text-decoration: underline;
}

.dl-dir__name {
  display: block;
  font-size: 0.86rem;
  font-weight: 500;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dl-dir__meta {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: var(--t3);
}

.dl-dir__pick {
  flex: 0 0 220px;
}

@media (max-width: 640px) {
  .dl-dir__row {
    flex-direction: column;
    align-items: stretch;
  }

  .dl-dir__pick {
    flex: 1 1 auto;
  }
}
</style>
