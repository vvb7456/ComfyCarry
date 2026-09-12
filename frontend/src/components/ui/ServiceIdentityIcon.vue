<script setup lang="ts">
/**
 * ServiceIdentityIcon — 按 config/serviceIdentity.ts 渲染服务身份图标。
 *
 * 有品牌 mark 时渲染 BrandIcon (mono), 否则渲染 MsIcon; 供侧栏、服务卡、
 * 诊断行、隧道服务行等复用, 避免各页重复 v-if。
 */
import { computed } from 'vue'
import BrandIcon from './BrandIcon.vue'
import MsIcon from './MsIcon.vue'
import { serviceIdentity } from '@/config/serviceIdentity'
import type { IconName } from '@/config/icon-codepoints'

defineOptions({ name: 'ServiceIdentityIcon' })

const props = defineProps<{
  service: string
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** 未知服务名的 MsIcon 后备 (默认 dns) */
  fallback?: IconName
}>()

const identity = computed(() => serviceIdentity(props.service, props.fallback))
</script>

<template>
  <BrandIcon v-if="identity.brand" :name="identity.brand" :size="size" />
  <MsIcon v-else-if="identity.icon" :name="identity.icon" :size="size" />
</template>
