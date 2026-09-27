import { computed, getCurrentScope, onScopeDispose } from 'vue'
import { useDownloadsStore } from '@/stores/downloads'
import type {
  FavoriteItem,
  DownloadTask,
  VersionState,
  VersionDownloadInfo,
  ModelAggregateState,
} from '@/stores/downloads'

export type {
  FavoriteItem,
  DownloadTask,
  VersionState,
  VersionDownloadInfo,
  ModelAggregateState,
}

export function useDownloads() {
  const store = useDownloadsStore()
  if (getCurrentScope()) onScopeDispose(store.subscribe())

  return {
    tasks: computed(() => store.tasks),
    activeTasks: computed(() => store.activeTasks),
    pausedTasks: computed(() => store.pausedTasks),
    completedTasks: computed(() => store.completedTasks),
    failedTasks: computed(() => store.failedTasks),

    getVersionState: store.getVersionState,
    getVersionDownloadInfo: store.getVersionDownloadInfo,
    getModelAggregateState: store.getModelAggregateState,
    getFileDownloadInfo: store.getFileDownloadInfo,

    downloadOne: store.downloadOne,
    downloadHuggingFaceVersion: store.downloadHuggingFaceVersion,
    downloadAll: store.downloadAll,
    pauseDownload: store.pauseDownload,
    resumeDownload: store.resumeDownload,
    cancelDownload: store.cancelDownload,
    retryDownload: store.retryDownload,
    retryVersion: store.retryVersion,
    pauseAll: store.pauseAll,
    resumeAll: store.resumeAll,
    clearHistory: store.clearHistory,

    refreshStatus: store.refreshStatus,
    startPolling: store.startPolling,
    stopPolling: store.stopPolling,

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

  }
}
