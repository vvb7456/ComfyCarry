<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MsIcon from '@/components/ui/MsIcon.vue'

export interface CheckpointInfo {
  name: string
  displayName: string
  previewUrl?: string | null
  arch?: string
}

defineProps<{
  selected: CheckpointInfo | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  open: []
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div
    class="ckpt-selector"
    :class="{ 'ckpt-selector--disabled': disabled }"
    @click="emit('open')"
  >
    <!-- Empty state -->
    <div v-if="!selected" class="ckpt-empty">
      <span class="ckpt-empty__icon">+</span>
      <span class="ckpt-empty__text">{{ t('generate.basic.select_checkpoint') }}</span>
    </div>

    <!-- Selected state -->
    <div v-else class="ckpt-card">
      <div class="ckpt-card__img">
        <img
          v-if="selected.previewUrl"
          :src="selected.previewUrl"
          alt=""
          loading="lazy"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <div v-if="!selected.previewUrl" class="ckpt-card__no-img">
          <MsIcon name="deployed_code" size="lg" color="none" />
        </div>
      </div>
      <div class="ckpt-card__info">
        <div class="ckpt-card__name" :title="selected.displayName">{{ selected.displayName }}</div>
        <span class="ckpt-card__hint">{{ t('generate.basic.click_change') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ckpt-selector {
  cursor: pointer;
  border-radius: var(--r-md);
  overflow: hidden;
  transition: all .15s;
}

.ckpt-selector--disabled {
  opacity: .55;
  pointer-events: none;
}

/* ── Empty state ── */
.ckpt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 160px;
  background: var(--bg2);
  border: 2px dashed var(--bd);
  border-radius: var(--r-md);
  color: var(--t2);
  font-size: .9rem;
}

.ckpt-empty__icon {
  font-size: 1.5rem;
  font-weight: bold;
}

.ckpt-selector:hover .ckpt-empty {
  border-color: var(--ac);
  color: var(--ac);
}

/* ── Selected card ── */
.ckpt-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg2);
}

.ckpt-selector:hover .ckpt-card {
  border-color: var(--ac);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .1);
}

.ckpt-card__img {
  position: relative;
  width: 100%;
  height: 120px;
  background: var(--bg3);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.ckpt-card__img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ckpt-card__no-img {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3);
  opacity: .3;
}

.ckpt-card__info {
  padding: 0 10px 8px;
  min-width: 0;
}

.ckpt-card__name {
  font-size: .88rem;
  font-weight: 500;
  color: var(--t1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ckpt-card__hint {
  font-size: .7rem;
  color: var(--t3);
  margin-top: 2px;
}
</style>
