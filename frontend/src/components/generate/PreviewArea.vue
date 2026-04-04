<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PreviewImage } from '@/composables/generate/useGeneratePreview'
import MsIcon from '@/components/ui/MsIcon.vue'

defineOptions({ name: 'PreviewArea' })

defineProps<{
  images: PreviewImage[]
  loading: boolean
  currentPreview: string | null
}>()

const emit = defineEmits<{
  clickImage: [url: string]
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div class="gen-preview-card">
    <!-- Loading spinner -->
    <div v-if="loading" class="gen-preview-loading">
      <div class="preview-spinner" />
    </div>

    <!-- Output images -->
    <template v-else-if="images.length > 0">
      <div v-if="images.length === 1" class="gen-preview-single">
        <img :src="images[0].url" alt="Generated" @click="emit('clickImage', images[0].url)" />
      </div>
      <div v-else class="gen-preview-grid">
        <img
          v-for="(img, i) in images"
          :key="i"
          :src="img.url"
          alt="Generated"
          @click="emit('clickImage', img.url)"
        />
      </div>
    </template>

    <!-- Live preview frame -->
    <div v-else-if="currentPreview" class="gen-preview-single">
      <img :src="currentPreview" alt="Preview" class="preview-live" />
    </div>

    <!-- Empty state -->
    <div v-else class="gen-preview-empty">
      <MsIcon name="image" color="none" class="preview-icon" />
      <span class="preview-hint">{{ t('generate.preview.empty') }}</span>
    </div>
  </div>
</template>

<style scoped>
.gen-preview-card {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg3);
  border: 1px solid var(--bd);
  border-radius: var(--r-lg);
  padding: 0;
}

/* Loading */
.gen-preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--bd);
  border-top-color: var(--ac);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Single image */
.gen-preview-single {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-2);
}
.gen-preview-single img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
  border-radius: var(--r-md);
  transition: opacity .2s;
}
.gen-preview-single img:hover { opacity: .9; }

/* Grid for batch */
.gen-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--sp-2);
  padding: var(--sp-2);
  height: 100%;
  overflow-y: auto;
}
.gen-preview-grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  cursor: pointer;
  border-radius: var(--r-md);
  transition: opacity .2s;
}
.gen-preview-grid img:hover { opacity: .9; }

/* Live preview */
.preview-live { opacity: 0.85; cursor: default; }
.preview-live:hover { opacity: 0.85; }

/* Empty state */
.gen-preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-6);
}
.preview-icon { font-size: 3.5rem; color: var(--t3); opacity: .2; }
.preview-hint { font-size: .85rem; color: var(--t3); }
</style>
