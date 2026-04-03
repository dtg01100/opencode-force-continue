# commit-early-and-often instruction

## Purpose
Encourage a workflow that keeps changes small, testable, and easy to revert during development in this repository.

## Rule
- Make incremental changes with frequent commits.
- Keep individual commits focused on a single concern (bug fix, behavior change, test addition, doc update).
- Avoid large, monolithic patches; break them into discrete, reversible steps.
- Include test updates with behavior changes whenever possible.

## Applies to
- Code modifications in `force-continue.server.js`
- Test changes in `__tests__/plugin.test.ts`
- Docs in `README.md` and `.github/copilot-instructions.md`

## Why
- Easier code review and bisecting.
- Reduces risk of regressions and conflicts.
- Aligns with established maintenance workflow for this plugin.

## Example prompt
- "commit-early-and-often: Implement force-continue idle retry and add regression test."