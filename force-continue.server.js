import { tool } from "@opencode-ai/plugin";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    maxContinuations: 5,
    escalationThreshold: 3,
    enableLoopDetection: true,
    enableToolLoopDetection: true,
    autoContinueEnabled: true,
    cooldownMs: 0,
    circuitBreakerThreshold: 10,
    enableFileTracking: true,
    enableTaskTracking: true,
    enableCompletionSummary: true,
    logToStdout: false,
    ignoreTools: ["read", "glob", "grep"],
    dangerousCommands: ["rm -rf /", "rm -rf ~", "mkfs", "dd if=/dev/zero", "> /dev/sda"],
};

function resolveConfig() {
    const envConfig = {};
    if (process.env.FORCE_CONTINUE_MAX_CONTINUATIONS) envConfig.maxContinuations = parseInt(process.env.FORCE_CONTINUE_MAX_CONTINUATIONS, 10);
    if (process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD) envConfig.escalationThreshold = parseInt(process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD, 10);
    if (process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION !== undefined) envConfig.enableLoopDetection = process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION !== undefined) envConfig.enableToolLoopDetection = process.env.FORCE_CONTINUE_ENABLE_TOOL_LOOP_DETECTION !== "false";
    if (process.env.FORCE_CONTINUE_AUTO_CONTINUE !== undefined) envConfig.autoContinueEnabled = process.env.FORCE_CONTINUE_AUTO_CONTINUE !== "false";
    if (process.env.FORCE_CONTINUE_COOLDOWN_MS) envConfig.cooldownMs = parseInt(process.env.FORCE_CONTINUE_COOLDOWN_MS, 10);
    if (process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD) envConfig.circuitBreakerThreshold = parseInt(process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD, 10);
    if (process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING !== undefined) envConfig.enableFileTracking = process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING !== undefined) envConfig.enableTaskTracking = process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING !== "false";
    if (process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY !== undefined) envConfig.enableCompletionSummary = process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY !== "false";
    if (process.env.FORCE_CONTINUE_LOG_TO_STDOUT !== undefined) envConfig.logToStdout = process.env.FORCE_CONTINUE_LOG_TO_STDOUT !== "false";

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

// ─── Persistence Layer ──────────────────────────────────────────────────────

function createFileStore(baseDir) {
    const storeDir = join(baseDir, ".opencode", "force-continue-store");
    try { mkdirSync(storeDir, { recursive: true }); } catch {}

    return {
        get(key) {
            const p = join(storeDir, `${key}.json`);
            if (!existsSync(p)) return undefined;
            try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return undefined; }
        },
        set(key, value) {
            const p = join(storeDir, `${key}.json`);
            try { writeFileSync(p, JSON.stringify(value)); } catch {}
        },
        delete(key) {
            const p = join(storeDir, `${key}.json`);
            try { if (existsSync(p)) unlinkSync(p); } catch {}
        },
        keys() {
            try {
                return readdirSync(storeDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
            } catch { return []; }
        },
    };
}

