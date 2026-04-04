import { computed, onScopeDispose, ref, watch } from 'vue'
import type {
  AvailablePluginsResponse,
  BrowseItem,
  InstalledPlugin,
  InstalledRaw,
  PluginData,
  PluginInfo,
  PluginSortBy,
  PluginStatusFilter,
} from '@/types/plugins'

const PAGE_SIZE = 40

function unpackAvailablePlugins(data: AvailablePluginsResponse): Record<string, PluginInfo> {
  const candidate = (data as { node_packs?: Record<string, PluginInfo> }).node_packs
  return candidate ?? (data as Record<string, PluginInfo>)
}

function toBrowseItems(data: Record<string, PluginInfo>): BrowseItem[] {
  return Object.entries(data).map(([id, info]) => ({
    id,
    ...info,
    _title: (info.title || id).toLowerCase(),
    _desc: (info.description || '').toLowerCase(),
    _last_update: typeof info.last_update === 'string' ? info.last_update : '',
  }))
}

function mapInstalledPlugins(
  installedData: Record<string, InstalledRaw>,
  availablePlugins: Record<string, PluginInfo>,
): InstalledPlugin[] {
  return Object.entries(installedData).map(([dirName, inst]) => {
    const cnrId = inst.cnr_id || ''
    const registryEntry = availablePlugins[cnrId] || {}

    return {
      dirName,
      cnrId,
      title: registryEntry.title || dirName,
      description: registryEntry.description || '',
      repository: registryEntry.repository || registryEntry.reference || (inst.aux_id ? `https://github.com/${inst.aux_id}` : ''),
      author: registryEntry.author || (inst.aux_id ? inst.aux_id.split('/')[0] : ''),
      stars: registryEntry.stars ?? 0,
      ver: inst.ver || '',
      activeVersion: registryEntry.active_version || inst.ver || '',
      cnrLatest: registryEntry.cnr_latest || '',
      enabled: inst.enabled !== false,
      updateState: registryEntry['update-state'] === 'true' || registryEntry['update-state'] === 'True',
    }
  })
}

export function usePluginFiltering() {
  const filter = ref('')
  const statusFilter = ref<PluginStatusFilter>('all')
  const sortBy = ref<PluginSortBy>('stars')

  const installedPlugins = ref<InstalledPlugin[]>([])
  const browseItems = ref<BrowseItem[]>([])
  const browseStart = ref(PAGE_SIZE)
  const listEndEl = ref<HTMLElement | null>(null)

  let observer: IntersectionObserver | null = null

  const unifiedPlugins = computed<PluginData[]>(() => {
    const installedMap = new Map(installedPlugins.value.map((plugin) => [plugin.cnrId, plugin]))
    const seen = new Set<string>()
    const result: PluginData[] = []

    for (const browseItem of browseItems.value) {
      seen.add(browseItem.id)
      const installed = installedMap.get(browseItem.id)
      result.push({
        id: browseItem.id,
        dirName: installed?.dirName || '',
        title: browseItem.title || browseItem.id,
        description: browseItem.description || '',
        repository: browseItem.repository || browseItem.reference || '',
        author: browseItem.author || installed?.author || '',
        stars: browseItem.stars ?? installed?.stars ?? 0,
        ver: installed?.ver || '',
        activeVersion: installed?.activeVersion || '',
        cnrLatest: installed?.cnrLatest || '',
        registryVersion: browseItem.version || '',
        enabled: installed?.enabled ?? false,
        installed: !!installed || browseItem.state === 'enabled' || browseItem.state === 'disabled',
        updateState: installed?.updateState ?? false,
        lastUpdate: browseItem._last_update || '',
      })
    }

    for (const plugin of installedPlugins.value) {
      const key = plugin.cnrId || plugin.dirName
      if (seen.has(key)) continue

      seen.add(key)
      result.push({
        id: key,
        dirName: plugin.dirName,
        title: plugin.title,
        description: plugin.description,
        repository: plugin.repository,
        author: plugin.author,
        stars: plugin.stars,
        ver: plugin.ver,
        activeVersion: plugin.activeVersion,
        cnrLatest: plugin.cnrLatest,
        registryVersion: '',
        enabled: plugin.enabled,
        installed: true,
        updateState: plugin.updateState,
        lastUpdate: '',
      })
    }

    return result
  })

  const filteredPlugins = computed<PluginData[]>(() => {
    const query = filter.value.toLowerCase().trim()
    const activeStatus = statusFilter.value
    let result = unifiedPlugins.value

    if (query) {
      result = result.filter((plugin) =>
        plugin.title.toLowerCase().includes(query)
        || plugin.description.toLowerCase().includes(query)
        || plugin.id.includes(query),
      )
    }

    if (activeStatus === 'installed') result = result.filter((plugin) => plugin.installed && plugin.enabled)
    else if (activeStatus === 'not-installed') result = result.filter((plugin) => !plugin.installed)
    else if (activeStatus === 'update') result = result.filter((plugin) => plugin.updateState)
    else if (activeStatus === 'disabled') result = result.filter((plugin) => plugin.installed && !plugin.enabled)

    if (sortBy.value === 'stars') return [...result].sort((a, b) => (b.stars || 0) - (a.stars || 0))
    if (sortBy.value === 'update') return [...result].sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate))
    return [...result].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
  })

  const currentPage = computed(() => filteredPlugins.value.slice(0, browseStart.value))

  watch([filter, statusFilter, sortBy], () => {
    browseStart.value = PAGE_SIZE
  })

  watch(listEndEl, (element) => {
    if (observer) {
      observer.disconnect()
      observer = null
    }

    if (!element) return

    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && browseStart.value < filteredPlugins.value.length) {
        browseStart.value += PAGE_SIZE
      }
    }, { rootMargin: '300px' })

    observer.observe(element)
  })

  onScopeDispose(() => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  })

  function setAvailablePlugins(data: AvailablePluginsResponse): Record<string, PluginInfo> {
    const unpacked = unpackAvailablePlugins(data)
    browseItems.value = toBrowseItems(unpacked)
    return unpacked
  }

  function setInstalledPlugins(data: Record<string, InstalledRaw>, availablePlugins: Record<string, PluginInfo>) {
    installedPlugins.value = mapInstalledPlugins(data, availablePlugins)
  }

  return {
    filter,
    statusFilter,
    sortBy,
    listEndEl,
    unifiedPlugins,
    filteredPlugins,
    currentPage,
    setAvailablePlugins,
    setInstalledPlugins,
  }
}
