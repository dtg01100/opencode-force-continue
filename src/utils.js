/**
 * Shared utility functions for force-continue plugin
 */

import { isTaskDone } from "./state.js";

/**
 * Get task hook candidates from ctx in priority order.
 * Checks multiple possible locations where the hook might be registered.
 * @param {object} ctx - Plugin context
 * @returns {Array<Function>} Array of candidate functions
 */
export function getTaskHookCandidates(ctx) {
    return [
        ctx?.hooks?.getTasksByParentSession,
        ctx?.hooks?.backgroundManager?.getTasksByParentSession,
        ctx?.getTasksByParentSession,
        ctx?.backgroundManager?.getTasksByParentSession,
    ];
}

/**
 * Fetch unfinished tasks from available task hooks.
 * @param {object} ctx - Plugin context
 * @param {string} sessionID - Session ID
 * @param {object} logger - Optional logger for error reporting
 * @returns {Promise<Array>} Array of unfinished tasks
 */
export async function getUnfinishedTasks(ctx, sessionID, logger = null) {
    const candidates = getTaskHookCandidates(ctx);

    const logTaskError = (error) => {
        if (!logger) return;
        try {
            if (typeof logger === "function") {
                logger("error", "Failed to query tasks", { error: error?.stack ?? error });
                return;
            }
            if (typeof logger.error === "function") {
                logger.error("Failed to query tasks", { error: error?.stack ?? error });
                return;
            }
        } catch (logErr) {
            try { console.error("force-continue: Failed to log task query error", logErr); } catch (ignored) {}
        }
    };
    
    for (const fn of candidates) {
        if (typeof fn !== "function") continue;
        try {
            const result = await fn(sessionID);
            const tasks = Array.isArray(result)
                ? result
                : (result && Array.isArray(result.data) ? result.data : []);
            if (tasks.length > 0) {
                return tasks.filter(t => t && t.status && !isTaskDone(t.status));
            }
        } catch (e) {
            logTaskError(e);
        }
    }
    
    return [];
}

/**
 * Format tasks as a summary string for prompts
 * @param {Array} tasks - Array of task objects
 * @returns {string|null} Formatted task summary or null if no tasks
 */
export function formatTaskSummary(tasks) {
    if (!tasks || tasks.length === 0) return null;
    return tasks.map(t => `- [${t.status}] ${t.title || t.id}`).join("\n");
}
