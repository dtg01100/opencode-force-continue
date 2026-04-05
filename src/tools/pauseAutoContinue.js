import { tool } from "@opencode-ai/plugin";
import { sessionState } from "../state.js";

export function createPauseAutoContinueTool(config, log) {
    return tool({
        description: "Temporarily suspend auto-continue prompts while you think through a complex problem. Call this when you need time to plan without being interrupted.",
        args: {
            reason: tool.schema.string().optional().describe("Why you're pausing auto-continue."),
            estimatedTime: tool.schema.string().optional().describe("Estimated time needed (e.g., '5 minutes')."),
        },
        execute: async ({ reason, estimatedTime }, toolCtx) => {
            const sessionID = toolCtx?.sessionID;
            if (sessionID) {
                const meta = sessionState.get(sessionID) || {};
                meta.autoContinuePaused = { reason, estimatedTime, timestamp: Date.now() };
                sessionState.set(sessionID, meta);
                log("info", "Auto-continue paused", { sessionID, reason });
            }
            return `Auto-continue paused${reason ? `: ${reason}` : ""}.${estimatedTime ? ` Estimated time: ${estimatedTime}.` : ""}\nCall completionSignal or send a message to resume.`;
        },
    });
}