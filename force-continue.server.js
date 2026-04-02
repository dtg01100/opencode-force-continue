import { tool } from "@opencode-ai/plugin";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const NEXT_SESSION_FLAG = join(tmpdir(), "opencode-force-continue-next");

function getFlagPath(sessionID) {
    return join(tmpdir(), `opencode-force-continue-${sessionID}`);
}

function isEnabled(sessionID) {
    if (!sessionID) return false;
    return existsSync(getFlagPath(sessionID));
}

function setEnabled(sessionID, enabled) {
    if (!sessionID) return;
    const flagPath = getFlagPath(sessionID);
    if (enabled) {
        writeFileSync(flagPath, "");
    } else {
        try { unlinkSync(flagPath); } catch {}
    }
}

function consumeNextSessionFlag() {
    if (!existsSync(NEXT_SESSION_FLAG)) return false;
    try { unlinkSync(NEXT_SESSION_FLAG); } catch {}
    return true;
}

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
                sessionCompletionState.set(sessionID, false);
            },
            "experimental.chat.system.transform": async ({ sessionID }, { system }) => {
                if (!isEnabled(sessionID)) return;
                system.push(
                    "IMPORTANT: You must call the 'completionSignal' tool when you are finished. " +
                    "Do not stop or ask for user input until you have called this tool. " +
                    "If you stop without calling it, you will be forced to continue."
                );
            },
            event: async ({ event }) => {
                const { sessionID } = event.properties;
                if (!sessionID) return;

                if (event.type === "session.created") {
                    if (consumeNextSessionFlag()) {
                        setEnabled(sessionID, true);
                    }
                    return;
                }

                if (!isEnabled(sessionID)) return;

                if (event.type === "message.part.updated") {
                    const { part } = event.properties;
                    if (part.type === "tool" && part.tool === "completionSignal") {
                        sessionCompletionState.set(part.sessionID, true);
                    }
                }

                if (event.type === "session.idle") {
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
};

export const ContinuePlugin = createContinuePlugin();
export default { server: ContinuePlugin };
