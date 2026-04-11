# Autopilot Alignment Design

**Date:** 2026-04-11
**Status:** Draft for autonomous review

## Problem

The project goal is to at least partially mimic GitHub Copilot Autopilot behavior, but the current implementation is still centered on a "force continue" safety net. It reliably nudges stalled sessions forward, but its autopilot behavior is limited mostly to auto-answering guidance questions and some heuristic idle handling.

The next step should improve autonomous execution without losing the repo's most reliable behavior: **basic nudge mode when a model simply stops continuing**.

## Design Goals

1. Preserve today's **basic nudge mode** as a safe default and fallback path.
2. Add a richer **autonomous execution mode** that does more than answer guidance questions.
3. Separate **temporary pause state** from **terminal completion state** so idle decisions are easier to reason about.
4. Make autopilot state semantics clearly **session-scoped vs global-scoped**.
5. Prefer explicit state over fragile text heuristics when deciding whether to continue, pause, or escalate.

## Non-Goals

1. Replace nudge mode entirely.
2. Turn the plugin into a full planner/task runner with external orchestration.
3. Remove existing safety rails like cooldowns, loop detection, or dangerous-command blocking.

## Recommended Approach

Use a **layered autonomy model**:

- **Layer 1: Nudge mode** stays intact as the base behavior. If the model stops without signaling completion and no stronger autopilot state applies, the plugin still sends continue/completion/escalation nudges.
- **Layer 2: Autopilot execution mode** sits above nudge mode. When enabled, the plugin maintains lightweight execution state and chooses between continuing, self-answering, pausing, or escalating based on structured session metadata rather than text guesses alone.

This approach improves alignment with Copilot-style autopilot while preserving the reliability of the current system.

## Architecture

### 1. Session State Model

Split current session state into clearer categories:

- **completionState**
  - terminal session outcome: `completed`, `blocked`, `interrupted`, or `null`
- **pauseState**
  - temporary pause reason: `planning`, `autopilot_max_attempts`, `circuit_breaker`, `user_wait`, `manual_pause`, or `null`
- **autopilotState**
  - `{ enabled, mode, attempts, lastDecisionAt, pendingGuidance, executionPhase }`
- **nudgeState**
  - continuation count, cooldown timestamps, last assistant text, response history, loop markers

This avoids overloading `autoContinuePaused` to mean both "session is done" and "temporarily don't nudge."

### 2. Execution Modes

Define two supported runtime modes:

- **`nudge` mode**
  - current default behavior
  - detects stalled sessions and nudges them forward
- **`autopilot` mode**
  - uses structured execution state to decide the next action
  - may synthesize a "next step" prompt, answer guidance autonomously, request verification, or fall back to nudge behavior

Autopilot mode must be additive, not exclusive: if it cannot decide safely, it falls back to standard nudge handling.

### 3. Idle Decision Pipeline

Refactor idle handling into a clearer decision ladder:

1. Check terminal completion state.
2. Check temporary pause state.
3. Check cooldown / babysitter / subagent exclusions.
4. Load session execution state.
5. If autopilot mode is enabled:
   - resolve pending guidance
   - detect if a verification step is due
   - decide whether to send an autonomous next-step prompt
   - fall back to nudge mode if no structured autopilot action applies
6. If autopilot mode is disabled or falls through:
   - run today's nudge/completion/escalation/loop-break behavior

This keeps the current nudge flow but gives autopilot a well-defined place to intervene.

## Component Changes

### `src/handlers/sessionEvents.js`

- Extract idle decision logic into smaller helpers:
  - `shouldSkipIdle()`
  - `getExecutionDecision()`
  - `runAutopilotStep()`
  - `runBasicNudgeStep()`
- Replace direct dependence on `autoContinuePaused` as a universal state bucket.
- Keep the current continue/completion/escalation prompts available as the nudge-mode implementation.

### `src/tools/requestGuidance.js`

- Keep current behavior that records pending guidance.
- In autopilot mode, allow structured resolution of guidance questions.
- Distinguish:
  - **pending guidance**
  - **waiting for user**
  - **autopilot fallback pause**

### `src/tools/setAutopilot.js`

- Make semantics explicit:
  - global toggle affects default behavior
  - session toggle affects only that session
- Stop writing global and session state together when a session-scoped change is requested.

### `src/state.js` / related helpers

- Introduce helpers to read/write separated session state:
  - completion state
  - pause state
  - autopilot state
  - nudge state

### `README.md`

- Document two-level behavior clearly:
  - basic nudge mode
  - optional/autonomous autopilot mode
- Clarify that the project emulates Copilot-style persistence and autonomous continuation, not a full remote orchestrator.

## Data Flow

### Basic Nudge Flow

1. Session goes idle.
2. If no completion or pause state blocks it, the plugin checks messages/tasks.
3. The plugin sends:
   - continue prompt,
   - completion nudge,
   - escalation prompt, or
   - loop-break prompt.
4. The model resumes work or calls `completionSignal`.

### Autopilot Flow

1. Session goes idle.
2. Autopilot mode inspects structured session state.
3. If pending guidance exists, autopilot may resolve it.
4. If the session appears stalled but unfinished, autopilot may send a more directive "next action" prompt.
5. If autopilot cannot choose safely, control falls back to the nudge flow.
6. If attempts/errors exceed thresholds, autopilot sets a temporary pause state and stops.

## Error Handling

1. Autopilot prompt failures should increment error counters and may trip the existing circuit breaker.
2. Autopilot attempt limits should set a **temporary pause state**, not a terminal completion state.
3. Completion signals must always override autopilot/nudge behavior immediately.
4. Unknown or ambiguous state should favor fallback to **basic nudge mode**, not silent no-op behavior.

## Testing Strategy

### Unit / Regression

1. Preserve existing nudge-mode regressions.
2. Add tests for separated completion vs pause state.
3. Add tests for session-scoped autopilot toggle not mutating global state.
4. Add tests for idle autopilot decisions falling back to nudge mode.
5. Add tests for pending guidance being resolved, preserved, or paused explicitly.

### Contract / Behavior

1. README parity tests for documented guidance and autopilot behavior.
2. State-machine tests for:
   - idle with completion state
   - idle with pause state
   - idle with autopilot enabled
   - idle with autopilot fallback
   - idle with plain nudge mode only

### Smoke Scenarios

1. Model stops early with autopilot off -> nudge mode continues.
2. Model stops early with autopilot on but no structured action -> nudge fallback still continues.
3. Model asks for guidance with autopilot on -> autonomous answer path.
4. Model loops or errors repeatedly -> escalation / circuit breaker path.

## Delivery Phases

### Phase 1: Semantics cleanup

- Separate completion state from pause state.
- Fix `setAutopilot` scoping semantics.
- Preserve existing behavior with compatibility shims.

### Phase 2: Layered autopilot runtime

- Add explicit autopilot execution decision helpers.
- Keep current nudge prompts as the fallback implementation.

### Phase 3: Validation and docs

- Expand state-machine tests.
- Add README parity updates and examples for the two-level model.

## Success Criteria

The project is better aligned with Copilot-style autopilot if:

1. Basic nudge mode still works exactly as the "model stopped early" fallback.
2. Autopilot mode can do more than auto-answer direct guidance calls.
3. State transitions are easier to understand and test.
4. Session-scoped autopilot behavior is predictable.
5. Docs clearly describe both the safety-net behavior and the richer autonomy layer.
