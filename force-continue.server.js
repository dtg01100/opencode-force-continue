import { tool } from "@opencode-ai/plugin";

const sessionState = new Map();

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
    return {
        sessions,
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
                description: "Call this tool EXACTLY ONCE when you are completely finished with the task. This MUST be your final action — do NOT generate any text, thoughts, or additional tool calls after calling it. You can also signal if you are blocked.",
                args: {
                    status: tool.schema.string().optional().describe("Status of the task. 'completed' (default), 'blocked', or 'interrupted'."),
                    reason: tool.schema.string().optional().describe("Reason for the status (e.g. if blocked)."),
                },
                execute: async ({ status = "completed", reason }, toolCtx) => {
                    const sessionID = toolCtx?.sessionID;
                    if (status === "blocked") {
                        if (sessionID) sessionCompletionState.set(sessionID, true);
                        return `Agent is blocked: ${reason || "No reason provided"}. Stopping auto-continue.`;
                    }
                    if (status === "interrupted") {
                        if (sessionID) sessionCompletionState.set(sessionID, true);
                        return `Agent interrupted: ${reason || "No reason provided"}. Stopping auto-continue.`;
                    }
                    if (sessionID) sessionCompletionState.set(sessionID, true);
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
        };

        returnObj.validate = validateFn;

        returnObj["chat.message"] = async ({ sessionID }) => {
            if (!sessionID || typeof sessionID !== "string") return;
            try {
                const meta = sessionState.get(sessionID) || {};
                meta.lastSeen = Date.now();
                meta.continuationCount = 0;
                meta.lastAssistantText = null;
                meta.responseHistory = [];
                sessionState.set(sessionID, meta);
            } catch (e) { /* best-effort */ }
            sessionCompletionState.set(sessionID, false);
        };

        returnObj["experimental.chat.system.transform"] = async (params = {}, ctx2 = {}) => {
            const { sessionID } = params || {};
            const system = ctx2 && ctx2.system;
            if (!sessionID || !system || typeof system.push !== "function") return;

            system.push(
                "When work is fully complete, call completionSignal(status='completed'). " +
                "When blocked, call completionSignal(status='blocked', reason='...'). " +
                "When you need user input, call completionSignal(status='interrupted', reason='...'). " +
                "completionSignal must be your FINAL action. After calling it, produce NO further output."
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
                try {
                    updateLastSeen(sessionID);
                    const meta = sessionState.get(sessionID) || {};
                    meta.continuationCount = 0;
                    sessionState.set(sessionID, meta);
                } catch (e) {}
                sessionCompletionState.set(sessionID, false);
                return;
            }

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

                const MAX_CONTINUATIONS = 5;
                const COMPLETION_KEYWORDS = /\b(done|finished|complete|all set|that.?s all|all done|wrapping up|concluded)\b/i;

                const getLastAssistantText = (messages) => {
                    for (let i = messages.length - 1; i >= 0; i--) {
                        const msg = messages[i];
                        if (msg.role === "assistant" && msg.parts) {
                            const textParts = msg.parts.filter(p => p && p.type === "text");
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

                const getRecentAssistantTexts = (messages, limit = 5) => {
                    const texts = [];
                    for (let i = messages.length - 1; i >= 0 && texts.length < limit; i--) {
                        const msg = messages[i];
                        if (msg.role === "assistant" && msg.parts) {
                            const textParts = msg.parts.filter(p => p && p.type === "text");
                            if (textParts.length > 0) {
                                const text = textParts.map(p => p.text).join("\n").trim();
                                if (text.length > 0) {
                                    texts.push(text);
                                }
                            }
                        }
                    }
                    return texts;
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
                    if (count >= MAX_CONTINUATIONS) {
                        if (taskSummary) {
                            msg += `AUTO-CONTINUE CAP REACHED (${count}/${MAX_CONTINUATIONS}). Unfinished tasks:\n${taskSummary}\n\n`;
                        } else {
                            msg += `AUTO-CONTINUE CAP REACHED (${count}/${MAX_CONTINUATIONS}).\n\n`;
                        }
                        msg += "STOP what you are doing. Call 'completionSignal' with status='blocked' and explain why you cannot proceed. Do NOT attempt more work.";
                    } else if (count >= 4) {
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
                        sessionID,
                        parts: [{ type: "text", text }]
                    });
                };

                if (unfinishedTasks.length > 0) {
                    try {
                        const response = await client.session.messages({ sessionID }).catch(() => null);
                        const messages = response?.data;
                        const contextText = messages ? getLastAssistantText(messages) : null;
                        const prevText = meta.lastAssistantText || null;
                        const progress = madeProgress(contextText, prevText);
                        const responseHistory = meta.responseHistory || [];
                        const inLoop = contextText ? isInLoop(contextText, responseHistory) : false;

                        if (progress && meta.continuationCount > 0) {
                            meta.continuationCount = 0;
                            (logger && typeof logger.info === "function" ? logger.info : console.log)("Progress detected, resetting continuation count");
                        }

                        meta.continuationCount = (meta.continuationCount || 0) + 1;
                        meta.lastAssistantText = contextText;
                        if (contextText) {
                            responseHistory.unshift(contextText);
                            if (responseHistory.length > 5) responseHistory.length = 5;
                            meta.responseHistory = responseHistory;
                        }
                        sessionState.set(sessionID, meta);

                        const taskSummary = unfinishedTasks.map(t => `- [${t.status}] ${t.title || t.id}`).join("\n");

                        if (meta.continuationCount >= MAX_CONTINUATIONS) {
                            const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop);
                            await sendPrompt(msg);
                        } else if (meta.continuationCount >= 3) {
                            const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop);
                            await sendPrompt(msg);
                        } else if (inLoop) {
                            await sendPrompt(buildLoopBreakPrompt(contextText));
                        } else {
                            const msg = buildContinuePrompt(meta.continuationCount, taskSummary, contextText);
                            await sendPrompt(msg);
                        }
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
                                const contextText = getLastAssistantText(messages);
                                const prevText = meta.lastAssistantText || null;
                                const progress = madeProgress(contextText, prevText);
                                const responseHistory = meta.responseHistory || [];
                                const inLoop = contextText ? isInLoop(contextText, responseHistory) : false;

                                if (progress && meta.continuationCount > 0) {
                                    meta.continuationCount = 0;
                                    (logger && typeof logger.info === "function" ? logger.info : console.log)("Progress detected, resetting continuation count");
                                }

                                meta.continuationCount = (meta.continuationCount || 0) + 1;
                                meta.lastAssistantText = contextText;
                                if (contextText) {
                                    responseHistory.unshift(contextText);
                                    if (responseHistory.length > 5) responseHistory.length = 5;
                                    meta.responseHistory = responseHistory;
                                }
                                sessionState.set(sessionID, meta);

                                if (contextText && COMPLETION_KEYWORDS.test(contextText) && meta.continuationCount <= 2) {
                                    await sendPrompt("You appear to have finished but did not call completionSignal. Please call it now.");
                                    return;
                                }

                                if (meta.continuationCount >= MAX_CONTINUATIONS) {
                                    const msg = buildEscalationPrompt(meta.continuationCount, null, contextText, inLoop);
                                    await sendPrompt(msg);
                                } else if (meta.continuationCount >= 3) {
                                    const msg = buildEscalationPrompt(meta.continuationCount, null, contextText, inLoop);
                                    await sendPrompt(msg);
                                } else if (inLoop) {
                                    await sendPrompt(buildLoopBreakPrompt(contextText));
                                } else {
                                    const msg = buildContinuePrompt(meta.continuationCount, null, contextText);
                                    await sendPrompt(msg);
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
                if (!sessionID) {
                    sessionID = event.properties?.info?.id;
                }
                if (!sessionID) return;
                sessionCompletionState.delete(sessionID);
                sessionState.delete(sessionID);
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
};

export default { id: "force-continue", server: ContinuePlugin };
