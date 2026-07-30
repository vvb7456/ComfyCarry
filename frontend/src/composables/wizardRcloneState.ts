/**
 * 向导 rclone / 同步步骤的跨步骤状态。
 *
 * 为什么单独一个模块: 这些值必须在 Step 3 ↔ Step 4 之间存活 (WizardApp 用
 * v-if 切步骤, 组件会被卸载), 所以不能放组件里; 但它们又是 UI 中间态而非
 * 要提交给后端的配置, 所以也不该塞进 wizard config。
 *
 * 放这里而不是放在 useWizardRclone.ts 内, 是为了让 useWizardState 能在
 * selectMode('fresh') 时重置它们, 又不与 useWizardRclone 形成循环 import。
 */
import { ref } from 'vue'
import type { DetectedRemote } from '@/types/wizard'

export type RcloneMethod = '' | 'file' | 'manual' | 'base64_env'

/** Step 4 选中的默认远程存储名 */
export const defaultRemoteNameRef = ref('')
/** Step 3 选中的 rclone 配置方式 */
export const selectedMethodRef = ref<RcloneMethod>('')
/** 从上传/环境变量的 rclone.conf 里探测出的 remote */
export const detectedRemotesRef = ref<DetectedRemote[]>([])
/** Step 3 的文件状态文案 */
export const fileStatusRef = ref('')

/** 未勾选规则卡片上的用户改动 (templateId → remote / remote_path) */
export const remoteOverrides = ref<Record<string, string>>({})
export const pathOverrides = ref<Record<string, string>>({})

let detectTimer: ReturnType<typeof setTimeout> | null = null

export function setDetectTimer(handle: ReturnType<typeof setTimeout> | null) {
  detectTimer = handle
}

export function clearDetectTimer() {
  if (detectTimer) clearTimeout(detectTimer)
  detectTimer = null
}

/**
 * 清空全部跨步骤状态。
 *
 * 必须在向导切回「全新部署」时调用 —— 否则上一轮探测到的 remote 仍留在
 * Step 4 的下拉里, 用户能把一个部署时并不存在的 remote 勾进规则。
 */
export function resetRcloneState() {
  clearDetectTimer()
  defaultRemoteNameRef.value = ''
  selectedMethodRef.value = ''
  detectedRemotesRef.value = []
  fileStatusRef.value = ''
  remoteOverrides.value = {}
  pathOverrides.value = {}
}
