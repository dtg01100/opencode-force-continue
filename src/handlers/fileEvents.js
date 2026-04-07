import { sessionState } from "../state.js";

export function createFileEventsHandler(config) {
    return async ({ event }) => {
        if (event.type === "file.edited" && config.enableFileTracking) {
            const sessionID = event.properties?.sessionID;
            if (!sessionID) return;
            const meta = sessionState.get(sessionID) || {};
            meta.filesModified = meta.filesModified || new Set();
            let filePath = event.properties?.filePath || event.properties?.path;
            if (filePath) {
                filePath = filePath.replace(/\\/g, '/');
                if (filePath.startsWith('./')) {
                    filePath = filePath.slice(2);
                }
                meta.filesModified.add(filePath);
            }
            sessionState.set(sessionID, meta);
        }
    };
}