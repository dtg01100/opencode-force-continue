import { tool } from "@opencode-ai/plugin";
import { isEnabled, setEnabled, consumeNextSessionFlag, cleanupOrphanSessions } from "./flags.js";

export const createContinuePlugin = (sessionCompletionState = new Map()) => {
    return async (ctx) => {
        const { client } = ctx;
        const activeSessions = new Set();

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
                activeSessions.add(sessionID);
                sessionCompletionState.set(sessionID, false);
            },
            "experimental.chat.system.transform": async ({ sessionID } = {}, { system }) => {
                // Only inject the system instruction for the current session when it's active and enabled
                if (!sessionID) return;
                if (!activeSessions.has(sessionID)) return;
                if (!isEnabled(sessionID)) return;

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
                    // Task-driven babysitter: delegate to hooks provided by the environment when possible.
                    // If a task-based babysitter is not available, fall back to the original behavior.
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
                    activeSessions.delete(sessionID);
                    cleanupOrphanSessions(activeSessions);
                }
            },
        };
    };
};

// Expose a default taskBabysitter that uses the local implementation when the host wants to mount it into ctx.hooks
import { createTaskBabysitter } from "./src/babysitter.js";

export const ContinuePlugin = createContinuePlugin();
export default { server: ContinuePlugin, taskBabysitter: createTaskBabysitter };

