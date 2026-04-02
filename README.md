# opencode-force-continue

Forces OpenCode AI to continue when the model stops early. The AI must call `completionSignal` before stopping.

## Installation

```bash
npm install @dtg01100/opencode-force-continue
```

Add to your `opencode.json`:

```json
{
  "plugin": ["@dtg01100/opencode-force-continue"]
}
```

## Alternative: Manual Installation

Drop the plugin files directly into OpenCode's plugin directory (no npm install needed).

### Global (all projects)

```bash
mkdir -p ~/.config/opencode/plugins
cp force-continue.server.js force-continue.tui.js ~/.config/opencode/plugins/
```

### Project-level (current project only)

```bash
mkdir -p .opencode/plugins
cp force-continue.server.js force-continue.tui.js .opencode/plugins/
```

### Project-level (current project only)

```bash
mkdir -p .opencode/plugins
cp force-continue.server.js force-continue.tui.js .opencode/plugins/
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

## Requirements

- OpenCode AI
- `@opencode-ai/plugin` (peer dependency, installed automatically with OpenCode)

## License

MIT
