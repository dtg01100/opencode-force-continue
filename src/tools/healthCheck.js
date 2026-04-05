import { tool } from "@opencode-ai/plugin";
import { sessionState } from "../state.js";
import { metrics } from "../metrics.js";

export function createHealthCheckTool(config, metricsTracker) {
    return tool({
        description: "Check the health and status of the force-continue plugin. Returns metrics, session counts, and configuration.",
        args: {
            detail: tool.schema.string().optional().describe("Level of detail: 'summary' (default), 'sessions', or 'full'."),
        },
        execute: async ({ detail = "summary" }) => {
            const summary = metricsTracker.getSummary();
            if (detail === "summary") {
                return `Plugin health: ${summary.totalSessions} sessions, ${summary.totalContinuations} continuations, ${summary.avgContinuationsPerSession} avg/session, ${summary.loopDetectionRate} loop rate`;
            }
            if (detail === "sessions") {
                const sessions = readState().sessions;
                const activeSessions = Object.keys(sessions).length;
                return `Active sessions: ${activeSessions}. Metrics: ${JSON.stringify(summary, null, 2)}`;
            }
            return JSON.stringify({ metrics: summary, config: { maxContinuations: config.maxContinuations, escalationThreshold: config.escalationThreshold, autoContinueEnabled: config.autoContinueEnabled }, sessions: readState().sessions }, null, 2);
        },
    });
}

function readState() {
    const sessions = {};
    for (const [sessionID, meta] of sessionState.entries()) {
        const copy = Object.assign({}, meta);
        if (copy.filesModified instanceof Set) {
            copy.filesModified = Array.from(copy.filesModified);
        }
        sessions[sessionID] = copy;
    }
    return { sessions };
}