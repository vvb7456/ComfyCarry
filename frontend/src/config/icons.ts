import { ICON_CODEPOINTS, type IconName } from './icon-codepoints'

const hasOwn = Object.prototype.hasOwnProperty

/**
 * 必须用 hasOwnProperty 而非 `in`: `in` 会命中 Object.prototype,
 * 使 'toString'/'constructor' 这类原型键被误判为合法图标名。
 */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && hasOwn.call(ICON_CODEPOINTS, value)
}

const warnedUnknownIcons = new Set<string>()

export function reportUnknownIcon(name: string): void {
  if (warnedUnknownIcons.has(name)) return
  warnedUnknownIcons.add(name)
  console.error(`[MsIcon] 未知图标名 "${name}" — 不在 icons.txt 清单中, 请检查调用点`)
}
