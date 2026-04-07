/**
 * Prompt normalization utility.
 *
 * 可配置的规格化：根据编辑器设置决定启用哪些转换。
 * 始终执行：comma formatting / duplicate removal / space collapse。
 */

export interface NormalizeOptions {
  /** 全角逗号 → 半角逗号 (，→ ,) */
  comma?: boolean
  /** 全角句号 → 半角句号 (。→ .) */
  period?: boolean
  /** 全角括号 → 半角括号 (（）→ () / 【】→ []) */
  bracket?: boolean
  /** 下划线 → 空格 (_ → space) */
  underscore?: boolean
  /** 括号转义 — 自动添加 \ 转义括号 */
  escapeBracket?: boolean
}

const DEFAULT_OPTIONS: NormalizeOptions = {
  comma: true,
  period: true,
  bracket: true,
  underscore: false,
  escapeBracket: false,
}

export function normalizePrompt(text: string, opts: NormalizeOptions = DEFAULT_OPTIONS): string {
  let s = text

  // 全角 → 半角 (按设置启用)
  if (opts.comma !== false) {
    s = s.replace(/，/g, ',')
  }
  if (opts.period !== false) {
    s = s.replace(/。/g, '.')
  }
  if (opts.bracket !== false) {
    s = s.replace(/（/g, '(').replace(/）/g, ')')
    s = s.replace(/【/g, '[').replace(/】/g, ']')
    s = s.replace(/；/g, ';').replace(/：/g, ':')
  }
  if (opts.underscore) {
    s = s.replace(/_/g, ' ')
  }
  if (opts.escapeBracket) {
    // 转义未转义的圆括号: ( → \(  ) → \)  但跳过已有 \( 的
    s = s.replace(/(?<!\\)\(/g, '\\(').replace(/(?<!\\)\)/g, '\\)')
  }

  // 始终执行的格式化
  s = s
    .replace(/\s*,\s*/g, ', ')     // uniform comma spacing
    .replace(/,\s*,/g, ',')        // remove duplicate commas
    .replace(/^\s*,|,\s*$/g, '')   // remove leading/trailing commas
    .replace(/\(\s+/g, '(')        // bracket whitespace
    .replace(/\s+\)/g, ')')
    .replace(/ {2,}/g, ' ')        // collapse multiple spaces
    .trim()

  return s
}
