#!/usr/bin/env bash
set -euo pipefail

PLUGIN_FILES=("force-continue.js")

# Determine target directory
if [ "${1:-}" = "--project" ]; then
    PLUGIN_DIR=".opencode/plugins"
else
    PLUGIN_DIR="$HOME/.config/opencode/plugins"
fi

echo "Installing force-continue plugin to $PLUGIN_DIR"

mkdir -p "$PLUGIN_DIR"

for file in "${PLUGIN_FILES[@]}"; do
    cp "$file" "$PLUGIN_DIR/$file"
    echo "  ✓ $file"
done

echo ""
echo "Installed. Enable with /force-continue or /fc in OpenCode."
