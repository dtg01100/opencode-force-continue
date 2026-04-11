# Validation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the README with current `requestGuidance` behavior and strengthen regression coverage around the idle/guidance state machine.

**Architecture:** Keep the implementation inside the existing README + Vitest structure. Update the public behavior contract in `README.md`, then add focused tests in `__tests__/plugin.test.ts` that assert stored guidance, prompt contents, and pause boundaries without introducing a new external harness.

**Tech Stack:** JavaScript (ES modules), Vitest, Markdown

---

## File Structure

- Modify: `README.md` — public behavior contract and tool reference
- Modify: `__tests__/plugin.test.ts` — regression coverage for guidance/idle prompt behavior

### Task 1: Fix README contract drift

**Files:**
- Modify: `README.md`
- Test: `README.md`, `__tests__/plugin.test.ts`

- [ ] **Step 1: Update behavior summary entry**

```md
10. Skips auto-continue when paused via `pauseAutoContinue`, terminal `completionSignal` states, circuit-breaker pauses, canceled parts, or when auto-continue is disabled. A pending `requestGuidance` is recorded and included in future nudges, but does not pause auto-continue on its own.
```

- [ ] **Step 2: Update tool reference for `requestGuidance`**

```md
### requestGuidance

Ask for clarification while keeping auto-continue active. The plugin records the pending guidance request, includes it in future nudges, and only pauses if an autopilot fallback or another explicit pause condition sets `autoContinuePaused`.
```

- [ ] **Step 3: Update idle-event flow description**

```md
1. On `session.idle`, the handler first checks if auto-continue is disabled or if `autoContinuePaused` is set — skipping early if either applies. `autoContinuePaused` covers terminal `completionSignal` states, `pauseAutoContinue`, circuit breaker, and canceled parts.
6. When a `completionSignal` tool call, `pauseAutoContinue`, circuit breaker, or canceled part sets `autoContinuePaused`, nudges are suppressed. A pending `requestGuidance` remains in session state and is included in continue prompts until the user sends a new message or autopilot resolves it.
```

- [ ] **Step 4: Review README for any remaining stale `requestGuidance` pause wording**

Run: `rg -n "requestGuidance|awaiting guidance|paus" README.md`
Expected: only the updated non-pausing guidance description remains.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: align requestGuidance behavior docs"
```

### Task 2: Add stronger guidance-state regression tests

**Files:**
- Modify: `__tests__/plugin.test.ts`
- Test: `__tests__/plugin.test.ts`

- [ ] **Step 1: Add a failing test for pending guidance prompt contents**

```ts
it('should include pending guidance details in continue nudges', async () => {
  const { createContinuePlugin } = await import('../force-continue.server.js');
  const createPlugin = createContinuePlugin();
  const plugin = await createPlugin(mockCtx);

  await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'guidance-prompt-session' } } } });

  await plugin.tool.requestGuidance.execute(
    { question: 'Should I use approach A or B?', context: 'Both have tradeoffs', options: 'A,B' },
    { sessionID: 'guidance-prompt-session' } as any
  );

  mockClient.session.messages.mockResolvedValue({
    data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still waiting' }] }]
  });

  await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'guidance-prompt-session' } } });

  const promptArg = mockClient.session.promptAsync.mock.calls.at(-1)?.[0];
  expect(promptArg.body.parts[0].text).toContain('You have a pending guidance request:');
  expect(promptArg.body.parts[0].text).toContain('Q: Should I use approach A or B?');
  expect(promptArg.body.parts[0].text).toContain('Context: Both have tradeoffs');
  expect(promptArg.body.parts[0].text).toContain('Options: A,B');
});
```

- [ ] **Step 2: Run the targeted test and verify it fails before changes**

Run: `npm run test:run -- --silent __tests__/plugin.test.ts -t "should include pending guidance details in continue nudges"`
Expected: FAIL until the new test is present and wired correctly.

- [ ] **Step 3: Add or adjust minimal assertions needed to pass**

```ts
expect(state.sessions['guidance-session'].awaitingGuidance).toMatchObject({
  question: 'Should I use approach A or B?',
  context: 'Both have tradeoffs',
});
```

- [ ] **Step 4: Add a pause-boundary regression around autopilot fallback**

```ts
it('should still pause when autopilot max attempts is exceeded for guidance', async () => {
  const { createContinuePlugin, readState, writeAutopilotState, resetAutopilotState } = await import('../force-continue.server.js');
  resetAutopilotState();
  const createPlugin = createContinuePlugin({ autopilotEnabled: true, autopilotMaxAttempts: 1 });
  const plugin = await createPlugin(mockCtx);
  writeAutopilotState({ enabled: true, timestamp: Date.now() });

  await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'guidance-cap-session' } } } });
  await plugin.tool.requestGuidance.execute({ question: 'First' }, { sessionID: 'guidance-cap-session' } as any);
  const result = await plugin.tool.requestGuidance.execute({ question: 'Second' }, { sessionID: 'guidance-cap-session' } as any);

  expect(result).toContain('Autopilot limit reached. Auto-continue paused.');
  expect(readState().sessions['guidance-cap-session'].autoContinuePaused).toMatchObject({
    reason: 'autopilot_max_attempts',
  });
});
```

- [ ] **Step 5: Run focused tests**

Run: `npm run test:run -- --silent __tests__/plugin.test.ts -t "guidance"`
Expected: PASS for the guidance-related block.

- [ ] **Step 6: Commit**

```bash
git add __tests__/plugin.test.ts
git commit -m "test: harden guidance state regressions"
```

### Task 3: Verify full validation pass

**Files:**
- Modify: `README.md`
- Modify: `__tests__/plugin.test.ts`
- Test: full suite

- [ ] **Step 1: Run the full suite**

Run: `npm run test:run --silent`
Expected: `Test Files 8 passed` and `Tests 349 passed` or the updated total after new tests are added.

- [ ] **Step 2: Inspect the final diff**

Run: `git --no-pager diff -- README.md __tests__/plugin.test.ts`
Expected: only README contract fixes and the new guidance-focused regression coverage.

- [ ] **Step 3: Commit final integrated changes**

```bash
git add README.md __tests__/plugin.test.ts
git commit -m "docs: align guidance docs and harden validation"
```
