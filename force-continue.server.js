import { tool } from "@opencode-ai/plugin";
import { isEnabled, setEnabled, consumeNextSessionFlag, cleanupOrphanSessions, updateLastSeen, getSessionMeta } from "./flags.js";

export const createContinuePlugin = (sessionCompletionState = new Map()) => {
    return async (ctx) => {
        const { client } = ctx;

        return {
            tool: {
                completionSignal: tool({
                    description: "Call this tool when you are genuinely finished with the task and ready for user input. Do NOT stop until you have called this.",
                    args: {},
                    execute: async () => {
                        return "Ready for user.";
                    },
                }),
            },
            "chat.message": async ({ sessionID }) => {
                if (!isEnabled(sessionID)) return;
                try { updateLastSeen(sessionID); } catch (e) { /* best-effort */ }
                sessionCompletionState.set(sessionID, false);
            },

            "experimental.chat.system.transform": async ({ sessionID } = {}, { system }) => {
                // Only inject the system instruction for the current session when it's enabled and recently active
                if (!sessionID) return;
                const meta = getSessionMeta(sessionID);
                if (!meta || !meta.enabled) return;
                const lastSeen = meta.lastSeen || 0;
                const now = Date.now();
                const TTL = 5 * 60 * 1000; // 5 minutes
                if (lastSeen && now - lastSeen > TTL) return;

                system.push(
                    "IMPORTANT: You must call the 'completionSignal' tool when you are finished. " +
                    "Do not stop or ask for user input until you have called this tool. " +
                    "If you stop without calling it, you will be forced to continue."
                );
            },


            event: async ({ event }) => {
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
                    if (consumeNextSessionFlag()) {
                        setEnabled(sessionID, true);
                    }
                    return;
                }

                if (!isEnabled(sessionID)) return;

                if (event.type === "message.part.updated") {
                    if (part?.type === "tool" && part.tool === "completionSignal" && part.state?.status === "completed") {
                        sessionCompletionState.set(sessionID, true);
                    }
                }

                if (event.type === "session.idle") {
                    const isComplete = sessionCompletionState.get(sessionID);

                    // If an external babysitter hook exists on ctx, prefer it. This keeps the plugin lightweight and
                    // compatible with environments that provide background task managers (like oh-my-opencode).
                    if (ctx?.hooks?.taskBabysitter?.event) {
                        try {
                            await ctx.hooks.taskBabysitter.event({ event });
                        } catch (e) {
                            console.error("Babysitter hook error:", e);
                        }
                        return;
                    }

                    // Attempt to detect unfinished tasks via host-provided helpers. If any unfinished tasks remain,
                    // inject a Continue prompt that reminds the assistant there are unfinished items — even if the
                    // completionSignal tool was already emitted.
                    let unfinishedCount = 0;
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
                                const tasks = await fn(sessionID);
                                if (Array.isArray(tasks)) {
                                    unfinishedCount = tasks.filter(t => t && t.status && t.status !== 'done' && t.status !== 'completed').length;
                                    break;
                                }
                                // some hosts return objects with .data
                                if (tasks && Array.isArray(tasks.data)) {
                                    unfinishedCount = tasks.data.filter(t => t && t.status && t.status !== 'done' && t.status !== 'completed').length;
                                    break;
                                }
                            } catch {}
                        }
                    } catch (e) {
                        console.error("Failed to query tasks:", e);
                    }

                    if (unfinishedCount > 0) {
                        try {
                            const msg = `Continue — ${unfinishedCount} unfinished task(s) remain. Continue working?`;
                            await client.session.promptAsync({
                                sessionID,
                                parts: [{ type: "text", text: msg }]
                            });
                        } catch (e) {
                            console.error("Plugin error:", e);
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
                                    await client.session.promptAsync({
                                        sessionID,
                                        parts: [{ type: "text", text: "Continue" }]
                                    });
                                }
                            }
                        } catch (e) {
                            console.error("Plugin error:", e);
                        }
                    }
                }

                if (event.type === "session.deleted") {
                    // best-effort cleanup of stale sessions (uses TTL inside flags.js)
                    try { cleanupOrphanSessions(); } catch (e) { /* ignore */ }
                }
            },
        };
    };
};

// Expose a default taskBabysitter that uses the local implementation when the host wants to mount it into ctx.hooks
import { createTaskBabysitter } from "./src/babysitter.js";

export const ContinuePlugin = createContinuePlugin();
export default { server: ContinuePlugin, taskBabysitter: createTaskBabysitter };

