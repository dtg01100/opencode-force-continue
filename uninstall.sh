#!/usr/bin/env bash
set -euo pipefail

PLUGIN_FILES=("force-continue.server.js")
PLUGIN_DIR="$HOME/.config/opencode/plugins"

echo "Uninstalling force-continue plugin from $PLUGIN_DIR"

for file in "${PLUGIN_FILES[@]}"; do
    if [ -f "$PLUGIN_DIR/$file" ]; then
        rm "$PLUGIN_DIR/$file"
        echo "  ✓ removed $file"
    else
        echo "  - $file not found, skipping"
    fi
done

echo ""
echo "Uninstalled. You may need to restart OpenCode."
