<script setup lang="ts">
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
