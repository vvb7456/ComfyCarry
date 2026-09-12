<script setup lang="ts">
/**
 * 设置页 shell — 单页 v3 (docs/SETTINGS_V2_OAUTH_SSH_SPEC.md §3/§4)。
 *
 * 层级: L1 分区标题 (居中, 与吸顶导航 chip 逐字一致) → L2 模块 (SettingsModule,
 * 保存边界, kicker 灰头 + dirty 浮现保存) → 行。无三级小节: 行 label 自足,
 * 多余标题层会稀释层级对比。
 *
 * 定位: `#/settings?section=panel` 查询参数直达;
 *   页内导航用 router.replace 更新 query (不产生历史记录)。
 *
 * 守卫: useSettingsGuard 只读 dirty 登记 + 模块级保存 (模块头浮现按钮),
 *   无全局 banner、无「保存全部」、无「放弃」按钮 (放弃走离开守卫)。本 shell 只做:
 *   1. onBeforeRouteLeave 离开守卫 (去处理 / 放弃并离开 / 取消 三键)
 *   2. beforeunload (任一模块 dirty 时注册)
 *   3. 分区导航 chip 上的 dirty 小圆点
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import TabSwitcher from '@/components/ui/TabSwitcher.vue'
import type { TabItem } from '@/components/ui/TabSwitcher.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import { useApiFetch } from '@/composables/useApiFetch'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useSettingsGuard } from '@/composables'
import SettingsSectionPanel from '@/components/settings/sections/SettingsSectionPanel.vue'
import SettingsSectionGenModels from '@/components/settings/sections/SettingsSectionGenModels.vue'
import SettingsAboutFooter from '@/components/settings/sections/SettingsAboutFooter.vue'

defineOptions({ name: 'SettingsPage' })

const { t } = useI18n({ useScope: 'global' })
const route = useRoute()
const router = useRouter()
const { confirm } = useConfirm()
const { post } = useApiFetch()
const { toast } = useToast()

// ─── 分区定义 ────────────────────────────────────────────────────────────────

const SECTION_KEYS = ['panel', 'genmodels', 'about'] as const
type SectionKey = (typeof SECTION_KEYS)[number]

/** focus id → 所属分区 (panel 内四个锚点为 group 级) */
const FOCUS_SECTIONS: Record<string, SectionKey> = {
  'password': 'panel',
  'config': 'panel',
  'prompt': 'genmodels',
  'llm': 'genmodels',
  'civitai': 'genmodels',
}

function normalizeSection(v: unknown): SectionKey | null {
  return SECTION_KEYS.includes(v as SectionKey) ? (v as SectionKey) : null
}

function normalizeFocus(v: unknown): string | null {
  const s = typeof v === 'string' ? v : ''
  return s && s in FOCUS_SECTIONS ? s : null
}

// ─── 分区导航 (dirty 小圆点: 域 → 分区映射) ──────────────────────────────────

const guardHub = useSettingsGuard()
const dirtyList = guardHub.dirtyList

const sectionTabs = computed<TabItem[]>(() => {
  const dirtyIds = new Set(dirtyList.value.map(d => d.id))
  const dotFor = (keys: string[]) => keys.some(k => dirtyIds.has(k))
  return [
    { key: 'panel', label: t('settings.section.panel'), icon: 'settings', dot: dotFor([]) },
    { key: 'genmodels', label: t('settings.section.genmodels'), icon: 'auto_awesome', dot: dotFor(['prompt', 'llm', 'civitai']) },
    { key: 'about', label: t('settings.section.about'), icon: 'info', dot: false },
  ]
})

const activeSection = ref<SectionKey>(normalizeSection(route.query.section) ?? 'panel')

