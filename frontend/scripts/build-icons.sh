#!/usr/bin/env bash
# 重新生成栅格图标:
#   favicon.ico        <- logo-mark.svg (透明背景, 浏览器标签页用)
#   apple-touch-icon   <- logo-tile.svg (iOS 主屏图标不支持透明, 规范即带底板)
# 改了标识就跑一次: bash frontend/scripts/build-icons.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUB="$HERE/../public"
MARK="$PUB/logo-mark.svg"
TILE="$PUB/logo-tile.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CHROME="${CHROME:-google-chrome}"
command -v "$CHROME" >/dev/null || { echo "需要 google-chrome (或设 CHROME=...)"; exit 1; }

render() {
  local n=$1 out=$2 src=$3
  local base
  base="$(basename "$src")"
  cat > "$TMP/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${n}px;height:${n}px}</style>
<img src="${base}">
HTML
  cp "$src" "$TMP/$base"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$n,$n" \
    --default-background-color=00000000 \
    --screenshot="$out" "file://$TMP/page.html" 2>/dev/null
  echo "  ${n}px -> $(basename "$out")"
}

echo "从 logo-mark.svg 生成 favicon.ico:"
render 48  "$TMP/ico-48.png" "$MARK"
render 32  "$TMP/ico-32.png" "$MARK"
render 16  "$TMP/ico-16.png" "$MARK"

echo "从 logo-tile.svg 生成 apple-touch-icon:"
render 180 "$PUB/apple-touch-icon.png" "$TILE"

python3 - "$TMP" "$PUB/favicon.ico" <<'PY'
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
imgs = [Image.open(f"{tmp}/ico-{n}.png").convert("RGBA") for n in (48, 32, 16)]
imgs[0].save(out, format="ICO", sizes=[(48, 48), (32, 32), (16, 16)])
print(f"  favicon.ico <- 48/32/16")
PY

echo "完成。"
