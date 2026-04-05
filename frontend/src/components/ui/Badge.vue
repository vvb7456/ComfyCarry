<script setup lang="ts">
/**
 * Badge — lightweight color-coded tag.
 *
 * Pass `color` for an explicit text color (background auto-generates at 20% opacity).
 * Omit `color` for a neutral/muted appearance.
 *
 * Usage:
 *   <Badge color="#f472b6">CHECKPOINTS</Badge>
 *   <Badge>Illustrious</Badge>
 */
defineOptions({ name: 'Badge' })

defineProps<{
  color?: string
}>()
</script>

<template>
  <span
    class="badge"
    :class="{ 'badge--muted': !color }"
    :style="color ? { color, background: `color-mix(in srgb, ${color} 15%, transparent)` } : undefined"
  >
    <slot />
  </span>
</template>

<style scoped>
.badge {
  font-size: .75rem;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
  line-height: 1.5;
}
.badge--muted {
  background: rgba(100, 116, 139, .15);
  color: var(--t2);
}
</style>
