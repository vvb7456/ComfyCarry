<script setup lang="ts">
/**
 * 导入后「这份配置还差什么」的提示。
 *
 * 只做聚合与透传, 不自造判定与下载:
 *   · 判定 — 检索顺序见 useMissingModels (白名单哈希索引 → civitai by-hash);
 *     无指纹/无命中的只能手动准备。
 *   · 下载 — 完全等价于在模型页点同一个模型 (同一个 downloadOne /
 *     downloadHuggingFaceVersion), 状态由同一套状态机透传。
 *
 * 打开时先转圈把需要联网的查完, 列表一次成型 (不跳变)。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Badge from '@/components/ui/Badge.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import DownloadButton from '@/components/models/DownloadButton.vue'
import { modelCategoryColor } from '@/utils/constants'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useDownloads } from '@/composables/useDownloads'
import { useMissingModels } from '@/composables/generate/useMissingModels'
import type { MissingModel } from '@/composables/generate/useMissingModels'

defineOptions({ name: 'MissingModelsModal' })

const props = defineProps<{
  modelValue: boolean
  downloadable: MissingModel[]
  unavailable: MissingModel[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  fallback: []
}>()

const { t, te } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const { confirm } = useConfirm()
const { getFileDownloadInfo, downloadOne, downloadHuggingFaceVersion, cancelDownload } = useDownloads()
const missingModels = useMissingModels()

const submitting = ref(false)

const totalCount = computed(() => [...props.downloadable, ...props.unavailable].filter(m => missingModels.isMissing(m.path)).length)

/** 该行的下载状态 (与模型页同源的状态机) */
function infoOf(m: MissingModel) {
  return getFileDownloadInfo(m.path, { modelId: m.modelId, versionId: m.versionId || m.modelId })
}

/**
 * 提交单条下载 —— 透传既有端点与既有请求体。
 * 失败态也走这里重新提交 (而非 retryVersion): 后者的 fallback 会丢掉
 * custom_filename, 落盘名会退回白名单/civitai 原名, 配置引用仍指向旧名。
 */
function handleDownload(m: MissingModel) {
  if (!m.modelId) return
  if (m.source === 'whitelist') {
    // 白名单命中: 依赖条同款的 HuggingFace 请求体, 覆写落盘文件名与登记类别
    downloadHuggingFaceVersion(m.modelId, m.versionId, {
      customFilename: basenameOf(m.path),
      modelType: m.category,
      targetPath: m.path,
    })
    return
  }
  // civitai 命中: 模型页同款请求体 (custom_filename = 配置引用的文件名)
  downloadOne(m.modelId, m.category, Number(m.versionId) || undefined, undefined, {
    customFilename: basenameOf(m.path),
    targetPath: m.path,
  })
}

function basenameOf(path: string): string {
  return path.split('/').pop() || path
}

/** 角色 Badge 文案 (缺失条目的"它是干什么的": 主模型 / LoRA / ControlNet...) */
function roleLabel(m: MissingModel): string {
  if (!m.role) return ''
  const key = `generate.missing.role_${m.role}`
  return te(key) ? t(key) : ''
}

/** 事实行第一格: 类别对应的完整落盘目录 (models/checkpoints 等) */
function fullDir(m: MissingModel): string {
  return m.path.slice(0, m.path.lastIndexOf('/'))
}

async function handleCancel(m: MissingModel) {
  const info = infoOf(m)
  if (!info.downloadId) return
  if (await confirm({
    title: t('models.confirm.cancel_download.title'),
    message: t('models.confirm.cancel_download.message', { name: m.name }),
    confirmText: t('models.confirm.cancel_download.button'),
    cancelText: t('models.confirm.cancel_download.cancel'),
  })) {
    cancelDownload(info.downloadId)
  }
}

/** 批量提交可下载项 (逐条走同一个入口; 已在下载的跳过) */
async function downloadAll() {
  if (submitting.value || !props.downloadable.length) return
  submitting.value = true
  let count = 0
  for (const m of props.downloadable) {
    const info = infoOf(m)
    if (info.state !== 'idle' && info.state !== 'failed') continue
    handleDownload(m)
    count++
  }
  // 提交是瞬时的 (真正的下载由后端引擎跑), 不等待完成
  submitting.value = false
  if (count) toast(t('generate.missing.download_submitted', { count }), 'success')
}

/** 忽略无效设置: 二次确认 (会丢弃配置里的缺失项) */
async function ignoreAndFallback() {
  const go = await confirm({
    title: t('generate.missing.confirm_fallback.title'),
    message: t('generate.missing.confirm_fallback.message', { count: totalCount.value }),
    confirmText: t('generate.missing.confirm_fallback.button'),
    variant: 'danger',
  })
  if (!go) return
  emit('fallback')
  emit('update:modelValue', false)
}

