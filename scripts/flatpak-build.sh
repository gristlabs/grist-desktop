#!/usr/bin/env bash
set -euo pipefail

echo "Checking Flatpak tooling..."
command -v flatpak >/dev/null || { echo "flatpak not found. Please install flatpak"; exit 1; }
command -v flatpak-builder >/dev/null || { echo "flatpak-builder not found. Please install flatpak-builder"; exit 1; }

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
