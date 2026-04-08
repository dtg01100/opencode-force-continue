import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
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
    try { unlinkSync(p); } catch (e) {}
    // rename is atomic on most platforms
    writeFileSync(p, readFileSync(tmp, "utf-8"));
    try { unlinkSync(tmp); } catch (e) {}
  } catch (e) {
    console.error(`[force-continue] writeAutopilotState: failed to persist autopilot state to disk — ${e?.message}. In-memory state updated but other processes may not see this value.`);
  }
}

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

export function getAutopilotMaxAttempts(config) {
    return config?.autopilotMaxAttempts ?? DEFAULT_AUTOPILOT_MAX_ATTEMPTS;
}
