<script setup lang="ts">
import { computed, onActivated, provide, ref, watch } from 'vue'
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

async function initOptions() {
  await options.load()
  if (!options.loaded.value) return // ComfyUI may be offline, options failed
  store.restore({
    checkpointExists: (name) => options.checkpoints.value.some(c => c.name === name),
    loraExists: (name) => options.loras.value.some(l => l.name === name),
    samplerExists: (name) => options.samplers.value.includes(name),
    schedulerExists: (name) => options.schedulers.value.includes(name),
  })
  store.enableAutoSave()
  optionsReady.value = true
}

initOptions()

// Watch gate: when it transitions to 'ready', re-init options if not loaded
watch(() => gate.state.value, (newState) => {
  if (newState === 'ready' && !optionsReady.value) {
    initOptions()
  }
})

onActivated(() => {
  if (options.loaded.value) options.refresh()
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

async function handleStop() {
  await post('/api/comfyui/interrupt')
  toast(t('generate.toast.interrupt_sent'), 'info')
}

// ── SSE event routing ──────────────────────────────────────────────────────
const sse = useComfySSE(tracker, {
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

    // Route through task registry
    const routed = taskRegistry.routeEvent(evt)

    if (result?.finished) {
      const promptId = (evt.data?.prompt_id as string) || ''

      if (result.type === 'execution_done') {
        const elapsed = result.data?.elapsed ? ` (${result.data.elapsed}s)` : ''

        // Only show toast + fetch images for main tasks
        if (!routed || routed.target.type === 'main') {
          toast(`${t('generate.toast.gen_complete')}${elapsed}`, 'success')
          if (promptId) preview.fetchOutputImages(promptId)
        }

        queuePanelRef.value?.loadQueue()
        historyPanelRef.value?.loadHistory()
        taskRegistry.cleanup()
      } else if (result.type === 'execution_interrupted') {
        toast(t('generate.toast.exec_interrupted'), 'warning')
        queuePanelRef.value?.loadQueue()
        historyPanelRef.value?.loadHistory()
        taskRegistry.cleanup()
      } else if (result.type === 'execution_error') {
        toast(t('generate.error.exec_error_prefix'), 'error')
        queuePanelRef.value?.loadQueue()
        taskRegistry.cleanup()
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
      <div class="gen-gate-card">
        <MsIcon :name="gate.state.value === 'error' ? 'error' : 'cloud_off'" class="gen-gate-icon" />
        <h3 class="gen-gate-title">
          {{ gate.state.value === 'starting'
            ? t('generate.gate.starting')
            : gate.state.value === 'error'
              ? t('generate.gate.backend_error')
              : t('generate.preview.offline_title') }}
        </h3>
        <p class="gen-gate-desc">{{ t('generate.preview.offline_desc') }}</p>
        <router-link v-if="gate.state.value === 'offline'" to="/comfyui" class="gen-gate-link">
          <MsIcon name="open_in_new" />
          {{ t('generate.gate.go_comfyui') }}
        </router-link>
        <div v-if="gate.state.value === 'starting' || gate.state.value === 'checking'" class="gen-gate-spinner">
          <div class="gate-spinner" />
        </div>
      </div>
    </div>

    <template v-else>
      <TabSwitcher v-model="activeTab" :tabs="tabs" />

      <!-- SDXL Tab -->
      <div v-show="activeTab === 'sdxl'">
        <SdxlTab
          :exec-state="execState"
          :elapsed="tracker.elapsed.value"
          :submitting="submitting"
          :preview-images="preview.images.value"
          :preview-loading="preview.loading.value"
          :preview-current="preview.currentPreview.value"
          @run="handleRun"
          @stop="handleStop"
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
  padding: var(--sp-6);
}
.gen-gate-card {
  text-align: center;
  max-width: 420px;
  padding: var(--sp-6);
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
}
.gen-gate-icon {
  font-size: 3rem;
  color: var(--t3);
  opacity: .4;
  margin-bottom: var(--sp-3);
}
.gen-gate-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--t1);
  margin: 0 0 var(--sp-2);
}
.gen-gate-desc {
  font-size: .85rem;
  color: var(--t2);
  margin: 0 0 var(--sp-4);
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
  margin-top: var(--sp-3);
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

