# Workspace instructions for opencode-force-continue

This repository is a simple OpenCode plugin to force AI to continue until `completionSignal` is called.

## Core files
- `force-continue.server.js`: server plugin implementation
- `__tests__/plugin.test.ts`: tests
- `README.md`: usage + architecture + install instructions

## Validation
- `npm install`
- `npm run test:run` (or `npm test`)

## Notes for contributors
- Put behavior change rationale in README and tests.
- Keep `session.idle` auto-continue behavior aligned with README: continue if session incomplete, stop when completion signal received.

## If in doubt
- Inspect `force-continue.server.js` for lifecycle hooks, event handling, and completion marker logic.
- Run `npm run test:run` after every logical change.
- Use existing files above as the source of truth rather than creating redundant docs.

## Test Infrastructure Approach
When working with test issues:
- **Diagnose first** — run `npm run test:run` to understand failures
- **Use minimally invasive fixes** — prefer small, targeted changes over large refactors
- **Don't give up** — work to resolve issues rather than working around them
- **Preserve isolation** — use `beforeEach`/`afterEach` hooks for cleanup (extensively used in this codebase)
- **Verify** — always run `npm run test:run` after making changes
