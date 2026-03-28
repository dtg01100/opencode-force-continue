import { tool } from "@opencode-ai/plugin";

const sessionCompletionState = new Map();

export const ContinuePlugin = async (ctx) => {
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
        "experimental.chat.system.transform": async ({ sessionID }, { system }) => {
            system.push(
                "IMPORTANT: You must call the 'completionSignal' tool when you are finished. " +
                "Do not stop or ask for user input until you have called this tool. " +
                "If you stop without calling it, you will be forced to continue."
            );
        },
        "chat.message": async ({ sessionID }) => {
            sessionCompletionState.set(sessionID, false);
        },
        event: async ({ event }) => {
            if (event.type === "message.part.updated") {
                const { part } = event.properties;
                if (part.type === "tool" && part.tool === "completionSignal") {
                    sessionCompletionState.set(part.sessionID, true);
                }
            }

            if (event.type === "session.idle") {
                const { sessionID } = event.properties;
                const isComplete = sessionCompletionState.get(sessionID);

                if (!isComplete) {
                    try {
                        const { data: messages } = await client.session.messages({ path: { sessionID } });
                        if (messages && messages.length > 0) {
                            const lastMsg = messages[messages.length - 1];
                            if (lastMsg.role === "assistant") {
                                await client.session.promptAsync({
                                    path: { sessionID },
                                    body: { parts: [{ type: "text", text: "Continue" }] }
                                });
                            }
                        }
                    } catch (e) {
                        console.error("Plugin error:", e);
                    }
                }
            }
        },
    };
};
