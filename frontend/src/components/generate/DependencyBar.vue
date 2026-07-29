<script setup lang="ts">
/**
 * DependencyBar — 依赖状态条 (三态: 就绪 / 缺失 / 下载中)。
 *
 * 运行组件、ControlNet、放大、面部修复、反推共用这一个组件: 折叠态一行说清状态,
 * 展开态逐项管理, 下载全程可见且不挡住用户干别的。形态差异全部由 props 表达,
 * 本组件不认识任何具体模块, 也不发起任何请求 —— 状态由父组件传入的 status 句柄提供。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseDependencyStatusReturn, DepRowStatus } from '@/composables/generate/useDependencyStatus'
import MsIcon from '@/components/ui/MsIcon.vue'
import Badge from '@/components/ui/Badge.vue'
import Spinner from '@/components/ui/Spinner.vue'
import DownloadButton from '@/components/models/DownloadButton.vue'
import type { VersionState } from '@/composables/useDownloads'

defineOptions({ name: 'DependencyBar' })

const props = defineProps<{
  /** 由父组件持有的依赖状态句柄 */
  status: UseDependencyStatusReturn
  /** 该组依赖的称呼, 进文案 (如 "运行组件" / "姿势控制模型") */
  noun: string
  /** 展开状态 (v-model:expanded) */
  expanded?: boolean
}>()

const emit = defineEmits<{ 'update:expanded': [boolean] }>()

const { t } = useI18n({ useScope: 'global' })

const s = props.status

// ── 三态判定 (互斥): downloading > missing > ready ──────────────────────────

const isDownloading = computed(() => s.downloading.value)
const hasMissing = computed(() => !s.ready.value)
// 首次体检未回来 = 骨架态。占位行此时已就位 (rows 非空), 故不能用 rows.length 判定
const showSkeleton = computed(() => !s.checked.value)

// ── 文案 ────────────────────────────────────────────────────────────────────

const readyText = computed(() =>
  t('generate.dep.ready', { noun: props.noun, n: s.rows.value.length }),
)

const missingText = computed(() =>
  t('generate.dep.missing', { noun: props.noun, n: s.missing.value.length }),
)

const downloadingText = computed(() => {
  const c = s.current.value
  if (!c) return t('generate.dep.downloading', { i: 0, n: 0, name: '' })
  return t('generate.dep.downloading', { i: c.index + 1, n: c.total, name: c.name })
})

// ── 体积 ────────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB'
  return Math.round(bytes / 1e6) + ' MB'
}

/** 行体积文本: 有精确字节用字节, 否则用配置里的展示文本 */
function rowSize(r: DepRowStatus): string {
  if (typeof r.row.bytes === 'number') return fmtSize(r.row.bytes)
  return r.row.sizeText || ''
}

// ── 交互 ────────────────────────────────────────────────────────────────────

function toggleExpand() {
  emit('update:expanded', !props.expanded)
}

/** 行状态 → 模型页下载按钮的状态机 (进度/spinner/hover 取消都由它管) */
function rowState(r: DepRowStatus): VersionState {
  if (r.installed) return 'installed'
  if (r.downloading) return 'downloading'
  if (r.failed) return 'failed'
  return 'idle'
}
</script>

