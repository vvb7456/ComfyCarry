<script setup lang="ts">
/**
 * 设置页 — 单分区单页 (设置域陆续回迁各功能页后, 本页仅剩面板级内容):
 *   面板 (登录与认证 / 配置管理) + 关于 (关于与更新, 原独立尾分区并入正文)。
 *
 * 页头与其他服务页同构: 标题 + 重启按钮, 无 tab 导航、无 scrollspy、无离开守卫
 * (剩余模块均为即时动作, 无草稿态)。
 */
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import SettingsSectionPanel from '@/components/settings/sections/SettingsSectionPanel.vue'
import SettingsAboutFooter from '@/components/settings/sections/SettingsAboutFooter.vue'

defineOptions({ name: 'SettingsPage' })

const { t } = useI18n({ useScope: 'global' })
const { confirm } = useConfirm()
const { post } = useApiFetch()
const { toast } = useToast()

// ─── 页头右上: 重启服务 (与其他服务页统一) ────────────────────────────────────

async function restartDashboard() {
  if (!await confirm({
    title: t('settings.confirm.restart.title'),
    message: t('settings.confirm.restart.message'),
    confirmText: t('common.btn.restart'),
  })) return
  // 失败已由 useApiFetch 提示; 不要再报"正在重启"并刷新页面
  if (!await post('/api/settings/restart', {})) return
  toast(t('settings.restarting'), 'info')
  setTimeout(() => location.reload(), 3000)
}
</script>

<template>
  <div class="page-body">
    <div class="page-header-row">
      <div class="page-title-wrap">
        <h1 class="page-title">{{ t('settings.title') }}</h1>
      </div>
      <span class="page-header-row__spacer" />
      <BaseButton variant="ghost" size="sm" :aria-label="t('settings.confirm.restart.title')" @click="restartDashboard">
        <MsIcon name="restart_alt" /> {{ t('settings.restart_btn') }}
      </BaseButton>
    </div>

    <!-- 正文: 760px 限宽列 (与原设置分区一致), 关于并入正文顺排 -->
    <div class="settings-page-col page-col">
      <!-- 面板: 登录与认证 / 配置管理 (即时动作, 无草稿态) -->
      <SettingsSectionPanel />

      <!-- 关于与更新 (原独立尾分区) -->
      <SettingsAboutFooter />
    </div>
  </div>
</template>

<style scoped>
/* 原设置分区正文限宽; page-col (1080) 兜底, 这里收紧到原值 */
.settings-page-col {
  max-width: 760px;
}

/* 模块间距 (原分区体系 .settings-module 间距规则的延续);
   SettingsSectionPanel 为 fragment, 模块平铺为本容器直接子元素 */
.settings-page-col :deep(.settings-module + .settings-module) {
  margin-top: 32px;
}

/* 关于并入正文: 与上方模块拉开分组间距 (原尾分区 72px 间距的延续) */
.settings-page-col > :deep(.about-content) {
  margin-top: 72px;
}
</style>
