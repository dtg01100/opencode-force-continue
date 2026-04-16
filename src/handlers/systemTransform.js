export function createSystemTransformHandler(config) {
    const enabled = config?.enableSystemPromptInjection ?? true;
    return async (params = {}, ctx2 = {}) => {
        if (!enabled) return;
        const { sessionID } = params || {};
        const system = ctx2 && ctx2.system;
        if (!sessionID || !system || typeof system.push !== "function") return;

        system.push(
            "When work is fully complete, call completionSignal(status='completed'). " +
            "When blocked, call completionSignal(status='blocked', reason='...'). " +
            "When you need user input, call completionSignal(status='interrupted', reason='...'). " +
            "When uncertain about a decision, use requestGuidance(question='...') instead of asking questions in your text — it tracks your question and lets the system handle it. " +
            "completionSignal must be your FINAL action. After calling it, produce NO further output. " +
            "IMPORTANT: If the user sends a message after you have called completionSignal, the session will be reset and you should resume working in response to their message. " +
            "Do not treat completionSignal as a permanent lock — user messages override the completion state and resume the session. " +
            "You can use statusReport to track progress, requestGuidance when uncertain, or pauseAutoContinue when planning."
        );
    };
}