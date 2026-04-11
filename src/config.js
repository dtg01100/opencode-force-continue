import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { validateConfig } from "./validation.js";

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
    sessionTtlMs: 24 * 60 * 60 * 1000,
};

function safeParseInt(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const str = typeof value === 'string' ? value.trim() : value.toString();
    if (str === '') return fallback;

    // Check for special number formats
    const hasExponent = /[eE]/.test(str);
    const hasHexPrefix = /^0[xX]/.test(str);

    if (hasExponent) {
        // Scientific notation - use parseFloat
        const f = parseFloat(str);
        if (Number.isFinite(f) && f >= 0 && Number.isInteger(f)) return f;
    } else if (hasHexPrefix) {
        // Hex number - use parseInt with base 16
        const n = parseInt(str, 16);
        if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) return n;
    } else {
        // Regular decimal - try parseInt first, then parseFloat
        const n = parseInt(str, 10);
        if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) return n;

        const f = parseFloat(str);
        if (Number.isFinite(f) && f >= 0 && Number.isInteger(f)) return f;
    }

    return fallback;
}

export function resolveConfig() {
    const envConfig = {};
    if (process.env.FORCE_CONTINUE_MAX_CONTINUATIONS) envConfig.maxContinuations = safeParseInt(process.env.FORCE_CONTINUE_MAX_CONTINUATIONS, DEFAULT_CONFIG.maxContinuations);
    if (process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD) envConfig.escalationThreshold = safeParseInt(process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD, DEFAULT_CONFIG.escalationThreshold);
    if (process.env.FORCE_CONTINUE_COOLDOWN_MS) envConfig.cooldownMs = safeParseInt(process.env.FORCE_CONTINUE_COOLDOWN_MS, DEFAULT_CONFIG.cooldownMs);
    if (process.env.FORCE_CONTINUE_NUDGE_DELAY_MS) envConfig.nudgeDelayMs = safeParseInt(process.env.FORCE_CONTINUE_NUDGE_DELAY_MS, DEFAULT_CONFIG.nudgeDelayMs);
    if (process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD) envConfig.circuitBreakerThreshold = safeParseInt(process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD, DEFAULT_CONFIG.circuitBreakerThreshold);
    if (process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION !== undefined) envConfig.enableLoopDetection = process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION !== undefined) envConfig.enableToolLoopDetection = process.env.FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_AUTO_CONTINUE !== undefined) envConfig.autoContinueEnabled = process.env.FORCE_CONTINUE_AUTO_CONTINUE.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING !== undefined) envConfig.enableFileTracking = process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING !== undefined) envConfig.enableTaskTracking = process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY !== undefined) envConfig.enableCompletionSummary = process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_LOG_TO_STDOUT !== undefined) envConfig.logToStdout = process.env.FORCE_CONTINUE_LOG_TO_STDOUT.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED !== undefined)
        envConfig.autopilotEnabled = process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS)
        envConfig.autopilotMaxAttempts = safeParseInt(process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS, DEFAULT_CONFIG.autopilotMaxAttempts);
    if (process.env.FORCE_CONTINUE_SKIP_NUDGE_IN_SUBAGENTS !== undefined)
        envConfig.skipNudgeInSubagents = process.env.FORCE_CONTINUE_SKIP_NUDGE_IN_SUBAGENTS.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_SYSTEM_PROMPT_INJECTION !== undefined)
        envConfig.enableSystemPromptInjection = process.env.FORCE_CONTINUE_ENABLE_SYSTEM_PROMPT_INJECTION.toLowerCase() !== "false";
    if (process.env.FORCE_CONTINUE_SESSION_TTL_MS)
        envConfig.sessionTtlMs = safeParseInt(process.env.FORCE_CONTINUE_SESSION_TTL_MS, DEFAULT_CONFIG.sessionTtlMs);

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

    // Filter out null values from fileConfig to avoid overriding defaults
    const filteredFileConfig = {};
    for (const [key, value] of Object.entries(fileConfig)) {
        if (value !== null) {
            filteredFileConfig[key] = value;
        }
    }

    const fileValidation = validateConfig(filteredFileConfig);
    const sanitizedFileConfig = {};
    if (fileValidation.valid) {
        Object.assign(sanitizedFileConfig, filteredFileConfig);
    } else {
        const validKeys = new Set(Object.keys(DEFAULT_CONFIG));
        for (const [key, value] of Object.entries(filteredFileConfig)) {
            if (!validKeys.has(key)) continue;
            const singleKeyValidation = validateConfig({ [key]: value });
            if (singleKeyValidation.valid) {
                sanitizedFileConfig[key] = value;
            }
        }
        if (Object.keys(filteredFileConfig).length > 0) {
            console.warn(`force-continue: Ignoring invalid config values from file: ${fileValidation.errors.map(e => e.message).join("; ")}`);
        }
    }

    return { ...DEFAULT_CONFIG, ...sanitizedFileConfig, ...envConfig };
}
