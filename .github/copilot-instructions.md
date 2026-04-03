# Workspace instructions for opencode-force-continue

This repository is a simple OpenCode plugin to force AI to continue until `completionSignal` is called.

## Core files
- `force-continue.server.js`: server plugin implementation
- `__tests__/plugin.test.ts`: tests
- `README.md`: usage + architecture + install instructions
- `plugin-audit.prompt.md`: default agent prompt for audits/fixes

## Important project rules
- Single-file install: `force-continue.server.js` must work as a standalone plugin file, with no separate mandatory dependencies.
- Commit workflow: small, atomic, reversible commits. See `commit-early-often.instructions.md`.

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