function onSectionClick(key: string) {
  const section = key as SectionKey
  activeSection.value = section
  holdSpy()
  document.getElementById(`settings-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // 页内导航: replace 更新 query (不产生历史记录); 点击分区即丢弃 focus 定位
  const { focus: _drop, ...rest } = route.query
  void router.replace({ query: { ...rest, section } })
}

// ─── query 定位 (section / focus) ────────────────────────────────────────────

const pageRootRef = ref<HTMLElement | null>(null)
const tabsRef = ref<ComponentPublicInstance | null>(null)

async function applyQuery(opts: { instant?: boolean } = {}) {
  const focus = normalizeFocus(route.query.focus)
  const section = normalizeSection(route.query.section) ?? (focus ? FOCUS_SECTIONS[focus] : null)
  if (section) activeSection.value = section
  if (!focus && !section) return
  holdSpy()
  await nextTick()
  if (focus) {
    document.getElementById(`settings-focus-${focus}`)
      ?.scrollIntoView({ behavior: opts.instant ? 'auto' : 'smooth', block: 'start' })
  } else if (section) {
    document.getElementById(`settings-section-${section}`)?.scrollIntoView({ behavior: opts.instant ? 'auto' : 'smooth', block: 'start' })
  }
}

// 挂载与 query 变化 (深链 push / 浏览器前进后退) 时重新定位
watch(() => route.query, () => {
  if (route.name !== 'settings') return
  void applyQuery()
})

// ─── scrollspy: IntersectionObserver 判定带 + 滚动到底兜底 ───────────────────

let io: IntersectionObserver | null = null
let scrollRootEl: HTMLElement | null = null
const bandVisible = new Map<SectionKey, boolean>()

/** 程序化滚动 (深链定位/分区点击) 期间挂起 spy, 防止滚动途中的中间态
 *  与滚底兜底把高亮抢走 (query/点击意图优先) */
let suppressSpyUntil = 0

function holdSpy(ms = 1100) {
  suppressSpyUntil = Date.now() + ms
}

/** 吸顶 TabSwitcher 实际占高 (含负 margin 补偿的 padding) + 余量 */
function stickyHeadPx(): number {
  const el = tabsRef.value?.$el as HTMLElement | undefined
  return (el?.offsetHeight ?? 72) + 24
}

function evalActiveSection() {
  if (Date.now() < suppressSpyUntil) return
  // 滚到底: 末分区 (about footer 很矮) 永远够不到顶部判定带, 直接按滚底归末分区
  if (scrollRootEl && scrollRootEl.scrollTop + scrollRootEl.clientHeight >= scrollRootEl.scrollHeight - 4) {
    activeSection.value = SECTION_KEYS[SECTION_KEYS.length - 1]
    return
  }
  // 判定带内可见的分区中取文档序最后一个; 都不在带内则保持现状
  let next: SectionKey | null = null
  for (const k of SECTION_KEYS) {
    if (bandVisible.get(k)) next = k
  }
  if (next) activeSection.value = next
}

function findScrollRoot(): HTMLElement | null {
  let el = pageRootRef.value?.parentElement ?? null
  while (el) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') return el
    el = el.parentElement
  }
  return null
}

onMounted(() => {
  scrollRootEl = findScrollRoot()
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const key = (e.target as HTMLElement).dataset.section as SectionKey | undefined
      if (key) bandVisible.set(key, e.isIntersecting)
    }
    evalActiveSection()
  }, { rootMargin: `-${stickyHeadPx()}px 0px -55% 0px`, threshold: 0 })
  for (const k of SECTION_KEYS) {
    const el = document.getElementById(`settings-section-${k}`)
    if (el) io.observe(el)
  }
  scrollRootEl?.addEventListener('scroll', evalActiveSection, { passive: true })

  // 挂载定位: instant (避免长距离 smooth 掠过整页); 数据加载后高度变化再补偿一次
  const hasPositioning = !!(normalizeFocus(route.query.focus) || normalizeSection(route.query.section))
  if (hasPositioning) {
    void applyQuery({ instant: true })
    window.setTimeout(() => { void applyQuery({ instant: true }) }, 600)
  }
})

onBeforeUnmount(() => {
  io?.disconnect()
  io = null
  scrollRootEl?.removeEventListener('scroll', evalActiveSection)
  scrollRootEl = null
})

// ─── 离开守卫 (三键: 去处理 / 放弃并离开 / 取消) ──────────────────────────────

/** 吸顶 chip: 跳到第一个 dirty 域 (复用离开守卫的目标定位) */
function goFirstDirty() {
  scrollToDomain(guardHub.dirtyList.value[0].id)
}

function scrollToDomain(id: string) {
  const el = document.getElementById(`settings-focus-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // 短促高亮指示目标模块 (CSS 动画; reflow 重启以便连续触发)
  el.classList.remove('settings-domain--flash')
  void el.offsetWidth
  el.classList.add('settings-domain--flash')
  window.setTimeout(() => el.classList.remove('settings-domain--flash'), 1400)
}

async function guardLeave(): Promise<boolean> {
  const dirty = guardHub.dirtyList.value
  if (!dirty.length) return true
  const names = dirty.map(d => d.label()).join(' · ')
  const result = await confirm({
    title: t('settings.confirm.unsaved_leave.title'),
    message: t('settings.confirm.unsaved_leave.message', { modules: names }),
    confirmText: t('settings.confirm.unsaved_leave.button'),
    altText: t('settings.confirm.unsaved_leave.alt'),
    cancelText: t('common.btn.cancel'),
  })
  if (result === true) { scrollToDomain(dirty[0].id); return false } // 取消导航并跳到第一个 dirty 域
  if (result === 'alt') return true // 放弃并离开: 组件卸载即丢弃草稿, 无任何清理代码
  return false
}

onBeforeRouteLeave(() => guardLeave())

// ─── beforeunload: 浏览器关闭/刷新拦截 (任一域 dirty 时注册, 否则移除) ─────────

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!guardHub.dirtyList.value.length) return
  e.preventDefault()
  e.returnValue = ''
}

