import { ref, computed, watch, onScopeDispose, toValue, type Ref, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadsStore, type VersionState } from '@/stores/downloads'
import { joinFilePath } from '@/utils/filePath'
import type { HuggingFaceModel, HuggingFaceVersion } from '@/config/huggingface-models'

export interface DepFileSpec {
  filename: string
  url: string
  directory: string
  hf?: { model: HuggingFaceModel; version: HuggingFaceVersion }
}

export interface DepRow {
  id: string
  label: string
  hint?: string
  sizeText?: string
  bytes?: number
  required?: boolean
  files: DepFileSpec[]
  meta?: unknown
}

export interface DepRowStatus {
  row: DepRow
  state: VersionState
  installed: boolean
  downloading: boolean
  downloadIds: string[]
  percent: number
  speed: number
  failed: boolean
}

export interface DepCurrent {
  active: number
  name: string
  percent: number
  speed: number
}

export interface UseDependencyStatusOptions {
  minOptional?: MaybeRefOrGetter<number>
  source?: string
  metaOf?: (row: DepRow) => Record<string, unknown>
  /** 架构面板常驻；只对启用面板首次检查文件。 */
  enabled?: MaybeRefOrGetter<boolean>
}

export interface UseDependencyStatusReturn {
  loading: Ref<boolean>
  checked: ComputedRef<boolean>
  rows: ComputedRef<DepRowStatus[]>
  has: ComputedRef<boolean>
  ready: ComputedRef<boolean>
  missing: ComputedRef<DepRowStatus[]>
  missingRequired: ComputedRef<DepRowStatus[]>
  downloading: ComputedRef<boolean>
  current: ComputedRef<DepCurrent | null>
  error: Ref<string>
  refresh(): Promise<void>
  downloadRow(rowId: string): Promise<void>
  cancelRow(rowId: string): Promise<void>
  destroy(): void
}

const BUSY: VersionState[] = ['submitting', 'downloading', 'queued', 'verifying', 'paused']

/** 依赖条只聚合共享下载状态，不维护任务副本或自己的进度等待链。 */
export function useDependencyStatus(
  rowsSource: MaybeRefOrGetter<DepRow[]>,
  opts: UseDependencyStatusOptions = {},
): UseDependencyStatusReturn {
  const downloads = useDownloadsStore()
  const release = downloads.subscribe()
  const { t } = useI18n({ useScope: 'global' })
  const loading = ref(false)
  const error = ref('')
  const paths = computed(() => toValue(rowsSource).flatMap(row => row.files.map(file => joinFilePath(file.directory, file.filename))))
  const checked = computed(() => !!error.value || paths.value.every(path => downloads.fileChecks.has(path)))
  const rows = computed<DepRowStatus[]>(() => toValue(rowsSource).map(row => {
    const infos = row.files.map(file => downloads.getFileDownloadInfo(joinFilePath(file.directory, file.filename),
      file.hf ? { modelId: String(file.hf.model.id), versionId: String(file.hf.version.id) } : undefined))
    const installed = infos.every(info => info.state === 'installed')
    const state = installed ? 'installed' : [...BUSY, 'failed' as const].find(state => infos.some(info => info.state === state)) ?? 'idle'
    return {
      row, state, installed,
      downloading: BUSY.includes(state),
      failed: infos.some(info => info.state === 'failed'),
      downloadIds: [...new Set(infos.filter(info => BUSY.includes(info.state) && info.downloadId).map(info => info.downloadId!))],
      percent: infos.length ? Math.round(infos.reduce((sum, info) => sum + info.progress, 0) / infos.length) : 0,
      speed: infos.reduce((sum, info) => sum + info.speed, 0),
    }
  }))
  const has = computed(() => rows.value.length > 0)
  const missing = computed(() => rows.value.filter(row => !row.installed))
  const missingRequired = computed(() => missing.value.filter(row => row.row.required))
  const ready = computed(() => !checked.value || !has.value || (!missingRequired.value.length
    && rows.value.filter(row => !row.row.required && row.installed).length >= (toValue(opts.minOptional) ?? 0)))
  const active = computed(() => rows.value.filter(row => row.downloading))
  const downloading = computed(() => active.value.length > 0)
  const current = computed<DepCurrent | null>(() => active.value.length ? {
    active: active.value.length,
    name: active.value[0]!.row.label,
    percent: Math.round(active.value.reduce((sum, row) => sum + row.percent, 0) / active.value.length),
    speed: active.value.reduce((sum, row) => sum + row.speed, 0),
  } : null)

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      await downloads.checkFiles(paths.value)
    } catch {
      error.value = t('generate.dep.error_check')
    } finally {
      loading.value = false
    }
  }

  async function downloadRow(rowId: string): Promise<void> {
    const row = toValue(rowsSource).find(row => row.id === rowId)
    if (!row) return
    error.value = ''
    for (const file of row.files) {
      const submitted = await downloads.downloadFile({
        path: joinFilePath(file.directory, file.filename), url: file.url,
        ...(file.hf ? { modelId: String(file.hf.model.id), versionId: String(file.hf.version.id) } : {}),
        meta: { source: opts.source || 'model-dependency', model: row.label, ...opts.metaOf?.(row) },
      })
      if (!submitted) error.value = t('generate.dep.error_submit', { name: row.label })
    }
  }

  async function cancelRow(rowId: string): Promise<void> {
    const row = rows.value.find(row => row.row.id === rowId)
    if (row) await Promise.all(row.downloadIds.map(id => downloads.cancelDownload(id)))
  }

  const stop = watch(() => [toValue(opts.enabled ?? true), paths.value] as const, ([enabled]) => {
    if (enabled) void refresh()
  }, { immediate: true })
  function destroy() { stop(); release() }
  onScopeDispose(destroy)
  return { loading, checked, rows, has, ready, missing, missingRequired, downloading, current, error, refresh, downloadRow, cancelRow, destroy }
}
