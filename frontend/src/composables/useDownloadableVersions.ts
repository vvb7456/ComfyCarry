import { ref, watch, type Ref } from 'vue'

/**
 * 过滤掉 Civitai 上不可下载的 version。
 *
 * 作者可以把模型设为 "Generation-Only"(只能站内出图, 不给权重), Civitai 也会
 * 把只含训练数据、没有权重文件的 version 一并标为不可下载。这两类都不该出现在
 * 下载列表里 —— 用户点了只会拿到一个错误。
 *
 * 判据由后端 /api/civitai/model/<id>/download_flags 提供 (canDownload)。
 * 前端列表用的 Meilisearch 索引里没有任何相关字段, 所以必须在打开列表时按
 * 模型单独取一次; 后端有 10 分钟缓存, 同一模型反复打开不会重复请求上游。
 *
 * **失败放行**: 拿不到判据 (接口抖动/结构变化) 时返回全部 version。宁可多列一个
 * 下不了的, 也不能因为一次请求失败就把正常模型的版本列表清空。
 */
export function useDownloadableVersions<T extends { id: number }>(
  modelId: Ref<number | string | null | undefined>,
  versions: Ref<T[]>,
  enabled: Ref<boolean>,
) {
  /** version_id → 可下载。null = 尚未拿到判据 (放行全部)。 */
  const flags = ref<Record<string, boolean> | null>(null)
  const loading = ref(false)

  async function load(id: number | string) {
    loading.value = true
    flags.value = null
    try {
      const res = await fetch(`/api/civitai/model/${id}/download_flags`)
      if (!res.ok) return
      const data = await res.json()
      if (data?.resolved) flags.value = data.flags || {}
    } catch {
      // 放行
    } finally {
      loading.value = false
    }
  }

  watch(
    [modelId, enabled],
    ([id, on]) => {
      if (!on || id === null || id === undefined || id === '') return
      load(id)
    },
    { immediate: true },
  )

  /** 可下载的 version。判据缺失时原样返回。 */
  const downloadable = ref<T[]>([]) as Ref<T[]>
  watch(
    [versions, flags],
    ([vs, f]) => {
      downloadable.value = f ? vs.filter(v => f[String(v.id)] === true) : vs
    },
    { immediate: true, deep: false },
  )

  /** 判据已拿到、且该模型一个可下载版本都没有 —— 用于区分「空」与「加载中」。 */
  const noneDownloadable = ref(false)
  watch(
    [downloadable, flags, versions],
    ([d, f, vs]) => {
      noneDownloadable.value = !!f && vs.length > 0 && d.length === 0
    },
    { immediate: true },
  )

  return { downloadable, noneDownloadable, loading }
}
