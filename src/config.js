import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const DEFAULT_CONFIG = {
    maxContinuations: 5,
    escalationThreshold: 3,
    enableLoopDetection: true,
    enableToolLoopDetection: true,
    autoContinueEnabled: true,
    cooldownMs: 0,
    nudgeDelayMs: 2000,
    circuitBreakerThreshold: 10,
    enableFileTracking: true,
    enableTaskTracking: true,
    enableCompletionSummary: true,
    enableSystemPromptInjection: true,
    logToStdout: false,
    ignoreTools: ["read", "glob", "grep"],
    dangerousCommands: ["rm -rf /", "rm -rf ~", "mkfs", "dd if=/dev/zero", "> /dev/sda"],
    autopilotEnabled: false,
    autopilotMaxAttempts: 3,
    skipNudgeInSubagents: true,
};

function safeParseInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function resolveConfig() {
    const envConfig = {};
    if (process.env.FORCE_CONTINUE_MAX_CONTINUATIONS) envConfig.maxContinuations = safeParseInt(process.env.FORCE_CONTINUE_MAX_CONTINUATIONS, DEFAULT_CONFIG.maxContinuations);
    if (process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD) envConfig.escalationThreshold = safeParseInt(process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD, DEFAULT_CONFIG.escalationThreshold);
    if (process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION !== undefined) envConfig.enableLoopDetection = process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION !== undefined) envConfig.enableToolLoopDetection = process.env.FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION !== "false";
    if (process.env.FORCE_CONTINUE_AUTO_CONTINUE !== undefined) envConfig.autoContinueEnabled = process.env.FORCE_CONTINUE_AUTO_CONTINUE !== "false";
    if (process.env.FORCE_CONTINUE_COOLDOWN_MS) envConfig.cooldownMs = safeParseInt(process.env.FORCE_CONTINUE_COOLDOWN_MS, DEFAULT_CONFIG.cooldownMs);
    if (process.env.FORCE_CONTINUE_NUDGE_DELAY_MS) envConfig.nudgeDelayMs = safeParseInt(process.env.FORCE_CONTINUE_NUDGE_DELAY_MS, DEFAULT_CONFIG.nudgeDelayMs);
    if (process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD) envConfig.circuitBreakerThreshold = safeParseInt(process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD, DEFAULT_CONFIG.circuitBreakerThreshold);
    if (process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING !== undefined) envConfig.enableFileTracking = process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING !== undefined) envConfig.enableTaskTracking = process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY !== undefined) envConfig.enableCompletionSummary = process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY !== "false";
    if (process.env.FORCE_CONTINUE_LOG_TO_STDOUT !== undefined) envConfig.logToStdout = process.env.FORCE_CONTINUE_LOG_TO_STDOUT !== "false";
    if (process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== undefined)
        envConfig.autopilotEnabled = process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== "false";
    if (process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS)
        envConfig.autopilotMaxAttempts = safeParseInt(process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS, DEFAULT_CONFIG.autopilotMaxAttempts);
    if (process.env.FORCE_CONTINUE_SKIP_NUDGE_IN_SUBAGENTS !== undefined)
        envConfig.skipNudgeInSubagents = process.env.FORCE_CONTINUE_SKIP_NUDGE_IN_SUBAGENTS !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_SYSTEM_PROMPT_INJECTION !== undefined)
        envConfig.enableSystemPromptInjection = process.env.FORCE_CONTINUE_ENABLE_SYSTEM_PROMPT_INJECTION !== "false";

    let fileConfig = {};
    const configPaths = [
        join(process.cwd(), ".opencode", "force-continue.json"),
        join(process.cwd(), "force-continue.config.json"),
    ];
    for (const p of configPaths) {
        if (existsSync(p)) {
            try {
                fileConfig = JSON.parse(readFileSync(p, "utf-8"));
                break;
            } catch (e) {
                console.warn(`force-continue: Failed to parse config file ${p}: ${e?.message ?? e}`);
            }
        }
    }

    return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}
