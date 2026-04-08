import { sessionState } from "../state.js";

export function createMessagesTransformHandler() {
    return async (params = {}, ctx2 = {}) => {
        const { sessionID } = params || {};
        const messages = ctx2 && ctx2.messages;
        if (!sessionID || !messages || !Array.isArray(messages)) return;

        const meta = sessionState.get(sessionID);
        if (!meta?.autoContinuePaused) return;

        // Insert a harmless system instruction to make intent explicit to downstream
        // systems rather than attempting to forcibly silence them which might be ignored.
        messages.push({
            info: { role: "system" },
            parts: [{
                type: "text",
                // Keep the injected message text in sync with tests that expect
                // the phrase 'COMPLETION ALREADY REACHED'. The message is still
                // a polite system note but includes the exact test-friendly
                // substring to avoid brittle assertions.
                text: "COMPLETION ALREADY REACHED: completionSignal has been called for this session. Do not generate further assistant outputs or call tools for this session.",
            }],
        });
    };
}
