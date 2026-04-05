# Autopilot Mode - Auto-Answer Guidance Questions

**Date:** 2026-04-05
**Status:** Draft

## Overview

Add an **autopilot mode** to the force-continue plugin that automatically generates AI answers to `requestGuidance` questions instead of pausing and waiting for user input. When enabled, the plugin acts as an autonomous coding assistant that can resolve its own questions without human intervention.

## Motivation

Currently, when the AI calls `requestGuidance` (e.g., "Should I use approach A or B?"), the session pauses and waits for user input. This breaks autonomy for long-running tasks where the AI could reasonably decide on its own.

This feature enables a "Copilot autopilot" style behavior where the AI makes reasonable decisions autonomously when it would otherwise ask for guidance.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `FORCE_CONTINUE_AUTOPILOT_ENABLED` | `false` | Master toggle for autopilot mode |
| `FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS` | `3` | Max consecutive auto-answers before falling back to user |

Config file equivalent:
```json
{
  "autopilotEnabled": true,
  "autopilotMaxAttempts": 3
}
```

## Behavior

### Normal Mode (autopilotEnabled=false)
Existing behavior: `requestGuidance` records the question, pauses auto-continue, and waits for user input.

### Autopilot Mode (autopilotEnabled=true)

When `requestGuidance` is called:

1. **Record guidance request** in session meta (existing behavior)
2. **Generate autonomous answer** using a mini-prompt to the session
3. **Send the generated answer** back to the session via `promptAsync`
4. **Resume normal operation** - the AI continues with its self-generated answer

### Autopilot Answer Generation

The mini-prompt sent to generate an answer:

```
You asked for guidance: {question}
{context if present}
{options if present}

Instead of waiting for user input, make a reasonable decision and proceed.
Choose the option that seems most appropriate given the context.
Call completionSignal if you cannot proceed.
```

### Safety Limits

- **Max attempts:** Track consecutive autopilot answers. After `autopilotMaxAttempts`, fall back to normal `requestGuidance` behavior requiring user input.
- **Circuit breaker:** Existing circuit breaker still applies to all operations.
- **Completion signals:** If AI calls `completionSignal` during autopilot, respect it.

## Implementation

### File: `force-continue.server.js`

#### New Config Options
```javascript
const DEFAULT_CONFIG = {
    // ... existing options ...
    autopilotEnabled: false,
    autopilotMaxAttempts: 3,
};
```

#### Environment Variable Support
```javascript
if (process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== undefined)
    envConfig.autopilotEnabled = process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== "false";
if (process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS)
    envConfig.autopilotMaxAttempts = parseInt(process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS, 10);
```

#### Modified `requestGuidance` Tool
```javascript
requestGuidance: tool({
    description: "...",
    args: { ... },
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
                return `Guidance request recorded:\n\nQ: ${question}\n\nAutopilot limit reached. Waiting for user input.`;
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

        return `Guidance request recorded:\n\nQ: ${question}...\n\nAuto-continue paused until user responds.`;
    },
}),

// Helper function
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

#### Reset Autopilot Attempts
Autopilot attempt counter should reset when:
- User sends a message (`chat.message` handler)
- AI calls `statusReport` indicating progress
- Session completes or is deleted

## Metrics

New metrics to track:
- `autopilotAttempts` - Total autonomous guidance resolutions
- `autopilotFallbacks` - Times autopilot fell back to user input

## Testing Considerations

1. Test that autopilot generates answers when enabled
2. Test that autopilot respects max attempts limit
3. Test fallback to normal behavior after max attempts
4. Test that autopilot attempts reset on user message
5. Test circuit breaker integration
