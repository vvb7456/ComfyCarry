#!/usr/bin/env bash
# 从 public/logo-tile.svg 重新生成所有栅格图标。
# 改了标识就跑一次: bash frontend/scripts/build-icons.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUB="$HERE/../public"
TILE="$PUB/logo-tile.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CHROME="${CHROME:-google-chrome}"
command -v "$CHROME" >/dev/null || { echo "需要 google-chrome (或设 CHROME=...)"; exit 1; }

render() {  # render <size> <out>
  local n=$1 out=$2
  cat > "$TMP/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${n}px;height:${n}px}</style>
<img src="logo-tile.svg">
HTML
  cp "$TILE" "$TMP/logo-tile.svg"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$n,$n" \
    --default-background-color=00000000 \
    --screenshot="$out" "file://$TMP/page.html" 2>/dev/null
  echo "  ${n}px -> $(basename "$out")"
}

echo "从 logo-tile.svg 生成图标:"
render 192 "$PUB/logo.png"
render 36  "$PUB/logo-small.png"
render 180 "$PUB/apple-touch-icon.png"
render 48  "$TMP/ico-48.png"
render 32  "$TMP/ico-32.png"
render 16  "$TMP/ico-16.png"

python3 - "$TMP" "$PUB/favicon.ico" <<'PY'
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
imgs = [Image.open(f"{tmp}/ico-{n}.png").convert("RGBA") for n in (48, 32, 16)]
imgs[0].save(out, format="ICO", sizes=[(48, 48), (32, 32), (16, 16)])
print(f"  favicon.ico <- 48/32/16")
PY

echo "完成。"
