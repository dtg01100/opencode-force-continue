import { metrics } from "./metrics.js";

export const sessionState = new Map();
let nextSessionAutopilotEnabled = null;

let sessionTtlMs = 24 * 60 * 60 * 1000; // 24 hours
let cleanupInterval = null;
let sessionTtlExplicitlySet = false;

/**
 * Terminal completion state reasons.
 * These indicate the session has reached a terminal state and should not be nudged.
 */
const TERMINAL_COMPLETION_REASONS = new Set([
    'completed', 'blocked', 'interrupted',
    'canceled', 'cancelled', 'aborted', 'stopped'
]);

/**
 * Temporary pause state reasons.
 * These indicate the session is temporarily paused but could resume.
 */
const TEMPORARY_PAUSE_REASONS = new Set([
    'user_paused', 'autopilot_max_attempts', 'max_continuations', 'circuit_breaker'
]);

/**
 * Check if session is in a terminal completion state.
 * @param {object} meta - Session metadata
 * @returns {boolean}
 */
function checkTerminalCompletion(meta) {
    return !!(meta?.completionState);
}

/**
 * Check if session is in a temporary pause state.
 * @param {object} meta - Session metadata
 * @returns {boolean}
 */
function checkTemporarilyPaused(meta) {
    return !!(meta?.pauseState);
}

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
        if (checkTerminalCompletion(meta) || (meta.autoContinuePaused && meta.autoContinuePaused.reason === 'completed')) {
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
    if (ttlMs !== undefined || !sessionTtlExplicitlySet) {
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
        if (checkTerminalCompletion(meta) || (meta.autoContinuePaused && meta.autoContinuePaused.reason === 'completed')) {
            continue;
        }
        const lastSeen = meta.lastSeen || meta.sessionStartedAt || 0;
        if (now - lastSeen <= sessionTtlMs) {
            activeCount++;
        }
    }
    return activeCount;
}

/**
 * Get session-level autopilot enabled state only (no config fallback).
 * Returns the session override value if set, otherwise null.
 * For the full resolution including config fallback, use getAutopilotEnabled from autopilot.js.
 * @param {string} sessionID
 * @returns {boolean|null} Session autopilot state, or null if not overridden
 */
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

export function setNextSessionAutopilotEnabled(enabled) {
    nextSessionAutopilotEnabled = Boolean(enabled);
}

export function peekNextSessionAutopilotEnabled() {
    return nextSessionAutopilotEnabled;
}

export function clearNextSessionAutopilotEnabled() {
    nextSessionAutopilotEnabled = null;
}

export function consumeNextSessionAutopilotEnabled(sessionID) {
    if (nextSessionAutopilotEnabled === null) return false;
    const meta = sessionState.get(sessionID) || {};
    meta.autopilotEnabled = nextSessionAutopilotEnabled;
    sessionState.set(sessionID, meta);
    nextSessionAutopilotEnabled = null;
    return true;
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

/**
 * Set terminal completion state for a session.
 * @param {string} sessionID
 * @param {string} status - One of: completed, blocked, interrupted, canceled, cancelled, aborted, stopped
 * @param {object} extra - Optional extra fields (e.g., reason details)
 */
export function setCompletionState(sessionID, status, extra = {}) {
    if (!TERMINAL_COMPLETION_REASONS.has(status)) {
        throw new Error(`Invalid completion state: ${status}. Must be one of: ${[...TERMINAL_COMPLETION_REASONS].join(', ')}`);
    }
    const meta = sessionState.get(sessionID) || {};
    meta.completionState = { status, timestamp: Date.now(), ...extra };
    // Clear any temporary pause state when entering terminal completion
    meta.pauseState = null;
    sessionState.set(sessionID, meta);
}

/**
 * Set temporary pause state for a session.
 * @param {string} sessionID
 * @param {string} reason - One of: user_paused, autopilot_max_attempts, max_continuations, circuit_breaker
 * @param {object} extra - Optional extra fields (e.g., estimatedTime)
 */
export function setPauseState(sessionID, reason, extra = {}) {
    if (!TEMPORARY_PAUSE_REASONS.has(reason)) {
        throw new Error(`Invalid pause reason: ${reason}. Must be one of: ${[...TEMPORARY_PAUSE_REASONS].join(', ')}`);
    }
    const meta = sessionState.get(sessionID) || {};
    meta.pauseState = { reason, timestamp: Date.now(), ...extra };
    sessionState.set(sessionID, meta);
}

/**
 * Clear temporary pause state without affecting completion state.
 * @param {string} sessionID
 */
export function clearPauseState(sessionID) {
    const meta = sessionState.get(sessionID);
    if (!meta) return;
    meta.pauseState = null;
    sessionState.set(sessionID, meta);
}

/**
 * Clear terminal completion state (only done when user explicitly resumes).
 * @param {string} sessionID
 */
export function clearCompletionState(sessionID) {
    const meta = sessionState.get(sessionID);
    if (!meta) return;
    meta.completionState = null;
    sessionState.set(sessionID, meta);
}

/**
 * Check if session is in a terminal completion state.
 * @param {object} meta - Session metadata
 * @returns {boolean}
 */
export function isTerminalCompletion(meta) {
    return checkTerminalCompletion(meta);
}

/**
 * Check if session is in a temporary pause state.
 * @param {object} meta - Session metadata
 * @returns {boolean}
 */
export function isTemporarilyPaused(meta) {
    return checkTemporarilyPaused(meta);
}

/**
 * Get the pause reason if session is temporarily paused.
 * @param {object} meta - Session metadata
 * @returns {string|null}
 */
export function getPauseReason(meta) {
    return meta?.pauseState?.reason || null;
}

/**
 * Get the completion status if session is in completion state.
 * @param {object} meta - Session metadata
 * @returns {string|null}
 */
export function getCompletionStatus(meta) {
    return meta?.completionState?.status || null;
}

export function isSubagentSession(sessionID) {
    if (typeof sessionID !== "string") return false;
    return sessionID.includes("$$");
}
