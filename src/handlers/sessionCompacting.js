import { sessionState } from "../state.js";

export function createSessionCompactingHandler(config) {
    return async (params = {}, ctx2 = {}) => {
        const sessionID = params?.sessionID;
        if (!sessionID) return;
        const meta = sessionState.get(sessionID) || {};
        const continuationState = meta.continuationCount || 0;
        const progressReport = meta.lastProgressReport || null;
        const filesModified = meta.filesModified ? [...meta.filesModified] : [];

        if (ctx2?.context && typeof ctx2.context.push === "function") {
            ctx2.context.push(
                `<force-continue-state>\n` +
                `Continuation count: ${continuationState}\n` +
                `Files modified: ${filesModified.join(", ") || "none"}\n` +
                `Last progress: ${progressReport ? progressReport.progress : "none"}\n` +
                `If continuation count >= ${config.escalationThreshold}, try a different approach.\n` +
                `If continuation count >= ${config.maxContinuations}, call completionSignal(status='blocked').\n` +
                `</force-continue-state>`
            );
        }
    };
}