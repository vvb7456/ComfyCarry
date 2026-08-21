<script setup lang="ts">
/**
 * UnsavedBanner — 表单未保存守卫的顶部提示条。
 * 仅承担展示：dirty 时显示, 内含「保存(saveLabel)」「放弃更改」两个按钮。
 * 守卫逻辑见 useUnsavedGuard, 文案由调用方传入 (按页语义区分)。
 */
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

defineOptions({ name: 'UnsavedBanner' })

const props = withDefaults(defineProps<{
  visible: boolean
  /** 提示正文 (如"存在未保存的更改...") */
  message: string
  /** 保存按钮文本 (如"保存" / "保存并重启"), 默认用 common.btn.save */
  saveLabel?: string
  /** 放弃按钮文本, 默认 common.btn.* 无对应, 用调用方传入的 discardLabel */
  discardLabel?: string
  saving?: boolean
  /** banner 是否吸附 (页面级 sticky); modal 内传 false */
  sticky?: boolean
}>(), {
  saving: false,
  sticky: true,
})

const emit = defineEmits<{
  save: []
  discard: []
}>()
</script>

<template>
  <div
    v-if="visible"
    class="unsaved-banner"
    :class="{ 'unsaved-banner--sticky': sticky }"
  >
    <div class="unsaved-banner__row">
      <span class="unsaved-banner__msg">{{ message }}</span>
      <div class="unsaved-banner__actions">
        <BaseButton size="sm" :disabled="saving" @click="emit('discard')">
          {{ discardLabel }}
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          <MsIcon name="restart_alt" size="xs" color="none" />
          {{ saveLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unsaved-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--rs);
  font-size: .82rem;
  line-height: 1.5;
  background: color-mix(in srgb, var(--c-caution) 8%, var(--bg3));
  border: 1px solid color-mix(in srgb, var(--c-caution) 25%, var(--bd));
  color: var(--c-caution);
  margin-bottom: var(--sp-3);
}

/* 吸附在 TabSwitcher 下方: header + TabSwitcher 总高 + 间距 (变量见 layout.css) */
.unsaved-banner--sticky {
  position: sticky;
  top: calc(var(--page-header-h) + var(--page-body-pt) + var(--tab-switcher-row-h) + var(--sp-3));
  z-index: 9;
}

.unsaved-banner__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  width: 100%;
}

.unsaved-banner__msg {
  flex: 1;
  min-width: 0;
}

.unsaved-banner__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
}
</style>