watch(() => guardHub.dirtyList.value.length, (n) => {
  if (n > 0) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

// ─── 页头右上: 重启服务 (与其他服务页统一) ────────────────────────────────────

async function restartDashboard() {
  if (!await confirm({
    title: t('settings.confirm.restart.title'),
    message: t('settings.confirm.restart.message'),
    confirmText: t('common.btn.restart'),
  })) return
  // 失败已由 useApiFetch 提示; 不要再报"正在重启"并刷新页面
  if (!await post('/api/settings/restart', {})) return
  toast(t('settings.restarting'), 'info')
  setTimeout(() => location.reload(), 3000)
}
</script>

<template>
  <div ref="pageRootRef" class="page-body">
    <TabSwitcher
      ref="tabsRef"
      :title="t('settings.title')"
      :tabs="sectionTabs"
      :model-value="activeSection"
      @update:model-value="onSectionClick"
    >
      <template #extra>
        <BaseButton
          v-if="dirtyList.length"
          size="sm"
          variant="warning"
          :title="t('settings.unsaved.chip_tip')"
          @click="goFirstDirty"
        >
          <MsIcon name="save" /> {{ t('settings.unsaved.chip', { n: dirtyList.length }) }}
        </BaseButton>
        <BaseButton size="sm" @click="restartDashboard">
          <MsIcon name="restart_alt" /> {{ t('settings.restart_btn') }}
        </BaseButton>
      </template>
    </TabSwitcher>

    <!-- 面板: 登录与认证 / 配置管理 (无草稿态) -->
    <section id="settings-section-panel" class="settings-section" data-section="panel">
      <h2 class="settings-section__title"><MsIcon name="settings" />{{ t('settings.section.panel') }}</h2>
      <SettingsSectionPanel />
    </section>

    <!-- 生成与模型: 提示词编辑器 / LLM 服务 / CivitAI -->
    <section id="settings-section-genmodels" class="settings-section" data-section="genmodels">
      <h2 class="settings-section__title"><MsIcon name="auto_awesome" />{{ t('settings.section.genmodels') }}</h2>
      <SettingsSectionGenModels />
    </section>

    <!-- 关于: 特殊尾分区 — 无标题 (nav chip 独有), 纯 about 内容直接呈现 -->
    <section id="settings-section-about" class="settings-section settings-section--about" data-section="about">
      <SettingsAboutFooter />
    </section>
  </div>
</template>
