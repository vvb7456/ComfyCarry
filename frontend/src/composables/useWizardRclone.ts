import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWizardState } from './useWizardState'
import { useApiFetch } from './useApiFetch'
import { useConfirm } from './useConfirm'
import { CLOUD_PROVIDERS, OAUTH_TYPES, type CloudProvider } from '@/config/cloud-providers'
import type { WizardRemotesResponse } from '@/types/wizard'
import type { RemoteField } from '@/types/sync'
import {
  pathOverrides as _pathOverrides,
  storageTypeRef, storageNameRef, storageFieldsRef, storageOauthParamsRef,
  storageBucketRef,
  createdRemoteRef, storageErrorRef, invalidateCreatedRemote,
} from './wizardRcloneState'

export function useWizardRclone() {
  const { t } = useI18n({ useScope: 'global' })
  const { config, syncTemplates, remoteTypeDefs } = useWizardState()
  const { post } = useApiFetch()
  const { confirm } = useConfirm()

  // ── Step 3 连接云存储 ───────────────────────────────────────

  const storageType = computed({
    get: () => storageTypeRef.value,
    set: (v: string) => { storageTypeRef.value = v },
  })
  const storageName = storageNameRef
  const storageFields = storageFieldsRef
  const storageBucket = storageBucketRef
  const storageOauthParams = storageOauthParamsRef
  const storageError = storageErrorRef

  const currentFields = computed<RemoteField[]>(() =>
    storageTypeRef.value ? (remoteTypeDefs.value[storageTypeRef.value]?.fields || []) : [],
  )

  const isOAuthType = computed(() =>
    !!storageTypeRef.value
    && (remoteTypeDefs.value[storageTypeRef.value]?.oauth ?? OAUTH_TYPES.includes(storageTypeRef.value)),
  )

  function generateUniqueName(base: string): string {
    let res = base
    let n = 2
    const existing = [config.wizard_remotes[0]?.name].filter(Boolean) as string[]
    while (existing.includes(res)) res = `${base}${n++}`
    return res
  }

  /** 选中 provider (点已选卡片 = 取消, 回到可跳过态); 默认值按后端字段定义填充 */
  function selectProvider(p: CloudProvider) {
    // provider 切换后不能再复用上一个 remote 的参数短路结果。
    invalidateCreatedRemote()
    storageErrorRef.value = ''
    if (storageTypeRef.value === p.id) {
      storageTypeRef.value = ''
      storageNameRef.value = ''
      storageFieldsRef.value = {}
      storageOauthParamsRef.value = {}
      return
    }
    storageTypeRef.value = p.id
    storageNameRef.value = generateUniqueName(p.defaultName)
    storageFieldsRef.value = {}
    for (const f of remoteTypeDefs.value[p.id]?.fields || []) {
      if (f.default !== undefined) storageFieldsRef.value[f.key] = f.default
    }
    storageOauthParamsRef.value = {}
  }

  /** 名称校验 (错误写入 storageError, 返回是否通过) */
  function validateName(): boolean {
    const n = storageNameRef.value.trim()
    if (!n) { storageErrorRef.value = t('sync.err.remote_name_required'); return false }
    if (!/^[a-zA-Z0-9_-]+$/.test(n)) { storageErrorRef.value = t('sync.remote.invalid_name'); return false }
    return true
  }

  /** 非 OAuth 必填项校验 (错误写入 storageError, 返回是否通过) */
  function validateFields(): boolean {
    const missing = currentFields.value
      .filter(f => f.required && !(storageFieldsRef.value[f.key] || '').trim())
      .map(f => f.label)
    if (missing.length > 0) {
      storageErrorRef.value = t('sync.remote.missing_fields', { fields: missing.join(', ') })
      return false
    }
    return true
  }

  /** 组装 /api/setup/wizard_remote 的 params (OAuth 会话 token 由服务端并入;
   *  OAuth 的 drive_id/scope 已含在 oauthParams (CloudAuthHero getParams)) */
  function buildCreateParams(): Record<string, string> {
    const params: Record<string, string> = { ...storageOauthParamsRef.value, ...storageFieldsRef.value }
    if (storageTypeRef.value === 's3' && storageBucketRef.value.trim()) {
      params.bucket = storageBucketRef.value.trim()
    }
    return params
  }

  /**
   * 确保 remote 已按当前表单写入服务端计划 (名称/类型/参数未变则复用), 返回是否可推进。
   * 错误就地写入 storageError; 用户在覆盖确认中取消时静默返回 false。
   *
   * wizard 单存储语义: 每次成功后把 wizard_remotes 收敛为仅此一条。
   * 同名同类型 → 覆盖确认; 同名不同类型 → 报错。
   * 编辑只写服务端内存草稿，真实 remote 由部署时 deploy_engine 落盘;
   * step4 的远程目录浏览走 staged (凭据经 env 注入, 不落盘)。
   */
  async function ensureCreated(sourceName?: string): Promise<boolean> {
    const target = storageNameRef.value.trim()
    const paramsKey = JSON.stringify(buildCreateParams())
    const cr = createdRemoteRef.value
    if (cr && cr.name === target && cr.type === storageTypeRef.value && cr.paramsKey === paramsKey) {
      return true
    }

    // 在请求前保留旧投影。请求成功后 config.wizard_remotes 会被替换为新投影,
    // 规则迁移仍需要旧 remote 的 type/bucket 来判断路径是否为默认值。
    const previousRemotes = config.wizard_remotes.map(r => ({ ...r }))
    const existing = previousRemotes.find(r => r.name === target)
    let overwrite = false
    if (existing) {
      if (existing.type !== storageTypeRef.value) {
        storageErrorRef.value = t('sync.err.remote_exists', { name: target })
        return false
      }
      const ok = await confirm({
        message: t('sync.overwrite.confirm', { name: target }),
        confirmText: t('sync.overwrite.btn'),
        variant: 'danger',
      })
      if (!ok) return false
      overwrite = true
    }

    const request: Record<string, unknown> = {
      name: target, type: storageTypeRef.value, params: buildCreateParams(), overwrite,
    }
    // 恢复态编辑 OAuth/凭据字段时，服务端用 source_name 从同类型旧草稿
    // 补回 token 等不可由前端持有的参数。新授权/换账号不带此字段。
    if (sourceName?.trim()) request.source_name = sourceName.trim()
    const d = await post<WizardRemotesResponse>('/api/setup/wizard_remote', request)
    if (!d) { storageErrorRef.value = t('sync.remote.create_failed'); return false }
    if (d.ok) {
      createdRemoteRef.value = { name: target, type: storageTypeRef.value, paramsKey, fresh: !overwrite }
      config.rclone_config_method = 'manual'
      config._rclone_display_method = 'manual'

      // 单存储收敛: 清掉服务端计划里的其他条目 (旧存储被本次新存储替换)
      const others = (d.wizard_remotes || []).filter(r => r.name !== target)
      for (const o of others) {
        await post('/api/setup/wizard_remote/delete', { name: o.name })
      }
      config.wizard_remotes = (d.wizard_remotes || []).filter(r => r.name === target)

      // 存储被替换时, 已选规则的 remote/路径一并迁移到新存储:
      // 旧 remote 已从计划删除, 规则若仍指旧名, 部署时 rclone 找不到 remote 必失败。
      // 路径仅当默认路径派生自旧存储 (bucket 前缀) 时重算, 用户手改过的原样保留。
      const newRemote = (d.wizard_remotes || []).find(r => r.name === target)
        || { name: target, type: storageTypeRef.value, bucket: storageTypeRef.value === 's3' ? storageBucketRef.value.trim() : '' }
      const previousPrimary = previousRemotes[0]
      const storageIdentityChanged = !!previousPrimary
        && (previousPrimary.name !== target
          || previousPrimary.type !== newRemote.type
          || (previousPrimary.type === 's3' ? (previousPrimary.bucket || '') : '')
            !== (newRemote.type === 's3' ? (newRemote.bucket || '') : ''))
      const wasReplaced = others.length > 0
        || storageIdentityChanged
        || !!(cr && (cr.name !== target || cr.type !== storageTypeRef.value))
      if (wasReplaced) {
        for (const rule of config.wizard_sync_rules) {
          const tpl = syncTemplates.value.find(x => x.id === rule.template_id)
          const oldRemote = previousRemotes.find(r => r.name === rule.remote) || previousPrimary
          const oldDefault = tpl ? defaultPathForRemote(oldRemote, tpl) : ''
          const oldPath = rule.remote_path
          rule.remote = target
          // 仅迁移空路径或原来自动生成的默认路径, 用户自定义路径保持不变。
          if (tpl && (!oldPath || oldPath === oldDefault)) {
            rule.remote_path = defaultPathForRemote(newRemote, tpl)
          }
        }
      }
      return true
    }
    storageErrorRef.value = t('sync.remote.create_failed')
    return false
  }

  // ── Step 4 同步规则 (单存储: remote 隐式取计划第一条, 无选择逻辑) ──

  const pullTemplates = computed(() =>
    syncTemplates.value.filter(t => t.direction === 'pull'),
  )

  const pushTemplates = computed(() =>
    syncTemplates.value.filter(t => t.direction === 'push'),
  )

  /** 当前存储 (计划第一条; 单存储语义) */
  const currentRemote = computed(() => config.wizard_remotes[0] || null)

  /** 规则的 remote 名 —— 单存储语义下无选择, 恒取当前存储 */
  const ruleRemoteName = computed(() => currentRemote.value?.name || '')

  /**
   * 规则默认远程路径: <[bucket/]ComfyCarry>/<模板子路径>。
   * S3 的 bucket 是 rclone s3 路径首段 (来自服务端安全投影, 与存储计划一致)。
   */
  function defaultPathForRemote(remote: { type?: string; bucket?: string } | null | undefined, tpl: { remote_path: string }): string {
    const bucket = remote?.type === 's3' ? (remote.bucket || '').trim() : ''
    const prefix = [bucket, 'ComfyCarry'].filter(Boolean).join('/')
    return `${prefix}/${tpl.remote_path.split('/').pop() || tpl.remote_path}`
  }

  function defaultPathFor(tpl: { remote_path: string }): string {
    return defaultPathForRemote(currentRemote.value, tpl)
  }

  function isRuleSelected(templateId: string): boolean {
    return config.wizard_sync_rules.some(r => r.template_id === templateId)
  }

  function toggleRule(templateId: string, remotePath: string) {
    const idx = config.wizard_sync_rules.findIndex(r => r.template_id === templateId)
    if (idx >= 0) {
      // 取消勾选前把已选路径存回 overrides ——
      // 不然重新勾选时会回落到默认值, 用户之前的选择白填了
      const removed = config.wizard_sync_rules[idx]
      if (removed.remote_path) _pathOverrides.value[templateId] = removed.remote_path
      config.wizard_sync_rules.splice(idx, 1)
    } else {
      config.wizard_sync_rules.push({
        template_id: templateId, remote: ruleRemoteName.value, remote_path: remotePath,
      })
    }
  }

  function updateRulePath(templateId: string, path: string) {
    const rule = config.wizard_sync_rules.find(r => r.template_id === templateId)
    if (rule) rule.remote_path = path
  }

  return {
    // State (aliased from module-level refs)
    storageType,
    storageName,
    storageFields,
    storageBucket,
    storageError,
    storageOauthParams,
    pathOverrides: _pathOverrides,

    // Computed (step 3 connect)
    currentFields,
    isOAuthType,
    cloudProviders: CLOUD_PROVIDERS,

    // Actions (step 3 connect)
    selectProvider,
    validateName,
    validateFields,
    ensureCreated,
    invalidateCreatedRemote,

    // Computed (step 4 rules)
    pullTemplates,
    pushTemplates,
    currentRemote,
    ruleRemoteName,

    // Actions (step 4 rules)
    defaultPathFor,
    isRuleSelected,
    toggleRule,
    updateRulePath,
  }
}
