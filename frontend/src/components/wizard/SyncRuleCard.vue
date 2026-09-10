<script setup lang="ts">
/**
 * SyncRuleCard — 同步规则卡片 (wizard step4 使用)。
 *
 * 经典卡片布局: 整卡点击切换选中, 右上角圆形选中角标, 名称 + 触发/方式
 * meta + 远程路径 + 本地路径。字段常驻展示 (未选中也可见 —— 清单语义,
 * 一眼看清每条规则会做什么)。
 *
 * remote 字段为可选 API (remoteOptions 非空时渲染); wizard 单存储语义下
 * 不传 → 无该字段, remote 隐式取计划。
 * browsable: 路径旁的目录选择器按钮 (PathBrowserModal)。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect, { type SelectOption } from '@/components/form/BaseSelect.vue'
import type { SyncTemplate } from '@/types/wizard'

defineOptions({ name: 'SyncRuleCard' })

const props = withDefaults(defineProps<{
  template: SyncTemplate
  selected: boolean
  remote: string
  remotePath: string
  remoteOptions: SelectOption[]
  /** 显示远程目录浏览按钮 (父组件监听 browse 打开 PathBrowser) */
  browsable?: boolean
}>(), {
  browsable: false,
})

const emit = defineEmits<{
  toggle: []
  'update:remote': [value: string]
  'update:remotePath': [value: string]
  browse: []
}>()

const { t } = useI18n({ useScope: 'global' })

const methodLabel = computed(() =>
  props.template.method === 'move' ? t('wizard.step4.method_move') : t('wizard.step4.method_keep'),
)

const triggerLabel = computed(() => {
  switch (props.template.trigger) {
    case 'deploy': return t('wizard.step4.trigger_deploy')
    case 'watch': return t('wizard.step4.trigger_watch')
    case 'manual': return t('wizard.step4.trigger_manual')
    default: return props.template.trigger
  }
})

function onPathChange(e: Event) {
  emit('update:remotePath', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <div
    class="sync-rule-card"
    :class="{ 'sync-rule-card--selected': selected }"
    @click="emit('toggle')"
  >
    <div class="sync-rule-card__check">
      <MsIcon v-if="selected" name="check" size="xs" color="none" />
    </div>
    <div class="sync-rule-card__name text-truncate">{{ template.name }}</div>
    <div class="sync-rule-card__method">{{ triggerLabel }} · {{ methodLabel }}</div>

    <!-- 远程存储 (仅 dashboard 多存储场景; wizard 单存储不传 options) -->
    <div v-if="remoteOptions.length > 0" class="sync-rule-card__field" @click.stop>
      <label>{{ t('wizard.step4.remote_label') }}</label>
      <BaseSelect
        :model-value="remote"
        :options="remoteOptions"
        size="sm"
        teleport
        @update:model-value="(v: string | number | boolean) => emit('update:remote', String(v))"
      />
    </div>

    <!-- 远程路径: 直输 + 目录选择器 -->
    <div class="sync-rule-card__field" @click.stop>
      <label>{{ t('wizard.step4.remote_path_label') }}</label>
      <div class="sync-rule-card__path">
        <input
          type="text"
          class="form-input sync-rule-card__input"
          :value="remotePath"
          :placeholder="t('wizard.step4.remote_path_placeholder')"
          spellcheck="false"
          @input="onPathChange"
          @click.stop
        >
        <BaseButton
          v-if="browsable"
          size="sm"
          icon-only
          class="sync-rule-card__browse"
          :aria-label="t('sync.dir.browse')"
          @click="emit('browse')"
        >
          <MsIcon name="folder_open" />
        </BaseButton>
      </div>
    </div>

    <div class="sync-rule-card__local text-truncate" :title="template.local_path">
      <MsIcon name="folder_open" size="xs" />
      {{ template.local_path }}
    </div>
  </div>
</template>

<style scoped>
.sync-rule-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 200px;
  max-width: 240px;
  flex-shrink: 0;
  padding: 14px;
  background: var(--bg3);
  border: 2px solid var(--bd);
  border-radius: var(--r);
  cursor: pointer;
  transition: border-color .2s, background .2s;
  user-select: none;
}

.sync-rule-card:hover {
  border-color: var(--ac);
}

.sync-rule-card--selected {
  border-color: var(--ac);
  background: color-mix(in srgb, var(--ac) 10%, var(--bg3));
}

.sync-rule-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--t3);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  background: var(--bg2);
  transition: all .2s;
  font-size: 12px;
}

.sync-rule-card__check:hover {
  border-color: var(--ac);
}

.sync-rule-card--selected .sync-rule-card__check {
  background: var(--ac);
  border-color: var(--ac);
  color: #fff;
}

.sync-rule-card__name {
  font-weight: 600;
  font-size: .88rem;
  color: var(--t1);
  padding-right: 24px;
}

.sync-rule-card__method {
  font-size: .72rem;
  color: var(--t3);
  margin-bottom: 2px;
}

.sync-rule-card__field {
  margin-bottom: 2px;
}

.sync-rule-card__field label {
  font-size: .72rem;
  color: var(--t3);
  display: block;
  margin-bottom: 2px;
}

.sync-rule-card__path {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.sync-rule-card__path .sync-rule-card__input {
  flex: 1;
  min-width: 0;
}

.sync-rule-card__input {
  padding: 4px 8px !important;
  font-size: .80rem !important;
}

.sync-rule-card__local {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .70rem;
  color: var(--t3);
  margin-top: 2px;
}
</style>
