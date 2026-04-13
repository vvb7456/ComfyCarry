<script setup lang="ts">
/**
 * MaskEditorModal — Full-screen mask drawing editor.
 *
 * Opens as a large modal with the reference image as background.
 * User draws with brush (white = repaint area) / eraser (black = preserve).
 * On apply, exports mask as PNG and uploads via parent callback.
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import RangeField from '@/components/form/RangeField.vue'
import { useMaskEditor } from '@/composables/generate/useMaskEditor'

defineOptions({ name: 'MaskEditorModal' })

const props = defineProps<{
  modelValue: boolean
  imageUrl: string
  maskUrl?: string | null
  onApplyMask?: (blob: Blob) => Promise<void> | void
  onClearMask?: () => void
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })
const canvasContainer = ref<HTMLElement | null>(null)
const applying = ref(false)

const editor = useMaskEditor()

// Initialize canvas when modal opens
watch(() => props.modelValue, async (visible) => {
  if (visible) {
    await nextTick()
    await nextTick() // wait for DOM to render
    if (canvasContainer.value && props.imageUrl) {
      await editor.init(props.imageUrl, canvasContainer.value)
      // Load existing mask if any
      if (props.maskUrl) {
        await editor.loadMask(props.maskUrl)
      }
    }
  } else {
    editor.destroy()
  }
})

onBeforeUnmount(() => {
  editor.destroy()
})

async function onApply() {
  applying.value = true
  try {
    if (editor.hasMaskContent.value) {
      const blob = await editor.exportMask()
      if (blob && props.onApplyMask) {
        await props.onApplyMask(blob)
      }
    } else {
      // Mask is empty (all cleared) — remove the mask
      props.onClearMask?.()
    }
    emit('update:modelValue', false)
  } finally {
    applying.value = false
  }
}

function onCancel() {
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('generate.mask_editor.title')"
    icon="brush"
    size="xl"
    :close-on-esc="true"
    :close-on-overlay="false"
    scroll="none"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="mask-editor">
      <!-- Toolbar -->
      <div class="mask-editor__toolbar">
        <div class="mask-editor__tools">
          <BaseButton
            :variant="editor.tool.value === 'brush' ? 'primary' : 'default'"
            size="xs"
            @click="editor.tool.value = 'brush'"
          >
            <MsIcon name="brush" size="xs" />
            {{ t('generate.mask_editor.brush') }}
          </BaseButton>
          <BaseButton
            :variant="editor.tool.value === 'eraser' ? 'primary' : 'default'"
            size="xs"
            @click="editor.tool.value = 'eraser'"
          >
            <MsIcon name="ink_eraser" size="xs" />
            {{ t('generate.mask_editor.eraser') }}
          </BaseButton>
        </div>

        <div class="mask-editor__brush-size">
          <RangeField
            :model-value="editor.brushSize.value"
            :min="5"
            :max="200"
            :step="1"
            :label="t('generate.mask_editor.brush_size')"
            @update:model-value="editor.brushSize.value = $event"
          />
        </div>

        <div class="mask-editor__actions">
          <BaseButton variant="ghost" size="xs" @click="editor.clearMask()">
            <MsIcon name="delete" size="xs" />
            {{ t('generate.mask_editor.clear_all') }}
          </BaseButton>
          <BaseButton variant="ghost" size="xs" @click="editor.invertMask()">
            <MsIcon name="invert_colors" size="xs" />
            {{ t('generate.mask_editor.invert') }}
          </BaseButton>
          <BaseButton variant="ghost" size="xs" :title="t('generate.mask_editor.fit_screen')" @click="editor.resetView()">
            <MsIcon name="fit_screen" size="xs" />
            {{ t('generate.mask_editor.fit_screen') }}
          </BaseButton>
        </div>
      </div>

      <!-- Help text -->
      <div class="mask-editor__help">
        {{ t('generate.mask_editor.help') }}
        <span class="mask-editor__shortcuts">
          B={{ t('generate.mask_editor.brush') }} · E={{ t('generate.mask_editor.eraser') }} · [/]={{ t('generate.mask_editor.brush_size') }} · {{ t('generate.mask_editor.space_pan') }} · {{ t('generate.mask_editor.scroll_zoom') }}
        </span>
      </div>

      <!-- Canvas area -->
      <div ref="canvasContainer" class="mask-editor__canvas" />
    </div>

    <template #footer>
      <BaseButton variant="default" size="sm" @click="onCancel">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <BaseButton variant="primary" size="sm" :loading="applying" @click="onApply">
        {{ t('common.btn.confirm') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.mask-editor {
  display: flex;
  flex-direction: column;
  height: 70vh;
  min-height: 400px;
}

.mask-editor__toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-2) 0;
  flex-wrap: wrap;
}

.mask-editor__tools {
  display: flex;
  gap: var(--sp-1);
}

.mask-editor__brush-size {
  flex: 0 0 180px;
}

.mask-editor__actions {
  display: flex;
  gap: var(--sp-1);
  margin-left: auto;
}

.mask-editor__help {
  font-size: var(--text-xs);
  color: var(--t3);
  padding: var(--sp-1) 0;
}

.mask-editor__shortcuts {
  opacity: 0.6;
  margin-left: var(--sp-2);
}

.mask-editor__canvas {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  overflow: hidden;
  background: #1a1a2e;
}
</style>
