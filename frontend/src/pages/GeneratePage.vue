<script setup lang="ts">
import { computed, onActivated, provide, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useExecTracker } from '@/composables/useExecTracker'
import { useComfySSE } from '@/composables/useComfySSE'
import { useToast } from '@/composables/useToast'
import { useApiFetch } from '@/composables/useApiFetch'
import { useGenerateStore } from '@/stores/generate'
import { useGenerateQueueStore } from '@/stores/generateQueue'
import { useGenerateOptions } from '@/composables/generate/useGenerateOptions'
import { useComfyGate } from '@/composables/generate/useComfyGate'
import { useTaskRegistry } from '@/composables/generate/useTaskRegistry'
import { useGenerateSubmit } from '@/composables/generate/useGenerateSubmit'
import { useGeneratePreview } from '@/composables/generate/useGeneratePreview'
import { TAB_DEP_CONFIGS } from '@/composables/generate/modelDepConfigs'
import { GenerateOptionsKey } from '@/composables/generate/keys'
import { MODEL_TYPES } from '@/config/model-types'
import PageHeader from '@/components/layout/PageHeader.vue'
import DropdownMenu, { type DropdownMenuItem } from '@/components/ui/DropdownMenu.vue'
import SegmentedControl, { type SegmentOption } from '@/components/ui/SegmentedControl.vue'
import Drawer from '@/components/ui/Drawer.vue'
import ModelTab from '@/components/generate/ModelTab.vue'
import QueuePanel from '@/components/generate/QueuePanel.vue'
import HistoryPanel from '@/components/generate/HistoryPanel.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'GeneratePage' })

const { t } = useI18n({ useScope: 'global' })
const { toast } = useToast()
const { post } = useApiFetch()
const store = useGenerateStore()
const queueStore = useGenerateQueueStore()

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
    unetExists: (name) => options.unets.value.some(u => u.name === name),
    clipExists: (name) => options.clips.value.some(c => c.name === name),
    vaeExists: (name) => options.vaes.value.some(v => v.name === name),
    samplerExists: (name) => options.samplers.value.includes(name),
    schedulerExists: (name) => options.schedulers.value.includes(name),
  })
  store.enableAutoSave()
  optionsReady.value = true
  // ── gateReady 全量预检 (规格 D) ──
  // 对 TAB_DEP_CONFIGS 每个 entry 并发预检 (与 ModelTab 内 check 同接口, mount 时跑一次)
  // 无依赖配置的 entry (sdxl/pony/illustrious/noobai) 直接置 true
  precheckAllGateReady()
}

let gatePrecheckStarted = false
async function precheckAllGateReady() {
  if (gatePrecheckStarted) return
  gatePrecheckStarted = true
  // 无 dep 配置的架构 key 直接置 ready=true
  const depKeys = Object.keys(TAB_DEP_CONFIGS)
  for (const k of Object.keys(MODEL_TYPES)) {
    if (!depKeys.includes(k)) store.setGateReady(k, true)
  }
  // 并发预检有 dep 的 entry (复用 useModelDependency.check 同样的 /api/downloads/check 请求)
  await Promise.all(depKeys.map(async (tabKey) => {
    const cfg = TAB_DEP_CONFIGS[tabKey]
    try {
      const checkFiles: Array<{ subdir: string; filename: string }> = []
      for (const m of cfg.models) {
        for (const f of m.files) checkFiles.push({ subdir: f.subdir, filename: f.filename })
      }
      const res = await fetch('/api/downloads/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: checkFiles }),
      })
      if (!res.ok) { store.setGateReady(tabKey, false); return }
      const data = await res.json()
      const results: Array<{ installed: boolean }> = data?.results || []
      // 任一文件未安装 → 未就绪; 否则就绪
      const allInstalled = results.length === checkFiles.length && results.every(r => r.installed)
      store.setGateReady(tabKey, allInstalled)
    } catch {
      store.setGateReady(tabKey, false)
    }
  }))
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

// ── 架构选择器 (顶栏左侧 DropdownMenu) ─────────────────────────────────────
// 选中 → store.activeModelType 切换 (语义不变, ModelTab 全量 v-show 挂载,
// 回调按 store.activeModelType 路由的机制严禁改动)。
// F2 菜单结构: 有 familyOf 的 entry 归入对应父组 children; 无 familyOf 的平铺。
// ── 任务切换 (占位): 图像已上线; 视频/编辑禁用, 上线时改接子路由驱动 ──
const activeTask = ref('image')
const taskOptions = computed<SegmentOption[]>(() => [
  { value: 'image', label: t('generate.header.task_image'), icon: 'image' },
  { value: 'video', label: t('generate.header.task_video'), icon: 'videocam', disabled: true },
  { value: 'edit', label: t('generate.header.task_edit'), icon: 'edit', disabled: true },
])

