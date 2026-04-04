/**
 * useWildcardManager — Wildcard CRUD composable.
 *
 * Manages wildcard files: list, create, edit, rename, delete, folder management.
 * Insertion handled by parent (via emit → PromptEditor.insertAtCursor).
 *
 * API:
 *   GET    /api/generate/wildcards                       → { wildcards, folders }
 *   GET    /api/generate/wildcard/:name                  → { name, content }
 *   PUT    /api/generate/wildcard/:name                  ← { content }
 *   DELETE /api/generate/wildcard/:name
 *   POST   /api/generate/wildcard/:name/rename           ← { new_name }
 *   POST   /api/generate/wildcard-folder/:name
 *
 * Legacy: _wildcardsCache / _loadWildcards / _newWildcard / _editWildcard / _deleteWildcard in page-generate.js
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useApiFetch } from '@/composables/useApiFetch'

export interface WildcardItem {
  name: string
  entries: number
}

export interface UseWildcardManagerReturn {
  visible: Ref<boolean>
  wildcards: Ref<WildcardItem[]>
  folders: Ref<string[]>
  activeFolder: Ref<string>
  loading: Ref<boolean>
  filtered: ComputedRef<WildcardItem[]>

  open(): Promise<void>
  close(): void
  reload(): Promise<void>
  createFolder(name: string): Promise<boolean>
  createWildcard(): Promise<string | null>
  rename(oldName: string, newName: string): Promise<boolean>
  editContent(name: string): Promise<string | null>
  saveContent(name: string, content: string): Promise<boolean>
  remove(name: string): Promise<boolean>
}

export function useWildcardManager(): UseWildcardManagerReturn {
  const { get, put, post, del } = useApiFetch()

  const visible = ref(false)
  const wildcards = ref<WildcardItem[]>([])
  const folders = ref<string[]>([])
  const activeFolder = ref('')
  const loading = ref(false)

  const filtered = computed(() => {
    const folder = activeFolder.value
    if (!folder) return wildcards.value
    if (folder === '(root)') return wildcards.value.filter(w => !w.name.includes('/'))
    return wildcards.value.filter(w => {
      const parts = w.name.split('/')
      return parts.length > 1 && parts.slice(0, -1).join('/') === folder
    })
  })

  async function open() {
    visible.value = true
    await reload()
  }

  function close() {
    visible.value = false
  }

  async function reload() {
    loading.value = true
    try {
      const resp = await get<{ wildcards?: WildcardItem[]; folders?: string[] }>('/api/generate/wildcards')
      wildcards.value = resp?.wildcards || []
      folders.value = resp?.folders || []
    } catch {
      wildcards.value = []
      folders.value = []
    } finally {
      loading.value = false
    }
  }

  async function createFolder(name: string): Promise<boolean> {
    const cleaned = name.trim().replace(/[\\/]/g, '')
    if (!cleaned) return false
    const resp = await post<{ ok?: boolean; error?: string }>(
      `/api/generate/wildcard-folder/${encodeURIComponent(cleaned)}`,
    )
    if (!resp?.ok) return false
    if (!folders.value.includes(cleaned)) {
      folders.value = [...folders.value, cleaned].sort()
    }
    activeFolder.value = cleaned
    return true
  }

  async function createWildcard(): Promise<string | null> {
    const folder = activeFolder.value && activeFolder.value !== '(root)' ? activeFolder.value : ''
    const existing = new Set(wildcards.value.map(w => w.name))
    let baseName = 'new_wildcard'
    let fullName = folder ? `${folder}/${baseName}` : baseName
    let i = 1
    while (existing.has(fullName)) {
      baseName = `new_wildcard_${i++}`
      fullName = folder ? `${folder}/${baseName}` : baseName
    }
    const resp = await put<{ ok?: boolean; error?: string }>(
      `/api/generate/wildcard/${encodeURIComponent(fullName)}`,
      { content: '' },
    )
    if (!resp?.ok) return null
    await reload()
    return fullName
  }

  async function rename(oldName: string, newName: string): Promise<boolean> {
    const resp = await post<{ ok?: boolean; error?: string }>(
      `/api/generate/wildcard/${encodeURIComponent(oldName)}/rename`,
      { new_name: newName },
    )
    if (!resp?.ok) return false
    await reload()
    return true
  }

  async function editContent(name: string): Promise<string | null> {
    const resp = await get<{ content?: string }>(`/api/generate/wildcard/${encodeURIComponent(name)}`)
    return resp?.content ?? null
  }

  async function saveContent(name: string, content: string): Promise<boolean> {
    const resp = await put<{ ok?: boolean }>(
      `/api/generate/wildcard/${encodeURIComponent(name)}`,
      { content },
    )
    if (!resp?.ok) return false
    await reload()
    return true
  }

  async function remove(name: string): Promise<boolean> {
    const resp = await del<{ ok?: boolean }>(`/api/generate/wildcard/${encodeURIComponent(name)}`)
    if (!resp?.ok) return false
    await reload()
    return true
  }

  return {
    visible,
    wildcards,
    folders,
    activeFolder,
    loading,
    filtered,
    open,
    close,
    reload,
    createFolder,
    createWildcard,
    rename,
    editContent,
    saveContent,
    remove,
  }
}
