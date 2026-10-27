#!/usr/bin/env bash
# installer-art.sh - the Windows setup wizard's own artwork (build/installerSidebar.bmp,
# build/uninstallerSidebar.bmp), in the brand's language: pure black, the armillary mark, DEUS NEUMA in
# Inter Light, the line in JetBrains Mono. Drawn at 4x and reduced to NSIS's 164x314, 24-bit BMP.
#   scripts/installer-art.sh            (needs ImageMagick 7, Inter and JetBrains Mono)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MARK=$ROOT/build/brand/neuma-mark-ink.svg
INTER=$(fc-match -f '%{file}' 'Inter:light')
MONO=$(fc-match -f '%{file}' 'JetBrains Mono')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

magick -background none -density 1200 "$MARK" -resize 400x400 "$TMP/mark.png"

draw() { # $1 out, $2 caption under the line
  magick -size 656x1256 xc:'#000000' \
    "$TMP/mark.png" -gravity north -geometry +0+190 -composite \
    -density 72 -font "$INTER" -fill '#F2F2F2' -pointsize 60 -kerning 18 -annotate +0+680 'DEUS NEUMA' \
    -stroke 'rgba(255,255,255,0.25)' -strokewidth 2 -draw 'line 248,800 408,800' -stroke none \
    -font "$MONO" -fill 'rgba(255,255,255,0.64)' -pointsize 30 -kerning 4 -annotate +0+840 "$2" \
    -fill 'rgba(255,255,255,0.45)' -pointsize 26 -kerning 6 -gravity south -annotate +0+70 'IGNIS AI LABS' \
    -filter Lanczos -resize '164x314!' -type TrueColor "BMP3:$1"
}
draw "$ROOT/build/installerSidebar.bmp" $'SOVEREIGN\nRELATIONSHIPS\nWITH AI'
draw "$ROOT/build/uninstallerSidebar.bmp" $'SOVEREIGN\nRELATIONSHIPS\nWITH AI'
echo "wrote build/installerSidebar.bmp, build/uninstallerSidebar.bmp"
