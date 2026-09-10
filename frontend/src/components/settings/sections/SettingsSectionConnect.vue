<script setup lang="ts">
/**
 * 设置分区: 连接与同步 — 目前仅剩余云同步域 (Tunnel 已迁入 Tunnel 页内设置, C04)。
 * 各域自持数据加载与卡片级保存, 本组件只做分区级拼装。
 */
import SettingsDomainSync from '@/components/settings/domains/SettingsDomainSync.vue'

defineOptions({ name: 'SettingsSectionConnect' })
</script>

<template>
  <SettingsDomainSync />
</template>
