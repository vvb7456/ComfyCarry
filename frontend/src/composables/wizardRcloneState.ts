/**
 * 向导 rclone / 同步步骤的跨步骤状态。
 *
 * 为什么单独一个模块: 这些值必须在 Step 3 ↔ Step 4 之间存活 (WizardApp 用
 * v-if 切步骤, 组件会被卸载), 所以不能放组件里; 但它们又是 UI 中间态而非
 * 要提交给后端的配置, 所以也不该塞进 wizard config。
 *
 * 放这里而不是放在 useWizardRclone.ts 内, 是为了让 useWizardState 能在
 * selectMode('fresh') 时重置它们, 又不与 useWizardRclone 形成循环 import。
 *
 * 连接区状态 (storage*) 刷新即放弃: 未创建的表单内容不落任何持久层,
 * 已创建的 remote 在服务端内存草稿 (wizard_draft), 前端镜像经
 * /api/setup/state 恢复 (失败重试会话) 或本会话 create 响应回填。
 */
import { ref } from 'vue'

/** 未勾选规则卡片上的用户改动 (templateId → remote_path) */
export const pathOverrides = ref<Record<string, string>>({})

// ── Step 3 连接云存储 (provider 卡片选中后展开的表单) ────────
/** 选中的 provider id (''=未选, 可整步跳过) */
export const storageTypeRef = ref('')
/** 存储名称 (rclone remote name; OAuth 时在 CloudAuthHero done 态填) */
export const storageNameRef = ref('')
/** 非 OAuth 类型的动态凭据字段 (REMOTE_TYPE_DEFS fields) */
export const storageFieldsRef = ref<Record<string, string>>({})
/** OAuth 最终参数 (CloudAuthHero getParams: 自建凭据 + drive_id 等) */
export const storageOauthParamsRef = ref<Record<string, string>>({})
/** S3 存储桶 (rclone s3 路径首段) */
export const storageBucketRef = ref('comfy-assets')
/**
 * 本会话已创建的 remote 镜像。paramsKey 是创建参数的序列化 (凭据字段变化
 * 即视为需要重建); wizard 单存储语义下它是唯一的“当前存储”。
 */
export const createdRemoteRef = ref<{ name: string; type: string; paramsKey: string; fresh?: boolean } | null>(null)
/** 连接区就地错误 (validate/ensureCreated 写入, StepRclone AlertBanner 展示) */
export const storageErrorRef = ref('')

/**
 * 使本地“已创建”短路缓存失效。
 *
 * OAuth 更换账号后，即使 client_id / drive_id 等可见参数恰好没变，
 * 服务端凭据也已经不同，不能再按旧 paramsKey 直接复用。
 */
export function invalidateCreatedRemote() {
  createdRemoteRef.value = null
}

/**
 * 清空全部跨步骤状态。
 *
 * 必须在向导切回「全新部署」时调用 —— 否则上一轮的表单残留会漏进新一轮。
 */
export function resetRcloneState() {
  pathOverrides.value = {}
  storageTypeRef.value = ''
  storageNameRef.value = ''
  storageFieldsRef.value = {}
  storageOauthParamsRef.value = {}
  storageBucketRef.value = 'comfy-assets'
  createdRemoteRef.value = null
  storageErrorRef.value = ''
}