const selectedModelKey = computed<string>({
  get: () => store.activeModelType,
  set: (v) => {
    if (MODEL_TYPES[v] && store.activeModelType !== v) {
      store.switchModelType(v)
    }
  },
})

const menuItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = []
  // 按 familyOf 分组: 家族 key → 子 entries
  const families: Record<string, DropdownMenuItem[]> = {}
  const topLevels: DropdownMenuItem[] = []

  for (const cfg of Object.values(MODEL_TYPES)) {
    const status = store.gateReady[cfg.key] === false ? 'warn' as const : undefined
    const leaf: DropdownMenuItem = {
      key: cfg.key,
      label: t(`generate.tabs.${cfg.key}`),
      logo: cfg.logo,
      logoInvertDark: cfg.logoInvertDark,
      letter: cfg.logo ? undefined : (cfg.label.slice(0, 2) || cfg.key.slice(0, 2)),
      status,
    }
    if (cfg.familyOf) {
      ;(families[cfg.familyOf] ||= []).push(leaf)
    } else {
      topLevels.push(leaf)
    }
  }

  // 合并: 顶级条目中, 若有 familyOf 子组, 把对应顶级条目升级为父组 (加 children)
  // sdxl 顶级条目 → SDXL 家族父组, children = [sdxl, pony, illustrious, noobai]
  for (let i = 0; i < topLevels.length; i++) {
    const top = topLevels[i]
    const famKey = Object.keys(families).find(k => k === top.key)
    if (famKey && families[famKey].length) {
      // 父组: logo 用家族根 logo (sdxl.png), label 用 family label
      const parentCfg = MODEL_TYPES[top.key]
      const parent: DropdownMenuItem = {
        key: `family_${top.key}`,
        label: t(`generate.header.family_${top.key}`),
        logo: parentCfg?.logo,
        logoInvertDark: parentCfg?.logoInvertDark,
      }
      // children: 父组行本身不可选中, 子行按家族内顺序 (通用在前)
      parent.children = [top, ...families[famKey]]
      items.push(parent)
      // 从 families 移除已消费的 (避免重复)
      delete families[famKey]
    } else {
      items.push(top)
    }
  }
  // 剩余未被消费的 family 子项 (理论上不会发生, 防御性追加)
  for (const [famKey, children] of Object.entries(families)) {
    const parentCfg = MODEL_TYPES[famKey]
    if (!parentCfg) continue
    items.push({
      key: `family_${famKey}`,
      label: t(`generate.header.family_${famKey}`),
      logo: parentCfg.logo,
      logoInvertDark: parentCfg.logoInvertDark,
      children,
    })
  }
  return items
})

// 当前选中模型 (用于触发器显示)
const currentConfig = computed(() => MODEL_TYPES[store.activeModelType] || MODEL_TYPES.sdxl)

// ── 队列/历史抽屉 (顶栏右侧按钮 + Drawer) ──────────────────────────────────
const drawerOpen = ref(false)
// 抽屉内容首开才挂载 (规格 E3): Drawer 本身常驻, slot 内容 v-if 首次打开后保留
const drawerEverOpened = ref(false)

function openDrawer() {
  drawerOpen.value = true
  if (!drawerEverOpened.value) drawerEverOpened.value = true
  // 队列实时刷新; 历史按 dirty / 未加载决定是否拉取 (规格 E3)
  queueStore.loadQueue()
  if (queueStore.historyDirty || !queueStore.historyLoaded) {
    queueStore.loadHistory()
  }
}

// badge: 队列任务数 (>0 显示, accent 底) — 读 store (规格 E2)
const queueCount = computed(() => queueStore.queueCount)
const isExecuting = computed(() => !!execState.value)

// ── Exec tracker + SSE ─────────────────────────────────────────────────────
const tracker = useExecTracker()
const execState = computed(() => tracker.state.value)

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

// ── Auxiliary task registration (from ModelTab) ─────────────────────────────
const modelTabRefs: Record<string, InstanceType<typeof ModelTab> | null> = {}

function activeTabRef() {
  // 按 store 的模型类型路由: 队列/历史已移入常驻抽屉, 不再占用 activeTab;
  // 预处理/打标完成回调仍须送达发起任务的模型 tab (store.activeModelType)
  return modelTabRefs[store.activeModelType] ?? null
}

function handleRegisterTask(promptId: string, type: 'preprocess' | 'tag', subtype: string) {
  taskRegistry.registerTask(promptId, type, subtype)
}

function onPreprocessComplete(cnType: string, success: boolean) {
  activeTabRef()?.handlePreprocessDone(cnType, success)
}

