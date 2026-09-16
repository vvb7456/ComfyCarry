<script setup lang="ts">
/**
 * PresetRuleCard — 同步规则预设卡 (wizard step4 / dashboard 添加规则共用)。
 *
 * 视觉对齐「添加存储」的 OptionCard: 两行 (标题 + 描述), 执行时机/方式以
 * badge 放在标题旁; 不再罗列本地路径 —— 对「选不选」没有帮助, 细节留在
 * 确认弹窗里按需查看。
 *
 * - wizard: selected + toggle (整卡勾选, 右上角圆形角标)
 * - dashboard: 点击进入确认态 (无勾选态); deployAsManual 把「部署时执行」
 *   按「手动」呈现 —— dashboard 新建规则时也会落成 manual, 两处一致
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OptionCard from '@/components/ui/OptionCard.vue'
import Badge from '@/components/ui/Badge.vue'
import type { IconName } from '@/config/icon-codepoints'
import type { SyncTemplate } from '@/types/sync'

defineOptions({ name: 'PresetRuleCard' })

const props = withDefaults(defineProps<{
  preset: SyncTemplate
  /** wizard 勾选态 (dashboard 不传 → 纯点击进入下一级) */
  selected?: boolean
  /** dashboard: 部署时触发按手动呈现 (新建时同样落成 manual) */
  deployAsManual?: boolean
  /** 隐藏右上角选中角标 (dashboard 单选场景用高亮边框即可) */
  hideCheck?: boolean
}>(), {
  selected: false,
  deployAsManual: false,
  hideCheck: false,
})

const emit = defineEmits<{ toggle: [] }>()

const { t, te } = useI18n({ useScope: 'global' })

function tr(key: string | undefined, fallback: string): string {
  return key && te(key) ? t(key) : fallback
}

const presetName = computed(() => tr(props.preset.name_key, props.preset.name))
/** 描述支持 ```路径``` 标记 → <code> 等宽 (文案出自本项目 i18n, 无注入风险) */
const presetDesc = computed(() =>
  tr(props.preset.desc_key, '').replace(/```([^`]+)```/g, '<code>$1</code>'),
)

const dirIcon = computed<IconName>(() =>
  props.preset.direction === 'push' ? 'cloud_upload' : 'cloud_download',
)
const dirColor = computed(() => props.preset.direction === 'push' ? 'var(--green)' : 'var(--blue)')

/** badge: 执行时机 (dashboard 把 deploy 显示为 manual) */
const triggerLabel = computed(() => {
  let trig = props.preset.entries[0]?.trigger || ''
  if (props.deployAsManual && trig === 'deploy') trig = 'manual'
  return trig && te(`sync.rules.${trig}`) ? t(`sync.rules.${trig}`) : trig
})

/** badge: 执行方式 */
const methodLabel = computed(() => {
  const m = props.preset.entries[0]?.method
  return m && te(`sync.rules.method_short.${m}`) ? t(`sync.rules.method_short.${m}`) : (m || '')
})
</script>

<template>
  <OptionCard
    variant="bg2"
    density="compact"
    :selected="selected"
    :icon="dirIcon"
    :icon-color="dirColor"
    :hide-check="hideCheck"
    @toggle="emit('toggle')"
  >
    <template #title>{{ presetName }}</template>
    <template #badge>
      <span class="preset-card__badges">
        <Badge v-if="triggerLabel">{{ triggerLabel }}</Badge>
        <Badge v-if="methodLabel">{{ methodLabel }}</Badge>
      </span>
    </template>
    <template #description>
      <span v-html="presetDesc" />
    </template>
  </OptionCard>
</template>

<style scoped>
.preset-card__badges { display: inline-flex; gap: 4px; }

.preset-card__badges ~ :deep(code), :deep(code) {
  font-family: var(--font-mono);
  font-size: .72rem;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 4px;
  padding: 0 4px;
  overflow-wrap: anywhere;
}
</style>
