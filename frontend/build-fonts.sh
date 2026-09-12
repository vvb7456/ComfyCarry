#!/bin/bash
# ==============================================================================
# Font Build Script
#
# 在 CI 环境中运行，生成前端所需的字体文件:
# - Material Symbols Outlined 子集化 (仅保留使用到的图标)
#
# 图标名来源 (自动合并去重):
# 1. 源码中 MsIcon 的 name="xxx" 静态绑定
# 2. 源码中 :name="... 'xxx' ..." 动态绑定内的字符串字面量
# 3. 任意组件的 icon="xxx" 静态 prop (SectionHeader/AlertBanner/OptionCard/EmptyState 等
#    把 icon prop 转传给 MsIcon 的间接调用, 无需在 icons.txt 手动补)
# 4. 任意组件的 :icon="... 'xxx' ..." 动态绑定内的字符串字面量
# 5. MsIcon.vue 中 ICON_COLORS 映射表的 key (兼容旧实现)
# 6. icons.txt 补充清单 (用于 JS 变量/对象/computed 传递等仍无法自动提取的图标)
#
# 输出: frontend/public/fonts/MaterialSymbolsOutlined.woff2
# ==============================================================================

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FONTS_DIR="$SCRIPT_DIR/public/fonts"
SRC_DIR="$SCRIPT_DIR/src"
ICONS_FILE="$SCRIPT_DIR/icons.txt"

echo "=== Font Build ==="

# ── 1. 从源码自动提取图标名 ──
echo ">>> [1/2] Extracting icon names from source..."

# 1a. MsIcon 静态绑定: <MsIcon ... name="icon_name" ...
STATIC_ICONS=$(grep -rh --include='*.vue' 'MsIcon' "$SRC_DIR" 2>/dev/null | grep -oP '\bname="[a-z_]+"' | grep -oP '(?<=name=")[a-z_]+' || true)

# 1b. MsIcon 动态绑定: :name="... 'icon_name' ..." 中的单引号字符串
DYNAMIC_ICONS=$(grep -rh --include='*.vue' 'MsIcon' "$SRC_DIR" 2>/dev/null | grep -oP ":name=\"[^\"]*'" | grep -oP "'[a-z_]+'" | tr -d "'" || true)

# 1c. 任意组件 icon="xxx" 静态 prop (SectionHeader/AlertBanner/OptionCard/EmptyState 等
#      间接把 icon prop 转传给 MsIcon 的调用点; 扫描所有 .vue, 不限 MsIcon)
ICON_PROP_STATIC=$(grep -rh --include='*.vue' 'icon="[a-z_0-9]' "$SRC_DIR" 2>/dev/null | grep -oP 'icon="[a-z_0-9]+"' | grep -oP '(?<=icon=")[a-z_0-9]+' || true)

# 1d. 任意组件 :icon="... 'icon_name' ..." 动态绑定内的单引号字符串
ICON_PROP_DYNAMIC=$(grep -rh --include='*.vue' ":icon=\"[^\"]*'" "$SRC_DIR" 2>/dev/null | grep -oP ":icon=\"[^\"]*'" | grep -oP "'[a-z_0-9]+'" | tr -d "'" || true)

# 1e. JS 对象字面量中的 icon: 'icon_name' 属性 (Tab 配置、菜单等)
JS_OBJECT_ICONS=$(grep -rh --include='*.vue' --include='*.ts' -oP "icon:\s*'\K[a-z_0-9]+" "$SRC_DIR" 2>/dev/null || true)

# 1g. icons.txt 补充清单 (JS 变量/对象/computed 传递等无法自动提取的图标)
MANUAL_ICONS=""
if [ -f "$ICONS_FILE" ]; then
    MANUAL_ICONS=$(grep -v '^#' "$ICONS_FILE" | grep -v '^\s*$' | tr -d '\r')
fi

# 合并去重
ALL_ICONS=$(echo -e "${STATIC_ICONS}\n${DYNAMIC_ICONS}\n${ICON_PROP_STATIC}\n${ICON_PROP_DYNAMIC}\n${JS_OBJECT_ICONS}\n${MANUAL_ICONS}" | grep -v '^\s*$' | sort -u)

AUTO_COUNT=$(echo -e "${STATIC_ICONS}\n${DYNAMIC_ICONS}\n${ICON_PROP_STATIC}\n${ICON_PROP_DYNAMIC}\n${JS_OBJECT_ICONS}" | grep -v '^\s*$' | sort -u | wc -l)
TOTAL_COUNT=$(echo "$ALL_ICONS" | wc -l)
echo "  Auto-extracted: ${AUTO_COUNT}, Manual (icons.txt): +$(echo "$MANUAL_ICONS" | grep -v '^\s*$' | wc -l), Total unique: ${TOTAL_COUNT}"

# ── 2. Material Symbols Outlined 子集化 ──
echo ">>> [2/2] Material Symbols subset..."

