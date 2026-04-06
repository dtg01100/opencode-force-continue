import { sessionState } from "./state.js";
import { metrics } from "./metrics.js";
import { resolveConfig } from "./config.js";
import { getAutopilotEnabled, getAutopilotMaxAttempts } from "./autopilot.js";
import {
    createCompletionSignalTool,
    createStatusReportTool,
    createRequestGuidanceTool,
    createPauseAutoContinueTool,
    createHealthCheckTool,
    createSetAutopilotTool,
} from "./tools/index.js";
import {
    createChatMessageHandler,
    createSystemTransformHandler,
    createMessagesTransformHandler,
    createToolExecuteBeforeHandler,
    createToolExecuteAfterHandler,
    createFileEventsHandler,
    createSessionEventsHandler,
    createSessionCompactingHandler,
} from "./handlers/index.js";
import { createValidateTool } from "./tools/validate.js";

export { sessionState, updateLastSeen, readState, isTaskDone, isSubagentSession } from "./state.js";
export { createMetricsTracker } from "./metrics.js";
export { resolveConfig, DEFAULT_CONFIG } from "./config.js";
export { createFileStore, createHybridStore } from "./persistence.js";
export { getAutopilotEnabled, getAutopilotMaxAttempts } from "./autopilot.js";

export const createContinuePlugin = (options = {}) => {
    const config = { ...resolveConfig(), ...options };

    return async (ctx) => {
        const { client } = ctx;
        const logger = ctx?.logger ?? client?.logger ?? console;

        const log = (level, message, extra = {}) => {
            if (client?.app?.log) {
                client.app.log({ service: "force-continue", level, message, extra }).catch(() => {});
            }
            if (config.logToStdout && logger && typeof logger[level] === "function") {
                logger[level](message, extra);
            }
        };

        const returnObj = {};

        const validateTool = createValidateTool(client, config, logger);

        returnObj.tool = {
            completionSignal: createCompletionSignalTool(ctx, config),
            validate: validateTool,
            statusReport: createStatusReportTool(config, log),
            requestGuidance: createRequestGuidanceTool(ctx, config, client, log),
            pauseAutoContinue: createPauseAutoContinueTool(config, log),
            healthCheck: createHealthCheckTool(config, metrics),
            setAutopilot: createSetAutopilotTool(config, log),
        };

        returnObj.validate = validateTool.execute;

        returnObj["chat.message"] = createChatMessageHandler();

        returnObj["experimental.chat.system.transform"] = createSystemTransformHandler(config);

        returnObj["experimental.chat.messages.transform"] = createMessagesTransformHandler();

        returnObj["tool.execute.before"] = createToolExecuteBeforeHandler(config, log);

        returnObj["tool.execute.after"] = createToolExecuteAfterHandler(config, log);

        returnObj.event = createFileEventsHandler(config);
        const sessionEventsHandler = createSessionEventsHandler(ctx, config, client, metrics, log);
        const originalEventHandler = returnObj.event;
        returnObj.event = async ({ event }) => {
            try {
                await originalEventHandler({ event });
            } catch (e) {
                log("error", "File events handler error", { error: e?.message });
            }
            try {
                await sessionEventsHandler({ event });
            } catch (e) {
                log("error", "Session events handler error", { error: e?.message });
            }
        };

        returnObj["experimental.session.compacting"] = createSessionCompactingHandler(config);

        return returnObj;
    };
};

export const id = "force-continue";

export const ContinuePlugin = createContinuePlugin();

export default { id, server: ContinuePlugin };