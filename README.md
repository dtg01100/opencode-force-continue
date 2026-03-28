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

## Usage

When this plugin is active, OpenCode will inject a system message requiring the AI to call `completionSignal` when finished with a task.

If the AI stops without calling it (session becomes idle), the plugin automatically prompts "Continue" to keep the agent running.

## Requirements

- OpenCode AI
- `@opencode-ai/plugin` (peer dependency, installed automatically with OpenCode)

## License

MIT