MS_FULL="/tmp/MaterialSymbolsOutlined-full.woff2"
MS_TTF="/tmp/MaterialSymbolsOutlined-full.ttf"
MS_OUTPUT="$FONTS_DIR/MaterialSymbolsOutlined.woff2"

CODEPOINTS_URL="https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints"
FONT_URL="https://github.com/google/material-design-icons/raw/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.woff2"

# 下载完整字体和 codepoints 映射 (如果已在提取步骤下载则复用)
wget -q -O "$MS_FULL" "$FONT_URL"
CP_FILE="/tmp/ms-codepoints.txt"
[ -f "$CP_FILE" ] || wget -q -O "$CP_FILE" "$CODEPOINTS_URL"
echo "  Downloaded full font: $(du -h "$MS_FULL" | cut -f1)"

# woff2 → ttf (fontTools 读取 cmap 用, 同时供后续子集化)
python3 -c "
from fontTools.ttLib import TTFont
font = TTFont('$MS_FULL')
font.flavor = None
font.save('$MS_TTF')
"

# 解析 codepoint: 优先用上游 codepoints 文件; 若该编码在字体 cmap 中不存在,
# 则按字形名回退到字体实际编码并告警 (上游文件偶有滞后, 如 movie e684 实际为 e404,
# 直接信任会导致 pyftsubset 静默丢字形、页面渲染空白)
RESOLVED_FILE="/tmp/ms-icons-resolved.tsv"
ICONS_TMP="/tmp/ms-icons-list.txt"
printf '%s\n' "$ALL_ICONS" > "$ICONS_TMP"
python3 - "$CP_FILE" "$MS_TTF" "$ICONS_TMP" "$RESOLVED_FILE" <<'PYEOF'
import sys
from fontTools.ttLib import TTFont

cp_file, ttf_path, icons_path, resolved_path = sys.argv[1:5]

declared = {}
with open(cp_file) as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) == 2:
            declared[parts[0]] = parts[1]

cmap = TTFont(ttf_path).getBestCmap()
glyph_cps = {}
for codepoint, glyph in cmap.items():
    glyph_cps.setdefault(glyph, []).append(codepoint)

icons = [line.strip() for line in open(icons_path) if line.strip()]
resolved = {}
warnings = []
for name in icons:
    hexcp = declared.get(name)
    codepoint = int(hexcp, 16) if hexcp else None
    if codepoint is not None and codepoint in cmap:
        resolved[name] = hexcp
        continue
    candidates = glyph_cps.get(name)
    if candidates:
        chosen = max(candidates)
        resolved[name] = f'{chosen:04x}'
        warnings.append(f'{name}: {hexcp or "(none)"} -> {chosen:04x}')
    elif hexcp:
        warnings.append(f'{name}: {hexcp} missing from font')

with open(resolved_path, 'w') as out:
    for name in sorted(resolved):
        out.write(f'{name} {resolved[name]}\n')
for w in warnings:
    print(f'  [WARN] codepoint corrected: {w}')
PYEOF

UNICODES=$(awk '{printf ",U+%s", $2}' "$RESOLVED_FILE")
UNICODES="${UNICODES#,}"
MISSING=$(comm -23 <(sort -u "$ICONS_TMP") <(cut -d' ' -f1 "$RESOLVED_FILE" | sort -u) | tr '\n' ' ')

if [ -n "${MISSING// /}" ]; then
    echo "  Missing codepoints for: ${MISSING}"
fi

ICON_COUNT=$(echo "$ALL_ICONS" | wc -l)
UNICODE_COUNT=$(wc -l < "$RESOLVED_FILE")
echo "  Icons: ${ICON_COUNT}, Unicodes: ${UNICODE_COUNT}"

# ── 2a. 生成 codepoint 映射 (MsIcon 用 codepoint 渲染，无需 ligature) ──
CODEPOINT_FILE="$SRC_DIR/config/icon-codepoints.ts"
python3 - "$RESOLVED_FILE" "$CODEPOINT_FILE" <<'PYEOF'
import sys

resolved_path, out_path = sys.argv[1:3]
entries = []
with open(resolved_path) as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) == 2:
            entries.append((parts[0], parts[1]))

with open(out_path, 'w') as out:
    out.write('// Auto-generated by build-fonts.sh — DO NOT EDIT\n')
    out.write('export const ICON_CODEPOINTS: Record<string, string> = {\n')
    for name, cp in sorted(entries):
        out.write("  '%s': '\\u%s',\n" % (name, cp))
    out.write('}\n')
PYEOF
echo "  Generated: $(basename "$CODEPOINT_FILE") (${UNICODE_COUNT} entries)"

mkdir -p "$FONTS_DIR"
pyftsubset "$MS_TTF" \
    --unicodes="$UNICODES" \
    --layout-features='*' \
    --flavor=woff2 \
    --output-file="$MS_OUTPUT"

echo "  Subset: $(du -h "$MS_OUTPUT" | cut -f1) (from $(du -h "$MS_FULL" | cut -f1))"
echo "=== Done ==="
