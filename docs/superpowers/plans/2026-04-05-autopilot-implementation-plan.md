# Autopilot Mode Implementation Plan

NOTE: Implementation approach changed since this plan was drafted. The repository uses a modular "src/" layout (config, tools, autopilot helper, handlers) rather than a single `force-continue.server.js` monolith. The implementation and tests live in `src/` and `__tests__/` respectively. This plan remains as the high-level checklist, but file paths below have been updated to reflect the current code layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autopilot mode that auto-answers `requestGuidance` calls using AI-generated responses instead of waiting for user input.

**Architecture:** Self-contained approach using mini-prompt injection to the same session. When `requestGuidance` is called and autopilot is enabled, a prompt is sent to the session asking it to make a decision autonomously. Safety limits prevent infinite loops.

**Tech Stack:** JavaScript/Node.js, @opencode-ai/plugin framework

---

## File Map (current code locations)

- **Modify / Inspect:** `src/config.js` - autopilot defaults and env parsing
- **Modify / Inspect:** `src/tools/requestGuidance.js` - requestGuidance tool logic and autopilot flow
- **Modify / Inspect:** `src/autopilot.js` - prompt builder, read/write autopilot state, helpers
- **Modify / Inspect:** `__tests__/plugin.test.ts` - tests that cover autopilot behavior

---

## Task 1: Add Autopilot Configuration Options

Implementation note: these options are already present in `src/config.js`. Confirm values and env parsing there.

**Files:**
- Inspect / Modify: `src/config.js` (config section)

- [ ] **Step 1: Add autopilot to DEFAULT_CONFIG**

```javascript
const DEFAULT_CONFIG = {
    // ... existing options ...
    autopilotEnabled: false,
    autopilotMaxAttempts: 3,
};
```

- [ ] **Step 2: Add environment variable parsing in resolveConfig()**

```javascript
if (process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== undefined)
    envConfig.autopilotEnabled = process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== "false";
if (process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS)
    envConfig.autopilotMaxAttempts = parseInt(process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS, 10);
```

Add after line 36 (before the config file loading section).

- [ ] **Step 3: Run lint check**

