<script setup lang="ts">
import { computed } from 'vue'
import { BRAND_ASSETS, type BrandAsset, type BrandName } from '@/config/brand-icons'

defineOptions({ name: 'BrandIcon' })

const props = withDefaults(defineProps<{
  name: BrandName
  variant?: 'mono' | 'color'
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
}>(), {
  variant: 'mono',
  size: 'sm',
})

const asset = computed<BrandAsset>(() => BRAND_ASSETS[props.name])

const resolvedVariant = computed<'mono' | 'color'>(() => {
  const a = asset.value
  if (props.variant === 'mono' ? a.mono : a.color) return props.variant
  const fallback: 'mono' | 'color' = a.mono ? 'mono' : 'color'
  if (import.meta.env.DEV) {
    console.warn(`[BrandIcon] 品牌 "${props.name}" 缺少 ${props.variant} 素材, 回退到 ${fallback}`)
  }
  return fallback
})

const sizeClass = computed(() =>
  typeof props.size === 'string' ? `brand-icon--${props.size}` : '',
)

const sizeStyle = computed(() =>
  typeof props.size === 'number' ? { width: `${props.size}px`, height: `${props.size}px` } : undefined,
)

const monoStyle = computed(() => {
  const url = asset.value.mono
  return {
    ...(sizeStyle.value ?? {}),
    maskImage: `url("${url}")`,
    WebkitMaskImage: `url("${url}")`,
  }
})
</script>

<template>
  <span
    v-if="resolvedVariant === 'mono'"
    class="brand-icon"
    :class="sizeClass"
    :style="monoStyle"
    aria-hidden="true"
  />
  <span
    v-else
    class="brand-icon brand-icon--img"
    :class="sizeClass"
    :style="sizeStyle"
  >
    <img :src="asset.color" alt="" class="brand-icon__img">
  </span>
</template>

<style scoped>
.brand-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

.brand-icon--img {
  background-color: transparent;
  -webkit-mask-image: none;
  mask-image: none;
}

.brand-icon__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.brand-icon--xxs { width: 12px; height: 12px; }
.brand-icon--xs { width: 16px; height: 16px; }
.brand-icon--sm { width: 18px; height: 18px; }
.brand-icon--md { width: 20px; height: 20px; }
.brand-icon--lg { width: 32px; height: 32px; }
.brand-icon--xl { width: 48px; height: 48px; }
</style>
