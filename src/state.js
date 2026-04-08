import { metrics } from "./metrics.js";

export const sessionState = new Map();

let sessionTtlMs = 24 * 60 * 60 * 1000; // 24 hours
let cleanupInterval = null;
let sessionTtlExplicitlySet = false;

/**
 * Configure the session TTL (time-to-live).
 * @param {number} ttlMs - TTL in milliseconds
 */
export function setSessionTtl(ttlMs) {
    sessionTtlMs = ttlMs;
    sessionTtlExplicitlySet = true;
}

/**
 * Get the current session TTL setting.
 * @returns {number} TTL in milliseconds
 */
export function getSessionTtl() {
    return sessionTtlMs;
}

/**
 * Clean up expired sessions from the state map.
 * Removes sessions that haven't been seen within the TTL period,
 * except for sessions that are marked as complete (autoContinuePaused).
 * @returns {number} Number of sessions cleaned up
 */
export function cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionID, meta] of sessionState.entries()) {
        // Skip sessions that are complete - they should be cleaned up via session.deleted
        if (meta.autoContinuePaused && meta.autoContinuePaused.reason === 'completed') {
            continue;
        }
        
        const lastSeen = meta.lastSeen || meta.sessionStartedAt || 0;
        if (now - lastSeen > sessionTtlMs) {
            sessionState.delete(sessionID);
            cleaned++;
        }
    }
    
    return cleaned;
}

/**
 * Start periodic cleanup of expired sessions.
 * Cleanup runs every intervalMs milliseconds (default: 1 hour).
 * Uses the sessionTtlMs value set via setSessionTtl or the default 24 hours.
 * Call setSessionTtl before startPeriodicCleanup to override the TTL.
 * @param {number} intervalMs - Cleanup interval in milliseconds (default: 1 hour)
 * @param {number} ttlMs - Optional TTL override; calls setSessionTtl if provided
 */
export function startPeriodicCleanup(intervalMs = 60 * 60 * 1000, ttlMs) {
    if (ttlMs !== undefined && !sessionTtlExplicitlySet) {
        sessionTtlMs = ttlMs;
    }
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }
    // Ensure intervalMs is a positive number
    const effectiveInterval = typeof intervalMs === "number" && intervalMs > 0 ? intervalMs : 60 * 60 * 1000;
    cleanupInterval = setInterval(() => {
        try {
            const cleaned = cleanupExpiredSessions();
            if (cleaned > 0) {
                console.log(`force-continue: Cleaned up ${cleaned} expired session(s)`);
            }
        } catch (e) {
            console.error(`[force-continue] startPeriodicCleanup: cleanup job failed: ${e?.message ?? e}`);
        }
    }, effectiveInterval);
}

/**
 * Stop periodic cleanup.
 */
export function stopPeriodicCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

/**
 * Get the number of active (non-expired) sessions.
 * @returns {number} Number of active sessions
 */
export function getActiveSessionCount() {
    cleanupExpiredSessions();
    let activeCount = 0;
    const now = Date.now();
    for (const [, meta] of sessionState.entries()) {
        if (meta.autoContinuePaused && meta.autoContinuePaused.reason === 'completed') {
            continue;
        }
        const lastSeen = meta.lastSeen || meta.sessionStartedAt || 0;
        if (now - lastSeen <= sessionTtlMs) {
            activeCount++;
        }
    }
    return activeCount;
}

export function getAutopilotEnabled(sessionID) {
    const meta = sessionState.get(sessionID) || {};
    if ('autopilotEnabled' in meta) {
        return meta.autopilotEnabled;
    }
    return null;
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