Run: `npm run lint` (or check package.json for lint command)
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add force-continue.server.js
git commit -m "feat: add autopilot config options"
```

---

## Task 2: Add buildAutopilotPrompt Helper Function

Implementation note: prompt builder and autopilot state helpers live in `src/autopilot.js`.

**Files:**
- Inspect / Modify: `src/autopilot.js`

- [ ] **Step 1: Add buildAutopilotPrompt function**

Add after the `isTaskDone` function (~line 221):

```javascript
function buildAutopilotPrompt(question, context, options) {
    let prompt = `You asked for guidance: ${question}\n\n`;
    if (context) prompt += `Context: ${context}\n\n`;
    if (options) prompt += `Options: ${options}\n\n`;
    prompt += `Instead of waiting for user input, make a reasonable decision and proceed.\n`;
    prompt += `Choose the option that seems most appropriate given the context.\n`;
    prompt += `If you cannot decide, call completionSignal with status='blocked'.\n`;
    prompt += `Do NOT ask for guidance again - make a choice and continue.`;
    return prompt;
}
```

- [ ] **Step 2: Commit**

```bash
git add force-continue.server.js
git commit -m "feat: add buildAutopilotPrompt helper"
```

---

## Task 3: Modify requestGuidance Tool for Autopilot

Implementation note: requestGuidance autopilot flow is implemented in `src/tools/requestGuidance.js` and integrates with `src/autopilot.js` and `src/state.js`.

**Files:**
- Inspect / Modify: `src/tools/requestGuidance.js`

- [ ] **Step 1: Read current requestGuidance implementation**

```javascript
requestGuidance: tool({
    description: "Use this tool when you are uncertain about how to proceed and need clarification from the user before continuing.",
    args: {
        question: tool.schema.string().describe("The specific question or clarification you need."),
        context: tool.schema.string().optional().describe("Additional context about why you're asking."),
        options: tool.schema.string().optional().describe("Possible options you're considering (if any)."),
    },
    execute: async ({ question, context, options }, toolCtx) => {
        const sessionID = toolCtx?.sessionID;
        if (sessionID) {
            const meta = sessionState.get(sessionID) || {};
            meta.awaitingGuidance = { question, context, options, timestamp: Date.now() };
            sessionState.set(sessionID, meta);
            log("info", "Guidance requested", { sessionID, question });
        }
        return `Guidance request recorded:\n\nQ: ${question}${context ? `\nContext: ${context}` : ""}${options ? `\nOptions: ${options}` : ""}\n\nAuto-continue paused until user responds.`;
    },
}),
```

- [ ] **Step 2: Replace with autopilot-enabled version**

```javascript
requestGuidance: tool({
    description: "Use this tool when you are uncertain about how to proceed and need clarification from the user before continuing.",
    args: {
        question: tool.schema.string().describe("The specific question or clarification you need."),
        context: tool.schema.string().optional().describe("Additional context about why you're asking."),
        options: tool.schema.string().optional().describe("Possible options you're considering (if any)."),
    },
    execute: async ({ question, context, options }, toolCtx) => {
        const sessionID = toolCtx?.sessionID;
        if (sessionID) {
            const meta = sessionState.get(sessionID) || {};
            meta.awaitingGuidance = { question, context, options, timestamp: Date.now() };
            meta.autopilotAttempts = meta.autopilotAttempts || 0;
            sessionState.set(sessionID, meta);
            log("info", "Guidance requested", { sessionID, question });
        }

        if (config.autopilotEnabled) {
            const meta = sessionState.get(sessionID) || {};

            // Check if we've exceeded max autopilot attempts
            if (meta.autopilotAttempts >= config.autopilotMaxAttempts) {
                log("info", "Autopilot max attempts reached, waiting for user", { sessionID });
                return `Guidance request recorded:\n\nQ: ${question}${context ? `\nContext: ${context}` : ""}${options ? `\nOptions: ${options}` : ""}\n\nAutopilot limit reached. Waiting for user input.`;
            }

            // Generate autonomous answer
            try {
                meta.autopilotAttempts++;
                sessionState.set(sessionID, meta);

                const prompt = buildAutopilotPrompt(question, context, options);
                await client.session.promptAsync({
                    path: { id: sessionID },
                    body: { parts: [{ type: "text", text: prompt }] }
                });

                log("info", "Autopilot answer generated", { sessionID, attempts: meta.autopilotAttempts });
                return null; // Answer was sent via promptAsync
            } catch (e) {
                log("error", "Autopilot failed", { error: e?.stack ?? e });
                // Fall back to normal behavior
            }
        }

        return `Guidance request recorded:\n\nQ: ${question}${context ? `\nContext: ${context}` : ""}${options ? `\nOptions: ${options}` : ""}\n\nAuto-continue paused until user responds.`;
    },
}),
```

- [ ] **Step 3: Commit**

```bash
git add force-continue.server.js
git commit -m "feat: add autopilot logic to requestGuidance tool"
```

---

## Task 4: Reset Autopilot Attempts on User Message

Implementation note: chat message handler is implemented in `src/handlers/chatMessage.js` / `src/state.js` and already resets session metadata on user messages; confirm autopilotAttempts reset there.

**Files:**
- Inspect / Modify: `src/handlers/chatMessage.js`, `src/state.js`

- [ ] **Step 1: Read current chat.message handler**

```javascript
returnObj["chat.message"] = async ({ sessionID }) => {
    if (!sessionID || typeof sessionID !== "string") return;
    try {
        const meta = sessionState.get(sessionID) || {};
        meta.lastSeen = Date.now();
        meta.continuationCount = 0;
        meta.lastAssistantText = null;
        meta.responseHistory = [];
        meta.toolCallHistory = [];
        meta.errorCount = 0;
        meta.autoContinuePaused = null;
        meta.awaitingGuidance = null;
        meta.toolLoopDetected = false;
        sessionState.set(sessionID, meta);
    } catch (e) { /* best-effort */ }
};
```

- [ ] **Step 2: Add autopilotAttempts reset**

Add `meta.autopilotAttempts = 0;` after `meta.toolLoopDetected = false;` and before `sessionState.set`:

```javascript
meta.toolLoopDetected = false;
meta.autopilotAttempts = 0;
sessionState.set(sessionID, meta);
```

- [ ] **Step 3: Commit**

```bash
git add force-continue.server.js
git commit -m "feat: reset autopilot attempts on user message"
```

---

## Task 5: Add Autopilot Metrics

Implementation note: metrics are tracked via `src/metrics.js`. Confirm `autopilot.attempt` and `autopilot.fallback` are recorded and surfaced by the metrics tracker.

**Files:**
- Inspect / Modify: `src/metrics.js`

- [ ] **Step 1: Read current metrics structure**

Add new metrics to the metrics object:
- `totalAutopilotAttempts: 0`
- `totalAutopilotFallbacks: 0`

- [ ] **Step 2: Add case handlers**

In the `record` method switch, add:
```javascript
case "autopilot.attempt": metrics.totalAutopilotAttempts++; break;
case "autopilot.fallback": metrics.totalAutopilotFallbacks++; break;
```

- [ ] **Step 3: Update getSummary return**

Add to the returned object:
```javascript
totalAutopilotAttempts: metrics.totalAutopilotAttempts,
totalAutopilotFallbacks: metrics.totalAutopilotFallbacks,
```

- [ ] **Step 4: Commit**

```bash
git add force-continue.server.js
git commit -m "feat: add autopilot metrics tracking"
```

---

## Task 6: Write Autopilot Tests

Implementation note: tests covering autopilot behavior exist in `__tests__/plugin.test.ts` — run the test suite to validate behavior.

**Files:**
- Inspect / Modify: `__tests__/plugin.test.ts`

- [ ] **Step 1: Read existing test structure**

Look at how other tools are tested to follow the same pattern.

- [ ] **Step 2: Add test for autopilot enabled behavior**

```javascript
describe("autopilot", () => {
    beforeEach(() => {
        sessionState.clear();
    });

    it("should generate autonomous answer when autopilot enabled", async () => {
        const mockPromptAsync = jest.fn().mockResolvedValue({});
        const mockClient = {
            session: { messages: jest.fn(), promptAsync: mockPromptAsync }
        };
        
        const plugin = createContinuePlugin({
            autopilotEnabled: true,
            autopilotMaxAttempts: 3
        });
        
        const ctx = { client: mockClient };
        const instance = await plugin(ctx);
        
        const result = await instance.tool.requestGuidance.execute(
            { question: "Should I use A or B?", context: "Building a feature", options: "A or B" },
            { sessionID: "test-session" }
        );
        
        expect(mockPromptAsync).toHaveBeenCalledWith({
            path: { id: "test-session" },
            body: { parts: [{ type: "text", text: expect.stringContaining("You asked for guidance") }] }
        });
        expect(result).toBeNull();
    });

    it("should fall back after max autopilot attempts", async () => {
        const mockPromptAsync = jest.fn().mockResolvedValue({});
        const mockClient = {
            session: { messages: jest.fn(), promptAsync: mockPromptAsync }
        };
        
        const plugin = createContinuePlugin({
            autopilotEnabled: true,
            autopilotMaxAttempts: 2
        });
        
        const ctx = { client: mockClient };
        const instance = await plugin(ctx);
        
        const toolCtx = { sessionID: "test-session" };
        
        // First call
        await instance.tool.requestGuidance.execute(
            { question: "First question?" },
            toolCtx
        );
        
        // Second call - at limit
        await instance.tool.requestGuidance.execute(
            { question: "Second question?" },
            toolCtx
        );
        
        // Third call - should fall back
        const result = await instance.tool.requestGuidance.execute(
            { question: "Third question?" },
            toolCtx
        );
        
        expect(result).toContain("Autopilot limit reached");
        expect(result).toContain("Waiting for user input");
    });

    it("should reset autopilot attempts on user message", async () => {
        const mockPromptAsync = jest.fn().mockResolvedValue({});
        const mockClient = {
            session: { messages: jest.fn(), promptAsync: mockPromptAsync }
        };
        
        const plugin = createContinuePlugin({
            autopilotEnabled: true,
            autopilotMaxAttempts: 1
        });
        
        const ctx = { client: mockClient };
        const instance = await plugin(ctx);
        
        const toolCtx = { sessionID: "test-session" };
        
        // First call
        await instance.tool.requestGuidance.execute(
            { question: "Question 1" },
            toolCtx
        );
        
        // Simulate user message via chat.message
        await instance["chat.message"]({ sessionID: "test-session" });
        
        // Should be able to use autopilot again
        const result = await instance.tool.requestGuidance.execute(
            { question: "Question 2" },
            toolCtx
        );
        
        expect(mockPromptAsync).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test:run`
Expected: All tests pass including new autopilot tests

- [ ] **Step 4: Commit**

```bash
git add __tests__/plugin.test.ts
git commit -m "test: add autopilot mode tests"
```

---

## Task 7: Update README Documentation

Implementation note: README already documents autopilot env vars and tools reference. If additional examples are needed, edit `README.md`.

**Files:**
- Modify: `README.md` (if updates required)

- [ ] **Step 1: Add autopilot configuration to environment variables table**

Add after the existing configuration entries:

```markdown
| `FORCE_CONTINUE_AUTOPILOT_ENABLED` | `false` | Enable autopilot mode for auto-answering guidance requests |
| `FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS` | `3` | Max auto-answer attempts before falling back to user input |
```

- [ ] **Step 2: Add autopilot section to Tools Reference**

Add new section after `requestGuidance`:

```markdown
### Autopilot Mode

When `FORCE_CONTINUE_AUTOPILOT_ENABLED=true`, the plugin automatically answers `requestGuidance` calls instead of waiting for user input. The AI makes autonomous decisions and continues working.

Use cases:
- Long-running tasks where the AI can reasonably decide on its own
- Autonomous research mode
- CI/automated environments without human guidance availability

If max attempts is reached, falls back to normal behavior requiring user input.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add autopilot mode documentation"
```

---

## Verification Checklist

After all tasks complete:
- [ ] All new config vars work via environment variables
- [ ] Autopilot generates answers when enabled
- [ ] Max attempts limit works correctly
- [ ] Fallback to user input after limit
- [ ] Reset on user message works
- [ ] All existing tests still pass
- [ ] New autopilot tests pass
- [ ] README updated with new config options
