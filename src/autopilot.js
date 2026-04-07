import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { sessionState, getAutopilotEnabled as getAutopilotEnabledFromState, setAutopilotEnabled as setAutopilotEnabledInState } from "./state.js";

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
  } catch {}
}

export function readAutopilotState() {
  try {
    const p = autopilotFilePath();
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, "utf-8"));
      if (parsed && typeof parsed.timestamp === "number" && parsed.timestamp !== null) {
        return parsed;
      }
    }
  } catch {}
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
    writeFileSync(p, JSON.stringify(autopilotState));
  } catch {}
}

export function buildAutopilotPrompt(question, context, options) {
  if (!question || typeof question !== "string") {
    throw new Error("buildAutopilotPrompt: question is required and must be a string");
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
    if (stored.timestamp !== null) return stored.enabled;
    // Fall back to config
    return config?.autopilotEnabled ?? false;
}

export function setAutopilotEnabled(sessionID, enabled) {
    if (sessionID) {
        setAutopilotEnabledInState(sessionID, enabled);
    }
    writeAutopilotState({ enabled, timestamp: Date.now() });
    if (!sessionID) {
        // Global toggle: clear any stale session-level overrides so they cannot
        // shadow the new global value when getAutopilotEnabled checks session first.
        for (const [sid, meta] of sessionState) {
            if (Object.prototype.hasOwnProperty.call(meta, "autopilotEnabled")) {
                delete meta.autopilotEnabled;
                sessionState.set(sid, meta);
            }
        }
    }
}

const DEFAULT_AUTOPILOT_MAX_ATTEMPTS = 3;

export function getAutopilotMaxAttempts(config) {
    return config?.autopilotMaxAttempts ?? DEFAULT_AUTOPILOT_MAX_ATTEMPTS;
}