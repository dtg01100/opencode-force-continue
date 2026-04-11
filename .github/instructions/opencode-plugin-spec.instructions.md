---
description: "OpenCode v1 plugin spec compliance rules for server and TUI plugin separation"
applyTo: "**/*.js"
---

# OpenCode Plugin Spec Compliance

## v1 Plugin Module Separation

OpenCode v1 requires strict separation between server and TUI plugin modules:

- **Server modules** (`force-continue.server.js`): Must export `{ id, server }` - NO `tui` property
- **TUI modules** (`force-continue.tui.js`): Must export `{ id, tui }` - NO `server` property
- A single module CANNOT export both `server` and `tui`

## Package Exports Configuration

`package.json` must declare separate entrypoints:

```json
{
  "exports": {
    ".": { "import": "./force-continue.server.js" },
    "./server": { "import": "./force-continue.server.js" },
    "./tui": { "import": "./force-continue.tui.js" }
  }
}
```

## Configuration Files

- **Server plugins**: Configured in `opencode.json` under `"plugin"` array
- **TUI plugins**: Configured in `tui.json` under `"plugin"` array

Both files are required for full plugin functionality.

## Key References

- Server loader uses `package.json` `main` for path specs
- TUI loader ONLY resolves `./tui` export, never falls back to `main` or `exports["."]`
- If `./tui` is missing but `oc-themes` exists, runtime creates no-op module
- v0 legacy compatibility is maintained in server runtime only

## Common Pitfalls

- Don't re-export `tui` from server module - violates v1 spec
- Don't assume `opencode.json` plugin config loads TUI - need separate `tui.json`
- Don't mix server and TUI concerns in single file - use separate entrypoints
