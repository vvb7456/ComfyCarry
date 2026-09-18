/**
 * CivitAI 设置 — 全局共享 composable (API Key 状态 + NSFW 两级模型)
 *
 * key_set: API Key 是否已配置。CivitAI 功能 (搜索/下载) 强制要求 key,
 * 模型页以此做 gate; 设置弹窗保存 key 后 load(true) 刷新。
 *
 * 一级「浏览级别」(browsingLevel bitmask, 1..31): 控制出现的模型内容范围。
 *   位定义对齐 civitai: 1=PG, 2=PG-13, 4=R, 8=X, 16=XXX; 位未开的内容不出
 *   现在结果里。UI 仅暴露三档预设: 仅PG(1) / PG–R(7) / 全部(31), 默认全部。
 * 二级「模糊 NSFW」(blur): 已出现的内容里, NSFW 图是否 CSS 模糊 (点击可揭)。
 *
 * Civitai API 不提供服务端 blur: CDN 返回原图, civitai.com 站内也是前端按
 * 图级 nsfwLevel 做 CSS blur。后端只存这些值, 过滤/模糊全部在前端做。
 */
import { readonly, ref } from 'vue'

/** blur 判定线: R 及以上 (bit 4+) 视为需要模糊的 NSFW 内容 */
const NSFW_BLUR_THRESHOLD = 4

const keySet = ref(false)
const browsingLevel = ref(31) // 默认全部
const blurNsfw = ref(true)
const loaded = ref(false)

// ── 模块级共享状态 ─────────────────────────────────────────────

/** 图级 nsfwLevel 是否属于需要模糊的内容 (≥ R) */
export function isNsfwImageLevel(nsfwLevel?: string | number): boolean {
  const n = typeof nsfwLevel === 'string' ? parseInt(nsfwLevel, 10) : nsfwLevel
  return typeof n === 'number' && !Number.isNaN(n) && n >= NSFW_BLUR_THRESHOLD
}

/** 图级 nsfwLevel 是否被当前浏览级别允许 */
export function isLevelAllowed(nsfwLevel: string | number | undefined, level: number): boolean {
  const n = typeof nsfwLevel === 'string' ? parseInt(nsfwLevel, 10) : nsfwLevel
  if (typeof n !== 'number' || Number.isNaN(n) || n <= 0) return true
  // 图级值是单一位 (1/2/4/8/16); 位在用户 bitmask 内即允许
  return (n & level) !== 0
}

// ── composable ────────────────────────────────────────────────

export function useCivitaiSettings() {
  /** 从 /api/settings 读取; 已加载过则跳过 */
  async function load(force = false) {
    if (loaded.value && !force) return
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        keySet.value = !!data.civitai_key_set
        const lv = Number(data.civitai_nsfw_level)
        if (Number.isFinite(lv) && lv >= 1 && lv <= 31) browsingLevel.value = lv
        blurNsfw.value = data.civitai_nsfw_blur !== false
      }
    } catch { /* ignore — 保持默认 */ }
    loaded.value = true
  }

  /** 保存 NSFW 设置到服务端并同步本地状态 */
  async function save(next: { level?: number; blur?: boolean }): Promise<boolean> {
    try {
      const res = await fetch('/api/settings/civitai-nsfw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          browsing_level: next.level ?? browsingLevel.value,
          blur: next.blur ?? blurNsfw.value,
        }),
      })
      if (!res.ok) return false
      const data = await res.json()
      browsingLevel.value = data.browsing_level ?? browsingLevel.value
      blurNsfw.value = data.blur ?? blurNsfw.value
      return true
    } catch {
      return false
    }
  }

  /** 浏览级别是否允许该图 (bitmask 交集) */
  const levelAllows = (nsfwLevel?: string | number) => isLevelAllowed(nsfwLevel, browsingLevel.value)

  /** blur 语义: 图是否应加模糊 (开启模糊 且 ≥ R) */
  const shouldBlur = (nsfwLevel?: string | number) =>
    blurNsfw.value && isNsfwImageLevel(nsfwLevel)

  return {
    /** API Key 是否已配置 (CivitAI 功能 gate) */
    keySet: readonly(keySet),
    load,
    save,
    /** 浏览级别是否允许该图 (bitmask 交集) */
    levelAllows,
    /** blur 语义: 图是否应加模糊 (开启模糊 且 ≥ R) */
    shouldBlur,
  }
}