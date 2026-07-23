<script setup lang="ts">
/**
 * ComponentPanel — 运行组件内联折叠面板 (三态)。
 *
 * 拆分形态 (UNet + 文本编码器 + VAE) 的模型需要外挂"运行组件"。
 * 本面板挂在主页左列、模型卡正下方: 折叠态一行说清状态，展开态逐项管理，
 * 下载全程可见且不阻塞用户干别的。状态由父组件通过 `status` prop 传入，
 * 本组件不创建 useComponentStatus 实例、不发起任何 fetch/axios 调用。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UseComponentStatusReturn, ComponentFileStatus } from '@/composables/generate/useComponentStatus'
import { componentsForSlot } from '@/config/component-registry'
import { MODEL_TYPES } from '@/config/model-types'
import MsIcon from '@/components/ui/MsIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { fmtSpeed } from '@/utils/format'

defineOptions({ name: 'ComponentPanel' })

const props = defineProps<{
  /** 架构 key (MODEL_TYPES 的 key) */
  arch: string
  /** 由父组件持有的组件状态句柄 */
  status: UseComponentStatusReturn
  /** 当前选中模型的打包形态 */
  packaging: 'checkpoint' | 'split'
  /** 展开状态 (v-model:expanded, 父组件可强制展开) */
  expanded?: boolean
}>()

const emit = defineEmits<{ 'update:expanded': [boolean] }>()

const { t } = useI18n({ useScope: 'global' })

// ── 派生展示值 ─────────────────────────────────────────────────────────────

const s = props.status
const archLabel = computed(() => MODEL_TYPES[props.arch]?.label ?? props.arch)

/** 三态判定 (互斥): downloading > missing > ready。loading 占位独立处理。 */
const isDownloading = computed(() => s.downloading.value)
const hasMissing = computed(() => s.missing.value.length > 0)
const isReady = computed(() => s.ready.value)
const showSkeleton = computed(() => s.loading.value && s.files.value.length === 0)

// ── 体积格式化 (规格: >=1e9 → X.XX GB, 否则 XXX MB) ──────────────────────────

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB'
  return Math.round(bytes / 1e6) + ' MB'
}

// ── 角色推导 helper ─────────────────────────────────────────────────────────
// registry 里没有直接 role 字段, 用 componentsForSlot(arch, slot) 对三个 slot
// 逐个查, 看该文件的 id 落在哪个 slot, 映射到对应 i18n key。

function roleKeyFor(fileId: string): string | null {
  const arch = props.arch
  const inClip = componentsForSlot(arch, 'clip').some(f => f.id === fileId)
  if (inClip) {
    // 该架构有 clip2 → clip 是"文本编码器 1", 否则是唯一的"文本编码器"
    return componentsForSlot(arch, 'clip2').length > 0
      ? 'generate.components.role_text_encoder_1'
      : 'generate.components.role_text_encoder'
  }
  const inClip2 = componentsForSlot(arch, 'clip2').some(f => f.id === fileId)
  if (inClip2) return 'generate.components.role_text_encoder_2'
  const inVae = componentsForSlot(arch, 'vae').some(f => f.id === fileId)
  if (inVae) return 'generate.components.role_vae'
  return null
}

function roleText(fileId: string): string {
  const key = roleKeyFor(fileId)
  return key ? t(key) : ''
}

// ── 折叠态文案 ──────────────────────────────────────────────────────────────

const readyText = computed(() =>
  t('generate.components.ready', { n: s.files.value.length }),
)

const missingText = computed(() =>
  t('generate.components.missing', { n: s.missing.value.length }),
)

const downloadingText = computed(() => {
  const c = s.current.value
  if (!c) return t('generate.components.downloading', { i: 0, n: 0, name: '' })
  return t('generate.components.downloading', { i: c.index + 1, n: c.total, name: c.name })
})

const downloadingPercent = computed(() => s.current.value?.percent ?? 0)
const downloadingSpeed = computed(() => {
  const sp = s.current.value?.speed ?? 0
  return fmtSpeed(sp)
})

// ── 展开切换 ───────────────────────────────────────────────────────────────

function toggleExpand() {
  emit('update:expanded', !props.expanded)
}

function onCancelClick(e: MouseEvent) {
  e.stopPropagation()
  void s.cancel()
}

function onRetryClick(e: MouseEvent) {
  e.stopPropagation()
  void s.downloadMissing()
}

