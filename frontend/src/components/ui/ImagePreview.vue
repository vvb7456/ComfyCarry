<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import MsIcon from './MsIcon.vue'

defineOptions({ name: 'ImagePreview' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  images: string[]
  initialIndex?: number
}>(), {
  initialIndex: 0,
})

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const idx = ref(0)
const loaded = ref(false)

const src = computed(() => props.images[idx.value] || '')
const total = computed(() => props.images.length)
const hasNav = computed(() => total.value > 1)
const isVideo = computed(() => /\.(mp4|webm|mov|avi)(\?|$)/i.test(src.value))

watch(() => props.modelValue, (open) => {
  if (open) {
    idx.value = Math.max(0, Math.min(props.initialIndex, total.value - 1))
    loaded.value = false
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

function close() { emit('update:modelValue', false) }

function prev() {
  if (idx.value > 0) { idx.value--; loaded.value = false }
}

function next() {
  if (idx.value < total.value - 1) { idx.value++; loaded.value = false }
}

function onKey(e: KeyboardEvent) {
  if (!props.modelValue) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ip-fade">
      <div v-if="modelValue" class="ip-overlay" @click.self="close">
        <!-- Close button -->
        <button class="ip-close" @click="close" aria-label="Close">
          <MsIcon name="close" />
        </button>

        <!-- Left arrow -->
        <button v-if="hasNav" class="ip-arrow ip-arrow--left" :disabled="idx === 0" @click="prev">
          <MsIcon name="chevron_left" />
        </button>

        <!-- Media wrapper -->
        <div class="ip-frame">
          <video
            v-if="isVideo"
            :key="`video:${src}`"
            :src="src"
            controls autoplay loop muted playsinline disablepictureinpicture
            controlslist="nodownload noplaybackrate nofullscreen"
            class="ip-media"
            :class="{ 'ip-media--loaded': loaded }"
            @loadeddata="loaded = true"
          />
          <img
            v-else
            :key="`image:${src}`"
            :src="src"
            alt=""
            class="ip-media"
            :class="{ 'ip-media--loaded': loaded }"
            @load="loaded = true"
          />
          <div v-if="!loaded" class="ip-loader">
            <MsIcon name="hourglass_empty" size="lg" />
          </div>
        </div>

        <!-- Right arrow -->
        <button v-if="hasNav" class="ip-arrow ip-arrow--right" :disabled="idx >= total - 1" @click="next">
          <MsIcon name="chevron_right" />
        </button>

        <!-- Counter -->
        <div v-if="hasNav" class="ip-counter">{{ idx + 1 }} / {{ total }}</div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Overlay */
.ip-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .82);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

/* Fade transition */
.ip-fade-enter-active,
.ip-fade-leave-active { transition: opacity .2s ease; }
.ip-fade-enter-from,
.ip-fade-leave-to { opacity: 0; }

/* Close button */
.ip-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, .12);
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  transition: background .15s;
  z-index: 2;
}
.ip-close:hover { background: rgba(255, 255, 255, .25); }

/* Image frame — adapts to image natural size */
.ip-frame {
  position: relative;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: var(--rs, 8px);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .5);
  border: 2px solid rgba(255, 255, 255, .1);
  background: var(--bg2, #1a1a2e);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ip-media {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  width: auto;
  height: auto;
  object-fit: contain;
  opacity: 0;
  transition: opacity .2s;
}
.ip-media--loaded { opacity: 1; }

.ip-loader {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t3, #888);
  min-width: 200px;
  min-height: 200px;
}

/* Navigation arrows */
.ip-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, .1);
  border: none;
  border-radius: 50%;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
  transition: background .15s, opacity .15s;
  z-index: 2;
}
.ip-arrow:hover:not(:disabled) { background: rgba(255, 255, 255, .25); }
.ip-arrow:disabled { opacity: .25; cursor: default; }
.ip-arrow--left { left: 20px; }
.ip-arrow--right { right: 20px; }

/* Counter */
.ip-counter {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 14px;
  background: rgba(0, 0, 0, .5);
  border-radius: 12px;
  color: rgba(255, 255, 255, .8);
  font-size: .82rem;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
</style>