// 打开时先查完再展示 (列表不跳变)
watch(() => props.modelValue, (open) => {
  if (open) void missingModels.prepare()
}, { immediate: true })
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    size="md"
    :title="t('generate.missing.title')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <LoadingCenter v-if="missingModels.loading.value">
      {{ t('generate.missing.querying') }}
    </LoadingCenter>

    <div v-else class="missing">
      <section v-if="downloadable.length" class="missing__section">
        <div class="missing__head">
          {{ t('generate.missing.section_downloadable', { count: downloadable.length }) }}
        </div>
        <ul class="list-plain">
          <li v-for="m in downloadable" :key="m.key" class="mrow">
            <div class="mrow__thumb">
              <img v-if="m.imageUrl" :src="m.imageUrl" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'">
              <MsIcon v-else name="image_not_supported" />
            </div>
            <div class="mrow__main">
              <div class="mrow__head">
                <span class="mrow__name" :title="m.path">{{ m.name }}</span>
              </div>
              <div class="mrow__badges">
                <Badge v-if="roleLabel(m)" :color="modelCategoryColor(m.category)" class="mrow__badge">{{ roleLabel(m) }}</Badge>
                <Badge v-if="m.baseModel" class="mrow__badge">{{ m.baseModel }}</Badge>
              </div>
              <div class="mrow__facts">
                <span :title="fullDir(m)">{{ fullDir(m) }}</span>
                <span :title="basenameOf(m.path)">{{ basenameOf(m.path) }}</span>
              </div>
            </div>
            <div class="mrow__actions">
              <DownloadButton
                :state="infoOf(m).state"
                :progress="infoOf(m).progress"
                :speed="infoOf(m).speed"
                :cancellable="!!infoOf(m).downloadId"
                size="sm"
                @download="handleDownload(m)"
                @cancel="handleCancel(m)"
              />
            </div>
          </li>
        </ul>
      </section>

      <section v-if="unavailable.length" class="missing__section">
        <div class="missing__head">
          {{ t('generate.missing.section_unavailable', { count: unavailable.length }) }}
        </div>
        <ul class="list-plain">
          <li v-for="m in unavailable" :key="m.key" class="mrow">
            <div class="mrow__thumb">
              <img v-if="m.imageUrl" :src="m.imageUrl" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'">
              <MsIcon v-else name="image_not_supported" />
            </div>
            <div class="mrow__main">
              <div class="mrow__head">
                <span class="mrow__name" :title="m.path">{{ m.name }}</span>
              </div>
              <div class="mrow__badges">
                <Badge v-if="roleLabel(m)" :color="modelCategoryColor(m.category)" class="mrow__badge">{{ roleLabel(m) }}</Badge>
                <Badge v-if="m.baseModel" class="mrow__badge">{{ m.baseModel }}</Badge>
              </div>
              <div class="mrow__facts">
                <span :title="fullDir(m)">{{ fullDir(m) }}</span>
                <span :title="basenameOf(m.path)">{{ basenameOf(m.path) }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <BaseButton :disabled="submitting" @click="emit('update:modelValue', false)">
        {{ t('generate.missing.keep') }}
      </BaseButton>
      <BaseButton :disabled="submitting || totalCount === 0" @click="ignoreAndFallback">
        {{ t('generate.missing.ignore_fallback') }}
      </BaseButton>
      <BaseButton
        v-if="downloadable.length"
        variant="primary"
        :loading="submitting"
        @click="downloadAll"
      >
        {{ t('generate.missing.download_all') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.missing {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}

.missing__section {
  display: flex;
  flex-direction: column;
}

/* 分组标题: 与 BaseModal 的 subtitle 同字号/字重 */
.missing__head {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--t2);
  margin-bottom: var(--sp-1);
}

/* 行结构对齐模型页下载项 (DownloadItem .dli): grid 三列 48px / minmax(0,1fr) / auto
   —— 左预览图与右按钮列宽度各自独立不受内容挤压, 中列严格吸收溢出 */
.mrow {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
}

.mrow + .mrow {
  border-top: 1px solid color-mix(in srgb, var(--bd) 65%, transparent);
}

.mrow__thumb {
  width: 48px;
  height: 48px;
  border-radius: var(--r-xs);
  overflow: hidden;
  background: var(--bg-in);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
}

.mrow__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mrow__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* 行1 head: 裁剪层 —— 溢出截断必须发生在这一层 (与 .dli-head 同构),
   只靠 name 自身的 overflow 不够: 它在无约束的 flex column 里宽度由内容撑开 */
.mrow__head {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}

/* 行1 名称: 严格单行 (长模型名不换行撑高) */
.mrow__name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 0;
}

/* 行2 纯 Badge 行 (与 .dli-badges 同构) */
.mrow__badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}

.mrow__badge {
  max-width: 110px;
  min-width: 0;
  flex-shrink: 1;
}

/* 行3 事实行: 目录 + 文件名 (等宽小字, 与 .dli-facts 同构) */
.mrow__facts {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  color: var(--t3);
  font-size: var(--text-xs);
  font-family: var(--font-tabular);
  min-width: 0;
  line-height: 1.4;
}

.mrow__facts > span {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mrow__facts > span + span::before {
  content: '·';
  margin: 0 6px;
}

.mrow__actions {
  display: flex;
  align-items: center;
}
</style>
