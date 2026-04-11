function createMetricsTracker() {
    const metrics = {
        totalSessions: 0,
        totalContinuations: 0,
        totalLoopDetections: 0,
        totalToolLoopDetections: 0,
        totalCircuitBreakerTrips: 0,
        totalEscalations: 0,
        totalCompletions: 0,
        totalBlocks: 0,
        totalInterrupts: 0,
        totalIdleEvents: 0,
        totalIdleSkippedComplete: 0,
        totalIdleSkippedPaused: 0,
        totalIdleSkippedGuidance: 0,
        totalIdleSkippedBabysitter: 0,
        totalIdleSkippedDisabled: 0,
        totalIdleSkippedSubagent: 0,
        totalIdleSkippedAwaiting: 0,
        totalMessagesEmpty: 0,
        totalMessagesErrors: 0,
        totalLastMsgNotAssistant: 0,
        totalAutopilotAttempts: 0,
        totalAutopilotFallbacks: 0,
        totalAutopilotGuidanceResolutions: 0,
        totalAutopilotGuidanceFallbacks: 0,
        promptContinue: 0,
        promptEscalation: 0,
        promptLoopBreak: 0,
        promptCompletionNudge: 0,
        promptErrors: 0,
        sessionContinuations: {},
        sessionErrors: {},
    };

    return {
        record(sessionID, event, extra = {}) {
            switch (event) {
                case "session.created": metrics.totalSessions++; break;
                case "continuation": metrics.totalContinuations++; metrics.sessionContinuations[sessionID] = (metrics.sessionContinuations[sessionID] || 0) + 1; break;
                case "loop.detected": metrics.totalLoopDetections++; break;
                case "tool.loop.detected": metrics.totalToolLoopDetections++; break;
                case "circuit.breaker.trip": metrics.totalCircuitBreakerTrips++; break;
                case "escalation": metrics.totalEscalations++; break;
                case "completion": metrics.totalCompletions++; break;
                case "blocked": metrics.totalBlocks++; break;
                case "interrupted": metrics.totalInterrupts++; break;
                case "error": metrics.sessionErrors[sessionID] = (metrics.sessionErrors[sessionID] || 0) + 1; break;
                case "idle.event": metrics.totalIdleEvents++; break;
                case "idle.skipped.complete": metrics.totalIdleSkippedComplete++; break;
                case "idle.skipped.paused": metrics.totalIdleSkippedPaused++; break;
                case "idle.skipped.guidance": metrics.totalIdleSkippedGuidance++; break;
                case "idle.skipped.babysitter": metrics.totalIdleSkippedBabysitter++; break;
                case "idle.skipped.disabled": metrics.totalIdleSkippedDisabled++; break;
                case "idle.skipped.subagent": metrics.totalIdleSkippedSubagent++; break;
                case "idle.skipped.awaiting.answer": metrics.totalIdleSkippedAwaiting++; break;
                case "messages.empty": metrics.totalMessagesEmpty++; break;
                case "messages.error": metrics.totalMessagesErrors++; break;
                case "last.msg.not.assistant": metrics.totalLastMsgNotAssistant++; break;
                case "last.msg.missing.role": metrics.totalLastMsgNotAssistant++; break;
                case "prompt.continue": metrics.promptContinue++; break;
                case "prompt.escalation": metrics.promptEscalation++; break;
                case "prompt.loop.break": metrics.promptLoopBreak++; break;
                case "prompt.completion.nudge": metrics.promptCompletionNudge++; break;
                case "prompt.error": metrics.promptErrors++; break;
                case "autopilot.attempt": metrics.totalAutopilotAttempts++; break;
                case "autopilot.fallback": metrics.totalAutopilotFallbacks++; break;
                case "autopilot.fallback.question": metrics.totalAutopilotFallbacks++; break;
                case "autopilot.question.attempt": metrics.totalAutopilotAttempts++; break;
                case "autopilot.guidance.resolution": metrics.totalAutopilotGuidanceResolutions++; break;
                case "autopilot.fallback.guidance": metrics.totalAutopilotGuidanceFallbacks++; break;
                case "completion.with.unfinished.tasks": break;
            }
        },
        reset() {
            metrics.totalSessions = 0;
            metrics.totalContinuations = 0;
            metrics.totalLoopDetections = 0;
            metrics.totalToolLoopDetections = 0;
            metrics.totalCircuitBreakerTrips = 0;
            metrics.totalEscalations = 0;
            metrics.totalCompletions = 0;
            metrics.totalBlocks = 0;
            metrics.totalInterrupts = 0;
            metrics.totalIdleEvents = 0;
            metrics.totalIdleSkippedComplete = 0;
            metrics.totalIdleSkippedPaused = 0;
            metrics.totalIdleSkippedGuidance = 0;
            metrics.totalIdleSkippedBabysitter = 0;
            metrics.totalIdleSkippedDisabled = 0;
            metrics.totalIdleSkippedSubagent = 0;
            metrics.totalIdleSkippedAwaiting = 0;
            metrics.totalMessagesEmpty = 0;
            metrics.totalMessagesErrors = 0;
            metrics.totalLastMsgNotAssistant = 0;
            metrics.totalAutopilotAttempts = 0;
            metrics.totalAutopilotFallbacks = 0;
            metrics.totalAutopilotGuidanceResolutions = 0;
            metrics.totalAutopilotGuidanceFallbacks = 0;
            metrics.promptContinue = 0;
            metrics.promptEscalation = 0;
            metrics.promptLoopBreak = 0;
            metrics.promptCompletionNudge = 0;
            metrics.promptErrors = 0;
            metrics.sessionContinuations = {};
            metrics.sessionErrors = {};
        },
        getSummary() {
            const avgContinuations = metrics.totalSessions > 0 ? (metrics.totalContinuations / metrics.totalSessions).toFixed(2) : 0;
            const loopRate = metrics.totalContinuations > 0 ? (metrics.totalLoopDetections / metrics.totalContinuations * 100).toFixed(1) : 0;
            return {
                totalSessions: metrics.totalSessions,
                totalContinuations: metrics.totalContinuations,
                avgContinuationsPerSession: parseFloat(avgContinuations),
                loopDetectionCount: metrics.totalLoopDetections,
                loopDetectionRate: `${loopRate}%`,
                toolLoopDetections: metrics.totalToolLoopDetections,
                circuitBreakerTrips: metrics.totalCircuitBreakerTrips,
                escalations: metrics.totalEscalations,
                completions: metrics.totalCompletions,
                blocks: metrics.totalBlocks,
                interrupts: metrics.totalInterrupts,
                idleEvents: metrics.totalIdleEvents,
                idleSkippedComplete: metrics.totalIdleSkippedComplete,
                idleSkippedPaused: metrics.totalIdleSkippedPaused,
                idleSkippedGuidance: metrics.totalIdleSkippedGuidance,
                idleSkippedBabysitter: metrics.totalIdleSkippedBabysitter,
                idleSkippedDisabled: metrics.totalIdleSkippedDisabled,
                idleSkippedSubagent: metrics.totalIdleSkippedSubagent,
                idleSkippedAwaiting: metrics.totalIdleSkippedAwaiting,
                messagesEmpty: metrics.totalMessagesEmpty,
                messagesErrors: metrics.totalMessagesErrors,
                lastMsgNotAssistant: metrics.totalLastMsgNotAssistant,
                totalAutopilotAttempts: metrics.totalAutopilotAttempts,
                totalAutopilotFallbacks: metrics.totalAutopilotFallbacks,
                totalAutopilotGuidanceResolutions: metrics.totalAutopilotGuidanceResolutions,
                totalAutopilotGuidanceFallbacks: metrics.totalAutopilotGuidanceFallbacks,
                promptContinue: metrics.promptContinue,
                promptEscalation: metrics.promptEscalation,
                promptLoopBreak: metrics.promptLoopBreak,
                promptCompletionNudge: metrics.promptCompletionNudge,
                promptErrors: metrics.promptErrors,
                sessionsWithErrors: Object.entries(metrics.sessionErrors).filter(([, c]) => c > 0).length,
            };
        },
    };
}

export const metrics = createMetricsTracker();
export { createMetricsTracker };

export function resetMetrics() {
    metrics.reset();
}
