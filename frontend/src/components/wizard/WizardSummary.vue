<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import CollapsibleGroup from '@/components/ui/CollapsibleGroup.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { useWizardRclone } from '@/composables/useWizardRclone'
import { useWizardState } from '@/composables/useWizardState'
import type { WizardConfig } from '@/types/wizard'

defineOptions({ name: 'WizardSummary' })

const props = defineProps<{
  config: WizardConfig
  importedConfig?: Record<string, any> | null
}>()

const { t } = useI18n({ useScope: 'global' })
const { allRemoteNames, loadImportedRemotes } = useWizardRclone()
const { syncTemplates } = useWizardState()

// Self-healing: if rclone config exists but remotes weren't detected
// (e.g. page reload after import), re-detect them
onMounted(() => {
  if (props.config.rclone_config_value && allRemoteNames.value.length === 0) {
    loadImportedRemotes(props.config.rclone_config_value)
  }
})

const syncRulesCount = computed(() => {
  const c = props.config
  if (c._imported_sync_rules && c._imported_sync_rules_count) return c._imported_sync_rules_count
  return c.wizard_sync_rules.length
})

interface SummaryRow {
  label: string
  value: string
  icon?: string
  green?: boolean
  active?: boolean
}

interface SummarySection {
  title: string
  rows: SummaryRow[]
  accent?: boolean
  summaryText?: string
}

const llmProviderLabels: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  custom: t('wizard.step6.custom_provider'),
}

function configured(v: unknown): SummaryRow['icon'] {
  return v ? 'check_circle' : 'skip_next'
}

function sectionSummary(rows: SummaryRow[]): string {
  const count = rows.filter(row => row.active).length
  return count > 0 ? t('wizard.summary.items_set', { count }) : t('wizard.summary.skipped')
}

const sections = computed<SummarySection[]>(() => {
  const c = props.config

  /* ── tunnel value ── */
  let tunnelValue = t('wizard.summary.skipped')
  let tunnelIcon = 'skip_next'
  if (c.tunnel_mode === 'public') {
    tunnelValue = t('wizard.summary.public_node')
    if (c.public_tunnel_subdomain) tunnelValue += ` · ${c.public_tunnel_subdomain}.erocraft.org`
    tunnelIcon = 'public'
  } else if (c.cf_api_token) {
    tunnelValue = `${t('wizard.summary.custom')} · ${c.cf_subdomain || 'auto'}.${c.cf_domain}`
    tunnelIcon = 'build'
  }

  /* ── rclone method ── */
  const rcloneLabels: Record<string, string> = {
    skip: t('wizard.summary.skipped'),
    file: t('wizard.summary.file_upload'),
    manual: t('wizard.summary.manual_create'),
    base64_env: t('wizard.summary.env_var'),
  }
  const rcloneIcons: Record<string, string> = {
    skip: 'skip_next', file: 'folder_open', manual: 'build', base64_env: 'key',
  }
  const dm = c.rclone_config_method

  /* ── imported config section (prepended if present) ── */
  const importSection: SummarySection[] = props.importedConfig ? [{
    title: t('wizard.summary.imported'),
    rows: [
      { label: t('wizard.summary.export_time'), value: props.importedConfig._exported_at || t('wizard.summary.unknown'), icon: 'inventory_2', active: true },
    ],
    accent: true,
    summaryText: t('wizard.summary.items_set', { count: 1 }),
  }] : []

  const summarySections: SummarySection[] = [
    ...importSection,
    {
      title: t('wizard.summary.deploy_method'),
      rows: [
        { label: t('wizard.summary.image_type'), value: t('wizard.summary.prebuilt'), icon: 'bolt', active: true },
      ],
    },
    {
      title: t('wizard.summary.network_security'),
      rows: [
        { label: t('wizard.summary.password'), value: c.password ? t('wizard.summary.configured') : t('wizard.summary.not_set'), icon: configured(c.password), green: !!c.password, active: !!c.password },
        { label: t('wizard.summary.tunnel'), value: tunnelValue, icon: tunnelIcon, active: c.tunnel_mode === 'public' || !!c.cf_api_token },
        { label: t('wizard.summary.ssh_password'), value: c.ssh_password ? t('wizard.summary.configured') : t('wizard.summary.skipped'), icon: configured(c.ssh_password), green: !!c.ssh_password, active: !!c.ssh_password },
        { label: t('wizard.summary.ssh_keys'), value: c.ssh_keys.length ? t('wizard.summary.keys_count', { count: c.ssh_keys.length }) : t('wizard.summary.skipped'), icon: configured(c.ssh_keys.length), green: c.ssh_keys.length > 0, active: c.ssh_keys.length > 0 },
      ],
    },
    {
      title: t('wizard.summary.cloud_sync'),
      rows: [
        { label: t('wizard.summary.rclone_config'), value: rcloneLabels[c._rclone_display_method || dm] ?? rcloneLabels[dm] ?? dm, icon: rcloneIcons[c._rclone_display_method || dm] ?? rcloneIcons[dm] ?? 'assignment', active: dm !== 'skip' },
        { label: t('wizard.summary.remote_count'), value: allRemoteNames.value.length ? t('wizard.summary.keys_count', { count: allRemoteNames.value.length }) : t('wizard.summary.keys_count', { count: 0 }), active: allRemoteNames.value.length > 0 },
        { label: t('wizard.summary.sync_rules'), value: syncRulesCount.value ? t('wizard.summary.rules_count', { count: syncRulesCount.value }) : t('wizard.summary.none'), active: syncRulesCount.value > 0 },
        ...(c.wizard_sync_rules.length ? [{ label: t('wizard.summary.rule_details'), value: c.wizard_sync_rules.map(r => {
          const tpl = syncTemplates.value.find(t => t.id === r.template_id)
          return tpl?.name || r.template_id
        }).join(', '), active: true }] : []),
        ...(c._imported_sync_rules && !c.wizard_sync_rules.length ? [{ label: t('wizard.summary.rule_details'), value: t('wizard.summary.imported'), active: true }] : []),
      ],
    },
    {
      title: t('wizard.summary.models_plugins'),
      rows: [
        { label: t('wizard.summary.civitai'), value: c.civitai_token ? t('wizard.summary.configured') : t('wizard.summary.skipped'), icon: configured(c.civitai_token), green: !!c.civitai_token, active: !!c.civitai_token },
        { label: t('wizard.summary.plugin_count'), value: t('wizard.summary.plugins_detail', { count: c.plugins.length }), active: c.plugins.length > 0 },
      ],
    },
    {
      title: t('wizard.summary.llm'),
      rows: [
        { label: t('wizard.summary.llm_provider'), value: c.llm_provider ? (llmProviderLabels[c.llm_provider] || c.llm_provider) : t('wizard.summary.skipped'), icon: c.llm_provider ? undefined : 'skip_next', active: !!c.llm_provider },
        { label: t('wizard.summary.llm_api_key'), value: c.llm_api_key ? t('wizard.summary.configured') : t('wizard.summary.not_configured'), icon: configured(c.llm_api_key), green: !!c.llm_api_key, active: !!c.llm_api_key },
        ...(c.llm_model ? [{ label: t('wizard.summary.llm_model'), value: c.llm_model, active: true }] : []),
      ],
    },
    {
      title: t('wizard.summary.attn'),
      rows: [
        { label: 'FlashAttention-2', value: c.install_fa2 ? t('wizard.summary.install') : t('wizard.summary.skipped'), icon: configured(c.install_fa2), green: !!c.install_fa2, active: !!c.install_fa2 },
        { label: 'SageAttention-2', value: c.install_sa2 ? t('wizard.summary.install') : t('wizard.summary.skipped'), icon: configured(c.install_sa2), green: !!c.install_sa2, active: !!c.install_sa2 },
      ],
    },
  ]

  return summarySections.map(section => ({
    ...section,
    summaryText: section.summaryText ?? sectionSummary(section.rows),
  }))
})
</script>

