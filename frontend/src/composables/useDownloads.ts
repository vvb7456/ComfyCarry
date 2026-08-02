import { computed } from 'vue'
import { useDownloadsStore } from '@/stores/downloads'
import type {
  FavoriteItem,
  DownloadTask,
  VersionState,
  VersionDownloadInfo,
  ModelAggregateState,
} from '@/stores/downloads'

// ── Types (re-exported for consumers; keep import paths stable) ──
export type {
  FavoriteItem,
  DownloadTask,
  VersionState,
  VersionDownloadInfo,
  ModelAggregateState,
}

/**
 * Thin composable wrapper around the pinia downloads store.
 *
 * Existing consumers (CivitaiTab / FavoritesPanel / DownloadItem / modals)
 * keep importing `useDownloads` from this path with the same API surface.
 * Internally the wrapper forwards to the store singleton.
 */
export function useDownloads() {
  const store = useDownloadsStore()

  return {
    // Tasks
    tasks: computed(() => store.tasks),
    activeTasks: computed(() => store.activeTasks),
    pausedTasks: computed(() => store.pausedTasks),
    completedTasks: computed(() => store.completedTasks),
    failedTasks: computed(() => store.failedTasks),

    // Selectors (primary API for UI state)
    getVersionState: store.getVersionState,
    getVersionDownloadInfo: store.getVersionDownloadInfo,
    getModelAggregateState: store.getModelAggregateState,

    // Actions
    downloadOne: store.downloadOne,
    downloadAll: store.downloadAll,
    pauseDownload: store.pauseDownload,
    resumeDownload: store.resumeDownload,
    cancelDownload: store.cancelDownload,
    retryDownload: store.retryDownload,
    retryVersion: store.retryVersion,
    pauseAll: store.pauseAll,
    resumeAll: store.resumeAll,
    clearHistory: store.clearHistory,

    // Polling (store-backed)
    refreshStatus: store.refreshStatus,
    startPolling: store.startPolling,
    stopPolling: store.stopPolling,

    // Local model index
    localCivitaiIds: computed(() => store.localCivitaiIds),
    fetchLocalIndex: store.fetchLocalIndex,

    // Favorites (API-backed)
    favorites: computed(() => store.favorites),
    favoritesItems: computed(() => store.favoritesItems),
    favoritesCount: computed(() => store.favoritesCount),
    addFavorite: store.addFavorite,
    removeFavorite: store.removeFavorite,
    removeFavoritesByModel: store.removeFavoritesByModel,
    clearFavorites: store.clearFavorites,
    isInFavorites: store.isInFavorites,
    updateFavoriteVersion: store.updateFavoriteVersion,
    loadFavorites: store.loadFavorites,

    // Wait-chain helper (used by useDependencyStatus)
    watchTaskTerminal: store.watchTaskTerminal,
  }
}
