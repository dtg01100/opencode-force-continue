import { tool } from "@opencode-ai/plugin";
import { writeAutopilotState } from "../autopilot.js";

export function createSetAutopilotTool(config, log) {
    return tool({
        description: "Enable or disable the autopilot feature for guidance requests. When enabled, the AI will make decisions autonomously instead of waiting for user input.",
        args: {
            enabled: tool.schema.boolean().describe("Whether to enable (true) or disable (false) autopilot."),
        },
        execute: async ({ enabled }) => {
            writeAutopilotState({ enabled, timestamp: Date.now() });
            log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool`);
            return `Autopilot ${enabled ? "enabled" : "disabled"}.`;
        },
    });
}