import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

// Import only the sessionState Map directly to avoid circular dependency
// DO NOT import getAutopilotEnabled/setAutopilotEnabled from state.js
import { sessionState } from "./state.js";

let autopilotState = { enabled: false, timestamp: null };

function autopilotFilePath() {
  // In test mode each worker gets its own file to prevent cross-worker contamination.
  // In production all processes share autopilot.json so TUI ↔ server state is visible.
  const filename = process.env.VITEST
    ? `autopilot.${process.pid}.json`
    : "autopilot.json";
  return join(process.cwd(), ".opencode", "force-continue", filename);
}

export function resetAutopilotState() {
  autopilotState = { enabled: false, timestamp: null };
  try {
    const p = autopilotFilePath();
    if (existsSync(p)) unlinkSync(p);
  } catch (e) {
    console.debug(`[force-continue] resetAutopilotState: ${e?.message}`);
  }
}

export function readAutopilotState() {
  try {
    const p = autopilotFilePath();
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, "utf-8"));
      // Accept stored state if it has an explicit timestamp (number) or null.
      // Older code rejected null timestamps; allow null so a persisted disabled
      // autopilot state is respected even when timestamp isn't set.
      if (parsed && (typeof parsed.timestamp === "number" || parsed.timestamp === null)) {
        return {
          enabled: Boolean(parsed.enabled),
          timestamp: parsed.timestamp,
        };
      }
    }
  } catch (e) {
    console.warn(`[force-continue] readAutopilotState: failed to read autopilot state — ${e?.message}`);
  }
  return autopilotState;
}

export function writeAutopilotState(state) {
  if (!state || typeof state !== "object") {
    throw new Error("writeAutopilotState: state must be an object with { enabled: boolean, timestamp: number|null }");
  }
  autopilotState = {
    enabled: Boolean(state.enabled),
    timestamp: typeof state.timestamp === "number" ? state.timestamp : null,
  };
  try {
    const p = autopilotFilePath();
    mkdirSync(join(process.cwd(), ".opencode", "force-continue"), { recursive: true });
    // write atomically: write to tmp file then rename
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(autopilotState));
    // renameSync is atomic on POSIX systems; on Windows it may fail if target exists
    try { unlinkSync(p); } catch (e) {}
    renameSync(tmp, p);
  } catch (e) {
    console.error(`[force-continue] writeAutopilotState: failed to persist autopilot state to disk — ${e?.message}. In-memory state updated but other processes may not see this value.`);
  }
}

/**
 * Build a prompt for autopilot decision-making.
 * @param {string} question - The question to answer
 * @param {string} [context] - Additional context
 * @param {string} [options] - Available options
 * @returns {string} Formatted prompt
 */
export function buildAutopilotPrompt(question, context, options) {
  if (!question || typeof question !== "string") {
    throw new Error("buildAutopilotPrompt: question is required and must be a string");
  }
  if (context !== undefined && context !== null && typeof context !== "string") {
    context = String(context);
  }
  if (options !== undefined && options !== null && typeof options !== "string") {
    options = String(options);
  }
  let prompt = `AUTONOMOUS DECISION REQUIRED\n\n`;
  prompt += `Question: ${question}\n\n`;
  if (context) prompt += `Context: ${context}\n\n`;
  if (options) prompt += `Options: ${options}\n\n`;
  prompt += `Instructions:\n`;
  prompt += `1. Make a specific, reasonable decision based on the context.\n`;
  prompt += `2. State your decision briefly, then proceed with the work.\n`;
  prompt += `3. If genuinely unable to decide, call completionSignal with status='blocked'.\n`;
  prompt += `4. Do NOT ask for guidance again or re-ask this question.\n`;
  return prompt;
}

/**
 * Get autopilot enabled state with full resolution: session override → file store → config.
 * @param {object} config - Configuration object with autopilotEnabled field
 * @param {string} [sessionID] - Optional session ID to check for session-level override
 * @returns {boolean} Whether autopilot is enabled
 */
export function getAutopilotEnabled(config, sessionID) {
    // Check session-level state if sessionID is provided
    if (sessionID) {
        const meta = sessionState.get(sessionID) || {};
        // If session has explicitly set autopilotEnabled, use that value
        if ('autopilotEnabled' in meta) {
            return meta.autopilotEnabled;
        }
    }
    // Fall back to global file store
    const stored = readAutopilotState();
    // If stored has a numeric timestamp treat it as authoritative.
    // Previously we treated null timestamps as authoritative which caused
    // persisted-but-uninitialized state to override runtime config. Tests and
    // callers expect that only a real numeric timestamp (a real write) should
    // override config at runtime. Fall back to config when timestamp is null.
    if (stored && typeof stored.timestamp === "number") return stored.enabled;
    // Fall back to config
    return config?.autopilotEnabled ?? false;
}

/**
 * Set autopilot enabled state for a session or globally.
 * @param {string} [sessionID] - Session ID for session-level override, or null for global
 * @param {boolean} enabled - Whether to enable or disable autopilot
 */
