# Autopilot Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the plugin toward Copilot-style autopilot behavior while preserving basic nudge mode as the safe default and fallback when the model stops continuing.

**Architecture:** Implement this in three phases: first clean up autopilot and pause/completion semantics without changing the user-facing nudge path, then refactor idle handling into explicit autopilot-vs-nudge decision helpers, then update docs and expand regression coverage. Compatibility shims should preserve existing behavior while the internal state model becomes easier to reason about and test.

**Tech Stack:** JavaScript (ES modules), Node.js, Vitest, @opencode-ai/plugin

---

## File Structure

- Modify: `src/tools/setAutopilot.js` — fix session/global scoping semantics
- Modify: `src/autopilot.js` — centralize autopilot state helpers and resolution
- Modify: `src/state.js` — add explicit completion/pause helper functions and compatibility accessors
- Modify: `src/handlers/chatMessage.js` — clear temporary pause state without destroying terminal completion state
- Modify: `src/handlers/sessionEvents.js` — split idle handling into autopilot and nudge decision paths while preserving the current nudge behavior
- Modify: `src/handlers/messagesTransform.js` — read explicit completion state, with compatibility fallback
- Modify: `src/plugin.js` — wire any new helpers if exports need to be surfaced
- Modify: `README.md` — document layered autopilot + nudge fallback behavior
- Modify: `__tests__/plugin.test.ts` — regression tests for scoping, state separation, autopilot fallback, and nudge preservation

---

### Task 1: Fix autopilot scoping semantics

**Files:**
- Modify: `src/tools/setAutopilot.js`
- Modify: `src/autopilot.js`
- Test: `__tests__/plugin.test.ts`

- [ ] **Step 1: Write the failing tests for session-vs-global autopilot state**

```ts
it('should set session autopilot without mutating global autopilot state', async () => {
  const { createContinuePlugin, readAutopilotState, readState, resetAutopilotState } = await import('../force-continue.server.js');
  resetAutopilotState();
  const plugin = await createContinuePlugin()({ client: mockClient } as any);

  await plugin.tool.setAutopilot.execute(
    { enabled: true, sessionID: 'session-only' },
    { sessionID: 'session-only' } as any
  );

  expect(readState().sessions['session-only'].autopilotEnabled).toBe(true);
  expect(readAutopilotState().enabled).toBe(false);
});

it('should set global autopilot and clear session overrides only for global toggles', async () => {
  const { createContinuePlugin, readAutopilotState, readState, resetAutopilotState } = await import('../force-continue.server.js');
  resetAutopilotState();
  const plugin = await createContinuePlugin()({ client: mockClient } as any);

  await plugin.tool.setAutopilot.execute(
    { enabled: true, sessionID: 'override-session' },
    { sessionID: 'override-session' } as any
  );
  await plugin.tool.setAutopilot.execute(
    { enabled: false },
    {} as any
  );

  expect(readAutopilotState().enabled).toBe(false);
  expect(readState().sessions['override-session'].autopilotEnabled).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "autopilot state" --silent`  
Expected: FAIL because session-scoped `setAutopilot` currently writes global autopilot state too.

- [ ] **Step 3: Write the minimal implementation in `src/tools/setAutopilot.js`**

```js
execute: async ({ enabled, sessionID }, toolCtx) => {
  const effectiveSessionID = sessionID || toolCtx?.sessionID;
  if (effectiveSessionID) {
    const meta = sessionState.get(effectiveSessionID) || {};
    meta.autopilotEnabled = enabled;
    sessionState.set(effectiveSessionID, meta);
    log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool for session ${effectiveSessionID}`);
    return `Autopilot ${enabled ? "enabled" : "disabled"} for session ${effectiveSessionID}.`;
  }

  writeAutopilotState({ enabled, timestamp: Date.now() });
  for (const [sid, meta] of sessionState) {
    if (Object.prototype.hasOwnProperty.call(meta, "autopilotEnabled")) {
      delete meta.autopilotEnabled;
      sessionState.set(sid, meta);
    }
  }
  log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool (global)`);
  return `Autopilot ${enabled ? "enabled" : "disabled"}.`;
}
```

- [ ] **Step 4: Keep `src/autopilot.js` resolution explicit**

```js
export function getAutopilotEnabled(config, sessionID) {
  if (sessionID) {
    const meta = sessionState.get(sessionID) || {};
    if ("autopilotEnabled" in meta) {
      return meta.autopilotEnabled;
    }
  }

  const stored = readAutopilotState();
  if (stored && typeof stored.timestamp === "number") return stored.enabled;
  return config?.autopilotEnabled ?? false;
}
```

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "autopilot state" --silent`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/setAutopilot.js src/autopilot.js __tests__/plugin.test.ts
git commit -m "fix: separate session and global autopilot state"
```

---

### Task 2: Separate completion state from temporary pause state

**Files:**
- Modify: `src/state.js`
- Modify: `src/handlers/chatMessage.js`
- Modify: `src/handlers/messagesTransform.js`
- Modify: `src/handlers/sessionEvents.js`
- Test: `__tests__/plugin.test.ts`

- [ ] **Step 1: Write failing state-semantics tests**

