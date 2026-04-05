import { metrics } from "./metrics.js";

export const sessionState = new Map();

export function updateLastSeen(sessionID) {
    if (!sessionID || typeof sessionID !== "string") return;
    const meta = sessionState.get(sessionID) || {};
    meta.lastSeen = Date.now();
    sessionState.set(sessionID, meta);
}

export function readState() {
    const sessions = {};
    for (const [sessionID, meta] of sessionState.entries()) {
        sessions[sessionID] = Object.assign({}, meta);
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