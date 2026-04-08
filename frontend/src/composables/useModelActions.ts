import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from './useApiFetch'
import { useConfirm } from './useConfirm'
import { useToast } from './useToast'
import type { LocalModel } from './useLocalModels'

export interface BatchProgress {
  running: boolean
  current: number
  total: number
  filename: string
}

/**
 * Model action handlers — fetchInfo, deleteModel, fetchAll.
 *
 * Depends on the models list and a reload callback from useLocalModels().
 */
export function useModelActions(
  loadModels: () => Promise<void>,
) {
  const { post } = useApiFetch()
  const { confirm } = useConfirm()
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  /** Tracks abs_paths currently being fetched */
  const fetchingSet = reactive(new Set<string>())
  const batchProgress = reactive<BatchProgress>({
    running: false,
    current: 0,
    total: 0,
    filename: '',
  })

  function isFetching(absPath: string): boolean {
    return fetchingSet.has(absPath)
  }

  async function fetchInfo(model: LocalModel) {
    if (fetchingSet.has(model.abs_path)) return

    fetchingSet.add(model.abs_path)
    try {
      const result = await post<{ ok: boolean }>('/api/local_models/fetch_info', {
        abs_path: model.abs_path,
      })
      if (result?.ok) {
        toast(`${model.filename} ${t('models.local.fetch_success')}`, 'success')
        await loadModels()
      }
    } finally {
      fetchingSet.delete(model.abs_path)
    }
  }

  async function deleteModel(model: LocalModel) {
    const ok = await confirm({
      title: t('models.local.confirm_delete'),
      message: t('models.local.confirm_delete_file', { filename: model.filename }),
      variant: 'danger',
      confirmText: t('models.local.delete'),
    })
    if (!ok) return

    const result = await post<{ ok: boolean; deleted: string[] }>('/api/files/delete', {
      path: model.abs_path,
      companions: true,
    })
    if (result?.ok) {
      toast(`${t('models.local.deleted')} ${model.filename}`, 'success')
      await loadModels()
    }
  }

  async function fetchAll(models: LocalModel[]) {
    const noInfo = models.filter(m => !m.has_info && m.can_fetch_info !== false)
    if (noInfo.length === 0) {
      toast(t('models.local.all_have_info'), 'info')
      return
    }

    const ok = await confirm({
      message: t('models.local.confirm_fetch_all', { count: noInfo.length }),
      confirmText: t('models.local.fetch_all'),
    })
    if (!ok) return

    batchProgress.running = true
    batchProgress.total = noInfo.length
    let successCount = 0
    let failCount = 0

    try {
      for (let i = 0; i < noInfo.length; i++) {
        const m = noInfo[i]
        batchProgress.current = i + 1
        batchProgress.filename = m.filename

        try {
          const result = await post('/api/local_models/fetch_info', { abs_path: m.abs_path })
          if (result) successCount++
          else failCount++
        } catch (e) {
          failCount++
          console.error(m.filename, e)
        }
      }
    } finally {
      batchProgress.running = false
    }

    if (failCount > 0) {
      toast(t('models.local.fetch_partial', { success: successCount, fail: failCount }), 'warning')
    } else {
      toast(t('models.local.fetch_complete'), 'success')
    }
    await loadModels()
  }

  return {
    fetchingSet,
    isFetching,
    fetchInfo,
    deleteModel,
    fetchAll,
    batchProgress,
  }
}