<template>
  <div class="wizard-summary">
    <div class="wizard-summary__frame">
      <div
        v-for="section in sections"
        :key="section.title"
        class="wizard-summary__section"
        :class="{ 'wizard-summary__section--accent': section.accent }"
      >
        <CollapsibleGroup :title="section.title" :default-open="false">
          <template #title-right>
            <span class="wizard-summary__section-meta">{{ section.summaryText }}</span>
          </template>
          <div
            v-for="row in section.rows"
            :key="row.label"
            class="wizard-summary__row"
          >
            <span class="wizard-summary__label">{{ row.label }}</span>
            <span class="wizard-summary__value">
              <MsIcon
                v-if="row.icon"
                :name="row.icon"
                size="xs"
                :color="row.green ? 'var(--green)' : 'none'"
              />
              {{ row.value }}
            </span>
          </div>
        </CollapsibleGroup>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-summary {
  min-height: 0;
}

.wizard-summary__frame {
  display: flex;
  flex-direction: column;
}

.wizard-summary__section {
  padding: 0 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd) 80%, transparent);
}

.wizard-summary__section:last-child {
  border-bottom: none;
}

.wizard-summary__section--accent {
  border-left: 2px solid color-mix(in srgb, var(--ac) 55%, var(--bd));
  padding-left: 12px;
}

.wizard-summary__section :deep(.collapsible-group__header) {
  padding: 14px 0 10px;
  font-size: .92rem;
  font-weight: 600;
}

.wizard-summary__section :deep(.collapsible-group__title) {
  color: var(--ac);
}

.wizard-summary__section-meta {
  font-size: .74rem;
  color: var(--t3);
  font-weight: 400;
}

.wizard-summary__section :deep(.collapsible-group__body) {
  padding-top: 0;
  padding-bottom: 10px;
}

.wizard-summary__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(156px, 22vw, 220px);
  align-items: center;
  gap: 16px;
  padding: 6px 0;
}

.wizard-summary__label {
  color: var(--t3);
  font-size: .85rem;
}

.wizard-summary__value {
  color: var(--t1);
  font-size: .85rem;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: right;
  justify-content: flex-end;
}
</style>