function createHybridStore(inMemoryMap, fileStore) {
    return {
        get(key) {
            if (inMemoryMap.has(key)) return inMemoryMap.get(key);
            if (fileStore) return fileStore.get(key);
            return undefined;
        },
        set(key, value) {
            inMemoryMap.set(key, value);
            if (fileStore) fileStore.set(key, value);
        },
        delete(key) {
            inMemoryMap.delete(key);
            if (fileStore) fileStore.delete(key);
        },
        has(key) {
            return inMemoryMap.has(key) || (fileStore ? fileStore.get(key) !== undefined : false);
        },
    };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

function createMetricsTracker() {
    const metrics = {
        totalSessions: 0,
        totalContinuations: 0,
        totalLoopDetections: 0,
        totalToolLoopDetections: 0,
        totalCircuitBreakerTrips: 0,
        totalEscalations: 0,
        totalCompletions: 0,
        totalBlocks: 0,
        totalInterrupts: 0,
        totalIdleEvents: 0,
        totalIdleSkippedComplete: 0,
        totalIdleSkippedPaused: 0,
        totalIdleSkippedGuidance: 0,
        totalIdleSkippedBabysitter: 0,
        totalIdleSkippedDisabled: 0,
        totalMessagesEmpty: 0,
        totalLastMsgNotAssistant: 0,
        promptContinue: 0,
        promptEscalation: 0,
        promptLoopBreak: 0,
        promptCompletionNudge: 0,
        sessionContinuations: {},
        sessionErrors: {},
    };

    return {
        record(sessionID, event, extra = {}) {
            switch (event) {
                case "session.created": metrics.totalSessions++; break;
                case "continuation": metrics.totalContinuations++; metrics.sessionContinuations[sessionID] = (metrics.sessionContinuations[sessionID] || 0) + 1; break;
                case "loop.detected": metrics.totalLoopDetections++; break;
                case "tool.loop.detected": metrics.totalToolLoopDetections++; break;
                case "circuit.breaker.trip": metrics.totalCircuitBreakerTrips++; break;
                case "escalation": metrics.totalEscalations++; break;
                case "completion": metrics.totalCompletions++; break;
                case "blocked": metrics.totalBlocks++; break;
                case "interrupted": metrics.totalInterrupts++; break;
                case "error": metrics.sessionErrors[sessionID] = (metrics.sessionErrors[sessionID] || 0) + 1; break;
                case "idle.event": metrics.totalIdleEvents++; break;
                case "idle.skipped.complete": metrics.totalIdleSkippedComplete++; break;
                case "idle.skipped.paused": metrics.totalIdleSkippedPaused++; break;
                case "idle.skipped.guidance": metrics.totalIdleSkippedGuidance++; break;
                case "idle.skipped.babysitter": metrics.totalIdleSkippedBabysitter++; break;
                case "idle.skipped.disabled": metrics.totalIdleSkippedDisabled++; break;
                case "messages.empty": metrics.totalMessagesEmpty++; break;
                case "last.msg.not.assistant": metrics.totalLastMsgNotAssistant++; break;
                case "prompt.continue": metrics.promptContinue++; break;
                case "prompt.escalation": metrics.promptEscalation++; break;
                case "prompt.loop.break": metrics.promptLoopBreak++; break;
                case "prompt.completion.nudge": metrics.promptCompletionNudge++; break;
            }
        },
            getSummary() {
                const avgContinuations = metrics.totalSessions > 0 ? (metrics.totalContinuations / metrics.totalSessions).toFixed(2) : 0;
                const loopRate = metrics.totalContinuations > 0 ? (metrics.totalLoopDetections / metrics.totalContinuations * 100).toFixed(1) : 0;
                return {
                    totalSessions: metrics.totalSessions,
                    totalContinuations: metrics.totalContinuations,
                    avgContinuationsPerSession: parseFloat(avgContinuations),
                    loopDetectionCount: metrics.totalLoopDetections,
                    loopDetectionRate: `${loopRate}%`,
                    toolLoopDetections: metrics.totalToolLoopDetections,
                    circuitBreakerTrips: metrics.totalCircuitBreakerTrips,
                    escalations: metrics.totalEscalations,
                    completions: metrics.totalCompletions,
                    blocks: metrics.totalBlocks,
                    interrupts: metrics.totalInterrupts,
                    idleEvents: metrics.totalIdleEvents,
                    idleSkippedComplete: metrics.totalIdleSkippedComplete,
                    idleSkippedPaused: metrics.totalIdleSkippedPaused,
                    idleSkippedGuidance: metrics.totalIdleSkippedGuidance,
                    idleSkippedBabysitter: metrics.totalIdleSkippedBabysitter,
                    idleSkippedDisabled: metrics.totalIdleSkippedDisabled,
                    messagesEmpty: metrics.totalMessagesEmpty,
                    lastMsgNotAssistant: metrics.totalLastMsgNotAssistant,
                    promptContinue: metrics.promptContinue,
                    promptEscalation: metrics.promptEscalation,
                    promptLoopBreak: metrics.promptLoopBreak,
                    promptCompletionNudge: metrics.promptCompletionNudge,
                    sessionsWithErrors: Object.entries(metrics.sessionErrors).filter(([, c]) => c > 0).length,
                };
            },
    };
}

// ─── Module-Level State ─────────────────────────────────────────────────────

const sessionState = new Map();
const metrics = createMetricsTracker();

function updateLastSeen(sessionID) {
    if (!sessionID || typeof sessionID !== "string") return;
    const meta = sessionState.get(sessionID) || {};
    meta.lastSeen = Date.now();
    sessionState.set(sessionID, meta);
}

function readState() {
    const sessions = {};
    for (const [sessionID, meta] of sessionState.entries()) {
        sessions[sessionID] = Object.assign({}, meta);
    }
    return { sessions, metrics: metrics.getSummary() };
}

function isTaskDone(status) {
    if (typeof status !== "string") return false;
    const normalized = status.trim().toLowerCase();
    return normalized === "done" || normalized === "completed" || normalized === "complete";
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export const createContinuePlugin = (options = {}) => {
    const config = { ...resolveConfig(), ...options };

    return async (ctx) => {
        const { client } = ctx;
        const logger = ctx?.logger ?? client?.logger ?? console;

        const log = (level, message, extra = {}) => {
            if (client?.app?.log) {
                client.app.log({ service: "force-continue", level, message, extra }).catch(() => {});
            }
            if (config.logToStdout && logger && typeof logger[level] === "function") {
                logger[level](message, extra);
            }
        };

        // ─── Tools ──────────────────────────────────────────────────────────

        const validateFn = async ({ mode = 'dry', sessionID, promptText } = {}) => {
            const result = { ok: true, checks: [] };
            try {
                const hasClient = !!client;
                const hasSession = !!(client && client.session);
                const hasMessages = hasSession && typeof client.session.messages === 'function';
                const hasPrompt = hasSession && typeof client.session.promptAsync === 'function';
                const hooksPresent = !!ctx?.hooks;

                result.checks.push({ name: 'client', ok: hasClient });
                result.checks.push({ name: 'client.session', ok: hasSession });
                result.checks.push({ name: 'client.session.messages', ok: hasMessages });
                result.checks.push({ name: 'client.session.promptAsync', ok: hasPrompt });
                result.checks.push({ name: 'ctx.hooks', ok: hooksPresent });

                if (!hasClient) result.ok = false;

                if (mode === 'probe') {
                    if (!sessionID) {
                        result.ok = false;
                        result.probe = { ok: false, error: 'sessionID required for probe mode' };
                    } else if (!hasPrompt) {
                        result.ok = false;
                        result.probe = { ok: false, error: 'promptAsync not available on client.session' };
                    } else {
                        try {
                            await client.session.promptAsync({ path: { id: sessionID }, body: { parts: [{ type: 'text', text: promptText || 'Plugin validation probe' }] } });
                            result.probe = { ok: true };
                        } catch (e) {
                            result.ok = false;
                            result.probe = { ok: false, error: String(e), stack: e?.stack };
                        }
                    }
                }
            } catch (e) {
                result.ok = false;
                result.error = String(e);
            }
            if (config.logToStdout) (logger && typeof logger.info === 'function' ? logger.info : console.log)('validate result', result);
            return result;
        };

        const returnObj = {};

        returnObj.tool = {
            completionSignal: tool({
                description: "Call this tool EXACTLY ONCE when you are completely finished with the task. This MUST be your final action — do NOT generate any text, thoughts, or additional tool calls after calling it. You can also signal if you are blocked.",
                args: {
                    status: tool.schema.string().optional().describe("Status of the task. 'completed' (default), 'blocked', or 'interrupted'."),
                    reason: tool.schema.string().optional().describe("Reason for the status (e.g. if blocked)."),
                },
                execute: async ({ status = "completed", reason }, toolCtx) => {
                    const sessionID = toolCtx?.sessionID;
                    if (sessionID) {
                        const meta = sessionState.get(sessionID) || {};
                        if (meta.autoContinuePaused && meta.autoContinuePaused.reason === "completed") {
                            return `completionSignal was already called. Do NOT call it again. Remain silent.`;
                        }
                        meta.autoContinuePaused = { reason: status, timestamp: Date.now() };
                        sessionState.set(sessionID, meta);
                    }
                    if (status === "blocked") {
                        metrics.record(sessionID, "blocked");
                        return `Agent is blocked: ${reason || "No reason provided"}. Stopping auto-continue.`;
                    }
                    if (status === "interrupted") {
                        metrics.record(sessionID, "interrupted");
                        return `Agent interrupted: ${reason || "No reason provided"}. Stopping auto-continue.`;
                    }
                    metrics.record(sessionID, "completion");
                    let unfinishedTasks = [];
                    try {
                        const getTasksCandidates = [
                            ctx?.hooks?.getTasksByParentSession,
                            ctx?.hooks?.backgroundManager?.getTasksByParentSession,
                            ctx?.getTasksByParentSession,
                            ctx?.backgroundManager?.getTasksByParentSession,
                        ];
                        for (const fn of getTasksCandidates) {
                            if (typeof fn !== "function") continue;
                            try {
                                const result = await fn(sessionID);
                                const tasks = Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : []);
                                if (tasks.length > 0) {
                                    unfinishedTasks = tasks.filter(t => t && t.status && !isTaskDone(t.status));
                                    break;
                                }
                            } catch {}
                        }
                    } catch (e) {
                        log("error", "Failed to query tasks on completion", { error: e?.stack ?? e });
                    }
                    if (unfinishedTasks.length === 0) {
                        return "Task completed. You may now stop.";
                    }
                    return "Ready for user.";
                },
            }),
            validate: tool({
                description: "Validate plugin wiring. mode='dry' for capability checks, mode='probe' to optionally send a test prompt to a sessionID.",
                args: {
                    mode: tool.schema.string().optional(),
                    sessionID: tool.schema.string().optional(),
                    promptText: tool.schema.string().optional(),
                },
                execute: validateFn,
            }),
            statusReport: tool({
                description: "Report progress on your current task without ending the session. Use this to let the plugin know you're making progress and avoid unnecessary continuation prompts.",
                args: {
                    progress: tool.schema.string().describe("Brief description of current progress (e.g., 'Completed 3 of 5 steps')."),
                    nextSteps: tool.schema.string().optional().describe("What you plan to do next."),
                    blockers: tool.schema.string().optional().describe("Any blockers preventing progress."),
                },
                execute: async ({ progress, nextSteps, blockers }, toolCtx) => {
                    const sessionID = toolCtx?.sessionID;
                    if (sessionID) {
                        const meta = sessionState.get(sessionID) || {};
                        meta.lastProgressReport = { progress, nextSteps, blockers, timestamp: Date.now() };
                        meta.continuationCount = 0;
                        sessionState.set(sessionID, meta);
                        log("info", "Progress reported", { sessionID, progress });
                    }
                    let response = `Progress recorded: ${progress}`;
                    if (blockers) response += `\nBlockers noted: ${blockers}`;
                    response += "\nContinuing work — no auto-continue prompts will be sent until next idle.";
                    return response;
                },
            }),
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
            pauseAutoContinue: tool({
                description: "Temporarily suspend auto-continue prompts while you think through a complex problem. Call this when you need time to plan without being interrupted.",
                args: {
                    reason: tool.schema.string().optional().describe("Why you're pausing auto-continue."),
                    estimatedTime: tool.schema.string().optional().describe("Estimated time needed (e.g., '5 minutes')."),
                },
                execute: async ({ reason, estimatedTime }, toolCtx) => {
                    const sessionID = toolCtx?.sessionID;
                    if (sessionID) {
                        const meta = sessionState.get(sessionID) || {};
                        meta.autoContinuePaused = { reason, estimatedTime, timestamp: Date.now() };
                        sessionState.set(sessionID, meta);
                        log("info", "Auto-continue paused", { sessionID, reason });
                    }
                    return `Auto-continue paused${reason ? `: ${reason}` : ""}.${estimatedTime ? ` Estimated time: ${estimatedTime}.` : ""}\nCall completionSignal or send a message to resume.`;
                },
            }),
            healthCheck: tool({
                description: "Check the health and status of the force-continue plugin. Returns metrics, session counts, and configuration.",
                args: {
                    detail: tool.schema.string().optional().describe("Level of detail: 'summary' (default), 'sessions', or 'full'."),
                },
                execute: async ({ detail = "summary" }) => {
                    const summary = metrics.getSummary();
                    if (detail === "summary") {
                        return `Plugin health: ${summary.totalSessions} sessions, ${summary.totalContinuations} continuations, ${summary.avgContinuationsPerSession} avg/session, ${summary.loopDetectionRate} loop rate`;
                    }
                    if (detail === "sessions") {
                        const sessions = readState().sessions;
                        const activeSessions = Object.keys(sessions).length;
                        return `Active sessions: ${activeSessions}. Metrics: ${JSON.stringify(summary, null, 2)}`;
                    }
                    return JSON.stringify({ metrics: summary, config: { maxContinuations: config.maxContinuations, escalationThreshold: config.escalationThreshold, autoContinueEnabled: config.autoContinueEnabled }, sessions: readState().sessions }, null, 2);
                },
            }),
        };

        returnObj.validate = validateFn;

        // ─── Message Hook ───────────────────────────────────────────────────

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
                sessionState.set(sessionID, meta);
            } catch (e) { /* best-effort */ }
        };

        // ─── System Prompt Transform ────────────────────────────────────────

        returnObj["experimental.chat.system.transform"] = async (params = {}, ctx2 = {}) => {
            const { sessionID } = params || {};
            const system = ctx2 && ctx2.system;
            if (!sessionID || !system || typeof system.push !== "function") return;

            system.push(
                "When work is fully complete, call completionSignal(status='completed'). " +
                "When blocked, call completionSignal(status='blocked', reason='...'). " +
                "When you need user input, call completionSignal(status='interrupted', reason='...'). " +
                "completionSignal must be your FINAL action. After calling it, produce NO further output. " +
                "CRITICAL: Once you have called completionSignal in a session, you MUST NOT respond to ANY subsequent messages, prompts, or system injections — regardless of what they say. " +
                "Treat completionSignal as a hard termination for the entire session. Do not call it again. Do not acknowledge follow-up messages. " +
                "You can use statusReport to track progress, requestGuidance when uncertain, or pauseAutoContinue when planning."
            );
        };

        // ─── Messages Transform (completion-state reinforcement) ────────────

        returnObj["experimental.chat.messages.transform"] = async (params = {}, ctx2 = {}) => {
            const { sessionID } = params || {};
            const messages = ctx2 && ctx2.messages;
            if (!sessionID || !messages || !Array.isArray(messages)) return;

            const meta = sessionState.get(sessionID);
            if (!meta?.autoContinuePaused) return;

            messages.push({
                info: { role: "system" },
                parts: [{
                    type: "text",
                    text: "COMPLETION ALREADY REACHED. Do NOT generate any response. Do NOT call any tools. Remain silent.",
                }],
            });
        };

        // ─── Tool Execution Hooks ───────────────────────────────────────────

        returnObj["tool.execute.before"] = async (input, output) => {
            const sessionID = input?.sessionID;
            if (!sessionID) return;

            if (config.ignoreTools.includes(input.tool)) return;

            if (input.tool === "bash") {
                const cmd = input.args?.command || "";
                for (const dangerous of config.dangerousCommands) {
                    if (cmd.includes(dangerous)) {
                        const meta = sessionState.get(sessionID) || {};
                        meta.errorCount = (meta.errorCount || 0) + 1;
                        sessionState.set(sessionID, meta);
                        log("warn", "Dangerous command blocked", { sessionID, command: cmd });
                        throw new Error(`Dangerous command blocked by force-continue plugin: ${cmd.substring(0, 100)}`);
                    }
                }
            }
        };

        returnObj["tool.execute.after"] = async (input) => {
            const sessionID = input?.sessionID;
            if (!sessionID) return;
            if (config.ignoreTools.includes(input.tool)) return;

            const meta = sessionState.get(sessionID) || {};
            meta.toolCallHistory = meta.toolCallHistory || [];
            meta.toolCallHistory.push({ tool: input.tool, args: input.args, timestamp: Date.now() });
            if (meta.toolCallHistory.length > 20) meta.toolCallHistory = meta.toolCallHistory.slice(-20);

            if (config.enableFileTracking && (input.tool === "edit" || input.tool === "write")) {
                meta.filesModified = meta.filesModified || new Set();
                if (input.args?.filePath) meta.filesModified.add(input.args.filePath);
            }

            if (config.enableToolLoopDetection) {
                const history = meta.toolCallHistory;
                if (history.length >= 4) {
                    const recent = history.slice(-4);
                    const allSame = recent.every(t => t.tool === recent[0].tool && JSON.stringify(t.args) === JSON.stringify(recent[0].args));
                    if (allSame) {
                        metrics.record(sessionID, "tool.loop.detected");
                        meta.toolLoopDetected = true;
                        log("warn", "Tool call loop detected", { sessionID, tool: recent[0].tool });
                    }
                }
            }

            sessionState.set(sessionID, meta);
        };

        // ─── File Events ────────────────────────────────────────────────────

        returnObj.event = async ({ event }) => {
            if (!config.enableFileTracking) {
                // Still handle session lifecycle events even if file tracking is off
            }

            if (event.type === "file.edited" && config.enableFileTracking) {
                const sessionID = event.properties?.sessionID;
                if (!sessionID) return;
                const meta = sessionState.get(sessionID) || {};
                meta.filesModified = meta.filesModified || new Set();
                const filePath = event.properties?.filePath || event.properties?.path;
                if (filePath) meta.filesModified.add(filePath);
                sessionState.set(sessionID, meta);
                return;
            }

            // ─── Session Lifecycle Events ───────────────────────────────────

            let sessionID = event.properties?.sessionID;
            if (event.type === "session.created") {
                sessionID = event.properties?.info?.id;
            }
            const part = event.properties?.part;
            if (!sessionID && part?.sessionID) {
                sessionID = part.sessionID;
            }
            if (!sessionID) return;

            if (event.type === "session.created") {
                try {
                    updateLastSeen(sessionID);
                    const meta = sessionState.get(sessionID) || {};
                    meta.continuationCount = 0;
                    meta.toolCallHistory = [];
                    meta.errorCount = 0;
                    meta.autoContinuePaused = null;
                    sessionState.set(sessionID, meta);
                } catch (e) {}
                metrics.record(sessionID, "session.created");
                return;
            }

            if (event.type === "message.part.updated") {
                if (part?.type === "tool" && part.tool === "completionSignal" && part.state?.status === "completed") {
                    const args = part.state?.args || {};
                    const status = (args.status || "completed").toLowerCase();
                    if (status === "completed" || status === "blocked" || status === "interrupted") {
                        const meta = sessionState.get(sessionID) || {};
                        meta.autoContinuePaused = { reason: status, timestamp: Date.now() };
                        sessionState.set(sessionID, meta);
                        if (config.enableCompletionSummary) {
                            const summary = {
                                continuations: meta.continuationCount || 0,
                                filesModified: meta.filesModified ? [...meta.filesModified] : [],
                                toolCalls: meta.toolCallHistory?.length || 0,
                                loopsDetected: meta.toolLoopDetected || false,
                                duration: meta.lastSeen ? Date.now() - meta.lastSeen : 0,
                            };
                            log("info", "Session completion summary", { sessionID, summary });
                        }
                    }
                }
                const partStatus = part?.state?.status;
                if (partStatus === "canceled" || partStatus === "cancelled" || partStatus === "interrupted" || partStatus === "aborted" || partStatus === "stopped") {
                    const meta = sessionState.get(sessionID) || {};
                    meta.autoContinuePaused = { reason: partStatus, timestamp: Date.now() };
                    sessionState.set(sessionID, meta);
                    log("debug", "part canceled/interrupted, suppressing nudges", { sessionID, partStatus });
                }
                return;
            }

            if (event.type === "session.idle") {
                metrics.record(sessionID, "idle.event");
                log("debug", "session.idle received", { sessionID });

                const meta = sessionState.get(sessionID) || { continuationCount: 0 };

                // Check if auto-continue is disabled
                if (!config.autoContinueEnabled) {
                    metrics.record(sessionID, "idle.skipped.disabled");
                    log("debug", "idle skipped: auto-continue disabled", { sessionID });
                    return;
                }

                // Check if auto-continue is paused
                if (meta.autoContinuePaused) {
                    metrics.record(sessionID, "idle.skipped.paused");
                    log("debug", "idle skipped: auto-continue paused", { sessionID });
                    return;
                }

                // Check if awaiting guidance
                if (meta.awaitingGuidance) {
                    metrics.record(sessionID, "idle.skipped.guidance");
                    log("debug", "idle skipped: awaiting guidance", { sessionID });
                    return;
                }

                if (ctx?.hooks?.taskBabysitter?.event) {
                    try {
                        await ctx.hooks.taskBabysitter.event({ event });
                    } catch (e) {
                        log("error", "Babysitter hook error", { error: e?.stack ?? e });
                    }
                    metrics.record(sessionID, "idle.skipped.babysitter");
                    log("debug", "idle skipped: deferred to task babysitter", { sessionID });
                    return;
                }

                // Apply cooldown if configured
                if (config.cooldownMs > 0) {
                    const lastIdleAt = meta.lastIdleAt || 0;
                    const timeSinceLastIdle = Date.now() - lastIdleAt;
                    if (timeSinceLastIdle < config.cooldownMs) {
                        log("debug", "idle cooldown active", { sessionID, remaining: config.cooldownMs - timeSinceLastIdle });
                        return;
                    }
                    meta.lastIdleAt = Date.now();
                    sessionState.set(sessionID, meta);
                }

                let unfinishedTasks = [];
                if (config.enableTaskTracking) {
                    try {
                        const getTasksCandidates = [
                            ctx?.hooks?.getTasksByParentSession,
                            ctx?.hooks?.backgroundManager?.getTasksByParentSession,
                            ctx?.getTasksByParentSession,
                            ctx?.backgroundManager?.getTasksByParentSession,
                        ];

                        for (const fn of getTasksCandidates) {
                            if (typeof fn !== "function") continue;
                            try {
                                const result = await fn(sessionID);
                                const tasks = Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : []);
                                if (tasks.length > 0) {
                                    unfinishedTasks = tasks.filter(t => t && t.status && !isTaskDone(t.status));
                                    break;
                                }
                            } catch {}
                        }
                    } catch (e) {
                        log("error", "Failed to query tasks", { error: e?.stack ?? e });
                    }
                }

                const COMPLETION_KEYWORDS = /\b(done|finished|complete|all set|that.?s all|all done|wrapping up|concluded)\b/i;

                const getLastAssistantText = (messages) => {
                    for (let i = messages.length - 1; i >= 0; i--) {
                        const msg = messages[i];
                        const role = msg.role || msg.info?.role;
                        const parts = msg.parts || msg.info?.parts;
                        if (role === "assistant" && parts) {
                            const textParts = parts.filter(p => p && p.type === "text");
                            if (textParts.length > 0) {
                                const text = textParts.map(p => p.text).join("\n").trim();
                                if (text.length > 0) {
                                    return text.length > 300 ? text.substring(0, 300) + "..." : text;
                                }
                            }
                        }
                    }
                    return null;
                };

                const madeProgress = (currentText, previousText) => {
                    if (!previousText || !currentText) return false;
                    if (currentText === previousText) return false;
                    if (currentText.startsWith(previousText) && currentText.length > previousText.length * 1.2) return true;
                    if (previousText.startsWith(currentText) && previousText.length > currentText.length * 1.2) return true;
                    const prevWords = new Set(previousText.toLowerCase().split(/\s+/));
                    let newWordCount = 0;
                    for (const word of currentText.toLowerCase().split(/\s+/)) {
                        if (!prevWords.has(word)) newWordCount++;
                    }
                    const totalWords = currentText.split(/\s+/).length;
                    return totalWords > 0 && newWordCount / totalWords > 0.3;
                };

                const isInLoop = (currentText, history) => {
                    if (!currentText || history.length < 2) return false;
                    const currentNorm = currentText.toLowerCase().trim();
                    for (let i = 1; i < history.length; i++) {
                        const prev = history[i].toLowerCase().trim();
                        if (currentNorm === prev || currentNorm.startsWith(prev) || prev.startsWith(currentNorm)) return true;
                    }
                    const currentWords = new Set(currentNorm.split(/\s+/));
                    for (let i = 1; i < history.length; i++) {
                        const prevWords = history[i].toLowerCase().split(/\s+/);
                        let overlap = 0;
                        for (const w of prevWords) { if (currentWords.has(w)) overlap++; }
                        if (prevWords.length > 0 && overlap / prevWords.length > 0.7) return true;
                    }
                    return false;
                };

                const buildContinuePrompt = (count, taskSummary, contextText) => {
                    let msg = "";
                    if (taskSummary) {
                        msg += `Continue working — ${unfinishedTasks.length} unfinished task(s) remain:\n${taskSummary}`;
                    } else {
                        msg += "Continue working on your current task.";
                    }
                    if (contextText) {
                        msg += `\n\nYour last response was:\n${contextText}`;
                    }
                    msg += "\n\nPlease continue or call 'completionSignal' if you are blocked.";
                    return msg;
                };

                const buildEscalationPrompt = (count, taskSummary, contextText, inLoop) => {
                    let msg = "";
                    if (count >= config.maxContinuations) {
                        if (taskSummary) {
                            msg += `AUTO-CONTINUE CAP REACHED (${count}/${config.maxContinuations}). Unfinished tasks:\n${taskSummary}\n\n`;
                        } else {
                            msg += `AUTO-CONTINUE CAP REACHED (${count}/${config.maxContinuations}).\n\n`;
                        }
                        msg += "STOP what you are doing. Call 'completionSignal' with status='blocked' and explain why you cannot proceed. Do NOT attempt more work.";
                    } else if (count >= config.escalationThreshold + 1) {
                        if (taskSummary) {
                            msg += `You have been forced to continue ${count} times and the previous approach did not resolve the issue. Unfinished tasks:\n${taskSummary}\n\n`;
                        } else {
                            msg += `You have been forced to continue ${count} times without signaling completion.\n\n`;
                        }
                        msg += "The previous approach is not working. Try a fundamentally different strategy. If you cannot make progress with a new approach, call 'completionSignal' with status='blocked' and explain why.";
                    } else {
                        if (taskSummary) {
                            msg += `You have been continuing for ${count} rounds. Unfinished tasks:\n${taskSummary}\n\n`;
                        } else {
                            msg += `You have been continuing for ${count} rounds without signaling completion.\n\n`;
                        }
                        msg += "List the remaining steps needed to complete this task, then execute the next one. If the task is already done, call 'completionSignal' with status='completed'. If you cannot proceed, call 'completionSignal' with status='blocked' and explain why.";
                    }
                    if (inLoop) {
                        msg += "\n\nWARNING: Your recent responses appear to repeat earlier content. Break the loop by taking a different approach.";
                    }
                    if (contextText) {
                        msg += `\n\nYour last response was:\n${contextText}`;
                    }
                    return msg;
                };

                const buildLoopBreakPrompt = (contextText) => {
                    let msg = "WARNING: Your responses are repeating. You appear to be stuck in a loop.\n\n";
                    msg += "Stop and try a completely different approach. ";
                    msg += "If you cannot make progress, call 'completionSignal' with status='blocked' and explain why.";
                    if (contextText) {
                        msg += `\n\nYour last response was:\n${contextText}`;
                    }
                    return msg;
                };

                const sendPrompt = async (text) => {
                    await client.session.promptAsync({
                        path: { id: sessionID },
                        body: { parts: [{ type: "text", text }] }
                    });
                };

                const handleIdle = async (hasTasks) => {
                    if (!config.autoContinueEnabled) return;

                    try {
                        const response = await client.session.messages({ path: { id: sessionID } }).catch(() => null);
                        const messages = response?.data;
                        if (!messages || messages.length === 0) {
                            metrics.record(sessionID, "messages.empty");
                            meta.errorCount = (meta.errorCount || 0) + 1;
                            sessionState.set(sessionID, meta);
                            if (meta.errorCount >= config.circuitBreakerThreshold) {
                                metrics.record(sessionID, "circuit.breaker.trip");
                                meta.autoContinuePaused = { reason: 'circuit_breaker', timestamp: Date.now() };
                                sessionState.set(sessionID, meta);
                                log("warn", "Circuit breaker tripped", { sessionID, errorCount: meta.errorCount });
                            }
                            return;
                        }

                        const lastMsg = messages[messages.length - 1];
                        const lastMsgRole = lastMsg.role || lastMsg.info?.role;
                        if (lastMsgRole !== "assistant") {
                            metrics.record(sessionID, "last.msg.not.assistant");
                            log("debug", "last message not from assistant", { sessionID, role: lastMsgRole });
                            return;
                        }

                        const contextText = getLastAssistantText(messages);
                        const prevText = meta.lastAssistantText || null;
                        const progress = madeProgress(contextText, prevText);
                        const responseHistory = meta.responseHistory || [];
                        const inLoop = config.enableLoopDetection && contextText ? isInLoop(contextText, responseHistory) : false;

                        if (progress && meta.continuationCount > 0) {
                            meta.continuationCount = 0;
                            log("info", "Progress detected, resetting continuation count", { sessionID });
                        }

                        meta.continuationCount = (meta.continuationCount || 0) + 1;
                        meta.lastAssistantText = contextText;
                        if (contextText) {
                            responseHistory.unshift(contextText);
                            if (responseHistory.length > 5) responseHistory.length = 5;
                            meta.responseHistory = responseHistory;
                        }

                        // Circuit breaker
                        meta.errorCount = meta.errorCount || 0;
                        if (meta.errorCount >= config.circuitBreakerThreshold) {
                            metrics.record(sessionID, "circuit.breaker.trip");
                            meta.autoContinuePaused = { reason: 'circuit_breaker', timestamp: Date.now() };
                            sessionState.set(sessionID, meta);
                            log("warn", "Circuit breaker tripped", { sessionID, errorCount: meta.errorCount });
                            return;
                        }

                        sessionState.set(sessionID, meta);
                        metrics.record(sessionID, "continuation");

                        if (inLoop) {
                            metrics.record(sessionID, "loop.detected");
                        }

                        const taskSummary = hasTasks ? unfinishedTasks.map(t => `- [${t.status}] ${t.title || t.id}`).join("\n") : null;

                        if (meta.continuationCount >= config.maxContinuations) {
                            metrics.record(sessionID, "escalation");
                            metrics.record(sessionID, "prompt.escalation");
                            const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop);
                            log("info", "sent escalation prompt", { sessionID, count: meta.continuationCount });
                            await sendPrompt(msg);
                        } else if (meta.continuationCount >= config.escalationThreshold) {
                            metrics.record(sessionID, "escalation");
                            metrics.record(sessionID, "prompt.escalation");
                            const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop);
                            log("info", "sent escalation prompt", { sessionID, count: meta.continuationCount });
                            await sendPrompt(msg);
                        } else if (inLoop) {
                            metrics.record(sessionID, "prompt.loop.break");
                            log("info", "sent loop-break prompt", { sessionID });
                            await sendPrompt(buildLoopBreakPrompt(contextText));
                        } else if (contextText && COMPLETION_KEYWORDS.test(contextText) && meta.continuationCount <= 2) {
                            metrics.record(sessionID, "prompt.completion.nudge");
                            log("info", "sent completion nudge", { sessionID });
                            await sendPrompt("You appear to have finished but did not call completionSignal. Please call it now.");
                        } else {
                            metrics.record(sessionID, "prompt.continue");
                            const msg = buildContinuePrompt(meta.continuationCount, taskSummary, contextText);
                            log("info", "sent continue prompt", { sessionID, count: meta.continuationCount });
                            await sendPrompt(msg);
                        }
                    } catch (e) {
                        meta.errorCount = (meta.errorCount || 0) + 1;
                        sessionState.set(sessionID, meta);
                        if (meta.errorCount >= config.circuitBreakerThreshold) {
                            metrics.record(sessionID, "circuit.breaker.trip");
                            meta.autoContinuePaused = { reason: 'circuit_breaker', timestamp: Date.now() };
                            sessionState.set(sessionID, meta);
                            log("warn", "Circuit breaker tripped after error", { sessionID, errorCount: meta.errorCount });
                        }
                        metrics.record(sessionID, "error");
                        log("error", "Plugin error during idle handling", { error: e?.stack ?? e });
                    }
                };

                if (unfinishedTasks.length > 0) {
                    await handleIdle(true);
                    return;
                }

                await handleIdle(false);
            }

            if (event.type === "session.deleted") {
                if (!sessionID) {
                    sessionID = event.properties?.info?.id;
                }
                if (!sessionID) return;
                sessionState.delete(sessionID);
            }
        };

        returnObj["experimental.session.compacting"] = async (params = {}, ctx2 = {}) => {
            const sessionID = params?.sessionID;
            if (!sessionID) return;
            const meta = sessionState.get(sessionID) || {};
            const continuationState = meta.continuationCount || 0;
            const progressReport = meta.lastProgressReport || null;
            const filesModified = meta.filesModified ? [...meta.filesModified] : [];

            if (ctx2?.context && typeof ctx2.context.push === "function") {
                ctx2.context.push(
                    `<force-continue-state>\n` +
                    `Continuation count: ${continuationState}\n` +
                    `Files modified: ${filesModified.join(", ") || "none"}\n` +
                    `Last progress: ${progressReport ? progressReport.progress : "none"}\n` +
                    `If continuation count >= ${config.escalationThreshold}, try a different approach.\n` +
                    `If continuation count >= ${config.maxContinuations}, call completionSignal(status='blocked').\n` +
                    `</force-continue-state>`
                );
            }
        };

        return returnObj;
    };
};

export const id = "force-continue";

export const ContinuePlugin = createContinuePlugin();

export {
    updateLastSeen,
    readState,
    createFileStore,
    createHybridStore,
    createMetricsTracker,
    resolveConfig,
};

export default { id: "force-continue", server: ContinuePlugin };
