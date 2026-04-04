#!/usr/bin/env bash
set -euo pipefail

PLUGIN_FILES=("force-continue.server.js")

# Determine target directory
if [ "${1:-}" = "--project" ]; then
	PLUGIN_DIR=".opencode/plugin"
else
	PLUGIN_DIR="$HOME/.config/opencode/plugin"
fi

echo "Installing force-continue plugin to $PLUGIN_DIR"

mkdir -p "$PLUGIN_DIR"

for file in "${PLUGIN_FILES[@]}"; do
	cp "$file" "$PLUGIN_DIR/$file"
	echo "  ✓ $file"
done

echo ""
echo "Installed. Force-continue is always on — no toggle needed."
