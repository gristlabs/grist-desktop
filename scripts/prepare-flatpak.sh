#!/usr/bin/env bash
set -euo pipefail

ICON_SRC="core/static/icons/grist.svg"
ICON_OUT_DIR="dist/icons/"
SIZES=(16 32 48 64 128 256 512)

echo "Checking Flatpak tooling..."
command -v flatpak >/dev/null || { echo "flatpak not found. Please install flatpak"; exit 1; }
command -v flatpak-builder >/dev/null || { echo "flatpak-builder not found. Please install flatpak-builder"; exit 1; }
command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found. Please install librsvg2-bin"; exit 1; }

echo "Generating PNG icons for Flatpak..."
mkdir -p "$ICON_OUT_DIR"
for size in "${SIZES[@]}"; do
    rsvg-convert -w "$size" -h "$size" "$ICON_SRC" -o "$ICON_OUT_DIR/${size}x${size}.png"
done

echo "Copying SVG icon for Flatpak..."
cp "$ICON_SRC" "$ICON_OUT_DIR/scalable.svg"

echo "Ensuring Flathub remote exists (needed for runtimes)..."
if ! flatpak remote-list | grep -q "^flathub"; then
  flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
fi

echo "Installing required runtimes if missing..."
flatpak install -y --noninteractive flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 org.electronjs.Electron2.BaseApp//25.08 || true

echo "Done. The flatpak can now be built using the normal linux build process (yarn run electron:linux)"
