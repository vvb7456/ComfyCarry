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
  const { post, del } = useApiFetch()
  const { confirm } = useConfirm()
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  /** Tracks model IDs currently being enriched. */
  const fetchingSet = reactive(new Set<string>())
  const batchProgress = reactive<BatchProgress>({
    running: false,
    current: 0,
    total: 0,
    filename: '',
  })

  function isFetching(modelId: number): boolean {
    return fetchingSet.has(String(modelId))
  }

  async function fetchInfo(model: LocalModel) {
    const key = String(model.id)
    if (fetchingSet.has(key)) return

    fetchingSet.add(key)
    try {
      const result = await post<{ ok?: boolean; model?: unknown }>(`/api/local_models/${model.id}/enrich`)
      if (result && result.ok !== false) {
        toast(`${model.filename} ${t('models.local.fetch_success')}`, 'success')
        await loadModels()
      }
    } finally {
      fetchingSet.delete(key)
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

    const result = await del<{ ok?: boolean }>(`/api/local_models/${model.id}`)
    if (result && result.ok !== false) {
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
    batchProgress.current = 0
    batchProgress.filename = ''
    let successCount = 0
    let failCount = 0

    try {
      // Hashing large model files is expensive, so keep a small bounded pool
      // instead of making the whole batch strictly serial.  IDs are added to
      // the shared set before each request so card-level actions cannot start
      // a duplicate enrich while a worker owns that model.
      let nextIndex = 0
      const worker = async () => {
        while (true) {
          const index = nextIndex++
          if (index >= noInfo.length) return
          const m = noInfo[index]
          const key = String(m.id)
          fetchingSet.add(key)
          try {
            const result = await post<{ ok?: boolean }>(`/api/local_models/${m.id}/enrich`)
            if (result && result.ok !== false) successCount++
            else failCount++
          } catch (e) {
            failCount++
            console.error(m.filename, e)
          } finally {
            fetchingSet.delete(key)
            batchProgress.current = successCount + failCount
            batchProgress.filename = m.filename
          }
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(2, noInfo.length) },
        () => worker(),
      ))
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
