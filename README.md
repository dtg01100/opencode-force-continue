# opencode-force-continue

Forces OpenCode AI to continue when the model stops early. The AI must call `completionSignal` before stopping.

## Installation

### Quick install (global)

```bash
./install.sh
```

### Quick install (project-level)

```bash
./install.sh --project
```

### Uninstall

```bash
./uninstall.sh
```

### Manual install

Copy the plugin files into OpenCode's plugin directory.

**Global** (all projects):

```bash
mkdir -p ~/.config/opencode/plugins
cp force-continue.js ~/.config/opencode/plugins/
```

**Project-level** (current project only):

```bash
mkdir -p .opencode/plugins
cp force-continue.js .opencode/plugins/
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
3. **Auto-Continue**: If the session becomes idle without the completion signal, the plugin sends a "Continue" prompt (repeatable on every idle check until completion)
4. **Completion**: Once the AI calls `completionSignal`, the plugin stops auto-continuing

## Recent updates
- Added robust idle retry logic to send `Continue` repeatedly when the assistant is idle and still not complete.
- Added a local fallback babysitter implementation in `src/babysitter.js` to support environments without a task babysitter hook.

## Architecture

### Server-Only Design

This plugin now uses a server-only approach in `force-continue.server.js`.
State is shared via a JSON file at `tmpdir()/opencode-force-continue/state.json` to preserve behavior between processes when needed.

### State Persistence

This server-only plugin keeps state in-memory per process and per session for runtime control. There is no filesystem-based state persistence in this version.

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
