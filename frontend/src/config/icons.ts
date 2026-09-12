import { ICON_CODEPOINTS, type IconName } from './icon-codepoints'

const hasOwn = Object.prototype.hasOwnProperty

/**
 * 运行时白名单校验 —— 用于把后端/动态数据里的字符串收窄成 IconName。
 * 静态代码应直接使用 IconName 类型, 只有跨类型边界时才需要这个函数。
 *
 * 约束: 禁止用 `as IconName` 绕过; 所有不受类型系统约束的来源
 * (任意对象字段、后端响应等) 都必须先过这里。
 *
 * 注意必须用 hasOwnProperty 而非 `in`: `in` 会命中 Object.prototype,
 * 使 'toString'/'constructor' 这类原型键被误判为合法图标名。
 */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && hasOwn.call(ICON_CODEPOINTS, value)
}

const warnedUnknownIcons = new Set<string>()

/** 未知图标名只报告一次 (模块级去重, 跨组件实例生效) */
export function reportUnknownIcon(name: string): void {
  if (warnedUnknownIcons.has(name)) return
  warnedUnknownIcons.add(name)
  console.error(`[MsIcon] 未知图标名 "${name}" — 不在 icons.txt 清单中, 请检查调用点`)
}
