<script setup lang="ts">
/**
 * PromptEditor — Positive / Negative prompt textareas + toolbar
 *
 * Features:
 *  - Positive textarea with bottom toolbar (variable buttons)
 *  - Optional negative textarea (controlled via `showNegative` prop)
 *  - Help button → opens syntax help modal (BaseModal)
 *  - Toolbar buttons are configurable via `tools` prop (array of ToolButton)
 *  - Each textarea auto‑resizes vertically (CSS resize: vertical)
 *  - Focus border highlight (--ac color)
 *  - Responsive: mobile hides tool labels, shows icons only
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseModal from '@/components/ui/BaseModal.vue'

export interface ToolButton {
  key: string
  icon: string
  label: string
  title?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  positive: string
  negative: string
  showNegative?: boolean
  tools?: ToolButton[]
}>(), {
  showNegative: true,
  tools: () => [],
})

const emit = defineEmits<{
  'update:positive': [value: string]
  'update:negative': [value: string]
  'tool': [key: string]
}>()

const { t } = useI18n({ useScope: 'global' })

const helpOpen = ref(false)
</script>

<template>
  <div class="prompt-editor">
    <!-- Section header -->
    <div class="gen-s-hdr">
      <MsIcon name="notes" class="hdr-icon" />
      {{ t('generate.prompt.title') }}
      <button class="prompt-help-btn" :title="t('generate.prompt.syntax_help_title')" @click="helpOpen = true">
        <MsIcon name="help_outline" size="sm" color="none" />
      </button>
    </div>

    <!-- Positive prompt -->
    <div class="prompt-wrap">
      <textarea
        class="prompt-textarea"
        :class="{ 'prompt-textarea--tooled': tools.length > 0 }"
        rows="4"
        :value="positive"
        :placeholder="t('generate.prompt.positive_placeholder')"
        @input="emit('update:positive', ($event.target as HTMLTextAreaElement).value)"
      />
      <div v-if="tools.length" class="prompt-toolbar">
        <button
          v-for="tool in tools"
          :key="tool.key"
          class="prompt-tool-btn"
          :title="tool.title"
          :disabled="tool.disabled"
          @click="emit('tool', tool.key)"
        >
          <MsIcon :name="tool.icon" class="tool-icon" />
          <span class="tool-label">{{ tool.label }}</span>
        </button>
      </div>
    </div>

    <!-- Negative prompt -->
    <div v-if="showNegative" class="prompt-wrap prompt-wrap--negative">
      <textarea
        class="prompt-textarea"
        rows="4"
        :value="negative"
        :placeholder="t('generate.prompt.negative_placeholder')"
        @input="emit('update:negative', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>

    <!-- Syntax help modal -->
    <BaseModal v-model="helpOpen" :title="t('generate.prompt.help_modal_title')" icon="help_outline" size="lg">
      <div class="help-content">
        <!-- 基础语法 -->
        <div class="help-section-title">{{ t('generate.prompt.help.basic_title') }}</div>
        <table class="help-table">
          <tr v-for="row in [
            { key: 'comma', example: '1girl, long hair, blue sky' },
            { key: 'weight_up', example: '(masterpiece:1.4)' },
            { key: 'weight_down', example: '(blurry:0.5)' },
            { key: 'embedding', example: 'embedding:easynegative' },
            { key: 'quality', example: '' },
          ]" :key="row.key">
            <td class="help-label">{{ t(`generate.prompt.help.${row.key}`) }}</td>
            <td>
              <code v-if="row.example">{{ row.example }}</code>
              <br v-if="row.example" />
              <span class="help-desc">{{ t(`generate.prompt.help.${row.key}_desc`) }}</span>
            </td>
          </tr>
        </table>

        <!-- 随机提示词 -->
        <div class="help-section-title">{{ t('generate.prompt.help.random_title') }}</div>
        <table class="help-table">
          <tr v-for="row in [
            { key: 'random_pick', example: '{red|green|blue} hair' },
            { key: 'random_weight', example: '{0.8::masterpiece|0.2::best quality}' },
            { key: 'random_multi', example: '{2$$cat|dog|bird}' },
            { key: 'wildcard', example: '__hair_color__ hair' },
            { key: 'wildcard_sub', example: '__sdxl/quality__' },
            { key: 'variable_lock', example: '${c=!{red|blue}} ${c} dress, ${c} shoes' },
            { key: 'nesting', example: '{a {big|small} cat|a {red|blue} ball}' },
          ]" :key="row.key">
            <td class="help-label">{{ t(`generate.prompt.help.${row.key}`) }}</td>
            <td>
              <code>{{ row.example }}</code><br />
              <span class="help-desc">{{ t(`generate.prompt.help.${row.key}_desc`) }}</span>
            </td>
          </tr>
        </table>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.prompt-editor {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* ── Section header ── */
