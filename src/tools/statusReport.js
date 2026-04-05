import { tool } from "@opencode-ai/plugin";
import { sessionState } from "../state.js";

export function createStatusReportTool(config, log) {
    return tool({
        description: "Report progress on your current task without ending the session. Use this to let the plugin know you're making progress and avoid unnecessary continuation prompts.",
        args: {
            progress: tool.schema.string().describe("Brief description of current progress (e.g., 'Completed 3 of 5 steps')."),
            nextSteps: tool.schema.string().optional().describe("What you plan to do next."),
            blockers: tool.schema.string().optional().describe("Any blockers preventing progress."),
        },
        execute: async ({ progress, nextSteps, blockers }, toolCtx) => {
            const sessionID = toolCtx?.sessionID;
            if (sessionID) {
                const meta = sessionState.get(sessionID) || {};
                meta.lastProgressReport = { progress, nextSteps, blockers, timestamp: Date.now() };
                meta.continuationCount = 0;
                sessionState.set(sessionID, meta);
                log("info", "Progress reported", { sessionID, progress });
            }
            let response = `Progress recorded: ${progress}`;
            if (blockers) response += `\nBlockers noted: ${blockers}`;
            response += "\nContinuing work — no auto-continue prompts will be sent until next idle.";
            return response;
        },
    });
}