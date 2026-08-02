#!/bin/bash
# ─────────────────────────────────────────────────────────────
# TABBSS macOS DMG Builder
# Run on macOS after PyInstaller has built TABBSS.app
#
# Prerequisites:
#   brew install create-dmg
#   pyinstaller tabbss.spec  (builds dist/TABBSS.app)
#
# Usage:
#   bash scripts/build_dmg.sh internal
# ─────────────────────────────────────────────────────────────

set -e

EDITION="${1:-internal}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
DIST="$ROOT/dist"
ICON_PNG="$ROOT/icon/TABBSS.png"

# ── Read version ──────────────────────────────────────────
VERSION=$(cat "$ROOT/VERSION" 2>/dev/null || echo "1.6.0")
echo "TABBSS DMG Builder — $EDITION edition — V$VERSION"

# ── Check prerequisites ───────────────────────────────────
if ! command -v create-dmg &>/dev/null; then
    echo "ERROR: create-dmg not found. Install with: brew install create-dmg"
    exit 1
fi

APP="$DIST/TABBSS.app"
if [ ! -d "$APP" ]; then
    echo "ERROR: TABBSS.app not found at $APP"
    echo "  Run first: pyinstaller tabbss.spec"
    exit 1
fi

# ── Convert PNG to ICNS (macOS requires .icns) ─────────────
ICONSET="$DIST/TABBSS.iconset"
ICNS="$DIST/TABBSS.icns"

if [ -f "$ICON_PNG" ]; then
    echo "Generating .icns from icon PNG..."
    mkdir -p "$ICONSET"

    # Generate required sizes
    sips -z 16 16   "$ICON_PNG" --out "$ICONSET/icon_16x16.png" &>/dev/null
    sips -z 32 32   "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" &>/dev/null
    sips -z 32 32   "$ICON_PNG" --out "$ICONSET/icon_32x32.png" &>/dev/null
    sips -z 64 64   "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" &>/dev/null
    sips -z 128 128 "$ICON_PNG" --out "$ICONSET/icon_128x128.png" &>/dev/null
    sips -z 256 256 "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" &>/dev/null
    sips -z 256 256 "$ICON_PNG" --out "$ICONSET/icon_256x256.png" &>/dev/null
    sips -z 512 512 "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" &>/dev/null
    sips -z 512 512 "$ICON_PNG" --out "$ICONSET/icon_512x512.png" &>/dev/null

    iconutil -c icns "$ICONSET" -o "$ICNS"
    rm -rf "$ICONSET"

    # Apply icns to .app
    cp "$ICNS" "$APP/Contents/Resources/icon.icns"
    touch "$APP"
    echo "  ICNS applied to TABBSS.app"
else
    echo "WARNING: No icon PNG found at $ICON_PNG"
fi

# ── Copy data directories into .app bundle ─────────────────
APP_RES="$APP/Contents/Resources"
echo "Copying data directories into .app bundle..."
cp -R "$ROOT/报站线路文件库" "$APP_RES/" 2>/dev/null || echo "  (no 报站线路文件库)"
cp -R "$ROOT/兼容模式-海峡报站器文件库" "$APP_RES/" 2>/dev/null || echo "  (no 兼容模式)"

# ── Create DMG ────────────────────────────────────────────
DMG_NAME="TABBSS_${EDITION}_V${VERSION}.dmg"
DMG_PATH="$DIST/$DMG_NAME"

echo "Creating DMG: $DMG_PATH"
create-dmg \
    --volname "档案库报站模拟器" \
    --volicon "$ICNS" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "TABBSS.app" 180 190 \
    --hide-extension "TABBSS.app" \
    --app-drop-link 420 190 \
    "$DMG_PATH" \
    "$DIST/TABBSS.app"

echo ""
echo "Done! DMG created: $DMG_PATH"
echo "  Size: $(du -sh "$DMG_PATH" | cut -f1)"