// ── SSE event routing ──────────────────────────────────────────────────────
// All events flow through to the tracker so the button always reflects ComfyUI
// real state. Auxiliary task completion (preprocess, tag) is handled via routing
// but NOT suppressed — only the "aftermath" (toast, fetch) is selective.
let lastRoutedType: string | null = null

const sse = useComfySSE(tracker, {
  onBeforeTracker(evt) {
    const promptId = (evt.data?.prompt_id as string) || ''
    if (!promptId) { lastRoutedType = null; return false }

    const routed = taskRegistry.routeEvent(evt)
    lastRoutedType = routed?.target.type ?? null

    // Handle auxiliary task completion callbacks (preprocess → set image, tag → set tags)
    if (routed && routed.target.type !== 'main') {
      if (evt.type === 'execution_done' || evt.type === 'execution_error' || evt.type === 'execution_interrupted') {
        const success = evt.type === 'execution_done'
        if (routed.target.type === 'preprocess' && routed.target.subtype) {
          onPreprocessComplete(routed.target.subtype as 'pose' | 'canny' | 'depth', success)
        } else if (routed.target.type === 'tag') {
          activeTabRef()?.handleTagDone(success)
        }
      }
    }

    return false // let ALL events through to tracker
  },

  onEvent(evt, result) {
    if (evt.type === 'status') {
      // 队列变化事件 → store 刷新 (badge 常显, 保持实时) (规格 E2)
      queueStore.loadQueue()
    }

    // Live preview frame — only for main tasks
    if (evt.type === 'preview_image' && evt.data?.b64) {
      const mainTask = taskRegistry.getMainTask()
      if (mainTask?.status === 'running') {
        const mime = (evt.data.mime as string) || 'image/jpeg'
        preview.setLivePreview(`data:${mime};base64,${evt.data.b64}`)
      }
    }

    if (result?.finished) {
      // Only show toast / fetch outputs for main tasks (or unknown = assumed main)
      const isMain = !lastRoutedType || lastRoutedType === 'main'

      if (isMain) {
        if (result.type === 'execution_done') {
          const elapsed = result.data?.elapsed ? ` (${result.data.elapsed}s)` : ''
          const promptId = (evt.data?.prompt_id as string) || ''
          toast(`${t('generate.toast.gen_complete')}${elapsed}`, 'success')
          if (promptId) preview.fetchOutputImages(promptId)
          queueStore.loadQueue()
          // 任务完成事件 → 抽屉开着: loadHistory; 关着: markHistoryDirty (规格 E2)
          if (drawerOpen.value) queueStore.loadHistory()
          else queueStore.markHistoryDirty()
          // Live mode: auto-rerun after successful execution
          if (store.currentState.runMode === 'live') scheduleLiveRerun()
        } else if (result.type === 'execution_interrupted') {
          toast(t('generate.toast.exec_interrupted'), 'warning')
          preview.clearPreview()
          queueStore.loadQueue()
          if (drawerOpen.value) queueStore.loadHistory()
          else queueStore.markHistoryDirty()
          cancelLiveRerun()
        } else if (result.type === 'execution_error') {
          toast(t('generate.error.exec_error_prefix'), 'error')
          preview.clearPreview()
          queueStore.loadQueue()
          cancelLiveRerun()
        }
      }
      taskRegistry.cleanup()
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
      <!-- ═══ 顶栏: [任务切换] [模型 ▾] ... [队列/历史 (badge)] ═══ -->
      <div class="gen-header">
        <div class="gen-header-left">
        <!-- 任务切换 (占位: 视频/编辑未上线为禁用项; 上线时接子路由) -->
        <SegmentedControl
          v-model="activeTask"
          :options="taskOptions"
          size="md"
        />
        <!-- 架构选择器: 前置静音小标签提示控件语义 -->
        <span class="gen-arch-label">{{ t('generate.header.model_label') }}</span>
        <DropdownMenu
          v-model="selectedModelKey"
          :items="menuItems"
          class="gen-arch-selector"
        >
          <template #default="{ open }">
            <button
              class="gen-arch-trigger"
              :class="{ 'gen-arch-trigger--open': open }"
              :aria-label="t('generate.header.model_selector_aria')"
            >
              <!-- 当前模型 logo(20px 底板) / 字母徽章 -->
              <span class="gen-arch-logo" :class="{ 'gen-arch-logo--pad': currentConfig.logo }">
                <img v-if="currentConfig.logo" :src="currentConfig.logo" :alt="currentConfig.label" />
                <span v-else class="gen-arch-logo__letter">{{ currentConfig.label.slice(0, 2) }}</span>
              </span>
              <span class="gen-arch-trigger__label">{{ t(`generate.tabs.${currentConfig.key}`) }}</span>
              <MsIcon name="expand_more" size="sm" color="var(--t3)" :class="{ 'gen-arch-trigger__icon--open': open }" />
            </button>
          </template>
        </DropdownMenu>
        </div>

        <!-- 右: 队列/历史按钮 (ghost 风格, badge + 执行中 pulse) -->
        <button class="gen-queue-btn" @click="openDrawer">
          <MsIcon
            name="history"
            :class="{ 'gen-queue-btn__icon--pulse': isExecuting }"
          />
          <span class="gen-queue-btn__label">{{ t('generate.header.queue_history') }}</span>
          <span v-if="queueCount > 0" class="gen-queue-btn__badge">{{ queueCount }}</span>
        </button>
      </div>

      <!-- Model Tabs (config-driven, 全量 v-show 挂载) -->
      <div
        v-for="mt in Object.keys(MODEL_TYPES)"
        :key="mt"
        v-show="store.activeModelType === mt"
      >
        <ModelTab
          :ref="(el: any) => { modelTabRefs[mt] = el }"
          :model-type="mt"
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

      <!-- ═══ 队列/历史抽屉 (常驻挂载 Drawer, slot 内容首开才挂载) ═══ -->
      <!-- 规格 E3: Drawer 组件本身常驻 (Teleport), 但 slot 内容 v-if="drawerEverOpened"
           首次打开才挂载 QueuePanel/HistoryPanel (其 onMounted 自行从 store 取数)。 -->
      <Drawer v-model="drawerOpen" :title="t('generate.header.queue_history')" icon="history">
        <template v-if="drawerEverOpened">
          <QueuePanel
            :exec-state="execState"
            :elapsed="tracker.elapsed.value"
          />
          <HistoryPanel />
        </template>
      </Drawer>
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

/* ═══ 新顶栏 (规格 B: 去 border-bottom, 行高紧凑) ═══ */
.gen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: 0;
  margin-bottom: var(--sp-3);
  /* 不再 border-bottom; 与下方内容用 margin 分隔 */
}

/* 架构选择器触发器 */
.gen-header-left {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
}

/* 架构选择器前置静音标签: 提示控件语义, 窄屏隐藏 */
.gen-arch-label {
  font-size: var(--text-xs);
  color: var(--t3);
  user-select: none;
  margin-right: calc(var(--sp-2) * -0.5);
}
@media (max-width: 640px) {
  .gen-arch-label { display: none; }
}

.gen-arch-selector {
  flex-shrink: 0;
}

/* 触发器与队列/历史按钮共用同一按钮规格 (规格 B):
   --bg3 底、1px --bd 边框、var(--rs) 圆角、同高度、同 padding;
   hover 边框变亮 (与触发器一致)。 */
.gen-arch-trigger,
.gen-queue-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 12px;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--rs);
  color: var(--t1);
  font-size: var(--text-base);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: border-color .15s, background .15s;
  flex-shrink: 0;
  position: relative;
}
.gen-arch-trigger:hover,
.gen-queue-btn:hover {
  border-color: var(--bd-f);
}

.gen-arch-trigger--open {
  border-color: var(--ac);
}

/* 当前模型 logo (20px 底板) / 字母徽章 */
.gen-arch-logo {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.gen-arch-logo--pad {
  background: #f4f4f5;
}
.gen-arch-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.gen-arch-logo__letter {
  font-size: .7rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac2));
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.gen-arch-trigger__label {
  white-space: nowrap;
}

/* chevron 旋转 (复用 MsIcon class) */
.gen-arch-trigger :deep(.ms.gen-arch-trigger__icon--open) {
  transform: rotate(180deg);
}

/* 队列/历史按钮 — 共用 .gen-arch-trigger 同规格 (上), 仅以下为独有覆盖 */
.gen-queue-btn {
  color: var(--t2); /* 次级文字色 (主操作 = 架构触发器, 此为辅助) */
}
.gen-queue-btn:hover {
  color: var(--t1); /* hover 时升主色 (border 由共用规则变亮) */
}

.gen-queue-btn__label {
  white-space: nowrap;
}

/* badge: 队列任务数 (>0 显示, accent 底) */
.gen-queue-btn__badge {
  background: var(--ac);
  color: #fff;
  font-size: .68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

/* 执行中图标轻微 pulse (CSS, prefers-reduced-motion 降级静态) */
.gen-queue-btn__icon--pulse {
  animation: gen-queue-pulse 1.6s ease-in-out infinite;
}
@keyframes gen-queue-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}
@media (prefers-reduced-motion: reduce) {
  .gen-queue-btn__icon--pulse {
    animation: none;
  }
}
</style>

