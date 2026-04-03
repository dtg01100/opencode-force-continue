# opencode-force-continue

Forces OpenCode AI to continue when the model stops early. The AI must call `completionSignal` before stopping.

## Installation

Copy the plugin files into OpenCode's plugin directory.

### Global (all projects)

```bash
mkdir -p ~/.config/opencode/plugins
cp force-continue.server.js force-continue.tui.js flags.js ~/.config/opencode/plugins/
```

### Project-level (current project only)

```bash
mkdir -p .opencode/plugins
cp force-continue.server.js force-continue.tui.js flags.js .opencode/plugins/
```

OpenCode automatically loads any `.js` or `.ts` files from these directories at startup.

## Usage

Force-continue is **disabled by default**. Enable it with the slash command:

```
/force-continue
```

Or use the alias:

```
/fc
```

When enabled, OpenCode will inject a system message requiring the AI to call `completionSignal` when finished with a task.

If the AI stops without calling it (session becomes idle), the plugin automatically prompts "Continue" to keep the agent running.

Run `/force-continue` again to toggle it off.

## How It Works

1. **Enable**: Toggle with `/force-continue` or `/fc`
2. **System Injection**: When enabled, a system message is added requiring the AI to call `completionSignal` before stopping
3. **Auto-Continue**: If the session becomes idle without the completion signal, the plugin sends a "Continue" prompt
4. **Completion**: Once the AI calls `completionSignal`, the plugin stops auto-continuing

## Architecture

### Two-Plugin Design

This plugin uses two files because OpenCode's server and TUI run in **separate processes** with no shared state primitive:

- **`force-continue.server.js`** — Runs in the server process. Handles event hooks, tool definitions, and auto-continue logic.
- **`force-continue.tui.js`** — Runs in the TUI process. Handles slash commands, status rendering, and user interaction.

### State Persistence

The server plugin has no access to the TUI's KV store, and there is no general-purpose IPC mechanism in OpenCode's plugin API. Instead, both plugins share state via a single JSON file at `tmpdir()/opencode-force-continue/state.json`:

```json
{
  "sessions": { "abc123": true },
  "nextSession": false,
  "version": 5
}
```

- **Atomic writes** — State is written to a temp file then atomically renamed to prevent corruption
- **Legacy migration** — On first load, old per-session flag files are automatically migrated into the JSON state
- **Orphan cleanup** — When a session is deleted, its entry is cleaned up from state

### Why Not Use the KV Store?

The TUI plugin uses `api.kv` for reactive UI updates, but the server plugin context only provides `{ project, client, $, directory, worktree }` — no KV access. The server API also has no KV endpoint. File-based state is the only viable cross-process communication available.

## Development

```bash
npm install
npm run test:run
```

## Requirements

- OpenCode AI
- `@opencode-ai/plugin` (loaded automatically by OpenCode)

## License

MIT
