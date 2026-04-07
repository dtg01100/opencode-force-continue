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
                // Globally toggling: write global state and clear ALL session-level overrides
                // so no stale per-session setting can shadow the global value.
                writeAutopilotState({ enabled, timestamp: Date.now() });
                for (const [sid, meta] of sessionState) {
                    if (Object.prototype.hasOwnProperty.call(meta, "autopilotEnabled")) {
                        delete meta.autopilotEnabled;
                        sessionState.set(sid, meta);
                    }
                }
                log("info", `Autopilot ${enabled ? "enabled" : "disabled"} via tool (global)`);
                return `Autopilot ${enabled ? "enabled" : "disabled"}.`;
            }
        },
    });
}