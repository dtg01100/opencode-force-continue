import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getAutopilotEnabled as getAutopilotEnabledFromState, setAutopilotEnabled as setAutopilotEnabledInState } from "./state.js";

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
    if (sessionID) {
        return getAutopilotEnabledFromState(sessionID);
    }
    const stored = readAutopilotState();
    if (stored.timestamp !== null) return stored.enabled;
    return config?.autopilotEnabled ?? false;
}

export function setAutopilotEnabled(sessionID, enabled) {
    setAutopilotEnabledInState(sessionID, enabled);
}