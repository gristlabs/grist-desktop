#!/usr/bin/env bash
set -euo pipefail

ICON_SRC="core/static/icons/grist.svg"
ICON_OUT_DIR="dist/icons/"
SIZES=(16 32 48 64 128 256 512)

echo "Checking Flatpak tooling..."
command -v flatpak >/dev/null || { echo "flatpak not found. Please install flatpak"; exit 1; }
command -v flatpak-builder >/dev/null || { echo "flatpak-builder not found. Please install flatpak-builder"; exit 1; }

echo "Generating PNG icons for Flatpak..."
mkdir -p "$ICON_OUT_DIR"
for size in "${SIZES[@]}"; do
    rsvg-convert -w "$size" -h "$size" "$ICON_SRC" -o "$ICON_OUT_DIR/${size}x${size}.png"
done

echo "Ensuring Flathub remote exists (needed for runtimes)..."
if ! flatpak remote-list | grep -q "^flathub"; then
  flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
fi

echo "Installing required runtimes if missing..."
flatpak install -y --noninteractive flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08 org.electronjs.Electron2.BaseApp//23.08 || true

echo "Installing dependencies..."
yarn install

echo "Project setup (Python env etc.)..."
yarn run setup

echo "Building app (production)..."
yarn run build

echo "Packaging Flatpak..."
yarn run electron:flatpak

echo "Done. Look in the dist/ folder for the .flatpak file."
