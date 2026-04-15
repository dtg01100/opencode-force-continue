# Subprocess Integration Test Harness Design

**Date:** 2026-04-15  
**Context:** Developing OpenCode plugin using OpenCode - need validation without breaking active session

## Problem

The force-continue plugin is being developed using OpenCode itself. Testing the plugin in the active session risks:
- Breaking the current session with bugs
- Interfering with development work
- False positives/negatives due to plugin already being loaded

We need integration tests that cover both server plugin (non-interactive) and TUI plugin behavior.

## Solution

A test harness that spawns isolated OpenCode instances in subprocesses, validating real plugin behavior without affecting the development session.

## Architecture

```
tests/integration/
├── harness/
│   ├── spawn-opencode.mjs      # Spawns isolated OpenCode instances
│   ├── pty-runner.mjs          # PTY wrapper for TUI testing
│   └── assertions.mjs          # Plugin-specific assertions
├── fixtures/
│   ├── test-project/           # Minimal test project
│   │   └── sample.txt          # File for model to modify
│   └── opencode-test.json      # Config with plugin loaded
├── server-plugin.test.mjs      # Non-interactive mode tests
├── tui-plugin.test.mjs         # TUI mode tests
└── full-integration.test.mjs   # End-to-end scenarios
```

## Components

### 1. spawn-opencode.mjs

Process spawner for isolated OpenCode instances.

**Responsibilities:**
- Spawn `opencode run` for non-interactive tests
- Spawn `opencode` with PTY for TUI tests
- Capture stdout/stderr and exit codes
- Timeout handling with graceful kill (SIGTERM then SIGKILL)
- Environment isolation:
  - Fresh HOME directory
  - Clean config directory
  - Plugin loaded from local path

**API:**
```javascript
export async function spawnOpenCode(options) {
  return {
    process: ChildProcess,
    stdout: AsyncIterable<string>,
    stderr: AsyncIterable<string>,
    exitCode: Promise<number>,
    kill(): void
  }
}
```

### 2. pty-runner.mjs

PTY controller for TUI mode testing.

**Options:**
- Use `node-pty` package (preferred) or `script(1)` command
- Send keystrokes programmatically
- Capture screen output
- Handle terminal resize

**API:**
```javascript
export async function runPTY(command, args, options) {
  return {
    write(data: string): void,        // Send keystrokes
    read(): Promise<string>,          // Read screen output
    resize(cols, rows): void,         // Resize terminal
    kill(): void                      // Terminate
  }
}
```

### 3. Test Fixtures

**test-project/** - Minimal project for validation:
```
test-project/
├── sample.txt      # "Hello World" - model can modify
└── task.txt        # "Add a greeting to sample.txt"
```

**opencode-test.json:**
```json
{
  "plugin": ["force-continue@file://...local path..."]
}
```

### 4. assertions.mjs

Plugin-specific assertion helpers:

```javascript
export function assertPluginLoaded(output: string): void
export function assertAutoContinueTriggered(output: string): void
export function assertCompletionSignaled(output: string): void
export function assertHealthCheckValid(result: object): void
export function assertAutopilotToggled(output: string, enabled: boolean): void
```

## Test Cases

### Non-Interactive Mode (server plugin)

| Test | Description |
|------|-------------|
| Plugin loads | OpenCode starts without error, plugin registers tools |
| healthCheck works | Tool returns valid metrics, session count, autopilot state |
| validate works | Dry mode checks pass, probe mode can send test prompt |
| completionSignal | Calling tool marks session as complete |
| Auto-continue idle | Session idle triggers continue prompt (verify in logs) |
| Loop detection | Repeated output triggers loop-break prompt |
| Circuit breaker | Error threshold trips breaker, stops auto-continue |

### TUI Mode (TUI plugin)

| Test | Description |
|------|-------------|
| Command appears | `/autopilot` shows in command palette |
| Toggle changes state | Executing command toggles autopilot |
| Toast displayed | Correct toast message shows status |
| Slash aliases | `/toggle-autopilot` and `/force-continue-autopilot` work |
| Session vs global | Toggle affects current session or next session appropriately |

### Full Integration

| Test | Description |
|------|-------------|
| Happy path | Session created → model works → idle → auto-continue → completionSignal |
| Loop scenario | Model loops → detection → break prompt → continues differently |
| Guidance pause | requestGuidance pauses auto-continue appropriately |
| Autopilot auto-answer | With autopilot enabled, guidance auto-answered |

## Safety Measures

1. **Temporary directories** - Each test run uses `fs.mkdtemp()`
2. **Local plugin path** - Load from `file://` URL, not global install
3. **Timeouts** - All operations have timeouts (default: 30s)
4. **Cleanup on exit** - Process cleanup in `finally` blocks
5. **Kill on timeout** - SIGTERM → wait → SIGKILL
6. **No shared state** - Each test gets fresh OpenCode instance

## Implementation Approach

### Phase 1: Basic Harness
1. Create spawn-opencode.mjs with non-interactive mode
2. Create test fixture structure
3. Add basic plugin load test

### Phase 2: Server Plugin Tests
1. Add healthCheck, validate tests
2. Add idle/continue test with timeout detection
3. Add loop detection test

### Phase 3: PTY/TUI Tests
1. Add pty-runner.mjs
2. Add command palette test
3. Add autopilot toggle test

### Phase 4: Full Integration
1. End-to-end session lifecycle test
2. Autopilot behavior tests
3. CI integration

## Configuration

```bash
# Environment variables for tests
OPENCODE_TEST_TIMEOUT=30000          # Max wait per operation
OPENCODE_TEST_MODEL=anthropic/claude # Model to use
OPENCODE_TEST_LOG_DIR=./test-logs    # Where to store logs
```

## Success Criteria

- [ ] Plugin loads in spawned instance without error
- [ ] healthCheck returns valid state
- [ ] Auto-continue triggers on idle (visible in logs)
- [ ] TUI command palette shows /autopilot
- [ ] Autopilot toggle changes state correctly
- [ ] Full session lifecycle works end-to-end
- [ ] Tests run in CI without affecting other processes
