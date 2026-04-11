---
description: "Use the current OpenCode repository as the authoritative source for plugin behaviors, API shapes, and runtime details"
applyTo: "**/*"
---

# OpenCode Reference Source

## Authoritative Repository

Always use the current OpenCode repository for research and reference:

- **Current repository**: `https://github.com/anomalyco/opencode`
- **Branch**: `dev` (default development branch)
- **Package**: `opencode-ai` on npm

## Deprecated References

Do NOT use any archived or legacy OpenCode repositories as references. These may contain outdated API shapes, plugin loading semantics, or configuration patterns.

## Key Paths for Plugin Development

When researching OpenCode plugin behaviors:

- **TUI plugin spec**: `packages/opencode/specs/tui-plugins.md`
- **TUI plugin runtime**: `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- **Plugin types**: `packages/plugin/src/tui.ts`
- **TUI config**: `packages/opencode/src/config/tui.ts`
- **Plugin loader**: `packages/opencode/src/plugin/loader.ts`

## Configuration Files

- `opencode.json` → server plugins
- `tui.json` → TUI plugins
- Both files may coexist in project or global config

## Version Awareness

Check the current installed version (`opencode version`) and reference matching source code. Plugin APIs and loading semantics may change between versions.
