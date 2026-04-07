import { tool } from "@opencode-ai/plugin";
import { sessionState, isTaskDone } from "../state.js";
import { metrics } from "../metrics.js";
import { getUnfinishedTasks } from "../utils.js";

export function createCompletionSignalTool(ctx, config) {
    return tool({
        description: "Call this tool EXACTLY ONCE when you are completely finished with the task. This MUST be your final action — do NOT generate any text, thoughts, or additional tool calls after calling it. You can also signal if you are blocked.",
        args: {
            status: tool.schema.string().optional().describe("Status of the task. 'completed' (default), 'blocked', or 'interrupted'."),
            reason: tool.schema.string().optional().describe("Reason for the status (e.g. if blocked)."),
        },
        execute: async ({ status = "completed", reason }, toolCtx) => {
            const sessionID = toolCtx?.sessionID;
            if (status === "blocked") {
                metrics.record(sessionID, "blocked");
                if (sessionID) {
                    const meta = sessionState.get(sessionID) || {};
                    meta.autoContinuePaused = { reason: status, timestamp: Date.now() };
                    sessionState.set(sessionID, meta);
                }
                return `Agent is blocked: ${reason || "No reason provided"}. Stopping auto-continue.`;
            }
            if (status === "interrupted") {
                metrics.record(sessionID, "interrupted");
                if (sessionID) {
                    const meta = sessionState.get(sessionID) || {};
                    meta.autoContinuePaused = { reason: status, timestamp: Date.now() };
                    sessionState.set(sessionID, meta);
                }
                return `Agent interrupted: ${reason || "No reason provided"}. Stopping auto-continue.`;
            }
            let unfinishedTasks = [];
            try {
                unfinishedTasks = await getUnfinishedTasks(ctx, sessionID, ctx?.logger);
            } catch (e) {
                if (ctx?.logger) ctx.logger.error("Failed to query tasks on completion", { error: e?.stack ?? e });
            }
            if (unfinishedTasks.length > 0) {
                const taskSummary = unfinishedTasks.map(t => `- ${t.title || t.id} [${t.status}]`).join("\n");
                metrics.record(sessionID, "completion.with.unfinished.tasks");
                return `You called completionSignal but ${unfinishedTasks.length} unfinished task(s) remain:\n${taskSummary}\n\nDo NOT stop. Continue working on these tasks immediately. When all tasks are truly complete, call completionSignal again.`;
            }
            metrics.record(sessionID, "completion");
            if (sessionID) {
                const meta = sessionState.get(sessionID) || {};
                if (meta.autoContinuePaused && meta.autoContinuePaused.reason === "completed") {
                    return `completionSignal was already called. Do NOT call it again. Remain silent.`;
                }
                meta.autoContinuePaused = { reason: status, timestamp: Date.now() };
                sessionState.set(sessionID, meta);
            }
            return "Task completed. You may now stop.";
        },
    });
}