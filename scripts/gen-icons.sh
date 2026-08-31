#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="assets/letters.png"
ICONSET="assets/icon.iconset"

for spec in "icon_16x16.png 16" "icon_16x16@2x.png 32" "icon_32x32.png 32" "icon_32x32@2x.png 64" "icon_128x128.png 128" "icon_128x128@2x.png 256" "icon_256x256.png 256" "icon_256x256@2x.png 512" "icon_512x512.png 512" "icon_512x512@2x.png 1024"; do
	set -- $spec
	sips -z "$2" "$2" "$SRC" --out "$ICONSET/$1" >/dev/null
done

echo "icons regenerated from $SRC"
