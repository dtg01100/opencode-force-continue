import { tool } from "@opencode-ai/plugin";
import { readState } from "../state.js";
import { readAutopilotState } from "../autopilot.js";

export function createHealthCheckTool(config, metricsTracker) {
    return tool({
        description: "Check the health and status of the force-continue plugin. Returns metrics, session counts, autopilot status, and configuration.",
        args: {
            detail: tool.schema.string().optional().describe("Level of detail: 'summary' (default), 'sessions', or 'full'."),
        },
        execute: async ({ detail = "summary" }) => {
            const summary = metricsTracker.getSummary();
            const autopilotState = readAutopilotState();
            if (detail === "summary") {
                return `Plugin health: ${summary.totalSessions} sessions, ${summary.totalContinuations} continuations, ${summary.avgContinuationsPerSession} avg/session, ${summary.loopDetectionRate} loop rate, autopilot ${autopilotState.enabled ? "enabled" : "disabled"}`;
            }
            if (detail === "sessions") {
                const sessions = readState().sessions;
                const activeSessions = Object.keys(sessions).length;
                return `Active sessions: ${activeSessions}. Autopilot: ${autopilotState.enabled ? "enabled" : "disabled"} (global). Metrics: ${JSON.stringify(summary, null, 2)}`;
            }
            return JSON.stringify({ metrics: summary, autopilot: autopilotState, config: { maxContinuations: config.maxContinuations, escalationThreshold: config.escalationThreshold, autoContinueEnabled: config.autoContinueEnabled, autopilotEnabled: config.autopilotEnabled, autopilotMaxAttempts: config.autopilotMaxAttempts }, sessions: readState().sessions }, null, 2);
        },
    });
}