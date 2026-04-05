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
    let prompt = `You asked for guidance: ${question}\n\n`;
    if (context) prompt += `Context: ${context}\n\n`;
    if (options) prompt += `Options: ${options}\n\n`;
    prompt += `Instead of waiting for user input, make a reasonable decision and proceed.\n`;
    prompt += `Choose the option that seems most appropriate given the context.\n`;
    prompt += `If you cannot decide, call completionSignal with status='blocked'.\n`;
    prompt += `Do NOT ask for guidance again - make a choice and continue.`;
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