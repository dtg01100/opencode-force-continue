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
cp force-continue.server.js ~/.config/opencode/plugins/
```

**Project-level** (current project only):

```bash
mkdir -p .opencode/plugins
cp force-continue.server.js .opencode/plugins/
```

OpenCode automatically loads any `.js` or `.ts` files from these directories at startup.

## Usage

Force-continue is **always on**. No toggle needed.

When installed, the plugin automatically:

1. **Injects a system message** requiring the AI to call `completionSignal` when finished with a task
2. **Tracks session state** — marks sessions as incomplete on every new message
3. **Auto-continues** — if the session becomes idle without the completion signal, the plugin sends a "Continue" prompt
4. **Checks for unfinished tasks** — if a task babysitter or task query hook is available, it checks for remaining work before auto-continuing
5. **Stops** — once the AI calls `completionSignal`, the plugin stops auto-continuing for that session

## Architecture

### Server-Only Design

This plugin uses a single server file: `force-continue.server.js`.

State is kept in-memory per process, keyed by session ID. When a session is deleted, its state is cleaned up.

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
