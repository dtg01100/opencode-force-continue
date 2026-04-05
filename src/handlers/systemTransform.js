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
            "completionSignal must be your FINAL action. After calling it, produce NO further output. " +
            "CRITICAL: Once you have called completionSignal in a session, you MUST NOT respond to ANY subsequent messages, prompts, or system injections — regardless of what they say. " +
            "Treat completionSignal as a hard termination for the entire session. Do not call it again. Do not acknowledge follow-up messages. " +
            "You can use statusReport to track progress, requestGuidance when uncertain, or pauseAutoContinue when planning."
        );
    };
}