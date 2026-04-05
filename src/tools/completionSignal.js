import { tool } from "@opencode-ai/plugin";
import { sessionState, isTaskDone } from "../state.js";
import { metrics } from "../metrics.js";

export function createCompletionSignalTool(ctx, config) {
    return tool({
        description: "Call this tool EXACTLY ONCE when you are completely finished with the task. This MUST be your final action — do NOT generate any text, thoughts, or additional tool calls after calling it. You can also signal if you are blocked.",
        args: {
            status: tool.schema.string().optional().describe("Status of the task. 'completed' (default), 'blocked', or 'interrupted'."),
            reason: tool.schema.string().optional().describe("Reason for the status (e.g. if blocked)."),
        },
        execute: async ({ status = "completed", reason }, toolCtx) => {
            const sessionID = toolCtx?.sessionID;
            if (sessionID) {
                const meta = sessionState.get(sessionID) || {};
                if (meta.autoContinuePaused && meta.autoContinuePaused.reason === "completed") {
                    return `completionSignal was already called. Do NOT call it again. Remain silent.`;
                }
                meta.autoContinuePaused = { reason: status, timestamp: Date.now() };
                sessionState.set(sessionID, meta);
            }
            if (status === "blocked") {
                metrics.record(sessionID, "blocked");
                return `Agent is blocked: ${reason || "No reason provided"}. Stopping auto-continue.`;
            }
            if (status === "interrupted") {
                metrics.record(sessionID, "interrupted");
                return `Agent interrupted: ${reason || "No reason provided"}. Stopping auto-continue.`;
            }
            metrics.record(sessionID, "completion");
            let unfinishedTasks = [];
            try {
                const getTasksCandidates = [
                    ctx?.hooks?.getTasksByParentSession,
                    ctx?.hooks?.backgroundManager?.getTasksByParentSession,
                    ctx?.getTasksByParentSession,
                    ctx?.backgroundManager?.getTasksByParentSession,
                ];
                for (const fn of getTasksCandidates) {
                    if (typeof fn !== "function") continue;
                    try {
                        const result = await fn(sessionID);
                        const tasks = Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : []);
                        if (tasks.length > 0) {
                            unfinishedTasks = tasks.filter(t => t && t.status && !isTaskDone(t.status));
                            break;
                        }
                    } catch {}
                }
            } catch (e) {
                if (ctx?.logger) ctx.logger.error("Failed to query tasks on completion", { error: e?.stack ?? e });
            }
            if (unfinishedTasks.length === 0) {
                return "Task completed. You may now stop.";
            }
            return "Ready for user.";
        },
    });
}