function onFetchAllClick(e: MouseEvent) {
  e.stopPropagation()
  void s.downloadMissing()
}

// ── 逐文件状态图标 ──────────────────────────────────────────────────────────

function fileIcon(f: ComponentFileStatus): { name: string; color: string } {
  if (f.installed) return { name: 'check_circle', color: 'var(--green)' }
  if (f.downloading) return { name: 'download', color: 'var(--ac)' }
  if (f.failed) return { name: 'error', color: 'var(--red)' }
  return { name: 'radio_button_unchecked', color: 'var(--t3)' }
}
</script>

<template>
  <div v-if="packaging === 'split' && s.hasComponents.value" class="comp-panel">
    <!-- ═══ 折叠态 (始终渲染在最上) ═══ -->

    <!-- 骨架/占位 -->
    <div v-if="showSkeleton" class="comp-row comp-row--skeleton">
      <Spinner size="xs" />
      <span class="comp-row__txt comp-row__txt--muted">{{ t('generate.components.title') }}</span>
      <span class="comp-row__arr">›</span>
    </div>

    <!-- 下载中 -->
    <div
      v-else-if="isDownloading"
      class="comp-row comp-row--downloading"
      @click="toggleExpand"
    >
      <MsIcon name="download" size="sm" color="var(--ac)" />
      <span class="comp-row__txt">{{ downloadingText }}</span>
      <span class="comp-row__prog">
        <span class="comp-row__prog-bar" :style="{ width: downloadingPercent + '%' }" />
      </span>
      <span v-if="downloadingSpeed" class="comp-row__speed">{{ downloadingSpeed }}</span>
      <BaseButton variant="ghost" size="xs" @click="onCancelClick">
        {{ t('common.btn.cancel') }}
      </BaseButton>
      <span class="comp-row__arr" :class="{ 'comp-row__arr--open': expanded }">›</span>
    </div>

    <!-- 缺失 -->
    <div
      v-else-if="hasMissing"
      class="comp-row comp-row--missing"
      @click="toggleExpand"
    >
      <MsIcon name="error" size="sm" color="var(--amber)" />
      <span class="comp-row__txt">{{ missingText }}</span>
      <span class="comp-row__arr" :class="{ 'comp-row__arr--open': expanded }">›</span>
    </div>

    <!-- 就绪 -->
    <div
      v-else-if="isReady"
      class="comp-row comp-row--ready"
      @click="toggleExpand"
    >
      <MsIcon name="check_circle" size="sm" color="var(--green)" />
      <span class="comp-row__txt comp-row__txt--muted">{{ readyText }}</span>
      <span class="comp-row__arr" :class="{ 'comp-row__arr--open': expanded }">›</span>
    </div>

    <!-- ═══ 展开态明细 ═══ -->
    <transition name="comp-expand">
      <div v-if="expanded" class="comp-detail">
        <!-- 标题行 -->
        <div class="comp-detail__head">
          <span class="comp-detail__title">{{ t('generate.components.title') }}</span>
          <span class="comp-detail__arch">{{ archLabel }}</span>
          <span class="comp-detail__spacer" />
          <BaseButton
            v-if="hasMissing && !isDownloading"
            variant="primary"
            size="sm"
            @click="onFetchAllClick"
          >
            {{ t('generate.components.fetch_all') }}
          </BaseButton>
        </div>

        <!-- 逐文件行 -->
        <div v-for="f in s.files.value" :key="f.file.id" class="comp-file">
          <div class="comp-file__row">
            <MsIcon
              :name="fileIcon(f).name"
              size="sm"
              :color="fileIcon(f).color"
              class="comp-file__icon"
            />
            <span class="comp-file__label">{{ f.file.label }}</span>
            <span v-if="roleText(f.file.id)" class="comp-file__role">{{ roleText(f.file.id) }}</span>
            <span class="comp-file__size">{{ fmtSize(f.file.bytes) }}</span>

            <!-- 状态/进度 -->
            <span class="comp-file__status">
              <!-- 下载中: 行内进度条 -->
              <span v-if="f.downloading" class="comp-file__dl">
                <span class="comp-file__dl-bar">
                  <span class="comp-file__dl-fill" :style="{ width: f.percent + '%' }" />
                </span>
                <span class="comp-file__dl-text">{{ f.percent }}% · {{ fmtSpeed(f.speed) }}</span>
              </span>

              <!-- 失败 -->
              <span v-else-if="f.failed" class="comp-file__failed-wrap">
                <span class="comp-file__failed">{{ t('generate.components.failed') }}</span>
                <BaseButton variant="ghost" size="xs" @click="onRetryClick">
                  {{ t('generate.components.retry') }}
                </BaseButton>
              </span>
            </span>
          </div>
        </div>

        <!-- 错误 -->
        <div v-if="s.error.value" class="comp-detail__error">{{ s.error.value }}</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.comp-panel {
  display: flex;
  flex-direction: column;
  border-radius: var(--r-md);
  background: var(--bg2);
  border: 1px solid var(--bd);
  overflow: hidden;
}

