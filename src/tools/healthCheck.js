import { tool } from "@opencode-ai/plugin";
import { readState } from "../state.js";
import { readAutopilotState } from "../autopilot.js";

export function createHealthCheckTool(config = {}, metricsTracker) {
    return tool({
        description: "Check the health and status of the force-continue plugin. Returns metrics, session counts, autopilot status, and configuration.",
        args: {
            detail: tool.schema.string().optional().describe("Level of detail: 'summary' (default), 'sessions', or 'full'."),
        },
        execute: async ({ detail = "summary" }) => {
            const summary = (metricsTracker && typeof metricsTracker.getSummary === 'function') ? metricsTracker.getSummary() : { totalSessions: 0, totalContinuations: 0, avgContinuationsPerSession: 0, loopDetectionRate: 0 };
            const autopilotState = (() => { try { return readAutopilotState(); } catch (e) { return { enabled: false, timestamp: null }; } })();
            if (detail === "summary") {
                return `Plugin health: ${summary.totalSessions || 0} sessions, ${summary.totalContinuations || 0} continuations, ${summary.avgContinuationsPerSession || 0} avg/session, ${summary.loopDetectionRate || 0} loop rate, autopilot ${autopilotState.enabled ? "enabled" : "disabled"}`;
            }
            if (detail === "sessions") {
                const state = readState();
                const sessions = state && state.sessions ? state.sessions : {};
                const activeSessions = Object.keys(sessions).length;
                return `Active sessions: ${activeSessions}. Autopilot: ${autopilotState.enabled ? "enabled" : "disabled"} (global). Metrics: ${JSON.stringify(summary, null, 2)}`;
            }
            return JSON.stringify({ metrics: summary, autopilot: autopilotState, config: { maxContinuations: config?.maxContinuations, escalationThreshold: config?.escalationThreshold, autoContinueEnabled: config?.autoContinueEnabled, autopilotEnabled: config?.autopilotEnabled, autopilotMaxAttempts: config?.autopilotMaxAttempts }, sessions: (readState && readState().sessions) || {} }, null, 2);
        },
    });
}
