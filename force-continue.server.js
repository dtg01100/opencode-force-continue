import { tool } from "@opencode-ai/plugin";

const sessionState = new Map();
let nextSessionEnabled = false;

function isEnabled(sessionID) {
    if (!sessionID || typeof sessionID !== "string") return false;
    return true;
}

function isNextSessionEnabled() {
    return nextSessionEnabled === true;
}

function setNextSessionEnabled(enabled = true) {
    nextSessionEnabled = !!enabled;
}

function consumeNextSessionFlag() {
    if (!nextSessionEnabled) return false;
    nextSessionEnabled = false;
    return true;
}

function updateLastSeen(sessionID) {
    if (!sessionID || typeof sessionID !== "string") return;
    const meta = sessionState.get(sessionID) || {};
    meta.enabled = true;
    meta.lastSeen = Date.now();
    sessionState.set(sessionID, meta);
}

function readState() {
    const sessions = {};
    for (const [sessionID, meta] of sessionState.entries()) {
        sessions[sessionID] = Object.assign({}, meta);
    }
    return {
        sessions,
        nextSession: nextSessionEnabled,
    };
}

function isTaskDone(status) {
    if (typeof status !== "string") return false;
    const normalized = status.trim().toLowerCase();
    return normalized === "done" || normalized === "completed" || normalized === "complete";
}

export const createContinuePlugin = (sessionCompletionState = new Map()) => {
    return async (ctx) => {
        const { client } = ctx;
        const logger = ctx?.logger ?? client?.logger ?? console;

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
                            await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: promptText || 'Plugin validation probe' }] });
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
            (logger && typeof logger.info === 'function' ? logger.info : console.log)('validate result', result);
            return result;
        };

        const returnObj = {};

        returnObj.tool = {
            completionSignal: tool({
                description: "Call this tool when you are finished with the task or ready for user input. You can also signal if you are blocked.",
                args: {
                    status: { type: "string", optional: true, description: "Status of the task. 'completed' (default), 'blocked', or 'interrupted'." },
                    reason: { type: "string", optional: true, description: "Reason for the status (e.g. if blocked)." },
                },
                execute: async ({ status = "completed", reason }) => {
                    if (status === "blocked") return `Agent is blocked: ${reason || "No reason provided"}. Stopping auto-continue.`;
                    if (status === "interrupted") return `Agent interrupted: ${reason || "No reason provided"}. Stopping auto-continue.`;
                    return "Ready for user.";
                },
            }),
            validate: tool({
                description: "Validate plugin wiring. mode='dry' for capability checks, mode='probe' to optionally send a test prompt to a sessionID.",
                args: { mode: { type: 'string', optional: true }, sessionID: { type: 'string', optional: true }, promptText: { type: 'string', optional: true } },
                execute: validateFn,
            }),
        };

        returnObj.validate = validateFn;

        returnObj["chat.message"] = async ({ sessionID }) => {
            if (!isEnabled(sessionID)) return;
            try {
                const meta = sessionState.get(sessionID) || {};
                meta.enabled = true;
                meta.lastSeen = Date.now();
                // Reset loop counter on new user message
                meta.continuationCount = 0;
                sessionState.set(sessionID, meta);
            } catch (e) { /* best-effort */ }
            sessionCompletionState.set(sessionID, false);
        };

        returnObj["experimental.chat.system.transform"] = async (params = {}, ctx2 = {}) => {
            const { sessionID } = params || {};
            const system = ctx2 && ctx2.system;
            if (!sessionID || !system || typeof system.push !== "function") return;

            system.push(
                "IMPORTANT: You must call the 'completionSignal' tool when you are finished. " +
                "Do not stop or ask for user input until you have called this tool. " +
                "If you are stuck, blocked, or need user input, call 'completionSignal' with status='blocked' or status='interrupted' and provide a reason. " +
                "If you stop without calling it, you will be forced to continue."
            );
        };

        returnObj.event = async ({ event }) => {
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
                try { updateLastSeen(sessionID); } catch (e) {}
                sessionCompletionState.set(sessionID, false);
                return;
            }

            if (!isEnabled(sessionID)) return;

            if (event.type === "message.part.updated") {
                if (part?.type === "tool" && part.tool === "completionSignal" && part.state?.status === "completed") {
                    const args = part.state?.args || {};
                    const status = (args.status || "completed").toLowerCase();
                    if (status === "completed" || status === "blocked" || status === "interrupted") {
                        sessionCompletionState.set(sessionID, true);
                    }
                }
            }

            if (event.type === "session.idle") {
                const isComplete = sessionCompletionState.get(sessionID);
                const meta = sessionState.get(sessionID) || { continuationCount: 0 };

                if (ctx?.hooks?.taskBabysitter?.event) {
                    try {
                        await ctx.hooks.taskBabysitter.event({ event });
                    } catch (e) {
                        (logger && typeof logger.error === "function"
                            ? logger.error
                            : console.error)("Babysitter hook error:", e?.stack ?? e);
                    }
                    return;
                }

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
                    (logger && typeof logger.error === "function"
                        ? logger.error
                        : console.error)("Failed to query tasks:", e?.stack ?? e);
                }

                if (unfinishedTasks.length > 0) {
                    try {
                        const taskSummary = unfinishedTasks.map(t => `- [${t.status}] ${t.title || t.id}`).join("\n");
                        const msg = `Continue — ${unfinishedTasks.length} unfinished task(s) remain:\n${taskSummary}\n\nPlease continue working or call 'completionSignal' if you are blocked.`;
                        await client.session.promptAsync({
                            sessionID,
                            parts: [{ type: "text", text: msg }]
                        });
                    } catch (e) {
                        (logger && typeof logger.error === "function"
                            ? logger.error
                            : console.error)("Plugin error:", e?.stack ?? e);
                    }
                    return;
                }

                if (!isComplete) {
                    try {
                        const response = await client.session.messages({ sessionID });
                        const messages = response?.data;
                        if (messages && messages.length > 0) {
                            const lastMsg = messages[messages.length - 1];
                            if (lastMsg.role === "assistant") {
                                meta.continuationCount = (meta.continuationCount || 0) + 1;
                                sessionState.set(sessionID, meta);

                                if (meta.continuationCount >= 3) {
                                    await client.session.promptAsync({
                                        sessionID,
                                        parts: [{ type: "text", text: "You have been forced to continue 3 times without signaling completion. Are you stuck or in a loop? If so, please explain or call 'completionSignal' with status='blocked'." }]
                                    });
                                } else {
                                    await client.session.promptAsync({
                                        sessionID,
                                        parts: [{ type: "text", text: "Continue" }]
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        (logger && typeof logger.error === "function"
                            ? logger.error
                            : console.error)("Plugin error:", e?.stack ?? e);
                    }
                }
            }

            if (event.type === "session.deleted") {
                sessionCompletionState.delete(sessionID);
                sessionState.delete(sessionID);
            }
        };

        return returnObj;
    };
};

export const ContinuePlugin = createContinuePlugin();

export {
    isEnabled,
    consumeNextSessionFlag,
    updateLastSeen,
    readState,
    isNextSessionEnabled,
    setNextSessionEnabled,
};

export default { server: ContinuePlugin };