/* ═══ 折叠态单行 ═══ */
.comp-row {
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
.comp-row:hover { background: var(--bg3); }

.comp-row__txt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comp-row__txt--muted { color: var(--t2); }

.comp-row__arr {
  color: var(--t3);
  font-size: 1rem;
  line-height: 1;
  flex: none;
  transition: transform .2s ease;
}
.comp-row__arr--open { transform: rotate(90deg); }

/* 下载中态 */
.comp-row--downloading {
  background: color-mix(in srgb, var(--ac) 8%, var(--bg2));
  color: var(--ac2);
}
.comp-row--downloading:hover { background: color-mix(in srgb, var(--ac) 12%, var(--bg2)); }

.comp-row__prog {
  flex: none;
  width: 80px;
  height: 4px;
  background: var(--bg3);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.comp-row__prog-bar {
  display: block;
  height: 100%;
  background: var(--ac);
  border-radius: var(--r-pill);
  transition: width .3s ease;
}
.comp-row__speed {
  flex: none;
  color: var(--t2);
  font-size: .72rem;
  white-space: nowrap;
}

/* 缺失态: 沿用 gen-comp-missing 的橙色基调 */
.comp-row--missing {
  background: color-mix(in srgb, var(--amber) 10%, var(--bg2));
  color: var(--t2);
}

/* 就绪态 */
.comp-row--ready {
  color: var(--t2);
}

/* 骨架 */
.comp-row--skeleton {
  cursor: default;
  color: var(--t3);
}
.comp-row--skeleton:hover { background: var(--bg2); }

/* ═══ 展开明细 ═══ */
.comp-detail {
  border-top: 1px solid var(--bd);
  padding: var(--sp-2) var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  background: var(--bg2);
}

.comp-detail__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.comp-detail__title {
  font-weight: 600;
  color: var(--t1);
  font-size: .82rem;
}
.comp-detail__arch {
  color: var(--t2);
  font-size: .78rem;
}
.comp-detail__spacer {
  flex: 1;
}

/* 逐文件行 */
.comp-file {
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--bd) 50%, transparent);
}
.comp-file:last-of-type { border-bottom: none; }

.comp-file__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.comp-file__icon { flex: none; }
.comp-file__label {
  font-weight: 500;
  color: var(--t1);
  font-size: .8rem;
}
.comp-file__role {
  color: var(--t3);
  font-size: .72rem;
  white-space: nowrap;
}
.comp-file__size {
  color: var(--t3);
  font-size: .72rem;
  white-space: nowrap;
}
.comp-file__status {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 行内进度条 */
.comp-file__dl {
  display: flex;
  align-items: center;
  gap: 6px;
}
.comp-file__dl-bar {
  width: 60px;
  height: 4px;
  background: var(--bg3);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.comp-file__dl-fill {
  display: block;
  height: 100%;
  background: var(--ac);
  border-radius: var(--r-pill);
  transition: width .3s ease;
}
.comp-file__dl-text {
  color: var(--t2);
  font-size: .72rem;
  white-space: nowrap;
}

.comp-file__failed-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.comp-file__failed {
  color: var(--red);
  font-size: .72rem;
}

/* 错误提示 */
.comp-detail__error {
  color: var(--red);
  font-size: .75rem;
  padding: 4px 0;
}

/* ═══ 展开/收起过渡 ═══ */
.comp-expand-enter-active,
.comp-expand-leave-active {
  transition: opacity .2s ease, max-height .25s ease;
  max-height: 600px;
  overflow: hidden;
}
.comp-expand-enter-from,
.comp-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

/* ═══ 移动端 ═══ */
@media (max-width: 600px) {
  .comp-file__row { flex-wrap: wrap; }
  .comp-file__status { margin-left: 0; width: 100%; }
  .comp-row__prog { width: 50px; }
}
</style>
