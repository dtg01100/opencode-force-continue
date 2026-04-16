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
        const { getPauseReason, getCompletionStatus, isTerminalCompletion } = await import('../state.js');
        const tempPauseReason = getPauseReason(meta);
        const completionStatus = getCompletionStatus(meta);
        // Check if session is in a terminal state (completionState or legacy autoContinuePaused with terminal reason)
        const isTerminal = isTerminalCompletion(meta);
        if (!isTerminal) return;

        // If the last message is from the user, the user has explicitly signaled they want to continue.
        // Don't tell the model to remain silent - let it respond to the user's message.
        const lastMsg = messages[messages.length - 1];
        const lastMsgRole = lastMsg?.role || lastMsg?.info?.role;
        if (lastMsgRole === 'user') return;

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
