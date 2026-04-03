# plugin-behavior-test prompt

## Purpose
Create a reproducible test-writing prompt for `opencode-force-continue` plugin behavior updates.

## When to use
- Adding or modifying behavior in `force-continue.server.js`.
- Ensuring the plugin correctly toggles state, handles idle detection, and respects `completionSignal` semantics.
- Extending tests in `__tests__/plugin.test.ts` for regression coverage.

## Prompt template
Use this as the conversation prompt when asking the AI to write tests.

```
You are an expert test-writer for a Node.js OpenCode plugin (repository root: /var/mnt/Disk2/projects/opencode-force-continue).

Goal: Add or enhance unit tests in `__tests__/plugin.test.ts` to verify the plugin's force-continue behavior.

Context:
- Plugin entrypoint: `force-continue.server.js`
- Existing behaviors:
  - `/force-continue` or `/fc` toggles force-continue in a session
  - enabled state injects a system sleep that requires `completionSignal`
  - if no completion signal and session becomes idle, a "Continue" prompt is sent
  - when `completionSignal` is received, auto-continue stops

Required outputs:
1. A short description of the new test case(s) and why they matter.
2. The exact test code to add into `__tests__/plugin.test.ts`.
3. A brief checklist of steps to run and validate (e.g., `npm run test:run`).

Inputs provided by user:
- Behavior delta (e.g., "check that second continue prompt is sent when completionSignal is missing").
- Any existing mock/hooks to reuse.

Acceptance criteria:
- New tests are isolated, deterministic, and failing before the fix (if possible).
- Clear assertions on the sequence of messages and internal session state.
- No environment-specific side effects; use existing plugin test harness.

Now provide the tests and follow-up steps in a concise format.
```

## Ambiguity note
If behavior details are missing, ask:
- "Should the test simulate a session that never calls `completionSignal` and confirm at least two triggers of auto-continue?"
- "Is there a preferred timeout or poll interval in the plugin test harness?"

## Example invocations
- `plugin-behavior-test Add regression test for missing completionSignal with repeated continue prompt`
- `plugin-behavior-test Check session cleanup after force-continue is deactivated`
