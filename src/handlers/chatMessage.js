import { sessionState } from "../state.js";

export function createChatMessageHandler() {
    return async ({ sessionID } = {}) => {
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
            meta.toolLoopDetected = false;
            meta.autopilotAttempts = 0;
            meta.autoContinuePaused = null;
            sessionState.set(sessionID, meta);
        } catch (e) {
            try {
                console.warn(`[force-continue] chatMessage handler: failed to update session state — ${e?.message}`);
            } catch (ignored) {}
        }
    };
}