```ts
it('should preserve terminal completion state separately from temporary pauses', async () => {
  const { createContinuePlugin, readState } = await import('../force-continue.server.js');
  const plugin = await createContinuePlugin()({ client: mockClient } as any);

  await plugin.event({
    event: {
      type: 'message.part.updated',
      properties: {
        sessionID: 'done-session',
        part: {
          type: 'tool',
          tool: 'completionSignal',
          state: { status: 'completed', input: { status: 'completed' } }
        }
      }
    }
  });

  const state = readState();
  expect(state.sessions['done-session'].completionState).toEqual({
    status: 'completed',
    timestamp: expect.any(Number)
  });
  expect(state.sessions['done-session'].pauseState).toBeNull();
});

it('should clear temporary pause state on chat.message without clearing completionState', async () => {
  const { createContinuePlugin, readState } = await import('../force-continue.server.js');
  const plugin = await createContinuePlugin()({ client: mockClient } as any);

  const { sessionState } = await import('../src/state.js');
  sessionState.set('pause-session', {
    pauseState: { reason: 'autopilot_max_attempts', timestamp: Date.now() },
    completionState: { status: 'completed', timestamp: Date.now() }
  });

  await plugin['chat.message']({ sessionID: 'pause-session' });

  const state = readState();
  expect(state.sessions['pause-session'].pauseState).toBeNull();
  expect(state.sessions['pause-session'].completionState).toMatchObject({ status: 'completed' });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "completion state" --silent`  
Expected: FAIL because `completionState` and `pauseState` do not exist yet.

- [ ] **Step 3: Add compatibility helpers to `src/state.js`**

```js
export function setCompletionState(sessionID, status) {
  const meta = sessionState.get(sessionID) || {};
  meta.completionState = { status, timestamp: Date.now() };
  meta.autoContinuePaused = { reason: status, timestamp: meta.completionState.timestamp };
  sessionState.set(sessionID, meta);
}

export function clearPauseState(sessionID) {
  const meta = sessionState.get(sessionID) || {};
  meta.pauseState = null;
  if (meta.autoContinuePaused && meta.autoContinuePaused.reason !== "completed" && meta.autoContinuePaused.reason !== "blocked" && meta.autoContinuePaused.reason !== "interrupted") {
    meta.autoContinuePaused = null;
  }
  sessionState.set(sessionID, meta);
}

export function setPauseState(sessionID, reason) {
  const meta = sessionState.get(sessionID) || {};
  meta.pauseState = { reason, timestamp: Date.now() };
  meta.autoContinuePaused = { reason, timestamp: meta.pauseState.timestamp };
  sessionState.set(sessionID, meta);
}
```

- [ ] **Step 4: Update handlers to use the new helpers**

```js
// src/handlers/chatMessage.js
const completionReached = meta.completionState?.status === 'completed'
  || meta.autoContinuePaused?.reason === 'completed';
meta.awaitingGuidance = null;
meta.autopilotAttempts = 0;
meta.pauseState = null;
if (!completionReached) {
  meta.autoContinuePaused = null;
}

// src/handlers/messagesTransform.js
const pauseReason = meta?.completionState?.status || meta?.autoContinuePaused?.reason;
if (pauseReason !== "completed" && pauseReason !== "blocked" && pauseReason !== "interrupted") return;
```

- [ ] **Step 5: Update terminal completion and temporary-pause writes in `src/handlers/sessionEvents.js`**

```js
if (status === "completed" || status === "blocked" || status === "interrupted") {
  setCompletionState(sessionID, status);
}

if (partStatus === "canceled" || partStatus === "cancelled" || partStatus === "interrupted" || partStatus === "aborted" || partStatus === "stopped") {
  setPauseState(sessionID, partStatus);
}
```

- [ ] **Step 6: Run the focused tests to verify they pass**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "completion state|pause state" --silent`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/state.js src/handlers/chatMessage.js src/handlers/messagesTransform.js src/handlers/sessionEvents.js __tests__/plugin.test.ts
git commit -m "refactor: separate completion and pause state"
```

---

### Task 3: Add layered autopilot decision helpers while preserving nudge mode

**Files:**
- Modify: `src/handlers/sessionEvents.js`
- Modify: `src/tools/requestGuidance.js`
- Test: `__tests__/plugin.test.ts`

- [ ] **Step 1: Write failing tests for autopilot fallback to nudge mode**

```ts
it('should fall back to the basic continue nudge when autopilot is enabled but no structured autopilot action applies', async () => {
  const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
  resetAutopilotState();
  const plugin = await createContinuePlugin({ autopilotEnabled: true })({ client: mockClient } as any);

  const { writeAutopilotState } = await import('../src/autopilot.js');
  writeAutopilotState({ enabled: true, timestamp: Date.now() });

  await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'fallback-nudge-session' } } } });
  mockClient.session.messages.mockResolvedValue({
    data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working on the task.' }] }]
  });

  await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'fallback-nudge-session' } } });

  expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
    path: { id: 'fallback-nudge-session' },
    body: { parts: [{ type: 'text', text: expect.stringContaining('Continue working on your current task') }] }
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "fall back to the basic continue nudge" --silent`  
Expected: FAIL or expose that the current logic lacks an explicit autopilot-vs-nudge decision layer.

