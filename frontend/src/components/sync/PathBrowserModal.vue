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
 * staged 凭据 (mode=remote 可选): 凭据经 env 临时注入跑 rclone, 不落盘 ——
 * 浏览/新建目录发生在用户最终「确定」之前 (wizard 计划 / dashboard 保存前)。
 *
 * 打开即从根目录浏览, 不预填表单当前值 (与常规文件选择器一致)。
 * 路径输入职责由面包屑承担: 点击面包屑的当前段展开为路径输入框 (预填当前
 * 路径, 可直接键入/粘贴深层路径), 回车跳转, Esc/失焦取消; 点击非当前段照旧
 * 跳到该目录。
 *
 * 新建目录 (仅 remote): footer 按钮 → 小弹窗输入名称 (预填 ComfyCarry),
 * 回车/点按钮即在当前位置创建 (无二次确认), 建完即进入。
 *
 * 后端 browse 端点失败时返回 200 + {ok:false,error}, 错误就地显示在列表位置
 * 并可重试, 不弹全局 toast (弹窗还开着, toast 是错的落点)。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiFetch } from '@/composables/useApiFetch'
import { apiErrorText } from '@/utils/apiError'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MsIcon from '@/components/ui/MsIcon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import type { BrowseResponse, StagedCreds } from '@/types/sync'

defineOptions({ name: 'PathBrowserModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** local = workspace 根相对; remote = rclone remote */
  mode: 'local' | 'remote'
  /** mode=remote 时的 remote 名称 */
  remote?: string
  /** staged 凭据 (wizard 计划 / oauth 会话 / 表单直传); 缺省走已落盘 remote */
  staged?: StagedCreds
}>(), { remote: '', staged: undefined })

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
/** 面包屑编辑态: true 时面包屑行替换为路径输入框 (粘贴/键入深层路径用) */
const editing = ref(false)
/** 编辑态输入框的草稿 */
const draft = ref('')
/** 新建目录小弹窗 (名称输入) */
const mkdirOpen = ref(false)
const newDirName = ref('')
const mkdirError = ref('')
const creating = ref(false)
const mkdirInputRef = ref<HTMLInputElement | null>(null)
const draftInputRef = ref<HTMLInputElement | null>(null)
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

/** 新建目录请求体: staged 凭据透传 */
function remoteBody(path: string): Record<string, unknown> {
  const body: Record<string, unknown> = { remote: props.remote, path }
  if (props.staged) body.staged = props.staged
  return body
}

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
  // 打开即根目录, 不预填表单当前值 (与常规文件选择器一致)
  parsePath('')
  dirs.value = []
  error.value = ''
  editing.value = false
  load()
})

