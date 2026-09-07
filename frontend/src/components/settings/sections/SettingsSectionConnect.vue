<script setup lang="ts">
/**
 * 设置分区: 连接与同步 — Sync / Tunnel 两个功能域组合。
 * 各域自持数据加载与卡片级保存 (tunnel 为「应用隧道配置」), 本组件只做分区级拼装。
 */
import SettingsDomainSync from '@/components/settings/domains/SettingsDomainSync.vue'
import SettingsDomainTunnel from '@/components/settings/domains/SettingsDomainTunnel.vue'

defineOptions({ name: 'SettingsSectionConnect' })
</script>

<template>
  <SettingsDomainSync />
  <SettingsDomainTunnel />
</template>