.gen-s-hdr {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--t2);
}
.hdr-icon { font-size: .9rem; color: var(--t3); }

/* ── Prompt wrap: fuses textarea + toolbar ── */
.prompt-wrap {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r);
  overflow: hidden;
  transition: border-color .15s;
  min-width: 0;
}
.prompt-wrap:focus-within {
  border-color: var(--ac);
}

/* ── Textarea ── */
.prompt-textarea {
  border: none;
  outline: none;
  box-shadow: none;
  background: var(--bg-in);
  color: var(--t1);
  font-size: .85rem;
  line-height: 1.5;
  padding: var(--sp-2) var(--sp-3);
  min-height: 60px;
  resize: vertical;
  font-family: inherit;
}
.prompt-textarea--tooled {
  border-radius: 0;
}
.prompt-textarea::placeholder {
  color: var(--t3);
  opacity: .7;
}

/* ── Toolbar ── */
.prompt-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 3px 6px;
  background: var(--bg2);
  border-top: 1px solid var(--bd);
  flex-shrink: 0;
  overflow-x: auto;
}
.prompt-toolbar::-webkit-scrollbar { display: none; }

/* ── Tool button ── */
.prompt-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--t2);
  font-size: .72rem;
  cursor: pointer;
  white-space: nowrap;
  transition: color .15s, background .15s;
}
.prompt-tool-btn .tool-icon { color: var(--ac); font-size: .85rem; }
.prompt-tool-btn:hover:not(:disabled) {
  color: var(--t1);
  background: var(--bg3);
}
.prompt-tool-btn:disabled {
  opacity: .3;
  cursor: not-allowed;
}
.tool-label {
  font-size: .74rem;
  font-weight: 500;
}

@media (max-width: 768px) {
  .prompt-toolbar { justify-content: flex-start; }
  .tool-label { display: none; }
}

/* ── Negative spacing ── */
.prompt-wrap--negative { margin-top: var(--sp-1); }

/* ── Help button ── */
.prompt-help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--t3);
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  transition: color .15s, background .15s;
}
.prompt-help-btn:hover {
  color: var(--ac);
  background: var(--bg3);
}

/* ── Help modal content ── */
.help-content {
  font-size: .88rem;
  line-height: 1.7;
}
.help-section-title {
  font-weight: 600;
  color: var(--t1);
  margin-bottom: 8px;
}
.help-section-title:not(:first-child) {
  margin-top: 16px;
}
.help-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}
.help-table td {
  padding: 7px 6px;
  border-bottom: 1px solid var(--bd);
  vertical-align: top;
}
.help-table tr:last-child td {
  border-bottom: none;
}
.help-label {
  font-weight: 600;
  white-space: nowrap;
  color: var(--ac);
}
.help-desc {
  color: var(--t3);
}
.help-content code {
  font-family: monospace;
  font-size: .84rem;
  background: var(--bg3);
  padding: 1px 5px;
  border-radius: 3px;
}
</style>
