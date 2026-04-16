import { sessionState, updateLastSeen, isTaskDone, isSubagentSession, consumeNextSessionAutopilotEnabled, setCompletionState, setPauseState, clearPauseState, isTerminalCompletion, isTemporarilyPaused, getPauseReason, getCompletionStatus } from "../state.js";
import { getAutopilotEnabled, getAutopilotMaxAttempts, buildAutopilotPrompt, getAutopilotDecision, runAutopilotStep, setAutopilotEnabled, clearSessionAutopilotOverride } from "../autopilot.js";
import { getUnfinishedTasks } from "../utils.js";

function resolveSessionID(event) {
    if (event.type === "session.created") {
        return event.properties?.info?.id;
    }
    return event.properties?.sessionID
        || event.properties?.part?.sessionID
        || event.properties?.info?.id;
}

const COMPLETION_KEYWORDS = /\b(done|finished|complete|all set|that.?s all|all done|wrapping up|concluded)\b/i;

// Detect if text contains a question that suggests the AI is waiting for user input
const QUESTION_PATTERN = /\?/g;
const WAITING_INDICATORS = /\b(should i|would you|do you want|can i|what do you|which|how would you|are you sure|does this|would this)\b/i;

function containsQuestion(text) {
    if (!text) return false;
    const questionMarks = (text.match(QUESTION_PATTERN) || []).length;
    const waitingWords = WAITING_INDICATORS.test(text);
    return questionMarks > 0 && waitingWords;
}

function extractQuestions(text) {
    if (!text) return [];
    const matches = text.match(/[^.!?]*\?+/g) || [];
    return matches.map(s => s.trim()).filter(s => s.length > 0 && WAITING_INDICATORS.test(s));
}

function getLastAssistantText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const role = msg.role || msg.info?.role;
        const parts = msg.parts || msg.info?.parts || msg.content || msg.info?.content;
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
    if (previousText.startsWith(currentText) && previousText.length > currentText.length * 1.2) return false;
    const prevWords = new Set(previousText.toLowerCase().split(/\s+/));
    let newWordCount = 0;
    for (const word of currentText.toLowerCase().split(/\s+/)) {
        if (!prevWords.has(word)) newWordCount++;
    }
    const totalWords = currentText.split(/\s+/).length;
    return totalWords > 0 && newWordCount / totalWords > 0.3;
}

function isInLoop(currentText, history) {
    if (!currentText || !history || history.length < 1) return false;
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

function buildContinuePrompt(count, taskSummary, contextText, pendingGuidance) {
    let msg = "";
    if (taskSummary) {
        msg += `Continue working — ${taskSummary.length} unfinished task(s) remain:\n${taskSummary}\n\n`;
        msg += `Take the next concrete action now. Do not restate your plan — execute the next step.`;
    } else {
        msg += "Continue working on your current task. Take the next concrete action now.";
    }
    if (pendingGuidance) {
        msg += `\n\nYou have a pending guidance request:\nQ: ${pendingGuidance.question}`;
        if (pendingGuidance.context) msg += `\nContext: ${pendingGuidance.context}`;
        if (pendingGuidance.options) msg += `\nOptions: ${pendingGuidance.options}`;
        msg += "\n\nDecide on an answer yourself and proceed, or wait for user input if you cannot.";
    }
    if (contextText) {
        msg += `\n\nYour last response was:\n${contextText}`;
    }
    msg += "\n\nPlease continue working or call 'completionSignal' with status='blocked' if you cannot proceed.";
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
        msg += "STOP. Do NOT attempt any more work. Call 'completionSignal' with status='blocked' and explain exactly what you were unable to complete and why.";
    } else if (count >= config.escalationThreshold) {
        if (taskSummary) {
            msg += `You have been forced to continue ${count} times without making progress. Unfinished tasks:\n${taskSummary}\n\n`;
        } else {
            msg += `You have been forced to continue ${count} times without signaling completion.\n\n`;
        }
        msg += "Your current approach is not working. Take a step back, reassess, and try a fundamentally different strategy. If no new approach is available, call 'completionSignal' with status='blocked' and explain what you've tried and why it failed.";
    } else {
        if (taskSummary) {
            msg += `You have been continuing for ${count} rounds. Unfinished tasks:\n${taskSummary}\n\n`;
        } else {
            msg += `You have been continuing for ${count} rounds without signaling completion.\n\n`;
        }
        msg += "Briefly identify what remains, then take the next action. When fully done, call 'completionSignal' with status='completed'. If you are stuck, call 'completionSignal' with status='blocked' and explain what is preventing progress.";
    }
    if (inLoop) {
        msg += "\n\nWARNING: Your recent responses appear to repeat earlier content. You must break the loop by taking a qualitatively different approach.";
    }
    if (contextText) {
        msg += `\n\nYour last response was:\n${contextText}`;
    }
    return msg;
}

