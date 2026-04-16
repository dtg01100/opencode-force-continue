import { sessionState, clearPauseState, clearCompletionState } from "../state.js";

export function createChatMessageHandler() {
    return async (params = {}) => {
        const sessionID = params?.sessionID || params?.params?.sessionID;
        if (!sessionID || typeof sessionID !== "string") return;
        try {
            const meta = sessionState.get(sessionID) || {};
            meta.lastSeen = Date.now();
            meta.continuationCount = 0;
            meta.lastAssistantText = null;
            meta.responseHistory = [];
            meta.toolCallHistory = [];
            meta.errorCount = 0;
            meta.awaitingGuidance = null;
            meta.aiCalledGuidanceTool = false;
            meta.handledGuidanceQuestion = null;
            meta.toolLoopDetected = false;
            meta.autopilotAttempts = 0;
            // Clear both pause and completion states - user interaction means they want to resume
            meta.pauseState = null;
            meta.completionState = null;
            // Also clear legacy autoContinuePaused for backward compatibility
            meta.autoContinuePaused = null;
            sessionState.set(sessionID, meta);
        } catch (e) {
            try {
                console.warn(`[force-continue] chatMessage handler: failed to update session state — ${e?.message}`);
            } catch (ignored) {}
        }
    };
}
