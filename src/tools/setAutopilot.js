import { tool } from "@opencode-ai/plugin";
import { setAutopilotEnabled } from "../autopilot.js";

export function createSetAutopilotTool(config, log) {
    return tool({
        description: "Enable or disable the autopilot feature for guidance requests. When enabled, the AI will make decisions autonomously instead of waiting for user input.",
        args: {
            enabled: tool.schema.boolean().describe("Whether to enable (true) or disable (false) autopilot."),
            sessionID: tool.schema.string().optional().describe("Optional session ID to enable/disable autopilot for a specific session. If not provided, sets the global autopilot state."),
        },
        execute: async ({ enabled, sessionID }) => {
            if (sessionID) {
                setAutopilotEnabled(sessionID, enabled);
                log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool for session ${sessionID}`);
                return `Autopilot ${enabled ? "enabled" : "disabled"} for session ${sessionID}.`;
            }

            setAutopilotEnabled(null, enabled);
            log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool (global)`);
            return `Autopilot ${enabled ? "enabled" : "disabled"}.`;
        },
    });
}
