import { tool } from "@opencode-ai/plugin";
import { sessionState } from "../state.js";
import { metrics } from "../metrics.js";
import { buildAutopilotPrompt, getAutopilotEnabled, getAutopilotMaxAttempts } from "../autopilot.js";

export function createRequestGuidanceTool(ctx, config, client, log) {
    return tool({
        description: "Use this tool when you are uncertain about how to proceed and need clarification from the user before continuing.",
        args: {
            question: tool.schema.string().describe("The specific question or clarification you need."),
            context: tool.schema.string().optional().describe("Additional context about why you're asking."),
            options: tool.schema.string().optional().describe("Possible options you're considering (if any)."),
        },
        execute: async ({ question, context, options }, toolCtx) => {
            const sessionID = toolCtx?.sessionID;
            if (sessionID) {
                const meta = sessionState.get(sessionID) || {};
                meta.awaitingGuidance = { question, context, options, timestamp: Date.now() };
                meta.autopilotAttempts = meta.autopilotAttempts || 0;
                sessionState.set(sessionID, meta);
                log("info", "Guidance requested", { sessionID, question });

                const autopilotEnabled = getAutopilotEnabled(config);
                if (autopilotEnabled) {
                    const autopilotMaxAttempts = getAutopilotMaxAttempts(config);
                    if (meta.autopilotAttempts >= autopilotMaxAttempts) {
                        log("info", "Autopilot max attempts reached, waiting for user", { sessionID });
                        metrics.record(sessionID, "autopilot.fallback");
                        return `Guidance request recorded:\n\nQ: ${question}${context ? `\nContext: ${context}` : ""}${options ? `\nOptions: ${options}` : ""}\n\nAutopilot limit reached. Waiting for user input.`;
                    }

                    try {
                        meta.autopilotAttempts++;
                        sessionState.set(sessionID, meta);

                        const prompt = buildAutopilotPrompt(question, context, options);
                        await client.session.promptAsync({
                            path: { id: sessionID },
                            body: { parts: [{ type: "text", text: prompt }] }
                        });

                        log("info", "Autopilot answer generated", { sessionID, attempts: meta.autopilotAttempts });
                        metrics.record(sessionID, "autopilot.attempt");
                        return "Autopilot resolved guidance question.";
                    } catch (e) {
                        log("error", "Autopilot failed", { error: e?.stack ?? e });
                        meta.autopilotAttempts--;
                        sessionState.set(sessionID, meta);
                        metrics.record(sessionID, "autopilot.fallback");
                    }
                }
            }

            return `Guidance request recorded:\n\nQ: ${question}${context ? `\nContext: ${context}` : ""}${options ? `\nOptions: ${options}` : ""}\n\nAuto-continue paused until user responds.`;
        },
    });
}