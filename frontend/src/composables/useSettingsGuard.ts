/**
 * useSettingsGuard — 设置页 dirty 只读登记表 (模块级单例)。
 *
 * 单页 v2 守卫模型 (docs/SETTINGS_V2_OAUTH_SSH_SPEC.md §4.2):
 * 各功能域 (prompt/llm/civitai/sync/tunnel) 在 onMounted 时 register,
 * onUnmounted 时注销; 本注册表只负责回答「当前哪些域 dirty」,
 * **不持有任何 save/discard 动作** — 保存全部由各域头部的按钮自己完成,
 * 离开守卫 (SettingsPage 的 onBeforeRouteLeave) 只消费 dirtyList。
 *
 * 全页不存在「离开时保存」路径: 单页内所有域同时挂载, 路由离开 = 卸载 = 丢弃草稿。
 */
import { computed, ref } from 'vue'

export interface SettingsDirtyEntry {
  /** 域 id: 'prompt' | 'llm' | 'civitai' | 'sync' | 'tunnel' */
  id: string
  /** 离开守卫文案用 (i18n) */
  label: () => string
  /** 域表单是否 dirty */
  isDirty: () => boolean
}

const registry = new Map<string, SettingsDirtyEntry>()
/** 注册/注销版本号: Map 本身无响应性, 用 rev 让 dirtyList 感知成员增减 */
const rev = ref(0)

export function useSettingsGuard() {
  function register(entry: SettingsDirtyEntry) {
    registry.set(entry.id, entry)
    rev.value++
  }

  function unregister(entry: SettingsDirtyEntry) {
    if (registry.get(entry.id) === entry) registry.delete(entry.id)
    rev.value++
  }

  /** 当前 dirty 的域 (文档注册序) */
  const dirtyList = computed(() => {
    void rev.value
    return [...registry.values()].filter(e => e.isDirty())
  })

  return { dirtyList, register, unregister }
}
