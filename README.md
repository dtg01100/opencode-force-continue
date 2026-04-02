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

Drop the plugin file directly into OpenCode's plugin directory (no npm install needed).

### Global (all projects)

```bash
mkdir -p ~/.config/opencode/plugins
cp index.js ~/.config/opencode/plugins/force-continue.js
```

### Project-level (current project only)

```bash
mkdir -p .opencode/plugins
cp index.js .opencode/plugins/force-continue.js
```

OpenCode automatically loads any `.js` or `.ts` files from these directories at startup.

## Usage

When this plugin is active, OpenCode will inject a system message requiring the AI to call `completionSignal` when finished with a task.

If the AI stops without calling it (session becomes idle), the plugin automatically prompts "Continue" to keep the agent running.

## Requirements

- OpenCode AI
- `@opencode-ai/plugin` (peer dependency, installed automatically with OpenCode)

## License

MIT
