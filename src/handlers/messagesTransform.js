import { sessionState } from "../state.js";

export function createMessagesTransformHandler() {
    return async (params = {}, ctx2 = {}) => {
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
}