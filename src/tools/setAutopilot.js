import { tool } from "@opencode-ai/plugin";
import { writeAutopilotState } from "../autopilot.js";
import { sessionState } from "../state.js";

export function createSetAutopilotTool(config, log) {
    return tool({
        description: "Enable or disable the autopilot feature for guidance requests. When enabled, the AI will make decisions autonomously instead of waiting for user input.",
        args: {
            enabled: tool.schema.boolean().describe("Whether to enable (true) or disable (false) autopilot."),
            sessionID: tool.schema.string().optional().describe("Optional session ID to enable/disable autopilot for a specific session. If not provided, sets the global autopilot state."),
        },
        execute: async ({ enabled, sessionID }, toolCtx) => {
            const effectiveSessionID = sessionID || toolCtx?.sessionID;
            if (effectiveSessionID) {
                const meta = sessionState.get(effectiveSessionID) || {};
                meta.autopilotEnabled = enabled;
                sessionState.set(effectiveSessionID, meta);
                writeAutopilotState({ enabled, timestamp: Date.now() });
                log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool for session ${effectiveSessionID}`);
                return `Autopilot ${enabled ? "enabled" : "disabled"} for session ${effectiveSessionID}.`;
            } else {
                writeAutopilotState({ enabled, timestamp: Date.now() });
                log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool (global)`);
                return `Autopilot ${enabled ? "enabled" : "disabled"}.`;
            }
        },
    });
}