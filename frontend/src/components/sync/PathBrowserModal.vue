<script setup lang="ts">
/**
 * PathBrowserModal — 目录选择器 (本地 workspace / rclone remote 两种模式)。
 *
 * 路径约定:
 *  - 本地: 一律 workspace 根相对, 前导 "/" 代表 WORKSPACE_DIR (后端
 *    resolve_workspace_path 换算真实路径, 越界拒绝)。所以本地模式恒 rooted。
 *  - 远程: **原样保留用户写法的前导 "/"**。s3 / webdav / drive / dropbox /
 *    onedrive 都会把前导 "/" Trim 掉, 但 sftp 上 "remote:path" 是登录用户
 *    home 相对、"remote:/path" 是服务器文件系统根 —— 语义不同, 面板不能
 *    替用户规范化。
 *
 * 后端 browse 端点失败时返回 200 + {ok:false,error}, 错误就地显示在列表位置
 * 并可重试, 不弹全局 toast (弹窗还开着, toast 是错的落点)。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { apiErrorText } from '@/utils/apiError'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import type { BrowseResponse } from '@/types/sync'

defineOptions({ name: 'PathBrowserModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** local = workspace 根相对; remote = rclone remote */
  mode: 'local' | 'remote'
  /** mode=remote 时的 remote 名称 */
  remote?: string
  /** 打开时的起始路径 (通常是表单字段当前值) */
  path?: string
}>(), { remote: '', path: '' })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [path: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const { post } = useApiFetch()

const segments = ref<string[]>([])
/** 路径是否带前导 "/" —— 本地恒 true, 远程沿用用户原本写法 (见文件头注释) */
const rooted = ref(true)
const dirs = ref<string[]>([])
const loading = ref(false)
const error = ref('')
/** 可直接键入/粘贴的路径草稿 —— 深层路径不必一级级点 */
const draft = ref('')
/** 请求序号: 只有最后一次 load() 的响应能落地, 关闭弹窗也让在途响应失效 */
let seq = 0

const show = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const currentPath = computed(() => (rooted.value ? '/' : '') + segments.value.join('/'))

const rootLabel = computed(() =>
  props.mode === 'local'
    ? t('sync.browse.root_local')
    : `${props.remote}:${rooted.value ? '/' : ''}`
)

function parsePath(raw: string) {
  const s = (raw || '').trim()
  rooted.value = props.mode === 'local' ? true : s.startsWith('/')
  segments.value = s.split('/').filter(Boolean)
}

watch(() => props.modelValue, (open) => {
  if (!open) {
    seq += 1
    return
  }
  parsePath(props.path || (props.mode === 'local' ? '/' : ''))
  dirs.value = []
  error.value = ''
  load()
})

async function load() {
  const mySeq = ++seq
  draft.value = currentPath.value
  if (props.mode === 'remote' && !props.remote) {
    dirs.value = []
    loading.value = false
    error.value = t('sync.browse.remote_required')
    return
  }
  loading.value = true
  error.value = ''
  const body: Record<string, string> = { path: currentPath.value }
  let d: BrowseResponse | null
  if (props.mode === 'remote') {
    body.remote = props.remote
    d = await post<BrowseResponse>('/api/sync/remote/browse', body)
  } else {
    d = await post<BrowseResponse>('/api/sync/local/browse', body)
  }
  if (mySeq !== seq) return  // 已被更晚的导航或关闭取代
  loading.value = false
  if (d?.ok) {
    dirs.value = d.dirs || []
  } else {
    dirs.value = []
    // d === null: HTTP 层出错, useApiFetch 已 toast
    error.value = apiErrorText(d, t('sync.browse.failed'))
  }
}

function enterDir(dir: string) {
  segments.value = [...segments.value, dir]
  load()
}

/** 跳到面包屑第 i 段 (含) */
function goToSegment(i: number) {
  if (i === segments.value.length - 1) return
  segments.value = segments.value.slice(0, i + 1)
  load()
}

function goToRoot() {
  if (!segments.value.length) return
  segments.value = []
  load()
}

function applyDraft() {
  if (draft.value.trim() === currentPath.value) return
  parsePath(draft.value)
  load()
}

function confirmSelect() {
  emit('select', currentPath.value)
  show.value = false
}
</script>

<template>
  <BaseModal
    v-model="show"
    :title="mode === 'local' ? t('sync.browse.local_title') : t('sync.browse.remote_title')"
    width="480px"
  >
    <!-- 面包屑: 每段可点 (含根), 溢出横向滚动 (不换行撑高弹窗)。
         上溯靠点面包屑, 不再另设"上一级"按钮。 -->
    <div class="pb-crumbs">
      <button class="pb-crumb" :class="{ 'is-current': !segments.length }" @click="goToRoot">{{ rootLabel }}</button>
      <template v-for="(seg, i) in segments" :key="i">
        <span class="pb-sep">/</span>
        <button class="pb-crumb" :class="{ 'is-current': i === segments.length - 1 }" @click="goToSegment(i)">{{ seg }}</button>
      </template>
    </div>

    <!-- 直接键入/粘贴路径, 回车跳转 -->
    <div class="pb-jump">
      <input
        v-model="draft"
        type="text"
        class="form-input"
        spellcheck="false"
        :placeholder="t('sync.browse.path_placeholder')"
        @keyup.enter="applyDraft"
      >
    </div>

    <div class="pb-list">
      <div v-if="loading" class="pb-hint">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="pb-error">
        <MsIcon name="error" />
        <span>{{ error }}</span>
        <BaseButton size="xs" @click="load">{{ t('sync.browse.retry') }}</BaseButton>
      </div>
      <div v-else-if="!dirs.length" class="pb-hint">{{ t('sync.browse.no_subdirs') }}</div>
      <template v-else>
        <button v-for="dir in dirs" :key="dir" class="pb-item" @click="enterDir(dir)">
          <MsIcon name="folder" /> {{ dir }}
        </button>
      </template>
    </div>

    <template #footer>
      <BaseButton size="sm" @click="show = false">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton variant="primary" size="sm" :disabled="!!error" @click="confirmSelect">
        {{ t('sync.browse.select') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
.pb-crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; white-space: nowrap; scrollbar-width: thin; }
.pb-crumb { background: transparent; border: none; padding: 2px 4px; border-radius: 4px; cursor: pointer; color: var(--t2); font-size: .78rem; }
.pb-crumb:hover { background: var(--bg3); color: var(--t1); }
.pb-crumb.is-current { color: var(--t1); font-weight: 600; cursor: default; }
.pb-crumb.is-current:hover { background: transparent; }
.pb-sep { color: var(--t3); font-size: .78rem; }

.pb-jump { margin: 8px 0; }
.pb-jump .form-input { width: 100%; font-size: .78rem; }

/* 固定高度 —— 每次导航列表都会重建, 不固定会整块塌陷再弹回 */
.pb-list { display: flex; flex-direction: column; gap: 2px; min-height: 180px; max-height: 280px; overflow-y: auto; }
.pb-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; text-align: left; background: transparent; border: none; border-radius: 4px; cursor: pointer; color: var(--t1); font-size: .85rem; transition: background .12s; }
.pb-item:hover { background: var(--bg3); }
.pb-hint { text-align: center; color: var(--t3); font-size: .8rem; padding: 16px; }
.pb-error { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--red); font-size: .8rem; padding: 16px; text-align: center; }
</style>
