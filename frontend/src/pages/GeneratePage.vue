<script setup lang="ts">
import { computed, onActivated, provide, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import { useToast } from '@/composables/useToast'
import { useApiFetch } from '@/composables/useApiFetch'
import { useGenerateStore } from '@/stores/generate'
import { useGenerateOptions } from '@/composables/generate/useGenerateOptions'
import { useComfyGate } from '@/composables/generate/useComfyGate'
import { useTaskRegistry } from '@/composables/generate/useTaskRegistry'
import { useGenerateSubmit } from '@/composables/generate/useGenerateSubmit'
import { useGeneratePreview } from '@/composables/generate/useGeneratePreview'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import PageHeader from '@/components/layout/PageHeader.vue'
import TabSwitcher, { type TabItem } from '@/components/ui/TabSwitcher.vue'
import SdxlTab from '@/components/generate/SdxlTab.vue'
import QueuePanel from '@/components/generate/QueuePanel.vue'
import HistoryPanel from '@/components/generate/HistoryPanel.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'GeneratePage' })

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const { post } = useApiFetch()
const store = useGenerateStore()

// ── Gate: check ComfyUI online ─────────────────────────────────────────────
const gate = useComfyGate()
gate.checkNow()

// ── Options: load once, provide to all children ────────────────────────────
const options = useGenerateOptions()
provide(GenerateOptionsKey, options)

const optionsReady = ref(false)

async function initOptions(forceRefresh = false) {
  if (forceRefresh) {
    await options.refresh()
  } else {
    await options.load()
  }
  if (!options.loaded.value) return // ComfyUI may be offline, options failed
  if (optionsReady.value) return // Already restored — skip duplicate restore
  store.restore({
    checkpointExists: (name) => options.checkpoints.value.some(c => c.name === name),
    loraExists: (name) => options.loras.value.some(l => l.name === name),
    samplerExists: (name) => options.samplers.value.includes(name),
    schedulerExists: (name) => options.schedulers.value.includes(name),
  })
  store.enableAutoSave()
  optionsReady.value = true
}

// Only load options when gate is ready (not eagerly on mount)
watch(() => gate.state.value, (newState, oldState) => {
  if (newState === 'ready') {
    // Force refresh if we previously loaded stale data while offline
    initOptions(options.loaded.value && !optionsReady.value)
  }
}, { immediate: true })

onActivated(() => {
  if (optionsReady.value) options.refresh()
  // Re-check gate on page re-activation
  gate.checkNow()
})

const activeTab = ref('sdxl')

const tabs = computed<TabItem[]>(() => [
  { key: 'sdxl', label: t('generate.tabs.sdxl'), icon: 'image' },
  { key: 'flux', label: t('generate.tabs.flux'), icon: 'bolt', disabled: true },
  { key: 'history', label: t('generate.tabs.history'), icon: 'history', align: 'right' },
])

// ── Exec tracker + SSE ─────────────────────────────────────────────────────
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

const queuePanelRef = ref<InstanceType<typeof QueuePanel> | null>(null)
const historyPanelRef = ref<InstanceType<typeof HistoryPanel> | null>(null)

// ── Task registry + Preview ────────────────────────────────────────────────
const taskRegistry = useTaskRegistry()
const preview = useGeneratePreview()

// ── Submit ─────────────────────────────────────────────────────────────────
const { submitting, submit } = useGenerateSubmit(execState)

async function handleRun(_mode: string) {
  const promptId = await submit()
  if (promptId) {
    taskRegistry.registerTask(promptId, 'main')
    preview.clearPreview()
  }
}

// ── Live mode auto-rerun (legacy §8.1: rerun 500ms after done) ─────────
let liveRerunTimer: ReturnType<typeof setTimeout> | null = null

function scheduleLiveRerun() {
  cancelLiveRerun()
  liveRerunTimer = setTimeout(() => {
    liveRerunTimer = null
    if (store.currentState.runMode === 'live' && !execState.value) {
      handleRun('live')
    }
  }, 500)
}

function cancelLiveRerun() {
  if (liveRerunTimer) {
    clearTimeout(liveRerunTimer)
    liveRerunTimer = null
  }
}

onBeforeUnmount(cancelLiveRerun)

async function handleStop() {
  cancelLiveRerun()
  await post('/api/comfyui/interrupt')
  toast(t('generate.toast.interrupt_sent'), 'info')
}

// ── Auxiliary task registration (from SdxlTab) ─────────────────────────────
const sdxlTabRef = ref<InstanceType<typeof SdxlTab> | null>(null)

function handleRegisterTask(promptId: string, type: 'preprocess' | 'tag', subtype: string) {
  taskRegistry.registerTask(promptId, type, subtype)
}

function onPreprocessComplete(cnType: string, success: boolean) {
  sdxlTabRef.value?.handlePreprocessDone(cnType, success)
}

// ── SSE event routing ──────────────────────────────────────────────────────
const sse = useComfySSE(tracker, {
  // Intercept auxiliary workflow events (preprocess, tag) BEFORE tracker
  // — prevents them from hijacking the main progress bar (legacy behavior)
  onBeforeTracker(evt) {
    const promptId = (evt.data?.prompt_id as string) || ''
    if (!promptId) return false

    const routed = taskRegistry.routeEvent(evt)
    if (!routed) return false

    // Only suppress non-main tasks from the tracker
    if (routed.target.type === 'main') return false

    // Handle auxiliary task completion
    if (evt.type === 'execution_done' || evt.type === 'execution_error' || evt.type === 'execution_interrupted') {
      const success = evt.type === 'execution_done'
      if (routed.target.type === 'preprocess' && routed.target.subtype) {
        onPreprocessComplete(routed.target.subtype as 'pose' | 'canny' | 'depth', success)
      } else if (routed.target.type === 'tag') {
        sdxlTabRef.value?.handleTagDone(success)
      }
      taskRegistry.cleanup()
    }

    return true // suppress from tracker
  },

  onEvent(evt, result) {
    if (evt.type === 'status') {
      queuePanelRef.value?.loadQueue()
    }

    // Live preview frame (legacy §6.6)
    if (evt.type === 'preview_image' && evt.data?.b64) {
      const mainTask = taskRegistry.getMainTask()
      if (mainTask?.status === 'running') {
        const mime = (evt.data.mime as string) || 'image/jpeg'
        preview.setLivePreview(`data:${mime};base64,${evt.data.b64}`)
      }
    }

    if (result?.finished) {
      if (result.type === 'execution_done') {
        const elapsed = result.data?.elapsed ? ` (${result.data.elapsed}s)` : ''
        const promptId = (evt.data?.prompt_id as string) || ''
        toast(`${t('generate.toast.gen_complete')}${elapsed}`, 'success')
        if (promptId) preview.fetchOutputImages(promptId)
        queuePanelRef.value?.loadQueue()
        historyPanelRef.value?.loadHistory()
        taskRegistry.cleanup()
        // Live mode: auto-rerun after successful execution
        if (store.currentState.runMode === 'live') scheduleLiveRerun()
      } else if (result.type === 'execution_interrupted') {
        toast(t('generate.toast.exec_interrupted'), 'warning')
        preview.clearPreview()
        queuePanelRef.value?.loadQueue()
        historyPanelRef.value?.loadHistory()
        taskRegistry.cleanup()
        cancelLiveRerun()
      } else if (result.type === 'execution_error') {
        toast(t('generate.error.exec_error_prefix'), 'error')
        preview.clearPreview()
        queuePanelRef.value?.loadQueue()
        taskRegistry.cleanup()
        cancelLiveRerun()
      }
    }
  },
})

sse.start()
</script>

<template>
  <PageHeader icon="palette" :title="t('generate.title')" />
  <div class="page-body">
    <!-- Gate overlay when ComfyUI is not ready -->
    <div v-if="gate.state.value !== 'ready'" class="gen-gate-overlay">
      <EmptyState
        :icon="gate.state.value === 'error' ? 'error' : 'cloud_off'"
        :title="gate.state.value === 'starting'
          ? t('generate.gate.starting')
          : gate.state.value === 'error'
            ? t('generate.gate.backend_error')
            : t('generate.preview.offline_title')"
        :message="t('generate.preview.offline_desc')"
      >
        <router-link v-if="gate.state.value === 'offline'" to="/comfyui" class="gen-gate-link">
          <MsIcon name="open_in_new" color="none" />
          {{ t('generate.gate.go_comfyui') }}
        </router-link>
        <div v-if="gate.state.value === 'starting' || gate.state.value === 'checking'" class="gen-gate-spinner">
          <div class="gate-spinner" />
        </div>
      </EmptyState>
    </div>

    <template v-else>
      <TabSwitcher v-model="activeTab" :tabs="tabs" />

      <!-- SDXL Tab -->
      <div v-show="activeTab === 'sdxl'">
        <SdxlTab
          ref="sdxlTabRef"
          :exec-state="execState"
          :elapsed="tracker.elapsed.value"
          :submitting="submitting"
          :preview-images="preview.images.value"
          :preview-loading="preview.loading.value"
          :preview-current="preview.currentPreview.value"
          @run="handleRun"
          @stop="handleStop"
          @register-task="handleRegisterTask"
        />
      </div>

      <!-- History & Queue Tab -->
      <div v-show="activeTab === 'history'">
        <QueuePanel
          ref="queuePanelRef"
          :exec-state="execState"
          :elapsed="tracker.elapsed.value"
        />
        <HistoryPanel ref="historyPanelRef" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.gen-gate-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}
.gen-gate-link {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: .85rem;
  color: var(--ac);
  text-decoration: none;
}
.gen-gate-link:hover { text-decoration: underline; }
.gen-gate-spinner {
  display: flex;
  justify-content: center;
}
.gate-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--bd);
  border-top-color: var(--ac);
  border-radius: 50%;
  animation: gate-spin 0.8s linear infinite;
}
@keyframes gate-spin { to { transform: rotate(360deg); } }
</style>

