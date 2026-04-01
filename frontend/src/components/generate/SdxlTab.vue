<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenerateStore } from '@/stores/generate'
import type { ExecState } from '@/composables/useExecTracker'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import ModuleTabs, { type SwitchTabItem } from '@/components/generate/ModuleTabs.vue'
import PromptEditor, { type ToolButton } from '@/components/generate/PromptEditor.vue'
import ActionBar from '@/components/generate/ActionBar.vue'
import BasicSettings from '@/components/generate/BasicSettings.vue'
import AdvancedSettings from '@/components/generate/AdvancedSettings.vue'
import PreviewArea from '@/components/generate/PreviewArea.vue'

defineOptions({ name: 'SdxlTab' })

const props = defineProps<{
  execState: ExecState | null
  elapsed: number
  submitting: boolean
  previewImages: PreviewImage[]
  previewLoading: boolean
  previewCurrent: string | null
}>()

const emit = defineEmits<{
  run: [mode: string]
  stop: []
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useGenerateStore()
const state = computed(() => store.currentState)

/* ── Prompt toolbar buttons ── */
const promptTools = computed<ToolButton[]>(() => [
  { key: 'interrogate', icon: 'image_search', label: t('generate.prompt.tools.interrogate'), title: t('generate.prompt.tools.interrogate_title') },
  { key: 'llm-assist', icon: 'auto_awesome', label: t('generate.prompt.tools.llm_assist'), title: t('generate.prompt.tools.llm_assist_title') },
  { key: 'embedding', icon: 'link', label: t('generate.prompt.tools.embedding'), title: t('generate.prompt.tools.embedding_title') },
  { key: 'wildcard', icon: 'shuffle', label: t('generate.prompt.tools.wildcard'), title: t('generate.prompt.tools.wildcard_title') },
])

/* ── Module tabs ── */
const moduleTabs = computed<SwitchTabItem[]>(() => [
  { key: 'lora', label: t('generate.modules.lora'), icon: 'extension' },
  { key: 'i2i', label: t('generate.modules.i2i'), icon: 'image' },
  { key: 'pose', label: t('generate.modules.pose'), icon: 'accessibility_new' },
  { key: 'canny', label: t('generate.modules.canny'), icon: 'border_style' },
  { key: 'depth', label: t('generate.modules.depth'), icon: 'layers' },
  { key: 'upscale', label: t('generate.modules.upscale'), icon: 'hd' },
  { key: 'hires', label: t('generate.modules.hires'), icon: 'auto_fix_high' },
])

/* Derive enabled modules from store state */
const enabledModules = computed(() => {
  const s = state.value
  const enabled = new Set<string>()
  if (s.loras.some(l => l.enabled)) enabled.add('lora')
  if (s.i2i.enabled) enabled.add('i2i')
  if (s.controlNets.pose?.enabled) enabled.add('pose')
  if (s.controlNets.canny?.enabled) enabled.add('canny')
  if (s.controlNets.depth?.enabled) enabled.add('depth')
  if (s.upscale.enabled) enabled.add('upscale')
  if (s.hires.enabled) enabled.add('hires')
  return enabled
})

function onModuleToggle(key: string, enabled: boolean) {
  const s = state.value
  switch (key) {
    case 'lora':
      // LoRA toggle: enable/disable all selected LoRAs
      s.loras.forEach(l => { l.enabled = enabled })
      break
    case 'i2i':
      s.i2i.enabled = enabled
      break
    case 'pose':
    case 'canny':
    case 'depth':
      if (s.controlNets[key]) s.controlNets[key].enabled = enabled
      break
    case 'upscale':
      s.upscale.enabled = enabled
      break
    case 'hires':
      s.hires.enabled = enabled
      break
  }
}
</script>

<template>
  <div class="sdxl-tab">
    <!-- ═══ 上部: 双列布局 ═══ -->
    <div class="gen-top-row">
      <!-- 左列: 控制区 -->
      <div class="gen-ctrl-col">
        <!-- 提示词 -->
        <PromptEditor
          :positive="state.positive"
          :negative="state.negative"
          :show-negative="true"
          :tools="promptTools"
          @update:positive="state.positive = $event"
          @update:negative="state.negative = $event"
        />

        <!-- 操作栏 -->
        <ActionBar
          :exec-state="execState"
          :elapsed="elapsed"
          :submitting="submitting"
          @run="emit('run', $event)"
          @stop="emit('stop')"
        />

        <hr class="gen-sep">

        <!-- 基础设置 -->
        <BasicSettings />

        <!-- 高级设置 -->
        <AdvancedSettings />
      </div>

      <!-- 右列: 预览区 -->
      <div class="gen-preview-col">
        <PreviewArea
          :images="previewImages"
          :loading="previewLoading"
          :current-preview="previewCurrent"
        />
      </div>
    </div>

    <!-- ═══ 下部: 功能模块 ═══ -->
    <ModuleTabs
      :tabs="moduleTabs"
      :active-tab="state.activeModule"
      :enabled-tabs="enabledModules"
      @update:active-tab="state.activeModule = $event ?? 'lora'"
      @toggle="onModuleToggle"
    />

    <!-- 模块面板占位 -->
    <div v-show="state.activeModule === 'lora'" class="gen-module-panel">
      <div class="gen-placeholder">LoRA 选择面板</div>
    </div>
    <div v-show="state.activeModule === 'i2i'" class="gen-module-panel">
      <div class="gen-placeholder">图生图面板</div>
    </div>
    <div v-show="state.activeModule === 'pose'" class="gen-module-panel">
      <div class="gen-placeholder">姿势控制面板</div>
    </div>
    <div v-show="state.activeModule === 'canny'" class="gen-module-panel">
      <div class="gen-placeholder">轮廓控制面板</div>
    </div>
    <div v-show="state.activeModule === 'depth'" class="gen-module-panel">
      <div class="gen-placeholder">景深控制面板</div>
    </div>
    <div v-show="state.activeModule === 'upscale'" class="gen-module-panel">
      <div class="gen-placeholder">高清放大面板</div>
    </div>
    <div v-show="state.activeModule === 'hires'" class="gen-module-panel">
      <div class="gen-placeholder">二次采样面板</div>
    </div>
  </div>
</template>

<style scoped>
.sdxl-tab {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/* ═══ 上部: 双列网格 ═══ */
.gen-top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
  align-items: stretch;
}
@media (max-width: 900px) {
  .gen-top-row { grid-template-columns: 1fr; }
}

/* ── 左列 ── */
.gen-ctrl-col {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
}

.gen-sep {
  border: none;
  border-top: 1px solid var(--bd);
  margin: 0;
}

/* ── 右列: 预览 ── */
.gen-preview-col {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-height: 0;
  overflow: hidden;
}

/* ═══ 下部: 模块面板 ═══ */
.gen-module-panel {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  min-height: 120px;
}

/* ── 通用占位 ── */
.gen-placeholder {
  background: var(--bg3);
  border: 1px dashed var(--bd);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  text-align: center;
  font-size: .82rem;
  color: var(--t3);
}
.gen-placeholder--sm { padding: var(--sp-2) var(--sp-3); }
</style>
