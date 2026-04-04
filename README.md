# opencode-force-continue

Forces OpenCode AI to continue when the model stops early by detecting unfinished sessions and prompting the model to continue until it explicitly signals completion.

The AI is expected to call `completionSignal` when it has finished a task; the plugin treats any session without that signal as incomplete and will attempt to auto-continue.

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

The plugin is intentionally simple and unobtrusive: once installed it runs automatically (no runtime toggle required).

Behavior summary:

1. Injects a system message asking the model to call `completionSignal` when a task is complete.
2. Tracks per-session state in-memory and marks sessions incomplete when new user messages arrive.
3. If a session becomes idle without a `completionSignal`, the plugin will send a short "Continue" prompt to encourage the model to finish.
4. If available, the plugin will consult task hooks (a babysitter or task-query hook) before auto-continuing to avoid interrupting legitimate pauses.
5. When the model calls `completionSignal`, the plugin stops auto-continuing for that session.
6. Escalates prompts progressively if the model keeps stopping without signaling completion.
7. Detects loops in model responses and tool calls, and breaks them with targeted prompts.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FORCE_CONTINUE_MAX_CONTINUATIONS` | `5` | Maximum auto-continue attempts before hard cap |
| `FORCE_CONTINUE_ESCALATION_THRESHOLD` | `3` | Continuation count at which escalation prompts begin |
| `FORCE_CONTINUE_ENABLE_LOOP_DETECTION` | `true` | Enable text response loop detection |
| `FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION` | `true` | Enable tool call loop detection |
| `FORCE_CONTINUE_AUTO_CONTINUE` | `true` | Master toggle for auto-continue behavior |
| `FORCE_CONTINUE_COOLDOWN_MS` | `0` | Milliseconds to wait after idle before prompting |
| `FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD` | `10` | Error count before circuit breaker trips |
| `FORCE_CONTINUE_ENABLE_FILE_TRACKING` | `true` | Track file modifications per session |
| `FORCE_CONTINUE_ENABLE_TASK_TRACKING` | `true` | Query task hooks for unfinished work |
| `FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY` | `true` | Log completion summary on session end |

### Config File

Create `.opencode/force-continue.json` or `force-continue.config.json` in your project root:

```json
{
  "maxContinuations": 10,
  "escalationThreshold": 4,
  "enableLoopDetection": true,
  "enableToolLoopDetection": true,
  "autoContinueEnabled": true,
  "circuitBreakerThreshold": 10,
  "enableFileTracking": true,
  "enableTaskTracking": true,
  "enableCompletionSummary": true,
  "ignoreTools": ["read", "glob", "grep"],
  "dangerousCommands": ["rm -rf /", "rm -rf ~"]
}
```

Environment variables take precedence over config file values, which take precedence over defaults.

## Architecture

### Server-Only Design

The plugin is implemented as a single server file: `force-continue.server.js` (included in the repository). It is intentionally lightweight:

- All runtime state is kept in-memory per process and keyed by the OpenCode session ID. This keeps the code simple and avoids external storage dependencies.
- State is cleaned up when a session ends or is deleted; because state is in-memory, multiple server instances do not share session state.
- An optional file-based persistence layer is available for cross-process state sharing (see `createFileStore` and `createHybridStore` exports).

## How it works

Overview:

- The plugin hooks into OpenCode's server lifecycle and session events. It watches sessions for inactivity and incomplete work and sends short prompts to encourage the model to finish until the model explicitly calls the `completionSignal` tool.
- Runtime state is kept in two places: an internal `sessionState` Map (private to the server file) and a `sessionCompletionState` Map which is provided to `createContinuePlugin` (defaults to a new Map). Both are in-memory by default.

Key components (in `force-continue.server.js`):

- `createContinuePlugin(sessionCompletionState, options)` — factory that returns the plugin server object. Accepts an optional second `options` argument to override config defaults.
- `ContinuePlugin` — the default exported plugin instance created by `createContinuePlugin()`.
- Tools exposed to the model:
  - `completionSignal` — call this from the model to indicate the task is finished. Accepts `status` (e.g. `completed`, `blocked`, `interrupted`) and optional `reason`.
  - `validate` — checks that the plugin environment is wired correctly; supports `mode='probe'` to send a test prompt to a session.
  - `statusReport` — lets the model report progress without ending the session, resetting the continuation counter.
  - `requestGuidance` — lets the model ask the user for clarification, pausing auto-continue until the user responds.
  - `pauseAutoContinue` — temporarily suspends auto-continue prompts while the model plans.
  - `healthCheck` — returns plugin metrics, session counts, and configuration status.
- Message & event handlers:
  - `chat.message` — updates per-session lastSeen and resets continuation counters when a user message arrives.
  - `experimental.chat.system.transform` — injects a system instruction telling the model to call `completionSignal` when finished.
  - `tool.execute.before` — blocks dangerous commands during auto-continue sessions.
  - `tool.execute.after` — tracks tool call history, file modifications, and detects tool call loops.
  - `event` — the main event handler that reacts to `session.created`, `message.part.updated` (used to detect `completionSignal` tool calls), `session.idle`, `session.deleted`, and `file.edited` events.
  - `experimental.session.compacting` — injects continuation state into the compaction context so the model retains awareness across context window truncation.

Event flow (session.idle handling simplified):

1. On `session.idle`, the handler checks whether the session already has a recorded completion via `sessionCompletionState`.
2. If task-related hooks are available (task babysitter), the plugin defers to them.
3. The plugin attempts to query unfinished tasks using several hook candidates (`getTasksByParentSession` from hooks or context). If unfinished tasks are found, it sends a prompt listing them and asks the model to continue or call `completionSignal`.
4. If no tasks are found and the session is not marked complete, it fetches recent messages. If the last message role is `assistant`, it increments a `continuationCount` and sends either a plain `Continue` prompt or a stronger nudge when `continuationCount >= escalationThreshold` (asks whether the model is stuck and requests `completionSignal` if appropriate).
5. When a `message.part.updated` event shows a `completionSignal` tool call (with `status` such as `completed`/`blocked`/`interrupted`), the plugin marks the session complete and stops auto-continuing.
6. On `session.deleted`, session entries are cleaned from in-memory maps.

Helpers and extension points:

- `isTaskDone(status)` — normalizes task status strings and treats `done`, `completed`, and `complete` as finished.
- `resolveConfig()` — resolves configuration from defaults, config file, and environment variables.
- `createFileStore(baseDir)` — creates a file-based persistence store for cross-process state.
- `createHybridStore(inMemoryMap, fileStore)` — creates a hybrid store that reads from memory first, falling back to file storage.
- `createMetricsTracker()` — creates a metrics tracker for observability.
- Exported helpers for operational or debug use: `updateLastSeen`, `readState`.
- To add cross-process persistence, replace the in-memory `sessionState` Map or adapt the plugin to call an external store inside the helper functions.
- If you have a background task manager or a task babysitter hook, connect it via `ctx.hooks` so the plugin can defer to those systems instead of auto-continuing.

Debugging tips:

- Use the `validate` tool in `probe` mode to ensure `promptAsync` is available and that a session accepts prompts.
- Use the `healthCheck` tool with `detail: 'full'` to get a complete snapshot of plugin state, metrics, and configuration.
- Inspect `readState()` (exported) to get a snapshot of tracked sessions and metrics.

## Tools Reference

### completionSignal

Call when work is complete, blocked, or interrupted.

```
completionSignal(status='completed', reason?)
completionSignal(status='blocked', reason='...')
completionSignal(status='interrupted', reason='...')
```

### statusReport

Report progress without ending the session. Resets the continuation counter.

```
statusReport(progress='Completed 3 of 5 steps', nextSteps='Finish remaining', blockers?)
```

### requestGuidance

Ask the user for clarification. Pauses auto-continue until the user responds.

```
requestGuidance(question='Should I use approach A or B?', context?)
```

### pauseAutoContinue

Temporarily suspend auto-continue prompts.

```
pauseAutoContinue(reason='Need time to plan', estimatedTime='5 minutes')
```

### healthCheck

Check plugin health and metrics.

```
healthCheck(detail='summary')   // One-line summary
healthCheck(detail='sessions')  // Active session count + metrics
healthCheck(detail='full')      // Full JSON dump
```

## Development

Run the test suite and install dependencies before modifying code:

```bash
npm install
npm run test:run
```

There are unit tests under `__tests__` that cover the core auto-continue logic, configuration, tools, hooks, and persistence. Keep changes small and focused: the plugin prefers minimal, auditable behavior rather than complex heuristics.

## Requirements

- OpenCode AI
- `@opencode-ai/plugin` (this is automatically provided by OpenCode when loading plugins)

The plugin uses only standard Node.js APIs and the OpenCode plugin interface; there are no additional runtime dependencies beyond what's listed in package.json.

## License

MIT
