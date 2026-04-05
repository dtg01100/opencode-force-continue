import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export function getAutopilotStorePath() {
    return join(process.cwd(), ".opencode", "force-continue-store", "autopilot.json");
}

export function readAutopilotState() {
    const p = getAutopilotStorePath();
    if (!existsSync(p)) return null;
    try {
        return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
        return null;
    }
}

export function writeAutopilotState(state) {
    const p = getAutopilotStorePath();
    const dir = join(process.cwd(), ".opencode", "force-continue-store");
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(p, JSON.stringify(state));
    } catch (e) {
        console.warn(`force-continue: Failed to write autopilot state: ${e?.message ?? e}`);
    }
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

export function getAutopilotEnabled(config) {
    const stored = readAutopilotState();
    return stored?.enabled ?? config.autopilotEnabled;
}

export function getAutopilotMaxAttempts(config) {
    const stored = readAutopilotState();
    if (stored && stored.maxAttempts !== undefined) {
        return stored.maxAttempts;
    }
    return config.autopilotMaxAttempts;
}