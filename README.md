# opencode-force-continue

Forces OpenCode AI (and KiloCode CLI) to continue when the model stops early by detecting unfinished sessions and prompting the model to continue until it explicitly signals completion.

> **Note:** This plugin also works with [KiloCode CLI](https://github.com/kilocode/kilocode), which is built on the OpenCode plugin architecture. Installation and usage are identical.

The AI is expected to call `completionSignal` when it has finished a task; the plugin treats any session without that signal as incomplete and will attempt to auto-continue.

## Why

LLM-powered coding agents frequently stop mid-task — the model generates a response, the tool calls complete, but there's more work remaining. This happens for many reasons: the context window truncates mid-thought, the model reaches a natural stopping point it mistakes for done, or it simply moves on before finishing.

This plugin solves that by acting as a safety net: when a session goes idle without explicitly signaling completion, the plugin notices and prompts the model to keep going. It escalates if the model keeps stopping, detects loops, and blocks dangerous commands. The model signals it is truly done by calling `completionSignal` — at which point the plugin stops nudging and treats the session as complete.

## Installation

### Via opencode.json (recommended)

Add the plugin to your `opencode.json` (global `~/.config/opencode/opencode.json` or project-level `.opencode/opencode.json`):

```json
{
  "plugin": ["force-continue@git+https://github.com/dtg01100/opencode-force-continue.git"]
}
```

Restart OpenCode. The plugin auto-installs and registers automatically.

### Verify Installation

After restarting OpenCode, the plugin is working if you see a message like:

> "You appear to have finished but did not call completionSignal. Please call it now."

This means the plugin detected a completion-like response without a `completionSignal` call.

To check plugin status, use the `healthCheck` tool:

```
healthCheck(detail='summary')
```

### Updating

The plugin updates automatically when you restart OpenCode. To pin a specific version:

```json
{
  "plugin": ["force-continue@git+https://github.com/dtg01100/opencode-force-continue.git#v1.0.0"]
}
```

### Uninstall

Remove the plugin from the `plugin` array in `opencode.json` and restart OpenCode.

## Usage

The plugin is intentionally simple and unobtrusive: once installed it runs automatically (no runtime toggle required).

Behavior summary:

1. Injects a system message asking the model to call `completionSignal` when a task is complete, treating it as a hard termination.
2. Tracks per-session state in-memory. Completion state is set by `session.created` (incomplete) and `completionSignal` (complete), but `chat.message` does not reset it.
3. If a session becomes idle without a `completionSignal`, the plugin will send a short "Continue" prompt to encourage the model to finish.
4. If available, the plugin will consult task hooks (a babysitter or task-query hook) before auto-continuing to avoid interrupting legitimate pauses.
5. When the model calls `completionSignal`, the plugin stops auto-continuing for that session. Duplicate calls are rejected.
6. Escalates prompts progressively if the model keeps stopping without signaling completion.
7. Detects loops in model responses and tool calls, and breaks them with targeted prompts.
8. Injects a system message into completed sessions via `experimental.chat.messages.transform` to prevent the model from responding to auto-continue nudges after completion.
9. Applies an optional cooldown (`cooldownMs`) between idle events to avoid rapid-fire prompts.
10. Skips auto-continue when paused via `pauseAutoContinue`, awaiting guidance via `requestGuidance`, or when auto-continue is disabled.

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
| `FORCE_CONTINUE_LOG_TO_STDOUT` | `false` | Log plugin activity to stdout in addition to OpenCode's logger |
| `FORCE_CONTINUE_AUTOPILOT_ENABLED` | `false` | Enable autopilot mode for auto-answering guidance requests |
| `FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS` | `3` | Max auto-answer attempts before falling back to user input |
| `FORCE_CONTINUE_SESSION_TTL_MS` | `86400000` (24h) | Session time-to-live before cleanup; sessions inactive beyond this are removed |

### Config File

Create `.opencode/force-continue.json` or `force-continue.config.json` in your project root:

```json
{
  "maxContinuations": 10,
  "escalationThreshold": 4,
  "enableLoopDetection": true,
  "enableToolLoopDetection": true,
  "autoContinueEnabled": true,
  "cooldownMs": 0,
  "circuitBreakerThreshold": 10,
  "enableFileTracking": true,
  "enableTaskTracking": true,
  "enableCompletionSummary": true,
  "logToStdout": false,
  "sessionTtlMs": 86400000,
  "ignoreTools": ["read", "glob", "grep"],
  "dangerousCommands": ["rm -rf /", "rm -rf ~"]
}
```

Environment variables take precedence over config file values, which take precedence over defaults.

## Architecture

The plugin is intentionally lightweight:

- All runtime state is kept in-memory per process and keyed by the OpenCode session ID. This keeps the code simple and avoids external storage dependencies.
- State is cleaned up when a session ends or is deleted; because state is in-memory, multiple server instances do not share session state.
- An optional file-based persistence layer is available for cross-process state sharing (see `createFileStore` and `createHybridStore` exports).
- The single `event` handler delegates to two sub-handlers: `createFileEventsHandler` (handles `file.edited` events) and `createSessionEventsHandler` (handles `session.created`, `session.idle`, `session.deleted`, and `message.part.updated`). Both are wrapped in the main event handler with error isolation so a failure in one does not block the other.

## How it works

Overview:

- The plugin hooks into OpenCode's server lifecycle and session events. It watches sessions for inactivity and incomplete work and sends short prompts to encourage the model to finish until the model explicitly calls the `completionSignal` tool.
- Runtime state is kept in an internal `sessionState` Map (private to the server file). It is in-memory by default.

Key components (in `force-continue.server.js`):

- `createContinuePlugin(options)` — factory that returns the plugin server object. Accepts an optional `options` argument to override config defaults.
- `ContinuePlugin` — the default exported plugin instance created by `createContinuePlugin()`.
- Tools exposed to the model:
  - `completionSignal` — call this from the model to indicate the task is finished. Accepts `status` (e.g. `completed`, `blocked`, `interrupted`) and optional `reason`.
  - `validate` — checks that the plugin environment is wired correctly; supports `mode='probe'` to send a test prompt to a session.
  - `statusReport` — lets the model report progress without ending the session, resetting the continuation counter.
  - `requestGuidance` — lets the model ask the user for clarification, pausing auto-continue until the user responds.
  - `pauseAutoContinue` — temporarily suspends auto-continue prompts while the model plans.
  - `healthCheck` — returns plugin metrics, session counts, autopilot status, and configuration.
  - `setAutopilot` — enables or disables autopilot mode globally or per-session.
- Message & event handlers:
  - `chat.message` — updates per-session lastSeen, resets continuation counters, and clears paused/guidance state. Does NOT reset completion state — `completionSignal` is a hard termination.
  - `experimental.chat.system.transform` — injects a system instruction telling the model to call `completionSignal` when finished, with explicit instructions to treat it as a hard termination.
  - `experimental.chat.messages.transform` — injects a system message into completed sessions instructing the model to remain silent and not respond to further prompts.
  - `tool.execute.before` — blocks dangerous commands during auto-continue sessions.
  - `tool.execute.after` — tracks tool call history, file modifications, and detects tool call loops.
  - `event` — the main event handler that reacts to `session.created`, `message.part.updated` (used to detect `completionSignal` tool calls and canceled parts), `session.idle`, `session.deleted`, and `file.edited` events.
  - `experimental.session.compacting` — injects continuation state into the compaction context so the model retains awareness across context window truncation.

Event flow (session.idle handling simplified):

1. On `session.idle`, the handler first checks if auto-continue is disabled or if `autoContinuePaused` is set — skipping early if either applies. `autoContinuePaused` covers all pause reasons: `completionSignal`, `pauseAutoContinue`, `requestGuidance`, circuit breaker, and canceled parts.
2. If a cooldown is configured (`cooldownMs > 0`), the handler skips if insufficient time has passed since the last idle event.
3. If task-related hooks are available (task babysitter), the plugin defers to them.
4. The plugin attempts to query unfinished tasks using several hook candidates (`getTasksByParentSession` from hooks or context). If unfinished tasks are found, it sends a prompt listing them and asks the model to continue or call `completionSignal`.
5. If no tasks are found, it fetches recent messages. If the last message role is `assistant`, it increments a `continuationCount` and sends either a plain `Continue` prompt, a completion nudge (if completion keywords detected), a loop-break prompt (if loop detected), or escalation prompts when thresholds are exceeded.
6. When a `completionSignal` tool call, `pauseAutoContinue`, `requestGuidance`, circuit breaker, or canceled part sets `autoContinuePaused`, nudges are suppressed. When the user sends a message, `chat.message` clears `autoContinuePaused` and nudges resume.
7. On `session.deleted`, session entries are cleaned from in-memory maps.

Helpers and extension points:

- `isTaskDone(status)` — normalizes task status strings and treats `done`, `completed`, and `complete` as finished.
- `resolveConfig()` — resolves configuration from defaults, config file, and environment variables.
- `createFileStore(baseDir)` — creates a file-based persistence store for cross-process state.
- `createHybridStore(inMemoryMap, fileStore)` — creates a hybrid store that reads from memory first, falling back to file storage.
- `createMetricsTracker()` — creates a metrics tracker for observability. Tracks idle events, prompt types (continue, escalation, loop-break, completion nudge), circuit breaker trips, and per-session error counts.
- Exported helpers for operational or debug use: `updateLastSeen`, `readState`, `readAutopilotState`, `writeAutopilotState`.
- To add cross-process persistence, replace the in-memory `sessionState` Map or adapt the plugin to call an external store inside the helper functions.
- If you have a background task manager or a task babysitter hook, connect it via `ctx.hooks` so the plugin can defer to those systems instead of auto-continuing.

Debugging tips:

- Use the `validate` tool in `probe` mode to ensure `promptAsync` is available and that a session accepts prompts.
- Use the `healthCheck` tool with `detail: 'full'` to get a complete snapshot of plugin state, metrics, autopilot status, and configuration.
- Inspect `readState()` (exported) to get a snapshot of tracked sessions and metrics.
- Inspect `readAutopilotState()` (exported) to check the current global autopilot file-store state.
- Set `FORCE_CONTINUE_LOG_TO_STDOUT=true` to log plugin activity to stdout in addition to OpenCode's logger.

## Tools Reference

### completionSignal

Call when work is complete, blocked, or interrupted. Duplicate calls are rejected — call this exactly once when finished.

```
completionSignal(status='completed', reason?)
completionSignal(status='blocked', reason='...')
completionSignal(status='interrupted', reason='...')
```

### validate

Check that the plugin environment is wired correctly.

```
validate(mode='dry')                          // Run capability checks
validate(mode='probe', sessionID='...', promptText='...')  // Send a test prompt to a session
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

### Autopilot Mode

When `FORCE_CONTINUE_AUTOPILOT_ENABLED=true`, the plugin automatically answers `requestGuidance` calls instead of waiting for user input. The AI makes autonomous decisions and continues working.

Use cases:
- Long-running tasks where the AI can reasonably decide on its own
- Autonomous research mode
- CI/automated environments without human guidance availability

If max attempts is reached, falls back to normal behavior requiring user input.

### pauseAutoContinue

Temporarily suspend auto-continue prompts.

```
pauseAutoContinue(reason='Need time to plan', estimatedTime='5 minutes')
```

### setAutopilot

Enable or disable autopilot mode. Supports both global and per-session control. When `sessionID` is provided, sets autopilot for that specific session; otherwise sets the global autopilot state.

```
setAutopilot(enabled=true)                    // Enable globally
setAutopilot(enabled=false)                   // Disable globally
setAutopilot(enabled=true, sessionID='...')   // Enable for a specific session
setAutopilot(enabled=false, sessionID='...') // Disable for a specific session
```

### healthCheck

Check plugin health and metrics. Returns autopilot status in all detail levels.

```
healthCheck(detail='summary')   // One-line summary with autopilot state
healthCheck(detail='sessions')  // Active session count + metrics + autopilot
healthCheck(detail='full')      // Full JSON dump including autopilot config
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
