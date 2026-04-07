import { metrics } from "./metrics.js";

export const sessionState = new Map();

export function getAutopilotEnabled(sessionID) {
    const meta = sessionState.get(sessionID) || {};
    return meta.autopilotEnabled ?? false;
}

export function setAutopilotEnabled(sessionID, enabled) {
    const meta = sessionState.get(sessionID) || {};
    meta.autopilotEnabled = enabled;
    sessionState.set(sessionID, meta);
}

export function updateLastSeen(sessionID) {
    if (!sessionID || typeof sessionID !== "string") return;
    const meta = sessionState.get(sessionID) || {};
    meta.lastSeen = Date.now();
    sessionState.set(sessionID, meta);
}

export function readState() {
    const sessions = {};
    for (const [sessionID, meta] of sessionState.entries()) {
        const copy = Object.assign({}, meta);
        if (copy.filesModified instanceof Set) {
            copy.filesModified = Array.from(copy.filesModified);
        }
        sessions[sessionID] = copy;
    }
    return { sessions, metrics: metrics.getSummary() };
}

export function isTaskDone(status) {
    if (typeof status !== "string") return false;
    const normalized = status.trim().toLowerCase();
    return normalized === "done" || normalized === "completed" || normalized === "complete";
}

export function isSubagentSession(sessionID) {
    if (typeof sessionID !== "string") return false;
    return sessionID.includes("$$");
}