export function setAutopilotEnabled(sessionID, enabled) {
    if (sessionID) {
        // Directly update sessionState to avoid circular dependency
        const meta = sessionState.get(sessionID) || {};
        meta.autopilotEnabled = enabled;
        sessionState.set(sessionID, meta);
        return;
    }
    writeAutopilotState({ enabled, timestamp: Date.now() });
    for (const [sid, meta] of sessionState) {
        if (Object.prototype.hasOwnProperty.call(meta, "autopilotEnabled")) {
            delete meta.autopilotEnabled;
            sessionState.set(sid, meta);
        }
    }
}

const DEFAULT_AUTOPILOT_MAX_ATTEMPTS = 3;

/**
 * Get the maximum number of autopilot attempts before fallback.
 * @param {object} [config] - Configuration object with autopilotMaxAttempts field
 * @returns {number} Maximum attempts (default: 3)
 */
export function getAutopilotMaxAttempts(config) {
    return config?.autopilotMaxAttempts ?? DEFAULT_AUTOPILOT_MAX_ATTEMPTS;
}

/**
 * Determine if autopilot should take action for an idle session.
 * Returns a decision object indicating what autopilot should do.
 * 
 * @param {object} meta - Session metadata
 * @param {object} config - Configuration object
 * @param {string} sessionID - Session ID
 * @param {boolean} aiAskedQuestion - Whether the AI's last message contains a question
 * @returns {object} Decision with shape: { action: 'resolve_guidance' | 'answer_question' | 'noop', ... }
 */
export function getAutopilotDecision(meta, config, sessionID, aiAskedQuestion) {
    const autopilotEnabled = getAutopilotEnabled(config, sessionID);
    if (!autopilotEnabled) {
        return { action: 'noop', reason: 'autopilot_disabled' };
    }

    // Check if there's pending guidance to resolve
    if (meta.awaitingGuidance && !aiAskedQuestion) {
        return {
            action: 'resolve_guidance',
            question: meta.awaitingGuidance.question,
            context: meta.awaitingGuidance.context,
            options: meta.awaitingGuidance.options,
            attempts: (meta.autopilotAttempts || 0) + 1,
            maxAttempts: getAutopilotMaxAttempts(config)
        };
    }

    // Check if AI asked a question that needs auto-answering
    if (aiAskedQuestion) {
        return {
            action: 'answer_question',
            attempts: (meta.autopilotAttempts || 0) + 1,
            maxAttempts: getAutopilotMaxAttempts(config)
        };
    }

    return { action: 'noop', reason: 'no_autopilot_trigger' };
}

/**
 * Execute an autopilot decision returned by getAutopilotDecision.
 * 
 * @param {object} decision - Decision object from getAutopilotDecision
 * @param {object} ctx - Context with sessionState, client, log, metricsTracker
 * @param {string} sessionID - Session ID
 * @param {string} contextText - AI's last response text
 * @returns {Promise<boolean>} True if autopilot took action, false if it fell back
 */
export async function runAutopilotStep(decision, ctx, sessionID, contextText) {
    const { sessionState: sState, client, log, metricsTracker, config, sendPrompt, extractQuestions, buildAutopilotPrompt: buildPrompt } = ctx;

    if (decision.action === 'noop') {
        return false;
    }

    if (decision.action === 'resolve_guidance') {
        if (decision.attempts > decision.maxAttempts) {
            log("info", "Autopilot max guidance attempts reached, pausing", { sessionID });
            metricsTracker.record(sessionID, "autopilot.fallback.guidance");
            // Import setPauseState lazily to avoid circular dependency
            const { setPauseState } = await import("./state.js");
            setPauseState(sessionID, 'autopilot_max_attempts');
            return false;
        }

        // Update attempt count
        const meta = sState.get(sessionID) || {};
        meta.autopilotAttempts = decision.attempts;
        sState.set(sessionID, meta);

        const prompt = buildPrompt(
            decision.question,
            decision.context,
            decision.options
        );
        metricsTracker.record(sessionID, "autopilot.guidance.resolution");
        log("info", "Autopilot resolving pending guidance", { sessionID, question: decision.question });
        await sendPrompt(sessionID, prompt);
        return true;
    }

    if (decision.action === 'answer_question') {
        if (decision.attempts > decision.maxAttempts) {
            log("info", "Autopilot max question attempts reached, tripping circuit breaker", { sessionID });
            metricsTracker.record(sessionID, "autopilot.fallback.question");
            metricsTracker.record(sessionID, "circuit.breaker.trip");
            const { setPauseState } = await import("./state.js");
            setPauseState(sessionID, 'autopilot_max_attempts');
            log("warn", "Circuit breaker tripped: autopilot max attempts exceeded", { sessionID, attempts: decision.attempts });
            return false;
        }

        // Update attempt count
        const meta = sState.get(sessionID) || {};
        meta.autopilotAttempts = decision.attempts;
        sState.set(sessionID, meta);

        const questions = extractQuestions(contextText);
        const questionText = questions.length > 0 ? questions.join(' ') : contextText;
        const prompt = buildPrompt(
            `You asked: ${questionText}`,
            `Your last response suggested you were waiting for an answer.`,
            "Choose a reasonable answer and proceed with your work."
        );
        metricsTracker.record(sessionID, "autopilot.question.attempt");
        log("info", "Autopilot answering AI question", { sessionID, questions });
        await sendPrompt(sessionID, prompt);
        return true;
    }

    return false;
}

