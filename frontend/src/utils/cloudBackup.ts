import type { CloudBackupSlot, CloudBackupSummary } from '@/types/config-export'

type TranslateFn = (key: string, params?: Record<string, unknown>) => string

export function isRecoverySlot(slot: CloudBackupSlot): boolean {
  return Boolean(slot.is_auto || slot.slot_type === 'recovery' || slot.id?.startsWith('recovery-'))
}

export function formatBackupDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function buildBackupSummaryTags(summary: CloudBackupSummary | undefined, t: TranslateFn): string[] {
  if (!summary) return []
  const tags: string[] = []
  if (summary.has_rclone) tags.push(t('settings.config.summary_rclone'))
  if (summary.sync_rules_count > 0) tags.push(t('settings.config.summary_rules', { count: summary.sync_rules_count }))
  if (summary.extra_plugins_count > 0) tags.push(t('settings.config.summary_plugins', { count: summary.extra_plugins_count }))
  if (summary.favorites_count > 0) tags.push(t('settings.config.summary_favorites', { count: summary.favorites_count }))
  if (summary.prompt_history_count > 0) tags.push(t('settings.config.summary_history', { count: summary.prompt_history_count }))
  if (summary.has_generate_state) tags.push(t('settings.config.summary_workspace'))
  return tags
}

export function buildSlotFacts(slot: CloudBackupSlot, t: TranslateFn): string[] {
  const formatted = formatBackupDate(slot.updated_at)
  return [
    ...(formatted ? [formatted] : []),
    ...buildBackupSummaryTags(slot.summary, t),
  ]
}
