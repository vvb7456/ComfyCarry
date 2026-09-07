<script setup lang="ts">
/**
 * 设置分区: 生成与模型 — Prompt / LLM / CivitAI 三个功能域组合。
 * 各域自持数据加载与卡片级保存, 本组件只做分区级拼装。
 */
import SettingsDomainPrompt from '@/components/settings/domains/SettingsDomainPrompt.vue'
import SettingsDomainLlm from '@/components/settings/domains/SettingsDomainLlm.vue'
import SettingsDomainCivitai from '@/components/settings/domains/SettingsDomainCivitai.vue'

defineOptions({ name: 'SettingsSectionGenModels' })
</script>

<template>
  <SettingsDomainPrompt />
  <SettingsDomainLlm />
  <SettingsDomainCivitai />
</template>
