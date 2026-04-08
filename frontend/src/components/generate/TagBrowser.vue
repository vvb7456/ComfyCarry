<script setup lang="ts">
/**
 * TagBrowser — 3-layer cascade tag browser (Group → Subgroup → Tag).
 *
 * Visual pattern: Each level uses the tab-panel fusion trick from ModuleTabs/SdxlTab:
 *   - Tab chips sit on top, active chip's bottom border merges with the panel below
 *   - Creates a visual "selected tab = connected to content" effect
 *
 * Data flow:
 *   - Groups are fetched once on mount via usePromptLibrary
 *   - Subgroups/tags are lazy-loaded on selection, cached in composable
 *   - Tag click emits `select` event to parent for insertion
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePromptLibrary } from '@/composables/generate/usePromptLibrary'
import { usePromptSettings } from '@/composables/generate/usePromptSettings'
import type { PromptSubgroup, PromptTag } from '@/types/prompt-library'
import FusionTabs from '@/components/ui/FusionTabs.vue'
import type { FusionTab } from '@/components/ui/FusionTabs.vue'
import Spinner from '@/components/ui/Spinner.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

defineOptions({ name: 'TagBrowser' })

const props = withDefaults(defineProps<{
  showTranslation?: boolean
}>(), {
  showTranslation: true,
})

const emit = defineEmits<{
  select: [tag: PromptTag]
}>()

const { t, locale } = useI18n({ useScope: 'global' })
const lib = usePromptLibrary()
const { settings: promptSettings } = usePromptSettings()

// ── State ──────────────────────────────────────────────────────
const selectedGroup = ref<number | null>(null)
const selectedSubgroup = ref<number | null>(null)
const subgroups = ref<PromptSubgroup[]>([])
const tags = ref<PromptTag[]>([])
const loadingSub = ref(false)
const loadingTags = ref(false)

// ── Fetch groups on mount ──────────────────────────────────────
onMounted(() => {
  lib.fetchGroups()
})

// ── When group changes → load subgroups ────────────────────────
watch(selectedGroup, async (id) => {
  selectedSubgroup.value = null
  subgroups.value = []
  tags.value = []
  if (!id) return
  loadingSub.value = true
  try {
    subgroups.value = await lib.fetchSubgroups(id)
  } finally {
    loadingSub.value = false
  }
})

// ── When subgroup changes → load tags ──────────────────────────
watch(selectedSubgroup, async (id) => {
  tags.value = []
  if (!id) return
  loadingTags.value = true
  try {
    tags.value = await lib.fetchTags(id)
  } finally {
    loadingTags.value = false
  }
})

// ── Actions ────────────────────────────────────────────────────
function onTagClick(tag: PromptTag) {
  emit('select', tag)
}

// ── FusionTab data ─────────────────────────────────────────────
const isZh = computed(() => locale.value.startsWith('zh'))

const groupTabs = computed<FusionTab[]>(() =>
  (lib.groups.value || [])
    .filter(g => promptSettings.show_nsfw || !g.is_nsfw)
    .map(g => ({
      key: g.id,
      label: props.showTranslation && isZh.value && g.translate ? g.translate : g.name,
      color: g.color,
    })),
)

const subgroupTabs = computed<FusionTab[]>(() =>
  subgroups.value.map(sg => ({
    key: sg.id,
    label: props.showTranslation && isZh.value && sg.translate ? sg.translate : sg.name,
    color: sg.color,
  })),
)
</script>

<template>
  <div class="tb">
    <!-- Level 1: Groups (wrapped FusionTabs) -->
    <FusionTabs
      v-model="selectedGroup"
      :tabs="groupTabs"
      :wrapped="true"
      panel-bg="var(--bg2)"
      min-height="160px"
    >
      <template #extra>
        <Spinner v-if="lib.loading.value" size="sm" />
      </template>

      <!-- L1 panel content -->
      <template v-if="selectedGroup">
        <div v-if="loadingSub" class="tb-loading">
          <Spinner size="sm" />
        </div>
        <template v-else-if="subgroups.length">
          <!-- Level 2: Subgroup tabs (bare FusionTabs) -->
          <FusionTabs
            v-model="selectedSubgroup"
            :tabs="subgroupTabs"
            size="sm"
            panel-bg="var(--bg)"
            class="tb-l2-tabs"
          />

          <!-- Level 2 panel (tag content) -->
          <div v-if="selectedSubgroup" class="tb-panel--l2">
            <div v-if="loadingTags" class="tb-loading">
              <Spinner size="sm" />
            </div>
            <template v-else-if="tags.length">
              <div class="tb-tag-grid">
                <button
                  v-for="tag in tags"
                  :key="tag.id"
                  class="tb-tag"
                  :class="{ 'tb-tag--has-desc': props.showTranslation && !!tag.translate }"
                  :style="{ '--chip-color': tag.color }"
                  :title="props.showTranslation ? (tag.translate || tag.text) : tag.text"
                  @click="onTagClick(tag)"
                >
                  <span class="tb-tag-top">{{ tag.text }}</span>
                  <span v-if="props.showTranslation && tag.translate" class="tb-tag-bot">{{ tag.translate }}</span>
                </button>
              </div>
            </template>
            <div v-else class="tb-empty">{{ t('prompt-library.tag_browser.no_tags') }}</div>
          </div>
        </template>
        <div v-else class="tb-empty">{{ t('prompt-library.tag_browser.no_subgroups') }}</div>
      </template>

      <!-- Empty state: no group selected -->
      <EmptyState
        v-else
        icon="category"
        :message="t('prompt-library.tag_browser.hint')"
        density="compact"
        class="tb-empty-state"
      />
    </FusionTabs>
  </div>
</template>

<style scoped>
.tb {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

/* ── L2 tabs (inside L1 panel, inherits bg2) ── */
.tb-l2-tabs {
  padding: var(--sp-2) var(--sp-3) 0;
}

/* ═══ Level 2 panel (tag content area) ═══ */
.tb-panel--l2 {
  flex: 1;
  background: var(--bg);
}

/* EmptyState fills panel for vertical centering */
.tb-empty-state {
  flex: 1;
}

/* ── Tag grid ── */
.tb-tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: var(--sp-3);
}

/* ── Tag chip (level 3, vertical two-row) ── */
.tb-tag {
  --chip-color: var(--t3);
  display: inline-flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--chip-color) 30%, var(--bd));
  border-radius: var(--r-sm);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  transition: border-color .12s, transform .1s;
}

.tb-tag:hover {
  border-color: color-mix(in srgb, var(--chip-color) 50%, var(--bd));
  transform: translateY(-1px);
}

.tb-tag:active {
  transform: scale(.97);
}

/* Top row: theme color bg + tag text */
.tb-tag-top {
  display: block;
  padding: 3px 10px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--t1);
  background: color-mix(in srgb, var(--chip-color) 18%, var(--bg3));
  line-height: 1.4;
}

/* Bottom row: standard bg + translation */
.tb-tag-bot {
  display: block;
  padding: 2px 10px 3px;
  font-size: var(--text-xs);
  color: var(--t2);
  background: var(--bg2);
  border-top: 1px solid color-mix(in srgb, var(--chip-color) 15%, var(--bd));
  line-height: 1.4;
}

/* When no translation, single row looks cleaner */
.tb-tag:not(.tb-tag--has-desc) .tb-tag-top {
  padding: 4px 10px;
}

/* ── States ── */
.tb-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
}

.tb-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  text-align: center;
  color: var(--t3);
  font-size: var(--text-sm);
}
</style>
