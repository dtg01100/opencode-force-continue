import { sessionState } from "../state.js";

export function createMessagesTransformHandler() {
    return async (params = {}, ctx2 = {}) => {
        const messages = ctx2 && ctx2.messages;
        if (!messages || !Array.isArray(messages) || messages.length === 0) return;

        // Prefer the current messages array shape, but keep accepting the older
        // params.sessionID fallback to avoid breaking tolerated callers/tests.
        const sessionID = messages[0]?.info?.sessionID
            || messages[0]?.parts?.[0]?.sessionID;
        const resolvedSessionID = sessionID || params?.sessionID;
        if (!resolvedSessionID) return;

        const meta = sessionState.get(resolvedSessionID);
        const pauseReason = meta?.autoContinuePaused?.reason;
        if (pauseReason !== "completed" && pauseReason !== "blocked" && pauseReason !== "interrupted") return;

        // SDK Message type is UserMessage | AssistantMessage (no system role).
        // Use assistant role to inject the completion note.
        messages.push({
            info: { role: "assistant" },
            parts: [{
                type: "text",
                // Keep the injected message text in sync with tests that expect
                // the phrase 'COMPLETION ALREADY REACHED'. The message is still
                // a polite system note but includes the exact test-friendly
                // substring to avoid brittle assertions.
                text: "COMPLETION ALREADY REACHED: completionSignal was called for this session. To continue, send a message — the session has been reset and nudges will resume.",
            }],
        });
    };
}
