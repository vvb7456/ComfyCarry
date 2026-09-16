<script setup lang="ts">
/**
 * AddStorageModal — dashboard「添加存储」弹窗薄壳。
 *
 * 流程主体在 AddStorageFlow (两态: 类型 → 连接), 本组件只负责 BaseModal 包装。
 * 凭据全程零落盘, 关闭即丢弃 —— 无关闭守卫; 仅在关闭路径上清理未完成的
 * OAuth 授权会话 (经 flow.cleanupSession, done 会话留给 create 消费)。
 *
 * wizard 不复用本组件 —— 其 step3 已将流程原生化为向导 step (StepRclone)。
 */
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/ui/BaseModal.vue'
import AddStorageFlow from '@/components/sync/AddStorageFlow.vue'
import type { RemoteTypeDef } from '@/types/sync'

defineOptions({ name: 'AddStorageModal' })

const props = withDefaults(defineProps<{
  /** 弹窗开关 */
  modelValue?: boolean
  /** 现有存储列表 (查重 / 覆盖确认) */
  existingRemotes?: Array<{ name: string; type: string }>
  /** 远端类型定义表 */
  remoteTypes?: Record<string, RemoteTypeDef>
  /** 重连预填: 打开时自动选中对应 provider 并恢复名称/同步文件夹/存储桶 */
  preset?: { type?: string; name?: string; root_dir?: string; bucket?: string }
}>(), {
  modelValue: false,
  existingRemotes: () => [],
  remoteTypes: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 存储已创建 (透传自 flow; openRuleModal = 点了「保存并创建规则」) */
  created: [remote: { name: string; type: string; openRuleModal: boolean }]
  /** 关闭事件 */
  close: []
}>()

const { t } = useI18n({ useScope: 'global' })

const flowRef = ref<InstanceType<typeof AddStorageFlow> | null>(null)

function onFlowCancel() {
  emit('update:modelValue', false)
  emit('close')
}

function onFlowCreated(remote: { name: string; type: string; openRuleModal: boolean }) {
  emit('created', remote)
  emit('update:modelValue', false)
  emit('close')
}

// 弹窗关闭时清理未完成的 OAuth 授权会话 (凭据零落盘, 关闭即丢弃)
watch(() => props.modelValue, (open, wasOpen) => {
  if (!open && wasOpen) flowRef.value?.cleanupSession()
})

onUnmounted(() => {
  flowRef.value?.cleanupSession()
})
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="t('sync.remote.add')"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <AddStorageFlow
      ref="flowRef"
      :existing-remotes="existingRemotes"
      :remote-types="remoteTypes"
      :preset="preset"
      @created="onFlowCreated"
      @cancel="onFlowCancel"
    />
  </BaseModal>
</template>