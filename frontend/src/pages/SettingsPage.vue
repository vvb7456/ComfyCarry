<script setup lang="ts">
/**
 * 设置页 shell — TabSwitcher (路由跳转) + UnsavedBanner + 子 tab 路由出口。
 *
 * 各子 tab (pages/settings/SettingsTab*.vue) 自持表单状态, 通过
 * useSettingsGuard 注册 dirty 提供者; shell 在这里做统一拦截:
 *   1. tab 切换 (router push 前守卫)
 *   2. 路由离开 (onBeforeRouteLeave)
 *   3. 浏览器关闭/刷新 (beforeunload)
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import UnsavedBanner from '@/components/ui/UnsavedBanner.vue'
import LoadingCenter from '@/components/ui/LoadingCenter.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useSettingsGuard } from '@/composables/useSettingsGuard'

defineOptions({ name: 'SettingsPage' })

const { t } = useI18n({ useScope: 'global' })
const route = useRoute()
const router = useRouter()
const { confirm } = useConfirm()
const { post } = useApiFetch()
const { toast } = useToast()

const guardHub = useSettingsGuard()
const formDirty = guardHub.dirty
const formSaving = guardHub.saving

const activeTab = computed(() => {
  const seg = route.path.split('/')[2] || 'comfycarry'
  return seg
})

const tabs = computed(() => [
  { key: 'comfycarry', label: 'ComfyCarry', icon: 'dashboard' },
  { key: 'prompt', label: t('settings.prompt.tab_label'), icon: 'edit_note' },
  { key: 'civitai', label: 'CivitAI', icon: 'palette' },
  { key: 'llm', label: 'LLM', icon: 'smart_toy' },
  { key: 'sync', label: t('nav.sync'), icon: 'cloud_sync' },
  { key: 'tunnel', label: t('nav.tunnel'), icon: 'language' },
])

// ─── 统一拦截 ─────────────────────────────────────────────────────────────────

async function guardLeave(): Promise<boolean> {
  if (!guardHub.dirty.value) return true
  const result = await confirm({
    title: t('settings.unsaved.title'),
    message: t('settings.unsaved.message'),
    variant: 'danger',
    confirmText: t('common.btn.save'),
    altText: t('settings.unsaved.discard'),
    altVariant: 'danger',
    cancelText: t('settings.unsaved.cancel'),
  })
  if (result === true) return guardHub.save()
  if (result === 'alt') {
    await guardHub.discard()
    return true
  }
  return false
}

async function onTabChange(next: string) {
  if (next === activeTab.value) return
  if (!(await guardLeave())) return
  router.push({ name: `settings-${next}` })
}

// ─── 页头右上: 重启服务 (与其他服务页统一) ────────────────────────────────────

async function restartDashboard() {
  if (!await confirm({ message: t('settings.restart_confirm') })) return
  await post('/api/settings/restart', {})
  toast(t('settings.restarting'), 'info')
  setTimeout(() => location.reload(), 3000)
}

onBeforeRouteLeave(() => guardLeave())

// ─── beforeunload: 浏览器关闭/刷新拦截 (dirty 时注册, 否则移除) ───────────────

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!guardHub.dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}

watch(guardHub.dirty, (dirty) => {
  if (dirty) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div class="page-body">
    <TabSwitcher :title="t('settings.title')" :tabs="tabs" :model-value="activeTab" @update:model-value="onTabChange">
      <template #extra>
        <BaseButton size="sm" @click="restartDashboard">
          <MsIcon name="restart_alt" /> {{ t('settings.restart_btn') }}
        </BaseButton>
      </template>
    </TabSwitcher>

    <!-- 未保存守卫 banner (子 tab 表单 dirty 时显示) -->
    <UnsavedBanner
      :visible="formDirty"
      :message="t('settings.unsaved.message_banner')"
      :save-label="t('common.btn.save')"
      :discard-label="t('settings.unsaved.discard')"
      :saving="formSaving"
      @save="guardHub.save"
      @discard="guardHub.discard"
    />

    <!-- 子 tab 出口: Suspense + async setup, 数据就绪才渲染表单 (防默认值→当前值跳变);
         tab 间切换时默认保留旧内容直到新 tab resolve, 无闪烁 -->
    <router-view v-slot="{ Component }">
      <Suspense>
        <component :is="Component" />
        <template #fallback>
          <div class="tab-panel settings-centered">
            <LoadingCenter />
          </div>
        </template>
      </Suspense>
    </router-view>
  </div>
</template>