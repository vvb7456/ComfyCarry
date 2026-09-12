<script setup lang="ts">
/**
 * BrandIcon — 第三方品牌图标, API 与 MsIcon 对齐。
 *
 * 两种用法:
 *   - mono (默认): 根节点 span 用 CSS mask 指向单色 SVG, background: currentColor,
 *     颜色完全由外部 color 决定, 可像 MsIcon 一样跟随选中态/状态色;
 *   - color: span 内 <img>, 官方彩色原样展示, 用于“选择位”。
 *
 * 尺寸映射与 MsIcon 一致: xxs(12) | xs(16) | sm(18, default) | md(20) | lg(32) | xl(48),
 * 另接受 number 按 px 处理 (如 Hero 的 42)。
 *
 * 名称由 config/brand-icons.ts 的 BrandName 联合类型约束, 写错在 vue-tsc 即报错。
 * 素材来源与授权见 assets/brand/SOURCES.md。
 */
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

// 请求的 variant 没有素材时回退到存在的那个, 开发环境提示, 不抛错
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

/* 彩色变体不参与遮罩, 只在 span 里放官方原图 */
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
