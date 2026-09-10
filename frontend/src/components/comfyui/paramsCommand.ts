/**
 * paramsCommand — ComfyUI 启动参数 → 命令行 / 额外参数解析。
 *
 * 由原 ParamsCard.vue 迁出: 主页「版本与启动」用它展示已保存配置生成的一行
 * 启动命令, 参数弹窗用它把未收录的 extra_args 从 raw_args 中分离出来。
 * 只做纯计算, 不持有状态。
 */
import type { ParamSchema } from '@/types/comfyui'

export type ParamValue = string | number | boolean

export const LRU_CACHE_SIZE_PRESETS = ['16', '32', '64', '128', '256']

/** schema 默认值 + listen/port 补全, 与后端 build_comfyui_args 口径一致 */
export function collectParams(
  schema: Record<string, ParamSchema>,
  current: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const result: Record<string, ParamValue> = {}
  for (const [key, s] of Object.entries(schema)) {
    result[key] = current[key] ?? s.value
  }
  result.listen = current.listen || '0.0.0.0'
  result.port = current.port || 8188
  return result
}

/** depends_on 联动条件: 值以 '!' 开头表示「不等于」。 */
export function isParamEnabled(
  schema: ParamSchema,
  current: Record<string, ParamValue>,
): boolean {
  if (!schema.depends_on) return true
  return Object.entries(schema.depends_on).every(([depKey, depValue]) => {
    if (typeof depValue === 'string' && depValue.startsWith('!')) {
      return String(current[depKey]) !== depValue.slice(1)
    }
    return String(current[depKey]) === String(depValue)
  })
}

function knownArgFlags(schema: Record<string, ParamSchema>) {
  const withValue = new Set<string>(['--listen', '--port'])
  const standalone = new Set<string>()
  for (const s of Object.values(schema)) {
    if (s.flag) standalone.add(s.flag)
    if (s.flag_prefix) withValue.add(s.flag_prefix)
    if (s.flag_map) Object.values(s.flag_map).forEach(flag => standalone.add(flag))
  }
  return { withValue, standalone }
}

/** 从 raw_args 里剔除结构化参数, 返回剩余的用户额外命令行参数 */
export function extractExtraArgs(
  raw: string[] | string,
  schema: Record<string, ParamSchema>,
): string {
  const parts = Array.isArray(raw)
    ? raw
    : raw.replace(/^main\.py\s*/, '').split(/\s+/).filter(Boolean)
  const { withValue, standalone } = knownArgFlags(schema)
  const extras: string[] = []
  for (let i = 0; i < parts.length;) {
    if (withValue.has(parts[i])) {
      i += 2
      continue
    }
    if (standalone.has(parts[i])) {
      i += 1
      continue
    }
    if (parts[i] !== 'main.py') extras.push(parts[i])
    i += 1
  }
  return extras.join(' ')
}

/**
 * 由结构化参数 + 额外参数拼出主页展示的一行启动命令。
 * 复用原 ParamsCard 的 currentCommand 规则: flag_map 优先, 其次 flag_prefix,
 * number 类型的 0 视为未设置。
 */
export function buildLaunchCommand(
  schema: Record<string, ParamSchema>,
  current: Record<string, ParamValue>,
  extraArgs: string,
): string {
  const params = collectParams(schema, current)
  const args = ['main.py', '--listen', String(params.listen), '--port', String(params.port)]
  for (const [key, s] of Object.entries(schema)) {
    if (!isParamEnabled(s, current)) continue
    const value = current[key] ?? s.value
    const mapped = s.flag_map?.[String(value)]
    if (mapped) {
      args.push(mapped)
    } else if (s.flag_prefix && value !== 'default' && value !== '' && value !== false) {
      if (s.type === 'number' && value === 0) continue
      args.push(s.flag_prefix, String(value))
    } else if (s.flag && value === true) {
      args.push(s.flag)
    }
  }
  const extra = extraArgs.trim()
  return `${args.join(' ')}${extra ? ` ${extra}` : ''}`
}
