/**
 * Prompt normalization utility.
 *
 * 可配置的规格化：根据编辑器设置决定启用哪些转换。
 * 始终执行：comma formatting (含连续逗号折叠) / space collapse / 首尾逗号清理。
 * 注意: 不做同名 tag 去重 — 重复 tag 在权重叠加上是有意义的写法。
 */

export interface NormalizeOptions {
  /** 全角逗号 → 半角逗号 (，→ ,) */
  comma?: boolean
  /** 全角句号 → 半角句号 (。→ .) */
  period?: boolean
  /** 全角括号 → 半角括号 (（）→ () / 【】→ []) */
  bracket?: boolean
  /** 下划线 → 空格 (_ → space)，特殊语法段落除外 (见 RE_PROTECTED) */
  underscore?: boolean
}

const DEFAULT_OPTIONS: NormalizeOptions = {
  comma: true,
  period: true,
  bracket: true,
  underscore: false,
}

// 下划线替换的豁免段落 — 这些语法里的 `_` 是标识符的一部分，改成空格会直接失效:
//   __wildcard__ / __sdxl/quality__  → 后端 dynamicprompts 按字面名查 wildcards/ 文件
//   embedding:my_embed              → ComfyUI 按字面名查 embeddings/
//   <lora:name_v1:0.8> / <wlr:...>  → 内联 LoRA 语法 (models.py 层 2 扫描同款)
//   ${var_name} / ${c=!{a|b}}       → dynamicprompts 变量名
// wildcard 名允许空格 (文件名不受限), 故只以逗号/换行为界 — 与 usePromptEditor
// 的 RE_WILDCARD (按逗号切分后整段匹配) 语义一致。
const RE_PROTECTED = /__[^\s_][^,\n]*?__|<(?:lora|lyco|wlr):[^>]*>|embedding:[^\s,)]+|\$\{[^}]*\}/gi

// 占位用控制字符 — 正常提示词不可能出现，避免与正文冲突
const PLACEHOLDER = '\u0000'

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
    // 先把受保护段落挖出来占位，替换完下划线再原样填回
    const kept: string[] = []
    s = s.replace(RE_PROTECTED, (m) => {
      kept.push(m)
      return `${PLACEHOLDER}${kept.length - 1}${PLACEHOLDER}`
    })
    s = s.replace(/_/g, ' ')
    s = s.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_m, i) => kept[Number(i)])
  }

  // 始终执行的格式化
  s = s
    .replace(/\s*(?:,\s*)+/g, ', ')  // 折叠连续逗号 + 统一逗号间距
    .replace(/^\s*,\s*|\s*,\s*$/g, '') // remove leading/trailing commas
    .replace(/\(\s+/g, '(')          // bracket whitespace
    .replace(/\s+\)/g, ')')
    .replace(/ {2,}/g, ' ')          // collapse multiple spaces
    .trim()

  return s
}
