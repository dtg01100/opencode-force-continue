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
                // Normalize and dedupe: store relative paths without leading ./
                try {
                    // avoid adding overly long or binary paths
                    if (typeof filePath === 'string' && filePath.length > 0 && filePath.length < 4096) {
                        meta.filesModified.add(filePath);
                    }
                } catch (e) {
                    // defensive: keep handler resilient to Set issues
                    meta.filesModified = new Set([...meta.filesModified, filePath]);
                }
            }
            sessionState.set(sessionID, meta);
        }
    };
}