function buildLoopBreakPrompt(contextText) {
    let msg = "LOOP DETECTED: Your recent responses have been repeating or rehashing the same content.\n\n";
    msg += "Do NOT repeat your previous approach. Instead:\n";
    msg += "1. Identify what specifically is not working.\n";
    msg += "2. Choose a qualitatively different strategy.\n";
    msg += "3. Take the first action of the new approach.\n";
    msg += "If you cannot identify a viable new approach, call 'completionSignal' with status='blocked' and explain what you've tried and why it isn't working.";
    if (contextText) {
        msg += `\n\nYour last response was:\n${contextText}`;
    }
    return msg;
}

export function createSessionEventsHandler(ctx, config, client, metricsTracker, log) {
    const getNudgeDelayMs = () => {
        const delay = typeof config.nudgeDelayMs === "number" ? config.nudgeDelayMs : 0;
        return delay > 0 ? delay : 0;
    };

    const handleIdle = async (sessionID, meta, hasTasks, unfinishedTasks) => {
        if (!config.autoContinueEnabled) return;

        try {
            let messages = null;
            let messagesError = null;
            try {
                const response = await client.session.messages({ path: { id: sessionID } });
                messages = response?.data;
            } catch (e) {
                messagesError = e;
            }
            
            if (messagesError) {
                meta.errorCount = (meta.errorCount || 0) + 1;
                sessionState.set(sessionID, meta);
                metricsTracker.record(sessionID, "messages.error");
                if (meta.errorCount >= config.circuitBreakerThreshold) {
                    metricsTracker.record(sessionID, "circuit.breaker.trip");
                    setPauseState(sessionID, 'circuit_breaker');
                    log("warn", "Circuit breaker tripped after messages error", { sessionID, errorCount: meta.errorCount });
                    return;
                }
                log("debug", "failed to fetch messages", { sessionID, error: messagesError?.message });
                return;
            }
            
            if (!messages || messages.length === 0) {
                metricsTracker.record(sessionID, "messages.empty");
                log("debug", "no messages found", { sessionID });
                return;
            }

            const lastMsg = messages[messages.length - 1];
            const lastMsgRole = lastMsg?.role || lastMsg?.info?.role;
            if (!lastMsgRole) {
                metricsTracker.record(sessionID, "last.msg.missing.role");
                log("debug", "last message missing role", { sessionID });
                return;
            }
            if (lastMsgRole !== "assistant") {
                metricsTracker.record(sessionID, "last.msg.not.assistant");
                log("debug", "last message not from assistant", { sessionID, role: lastMsgRole });
                return;
            }

            const contextText = getLastAssistantText(messages || []);
            const prevText = meta.lastAssistantText || null;
            const progress = madeProgress(contextText, prevText);
            const responseHistory = meta.responseHistory || [];
            const inLoop = (config.enableLoopDetection && contextText ? isInLoop(contextText, responseHistory) : false) || meta.toolLoopDetected;

            if (progress && meta.continuationCount > 0) {
                meta.continuationCount = 0;
                meta.autopilotAttempts = 0;
                log("info", "Progress detected, resetting continuation and autopilot attempt counts", { sessionID });
            }

            meta.lastAssistantText = contextText;
            if (contextText) {
                responseHistory.unshift(contextText);
                if (responseHistory.length > 5) responseHistory.length = 5;
                meta.responseHistory = responseHistory;
            }

            sessionState.set(sessionID, meta);

            if (inLoop) {
                metricsTracker.record(sessionID, "loop.detected");
            }

            const taskSummary = hasTasks ? unfinishedTasks.map(t => `- [${t.status}] ${t.title || t.id}`).join("\n") : null;

            // Check if AI asked a question and is waiting for user input
            const aiAskedQuestion = containsQuestion(contextText);

            // Autopilot decision layer: check if autopilot should take action
            const decision = getAutopilotDecision(meta, config, sessionID, aiAskedQuestion);
            const autopilotAction = await runAutopilotStep(decision, {
                sessionState,
                client,
                log,
                metricsTracker,
                config,
                sendPrompt,
                extractQuestions,
                buildAutopilotPrompt
            }, sessionID, contextText);

            if (autopilotAction) {
                // Autopilot took action, don't proceed with nudge
                return;
            }

            // If autopilot didn't take action but AI asked a question, skip nudge
            if (aiAskedQuestion) {
                metricsTracker.record(sessionID, "idle.skipped.awaiting.answer");
                log("info", "Idle skipped: AI asked a question and autopilot did not auto-answer", { sessionID });
                return;
            }

            meta.continuationCount = (meta.continuationCount || 0) + 1;
            sessionState.set(sessionID, meta);
            metricsTracker.record(sessionID, "continuation");

            // Check continuation cap BEFORE incrementing
            if (meta.continuationCount >= config.maxContinuations) {
                metricsTracker.record(sessionID, "escalation");
                metricsTracker.record(sessionID, "prompt.escalation");
                setPauseState(sessionID, 'max_continuations');
                const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop, config);
                log("warn", "Auto-continue cap reached, pausing further continuations", { sessionID, count: meta.continuationCount });
                await sendPrompt(sessionID, msg, { allowPausedReason: 'max_continuations' });
                return;
            } else if (meta.continuationCount >= config.escalationThreshold) {
                // Escalation prompt with progress-aware messaging (buildEscalationPrompt handles the message differentiation)
                metricsTracker.record(sessionID, "escalation");
                metricsTracker.record(sessionID, "prompt.escalation");
                const msg = buildEscalationPrompt(meta.continuationCount, taskSummary, contextText, inLoop, config);
                log("info", "sent escalation prompt", { sessionID, count: meta.continuationCount });
                await sendPrompt(sessionID, msg);
            } else if (inLoop) {
                metricsTracker.record(sessionID, "prompt.loop.break");
                log("info", "sent loop-break prompt", { sessionID });
                await sendPrompt(sessionID, buildLoopBreakPrompt(contextText));
            } else if (contextText && COMPLETION_KEYWORDS.test(contextText) && meta.continuationCount <= 2) {
                metricsTracker.record(sessionID, "prompt.completion.nudge");
                log("info", "sent completion nudge", { sessionID });
                await sendPrompt(sessionID, "Your response suggests you are done, but you did not call 'completionSignal'. If your work is complete, call 'completionSignal' with status='completed'. If there is more to do, continue working. If you are stuck, call 'completionSignal' with status='blocked'.");
            } else {
                metricsTracker.record(sessionID, "prompt.continue");
                const pendingGuidance = meta.awaitingGuidance || null;
                const msg = buildContinuePrompt(meta.continuationCount, taskSummary, contextText, pendingGuidance);
                log("info", "sent continue prompt", { sessionID, count: meta.continuationCount });
                await sendPrompt(sessionID, msg);
            }
        } catch (e) {
            meta.errorCount = (meta.errorCount || 0) + 1;
            sessionState.set(sessionID, meta);
            if (meta.errorCount >= config.circuitBreakerThreshold) {
                metricsTracker.record(sessionID, "circuit.breaker.trip");
                setPauseState(sessionID, 'circuit_breaker');
                log("warn", "Circuit breaker tripped after error", { sessionID, errorCount: meta.errorCount });
            }
            metricsTracker.record(sessionID, "error");
            log("error", "Plugin error during idle handling", { error: e?.stack ?? e });
        }
    };

    const sendPrompt = async (sessionID, text, options = {}) => {
        if (!text || typeof text !== 'string') return;
        const nudgeDelayMs = getNudgeDelayMs();
        if (nudgeDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, nudgeDelayMs));
            if (!sessionState.has(sessionID)) {
                log("debug", "nudge suppressed after delay: session deleted", { sessionID });
                return;
            }
            const meta = sessionState.get(sessionID);
            const pauseReason = getPauseReason(meta);
            const completionStatus = getCompletionStatus(meta);
            if (completionStatus || pauseReason) {
                if (pauseReason === options.allowPausedReason) {
                    // Allow the prompt that established this paused state to land.
                } else {
                    log("debug", "nudge suppressed after delay", { sessionID, reason: completionStatus || pauseReason });
                    return;
                }
            }
        }
        try {
            await client.session.promptAsync({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text }] }
            });
        } catch (e) {
            // Record prompt error and also increment session-level error count
            // immediately. Some error paths may not bubble cleanly to the
            // outer handler in tests, so incrementing here makes the behavior
            // deterministic and ensures prompt failures contribute to the
            // circuit-breaker threshold as tests expect.
            metricsTracker.record(sessionID, "prompt.error");
            log("error", "Failed to send prompt", { sessionID, error: e?.message ?? e });

            try {
                const currentMeta = sessionState.get(sessionID) || {};
                currentMeta.errorCount = (currentMeta.errorCount || 0) + 1;
                sessionState.set(sessionID, currentMeta);

                if (currentMeta.errorCount >= config.circuitBreakerThreshold) {
                    metricsTracker.record(sessionID, "circuit.breaker.trip");
                    setPauseState(sessionID, 'circuit_breaker');
                    log("warn", "Circuit breaker tripped after prompt error", { sessionID, errorCount: currentMeta.errorCount });
                }
            } catch (innerErr) {
                // Don't let error-counting itself throw and mask the original error
                log("error", "Failed while recording prompt error to session state", { sessionID, error: innerErr?.message ?? innerErr });
            }

            // Do NOT rethrow — error is fully handled above (error count incremented,
            // circuit breaker checked). Rethrowing would cause the outer catch in
            // handleIdle to double-count the error.
        }
    };

    return async ({ event }) => {
        const sessionID = resolveSessionID(event);
        if (!sessionID) return;
        const part = event.properties?.part;

        if (event.type === "session.created") {
            try {
                updateLastSeen(sessionID);
                const meta = sessionState.get(sessionID) || {};
                meta.continuationCount = 0;
                meta.toolCallHistory = [];
                meta.errorCount = 0;
                // Clear both new and legacy pause/completion states
                meta.pauseState = null;
                meta.completionState = null;
                meta.autoContinuePaused = null;
                meta.sessionStartedAt = Date.now();
                sessionState.set(sessionID, meta);
                if (consumeNextSessionAutopilotEnabled(sessionID)) {
                    setAutopilotEnabled(sessionID, sessionState.get(sessionID)?.autopilotEnabled);
                }
            } catch (e) {
                log("debug", "session.created handler error", { sessionID, error: e?.message });
            }
            metricsTracker.record(sessionID, "session.created");
            return;
        }

        if (event.type === "message.part.updated") {
            if (part?.type === "tool" && part.tool === "completionSignal" && part.state?.status === "completed") {
                // SDK type: ToolStateCompleted has `input`, but keep supporting
                // the older `args` shape for compatibility with tolerated callers.
                const args = part.state?.input || part.state?.args || {};
                const status = (args.status || "completed").toLowerCase();
                if (status === "completed" || status === "blocked" || status === "interrupted") {
                    setCompletionState(sessionID, status);
                    if (config.enableCompletionSummary) {
                        const meta = sessionState.get(sessionID) || {};
                        const summary = {
                            continuations: meta.continuationCount || 0,
                            filesModified: meta.filesModified ? [...meta.filesModified] : [],
                            toolCalls: meta.toolCallHistory?.length || 0,
                            loopsDetected: meta.toolLoopDetected || false,
                            duration: meta.sessionStartedAt ? Date.now() - meta.sessionStartedAt : 0,
                        };
                        log("info", "Session completion summary", { sessionID, summary });
                    }
                }
            }
            const partStatus = part?.state?.status;
            if (partStatus === "canceled" || partStatus === "cancelled" || partStatus === "interrupted" || partStatus === "aborted" || partStatus === "stopped") {
                setCompletionState(sessionID, partStatus);
                log("debug", "part canceled/interrupted, suppressing nudges", { sessionID, partStatus });
            }
            return;
        }

        if (event.type === "session.idle") {
            metricsTracker.record(sessionID, "idle.event");
            log("debug", "session.idle received", { sessionID });

            const meta = sessionState.get(sessionID) || { continuationCount: 0 };

            if (!config.autoContinueEnabled) {
                metricsTracker.record(sessionID, "idle.skipped.disabled");
                log("debug", "idle skipped: auto-continue disabled", { sessionID });
                return;
            }

            if (isTerminalCompletion(meta)) {
                metricsTracker.record(sessionID, "idle.skipped.complete");
                log("debug", "idle skipped: session completed", { sessionID });
                return;
            }

            if (isTemporarilyPaused(meta)) {
                metricsTracker.record(sessionID, "idle.skipped.paused");
                log("debug", "idle skipped: session temporarily paused", { sessionID });
                return;
            }

            if (config.skipNudgeInSubagents && isSubagentSession(sessionID)) {
                metricsTracker.record(sessionID, "idle.skipped.subagent");
                log("debug", "idle skipped: subagent session", { sessionID });
                return;
            }

            if (ctx?.hooks?.taskBabysitter?.event) {
                try {
                    await ctx.hooks.taskBabysitter.event({ event });
                } catch (e) {
                    log("error", "Babysitter hook error", { error: e?.stack ?? e });
                }
                metricsTracker.record(sessionID, "idle.skipped.babysitter");
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
                unfinishedTasks = await getUnfinishedTasks(ctx, sessionID, log);
            }

            if (unfinishedTasks.length > 0) {
                await handleIdle(sessionID, meta, true, unfinishedTasks);
                return;
            }

            await handleIdle(sessionID, meta, false, []);
        }

        if (event.type === "session.deleted") {
            sessionState.delete(sessionID);
            clearSessionAutopilotOverride(sessionID);
        }
    };
}
