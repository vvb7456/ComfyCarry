import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from './useApiFetch'
import { useConfirm } from './useConfirm'
import { useToast } from './useToast'
import type { LocalModel } from './useLocalModels'

export function useModelActions(
  loadModels: () => Promise<void>,
) {
  const { post, del } = useApiFetch()
  const { confirm } = useConfirm()
  const { toast } = useToast()
  const { t } = useI18n({ useScope: 'global' })

  const fetchingSet = reactive(new Set<string>())

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
      title: t('models.confirm.delete_model.title'),
      message: t('models.confirm.delete_model.message', { filename: model.filename }),
      variant: 'danger',
      confirmText: t('common.btn.delete'),
    })
    if (!ok) return

    const result = await del<{ ok?: boolean }>(`/api/local_models/${model.id}`)
    if (result && result.ok !== false) {
      toast(`${t('models.local.deleted')} ${model.filename}`, 'success')
      await loadModels()
    }
  }

  return {
    fetchingSet,
    isFetching,
    fetchInfo,
    deleteModel,
  }
}
