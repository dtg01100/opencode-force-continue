import { sessionState, updateLastSeen, isTaskDone, isSubagentSession } from "../state.js";
import { metrics } from "../metrics.js";
import { getAutopilotEnabled, getAutopilotMaxAttempts } from "../autopilot.js";

const COMPLETION_KEYWORDS = /\b(done|finished|complete|all set|that.?s all|all done|wrapping up|concluded)\b/i;

function getLastAssistantText(messages) {
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
}

function madeProgress(currentText, previousText) {
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
}

function isInLoop(currentText, history) {
    if (!currentText || history.length < 1) return false;
    const currentNorm = currentText.toLowerCase().trim();
    for (let i = 0; i < history.length; i++) {
        const prev = history[i].toLowerCase().trim();
        if (currentNorm === prev || currentNorm.startsWith(prev) || prev.startsWith(currentNorm)) return true;
    }
    const currentWords = new Set(currentNorm.split(/\s+/));
    for (let i = 0; i < history.length; i++) {
        const prevWords = history[i].toLowerCase().split(/\s+/);
        let overlap = 0;
        for (const w of prevWords) { if (currentWords.has(w)) overlap++; }
        if (prevWords.length > 0 && overlap / prevWords.length > 0.7) return true;
    }
    return false;
}

function buildContinuePrompt(count, taskSummary, contextText) {
    let msg = "";
    if (taskSummary) {
        msg += `Continue working — ${taskSummary.length} unfinished task(s) remain:\n${taskSummary}`;
    } else {
        msg += "Continue working on your current task.";
    }
    if (contextText) {
        msg += `\n\nYour last response was:\n${contextText}`;
    }
    msg += "\n\nPlease continue or call 'completionSignal' if you are blocked.";
    return msg;
}

function buildEscalationPrompt(count, taskSummary, contextText, inLoop, config) {
    let msg = "";
    if (count >= config.maxContinuations) {
        if (taskSummary) {
            msg += `AUTO-CONTINUE CAP REACHED (${count}/${config.maxContinuations}). Unfinished tasks:\n${taskSummary}\n\n`;
        } else {
            msg += `AUTO-CONTINUE CAP REACHED (${count}/${config.maxContinuations}).\n\n`;
        }
        msg += "STOP what you are doing. Call 'completionSignal' with status='blocked' and explain why you cannot proceed. Do NOT attempt more work.";
    } else if (count >= config.escalationThreshold) {
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
}

function buildLoopBreakPrompt(contextText) {
    let msg = "WARNING: Your responses are repeating. You appear to be stuck in a loop.\n\n";
    msg += "Stop and try a completely different approach. ";
    msg += "If you cannot make progress, call 'completionSignal' with status='blocked' and explain why.";
    if (contextText) {
        msg += `\n\nYour last response was:\n${contextText}`;
    }
    return msg;
}

export function createSessionEventsHandler(ctx, config, client, metricsTracker, log) {
    const handleIdle = async (sessionID, meta, hasTasks, unfinishedTasks) => {
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
            const inLoop = (config.enableLoopDetection && contextText ? isInLoop(contextText, responseHistory) : false) || meta.toolLoopDetected;

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

            sessionState.set(sessionID, meta);
            metrics.record(sessionID, "continuation");

            if (inLoop) {
                metrics.record(sessionID, "loop.detected");
            }

            const taskSummary = hasTasks ? unfinishedTasks.map(t => `- [${t.status}] ${t.title || t.id}`).join("\n") : null;

            if (meta.continuationCount >= config.maxContinuations) {
                metrics.record(sessionID, "escalation");
                metrics.record(sessionID, "prompt.escalation");
                const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop, config);
                log("info", "sent escalation prompt", { sessionID, count: meta.continuationCount });
                await sendPrompt(sessionID, msg);
            } else if (meta.continuationCount >= config.escalationThreshold) {
                metrics.record(sessionID, "escalation");
                metrics.record(sessionID, "prompt.escalation");
                const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop, config);
                log("info", "sent escalation prompt", { sessionID, count: meta.continuationCount });
                await sendPrompt(sessionID, msg);
            } else if (inLoop) {
                metrics.record(sessionID, "prompt.loop.break");
                log("info", "sent loop-break prompt", { sessionID });
                await sendPrompt(sessionID, buildLoopBreakPrompt(contextText));
            } else if (contextText && COMPLETION_KEYWORDS.test(contextText) && meta.continuationCount <= 2) {
                metrics.record(sessionID, "prompt.completion.nudge");
                log("info", "sent completion nudge", { sessionID });
                await sendPrompt(sessionID, "You appear to have finished but did not call completionSignal. Please call it now.");
            } else {
                metrics.record(sessionID, "prompt.continue");
                const msg = buildContinuePrompt(meta.continuationCount, taskSummary, contextText);
                log("info", "sent continue prompt", { sessionID, count: meta.continuationCount });
                await sendPrompt(sessionID, msg);
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

    const sendPrompt = async (sessionID, text) => {
        if (config.nudgeDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, config.nudgeDelayMs));
            const meta = sessionState.get(sessionID);
            if (meta?.autoContinuePaused) {
                log("debug", "nudge suppressed after delay", { sessionID, reason: meta.autoContinuePaused.reason });
                return;
            }
        }
        await client.session.promptAsync({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text }] }
        });
    };

    return async ({ event }) => {
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

            if (!config.autoContinueEnabled) {
                metrics.record(sessionID, "idle.skipped.disabled");
                log("debug", "idle skipped: auto-continue disabled", { sessionID });
                return;
            }

            if (meta.autoContinuePaused) {
                metrics.record(sessionID, "idle.skipped.paused");
                log("debug", "idle skipped: auto-continue paused", { sessionID });
                return;
            }

            if (meta.awaitingGuidance) {
                metrics.record(sessionID, "idle.skipped.guidance");
                log("debug", "idle skipped: awaiting guidance", { sessionID });
                return;
            }

            if (config.skipNudgeInSubagents && isSubagentSession(sessionID)) {
                metrics.record(sessionID, "idle.skipped.subagent");
                log("debug", "idle skipped: subagent session", { sessionID });
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

            if (unfinishedTasks.length > 0) {
                await handleIdle(sessionID, meta, true, unfinishedTasks);
                return;
            }

            await handleIdle(sessionID, meta, false, []);
        }

        if (event.type === "session.deleted") {
            if (!sessionID) {
                sessionID = event.properties?.info?.id;
            }
            if (!sessionID) return;
            sessionState.delete(sessionID);
        }
    };
}