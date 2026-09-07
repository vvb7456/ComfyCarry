/**
 * useSettingsGuard — 设置页未保存守卫协调器 (模块级单例)。
 *
 * 设置页拆成路由子 tab 后, 各 tab 的表单状态分散在各自组件里。
 * 本协调器让 shell (SettingsPage) 与子 tab 通过「注册 dirty 提供者」协作:
 *
 *  - 子 tab setup 时 register(provider), 卸载时自动注销
 *  - shell 的 banner / 路由守卫读取当前激活 tab 的 provider 做统一拦截
 *  - provider.save/discard 由子 tab 自己实现 (保存走各自 API, 放弃走重载)
 *
 * 同一时刻至多一个 tab dirty (路由切换被守卫拦住, 进不去别的 tab)。
 */
import { computed, ref } from 'vue'

export interface SettingsGuardProvider {
  /** 表单是否 dirty */
  isDirty: () => boolean
  /** 是否处于保存中 (banner loading) */
  isSaving: () => boolean
  /** 保存; 返回 true = 成功放行 */
  save: () => Promise<boolean>
  /** 放弃更改 (恢复服务端值) */
  discard: () => Promise<void>
}

const provider = ref<SettingsGuardProvider | null>(null)

export function useSettingsGuard() {
  const dirty = computed(() => !!provider.value?.isDirty())
  const saving = computed(() => !!provider.value?.isSaving())

  function register(p: SettingsGuardProvider) {
    provider.value = p
  }

  function unregister(p: SettingsGuardProvider) {
    if (provider.value === p) provider.value = null
  }

  return {
    dirty,
    saving,
    register,
    unregister,
    /** 供 shell 的守卫/banner 调用 */
    save: () => provider.value?.save() ?? Promise.resolve(true),
    discard: () => provider.value?.discard() ?? Promise.resolve(),
  }
}