async function load() {
  const mySeq = ++seq
  if (props.mode === 'remote' && !props.remote) {
    dirs.value = []
    loading.value = false
    error.value = t('sync.browse.remote_required')
    return
  }
  loading.value = true
  error.value = ''
  let d: BrowseResponse | null
  if (props.mode === 'remote') {
    d = await post<BrowseResponse>('/api/sync/remote/browse', remoteBody(currentPath.value))
  } else {
    d = await post<BrowseResponse>('/api/sync/local/browse', { path: currentPath.value })
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

/** 跳到面包屑第 i 段 (含); 点击当前段 = 展开路径输入框 (预填当前路径) */
function goToSegment(i: number) {
  if (i === segments.value.length - 1) {
    openEdit()
    return
  }
  segments.value = segments.value.slice(0, i + 1)
  load()
}

function goToRoot() {
  if (!segments.value.length) {
    openEdit()
    return
  }
  segments.value = []
  load()
}

// ── 面包屑编辑态: 点击当前段展开, 粘贴/键入深层路径, 回车跳转, Esc/失焦取消 ──

function openEdit() {
  draft.value = currentPath.value
  editing.value = true
  nextTick(() => draftInputRef.value?.focus())
}

function cancelEdit() {
  editing.value = false
}

function applyDraft() {
  if (!draft.value.trim() || draft.value.trim() === currentPath.value) {
    editing.value = false
    return
  }
  editing.value = false
  parsePath(draft.value)
  load()
}

/** 新建目录: 名称合法 = 非空且不含路径分隔符 */
const mkdirValid = computed(() => {
  const n = newDirName.value.trim()
  return !!n && !n.includes('/')
})

function openMkdir() {
  mkdirError.value = ''
  newDirName.value = 'ComfyCarry'
  mkdirOpen.value = true
  nextTick(() => {
    mkdirInputRef.value?.focus()
    mkdirInputRef.value?.select()
  })
}

/** 在当前位置新建目录 (mkdir 幂等, 无二次确认), 成功后进入该目录。
 *  路径原样保留前导 "/" (sftp 的绝对/相对语义, 见文件头注释), 仅拼接新段。 */
async function createDir() {
  const name = newDirName.value.trim()
  if (!name || creating.value || !mkdirValid.value) return
  const base = currentPath.value
  const target = base ? `${base.replace(/\/+$/, '')}/${name}` : name
  creating.value = true
  const d = await post<BrowseResponse>('/api/sync/remote/mkdir', remoteBody(target))
  creating.value = false
  if (d?.ok) {
    mkdirOpen.value = false
    enterDir(name)
  } else {
    // 失败留在小弹窗内就地重试 (useApiFetch 已 toast HTTP 层错误)
    mkdirError.value = apiErrorText(d, t('sync.browse.mkdir_failed'))
  }
}

function confirmSelect() {
  // SFTP 的 home 根是空字符串, 用显式的 "." 保留相对路径语义;
  // 绝对根仍返回 "/", 其他 remote 路径原样透传。
  const selectedPath = currentPath.value || (props.mode === 'remote' && !rooted.value ? '.' : currentPath.value)
  emit('select', selectedPath)
  show.value = false
}
</script>

<template>
  <BaseModal
    v-model="show"
    :title="mode === 'local' ? t('sync.browse.local_title') : t('sync.browse.remote_title')"
    width="480px"
  >
    <!-- 顶部: 面包屑 (点击当前段展开为路径输入框, 非当前段跳转; 溢出横向滚动) -->
    <div class="pb-top">
      <!-- 编辑态: 面包屑临时替换为路径输入框 -->
      <template v-if="editing">
        <input
          ref="draftInputRef"
          v-model="draft"
          type="text"
          class="form-input pb-edit"
          spellcheck="false"
          :placeholder="t('sync.browse.path_placeholder')"
          @keyup.enter="applyDraft"
          @keyup.esc="cancelEdit"
          @blur="cancelEdit"
        >
        <BaseButton size="xs" class="pb-edit-btn" @mousedown.prevent @click="applyDraft">
          <MsIcon name="arrow_forward" size="xs" />
        </BaseButton>
      </template>
      <div v-else class="pb-crumbs">
        <button class="pb-crumb" :class="{ 'is-current': !segments.length }" @click="goToRoot">{{ rootLabel }}</button>
        <template v-for="(seg, i) in segments" :key="i">
          <span class="pb-sep">/</span>
          <button class="pb-crumb" :class="{ 'is-current': i === segments.length - 1 }" @click="goToSegment(i)">{{ seg }}</button>
        </template>
      </div>
    </div>

    <div class="pb-list">
      <div v-if="loading" class="pb-loading"><Spinner size="md" /></div>
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
      <BaseButton v-if="mode === 'remote'" size="sm" :disabled="loading || !!error" @click="openMkdir">
        <MsIcon name="create_new_folder" size="xs" color="none" />
        {{ t('sync.browse.mkdir_btn') }}
      </BaseButton>
      <BaseButton variant="primary" size="sm" :disabled="!!error" @click="confirmSelect">
        {{ t('sync.browse.select') }}
      </BaseButton>
    </template>
  </BaseModal>

  <!-- 新建目录小弹窗: 输入名称, 回车/点按钮即在当前位置创建 (无二次确认) -->
  <BaseModal
    v-model="mkdirOpen"
    :title="t('sync.browse.mkdir_btn')"
    :subtitle="currentPath"
    size="sm"
    density="compact"
    :z-index="1100"
  >
    <input
      ref="mkdirInputRef"
      v-model="newDirName"
      type="text"
      class="form-input"
      spellcheck="false"
      @keyup.enter="createDir"
      @input="mkdirError = ''"
    >
    <p v-if="mkdirError" class="pb-mkdir-err">
      <MsIcon name="error" size="xs" />
      {{ mkdirError }}
    </p>
    <template #footer>
      <BaseButton size="sm" @click="mkdirOpen = false">{{ t('common.btn.cancel') }}</BaseButton>
      <BaseButton variant="primary" size="sm" :loading="creating" :disabled="!mkdirValid" @click="createDir">
        {{ t('sync.browse.mkdir_btn') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/* 顶部行: 面包屑 (点击当前段展开为输入框) */
.pb-top { display: flex; align-items: center; gap: 4px; }
.pb-crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1; overflow-x: auto; white-space: nowrap; scrollbar-width: thin; }
.pb-edit { flex: 1; min-width: 0; font-size: .78rem; }
.pb-edit-btn { flex: none; }

.pb-crumb { background: transparent; border: none; padding: 2px 4px; border-radius: 4px; cursor: pointer; color: var(--t2); font-size: .78rem; }
.pb-crumb:hover { background: var(--bg3); color: var(--t1); }
.pb-crumb.is-current { color: var(--t1); font-weight: 600; cursor: default; }
.pb-crumb.is-current:hover { background: transparent; }
.pb-sep { color: var(--t3); font-size: .78rem; }

/* 固定高度 —— 每次导航列表都会重建, 不固定会整块塌陷再弹回 */
.pb-list { display: flex; flex-direction: column; gap: 2px; min-height: 180px; max-height: 280px; overflow-y: auto; }
.pb-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; text-align: left; background: transparent; border: none; border-radius: 4px; cursor: pointer; color: var(--t1); font-size: .85rem; transition: background .12s; }
.pb-item:hover { background: var(--bg3); }
.pb-hint { text-align: center; color: var(--t3); font-size: .8rem; padding: 16px; }
.pb-loading { display: flex; align-items: center; justify-content: center; min-height: 180px; flex: 1; }
.pb-error { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--red); font-size: .8rem; padding: 16px; text-align: center; }

/* 新建目录小弹窗内的错误 */
.pb-mkdir-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: .78rem;
  color: var(--red);
}
</style>