<template>
  <div class="dep-bar">
    <!-- ═══ 折叠态 ═══ -->

    <div v-if="showSkeleton" class="dep-row dep-row--skeleton">
      <Spinner size="xs" />
      <span class="dep-row__txt dep-row__txt--muted">{{ t('generate.dep.detecting') }}</span>
      <span class="dep-row__arr">›</span>
    </div>

    <!-- 下载中 -->
    <div v-else-if="isDownloading" class="dep-row dep-row--downloading" @click="toggleExpand">
      <MsIcon name="download" size="sm" color="var(--ac)" />
      <span class="dep-row__txt">{{ downloadingText }}</span>
      <span class="dep-row__arr" :class="{ 'dep-row__arr--open': expanded }">›</span>
    </div>

    <!-- 缺失 -->
    <div v-else-if="hasMissing" class="dep-row dep-row--missing" @click="toggleExpand">
      <MsIcon name="error" size="sm" color="var(--amber)" />
      <span class="dep-row__txt">{{ missingText }}</span>
      <span class="dep-row__arr" :class="{ 'dep-row__arr--open': expanded }">›</span>
    </div>

    <!-- 就绪 -->
    <div v-else class="dep-row dep-row--ready" @click="toggleExpand">
      <MsIcon name="check_circle" size="sm" color="var(--green)" />
      <span class="dep-row__txt dep-row__txt--muted">{{ readyText }}</span>
      <span class="dep-row__arr" :class="{ 'dep-row__arr--open': expanded }">›</span>
    </div>

    <!-- ═══ 展开态明细 ═══ -->
    <transition name="dep-expand">
      <div v-if="expanded" class="dep-detail">
        <!-- 逐行 -->
        <div v-for="r in s.rows.value" :key="r.row.id" class="dep-file">
          <div class="dep-file__row">
            <!-- 统一行式: badge · 名称 · 大小 · 简介 -->
            <Badge :color="r.row.required ? 'var(--amber)' : undefined">
              {{ t(r.row.required ? 'generate.dep.required' : 'generate.dep.optional') }}
            </Badge>
            <span class="dep-file__label">{{ r.row.label }}</span>
            <span v-if="rowSize(r)" class="dep-file__size">{{ rowSize(r) }}</span>
            <span v-if="r.row.hint" class="dep-file__hint">{{ r.row.hint }}</span>

            <span class="dep-file__status">
              <!-- 与模型页同一个下载按钮: 进度环 / spinner / hover 取消 -->
              <DownloadButton
                :state="rowState(r)"
                :progress="r.percent"
                :speed="r.speed"
                cancellable
                size="xs"
                @download="s.downloadRow(r.row.id)"
                @cancel="s.cancelRow(r.row.id)"
              />
            </span>
          </div>
        </div>

        <div v-if="s.error.value" class="dep-detail__error">{{ s.error.value }}</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.dep-bar {
  display: flex;
  flex-direction: column;
  border-radius: var(--r-md);
  background: var(--bg2);
  border: 1px solid var(--bd);
  overflow: hidden;
}

/* ═══ 折叠态单行 ═══ */
.dep-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 10px;
  font-size: .8rem;
  cursor: pointer;
  user-select: none;
  transition: background .15s;
}
.dep-row:hover { background: var(--bg3); }

.dep-row__txt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dep-row__txt--muted { color: var(--t2); }

.dep-row__arr {
  color: var(--t3);
  font-size: 1rem;
  line-height: 1;
  flex: none;
  transition: transform .2s ease;
}
.dep-row__arr--open { transform: rotate(90deg); }

.dep-row--downloading {
  background: color-mix(in srgb, var(--ac) 8%, var(--bg2));
  color: var(--ac2);
}
.dep-row--downloading:hover { background: color-mix(in srgb, var(--ac) 12%, var(--bg2)); }

.dep-row--missing {
  background: color-mix(in srgb, var(--amber) 10%, var(--bg2));
  color: var(--t2);
}

.dep-row--ready { color: var(--t2); }

.dep-row--skeleton {
  cursor: default;
  color: var(--t3);
}
.dep-row--skeleton:hover { background: var(--bg2); }

/* ═══ 展开明细 ═══ */
.dep-detail {
  border-top: 1px solid var(--bd);
  padding: var(--sp-2) var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  background: var(--bg2);
}


/* 逐行 —— 分隔线画在「后一条的顶部」 */
.dep-file { padding: 4px 0; }
.dep-file + .dep-file {
  border-top: 1px solid color-mix(in srgb, var(--bd) 50%, transparent);
}

.dep-file__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dep-file__label {
  font-weight: 500;
  color: var(--t1);
  font-size: .8rem;
}
.dep-file__hint {
  color: var(--t3);
  font-size: .72rem;
}
.dep-file__size {
  color: var(--t3);
  font-size: .72rem;
  white-space: nowrap;
}
.dep-file__status {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dep-detail__error {
  color: var(--red);
  font-size: .75rem;
  padding: 4px 0;
}

/* ═══ 展开/收起过渡 ═══ */
.dep-expand-enter-active,
.dep-expand-leave-active {
  transition: opacity .2s ease, max-height .25s ease;
  max-height: 600px;
  overflow: hidden;
}
.dep-expand-enter-from,
.dep-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

/* ═══ 移动端 ═══ */
@media (max-width: 600px) {
  .dep-file__row { flex-wrap: wrap; }
  .dep-file__status { margin-left: 0; width: 100%; }
}
</style>
