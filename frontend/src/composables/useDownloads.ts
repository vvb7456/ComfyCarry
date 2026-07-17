import { computed } from 'vue'
import { useDownloadsStore } from '@/stores/downloads'
import type {
  CartItem,
  DownloadTask,
  VersionState,
  VersionDownloadInfo,
  ModelAggregateState,
} from '@/stores/downloads'

// ── Types (re-exported for consumers; keep import paths stable) ──
export type {
  CartItem,
  DownloadTask,
  VersionState,
  VersionDownloadInfo,
  ModelAggregateState,
}

/**
 * Thin composable wrapper around the pinia downloads store (C1).
 *
 * Existing consumers (CivitaiTab / DownloadsTab / DownloadItem / modals)
 * keep importing `useDownloads` from this path with the same API surface.
 * Internally the wrapper forwards to the store singleton. Cart-named members
 * are kept as aliases onto the now favorites-backed store state.
 */
export function useDownloads() {
  const store = useDownloadsStore()

  // ── Cart aliases (back-compat) ──
  // cart → favorites map ref; cartItems → favoritesItems; cartCount → favoritesCount;
  // addToCart → addFavorite; removeFromCart → removeFavorite; clearCart → clearFavorites;
  // updateCartVersion → updateFavoriteVersion; isInCart → isInFavorites.
  const cart = computed(() => store.favorites)
  const cartItems = computed(() => store.favoritesItems)
  const cartCount = computed(() => store.favoritesCount)

  function addToCart(item: CartItem): boolean {
    // Original addToCart returned boolean synchronously; store is async but
    // we fire optimistically and let the store roll back on failure.
    void store.addFavorite(item)
    return true
  }

  function removeFromCart(key: string): void {
    void store.removeFavorite(key)
  }

  function isInCart(modelId: string | number): boolean {
    return store.isInFavorites(modelId)
  }

  function clearCart(): void {
    void store.clearFavorites()
  }

  function updateCartVersion(key: string, versionId: number, versionName: string, baseModel?: string): void {
    void store.updateFavoriteVersion(key, versionId, versionName, baseModel)
  }

  return {
    // Cart (aliased to favorites-backed state)
    cart,
    cartItems,
    cartCount,
    addToCart,
    removeFromCart,
    isInCart,
    clearCart,
    updateCartVersion,

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

    // Favorites (new names — also exposed so new code can use them directly)
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

    // Wait-chain helper (used by useModelDependency)
    watchTaskTerminal: store.watchTaskTerminal,
  }
}