- [ ] **Step 3: Extract explicit decision helpers in `src/handlers/sessionEvents.js`**

```js
function getAutopilotDecision(meta, contextText, autopilotEnabled) {
  if (!autopilotEnabled) return { type: "nudge" };
  if (meta.awaitingGuidance) return { type: "resolve-guidance" };
  if (!contextText) return { type: "nudge" };
  return { type: "nudge" };
}

async function runAutopilotStep(sessionID, meta, contextText, sendPrompt) {
  if (meta.awaitingGuidance) {
    const prompt = buildAutopilotPrompt(
      meta.awaitingGuidance.question,
      meta.awaitingGuidance.context,
      meta.awaitingGuidance.options
    );
    await sendPrompt(sessionID, prompt);
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Preserve the current basic nudge path as an explicit fallback**

```js
const autopilotDecision = getAutopilotDecision(meta, contextText, autopilotEnabled);
if (autopilotDecision.type === "resolve-guidance") {
  const handled = await runAutopilotStep(sessionID, meta, contextText, sendPrompt);
  if (handled) return;
}

// fallback to current behavior
if (meta.continuationCount >= config.maxContinuations) {
  // existing escalation code
} else if (meta.continuationCount >= config.escalationThreshold) {
  // existing escalation code
} else if (inLoop) {
  // existing loop-break code
} else if (contextText && COMPLETION_KEYWORDS.test(contextText) && meta.continuationCount <= 2) {
  // existing completion nudge code
} else {
  // existing continue prompt code
}
```

- [ ] **Step 5: Keep `requestGuidance` compatible with layered behavior**

```js
meta.awaitingGuidance = { question, context, options, timestamp };
if (!autopilotEnabled) {
  return `Guidance request recorded:\n\nQ: ${question}${context ? `\nContext: ${context}` : ""}${options ? `\nOptions: ${options}` : ""}\n\nGuidance recorded. Auto-continue prompts will still be sent and will include the pending guidance.`;
}
```

- [ ] **Step 6: Run focused autopilot/nudge tests**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "autopilot|guidance|continue nudge" --silent`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/handlers/sessionEvents.js src/tools/requestGuidance.js __tests__/plugin.test.ts
git commit -m "feat: layer autopilot decisions over nudge fallback"
```

---

### Task 4: Update docs and harden validation

**Files:**
- Modify: `README.md`
- Modify: `__tests__/plugin.test.ts`

- [ ] **Step 1: Update README behavior summary**

```md
3. If a session becomes idle without a `completionSignal`, the plugin first tries any applicable autopilot decision path. If no structured autopilot action applies, it falls back to a short "Continue" nudge.
10. Basic nudge mode remains active as the default fallback when the model stops early. Autopilot builds on top of that behavior rather than replacing it.
```

- [ ] **Step 2: Update README tool semantics**

```md
- `requestGuidance` — records guidance and allows autopilot or nudge-mode follow-up depending on session state.
- `setAutopilot` — enables or disables autopilot mode globally or per-session; session-scoped changes do not mutate global autopilot state.
```

- [ ] **Step 3: Add README parity regression coverage**

```ts
it('should document nudge mode as the fallback path for autopilot', async () => {
  const readme = await fs.promises.readFile(new URL('../README.md', import.meta.url), 'utf8');
  expect(readme).toContain('Basic nudge mode remains active as the default fallback');
});
```

- [ ] **Step 4: Run docs/behavior-focused tests**

Run: `npm run test:run -- __tests__/plugin.test.ts -t "fallback path|README" --silent`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md __tests__/plugin.test.ts
git commit -m "docs: describe layered autopilot with nudge fallback"
```

---

### Task 5: Final verification

**Files:**
- Modify: `README.md`
- Modify: `src/autopilot.js`
- Modify: `src/state.js`
- Modify: `src/handlers/chatMessage.js`
- Modify: `src/handlers/sessionEvents.js`
- Modify: `src/handlers/messagesTransform.js`
- Modify: `src/tools/requestGuidance.js`
- Modify: `src/tools/setAutopilot.js`
- Modify: `__tests__/plugin.test.ts`

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run --silent`  
Expected: `Test Files 8 passed` and all tests green.

- [ ] **Step 2: Review the final diff**

Run: `git --no-pager diff -- README.md src/autopilot.js src/state.js src/handlers/chatMessage.js src/handlers/sessionEvents.js src/handlers/messagesTransform.js src/tools/requestGuidance.js src/tools/setAutopilot.js __tests__/plugin.test.ts`  
Expected: only the planned semantics cleanup, layered autopilot fallback work, docs, and tests.

- [ ] **Step 3: Final commit**

```bash
git add README.md src/autopilot.js src/state.js src/handlers/chatMessage.js src/handlers/sessionEvents.js src/handlers/messagesTransform.js src/tools/requestGuidance.js src/tools/setAutopilot.js __tests__/plugin.test.ts
git commit -m "feat: align autopilot with nudge-mode fallback"
```
