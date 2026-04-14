import os from "os";
import { join } from "path";
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
import { setSessionTtl } from "./state.js";
import { syncTuiConfigFromOpencode } from "./install-config.js";

export {
    sessionState,
    updateLastSeen,
    readState,
    isTaskDone,
    isSubagentSession,
    // Note: setAutopilotEnabled is exported from autopilot.js, not state.js
    cleanupExpiredSessions,
    startPeriodicCleanup,
    stopPeriodicCleanup,
    setSessionTtl,
    getSessionTtl,
    getActiveSessionCount,
} from "./state.js";
export { createMetricsTracker, resetMetrics } from "./metrics.js";
export { resolveConfig, DEFAULT_CONFIG } from "./config.js";
export { createFileStore, createHybridStore } from "./persistence.js";
export { getAutopilotEnabled, getAutopilotMaxAttempts, resetAutopilotState, setAutopilotEnabled, readAutopilotState, writeAutopilotState } from "./autopilot.js";

// Start periodic cleanup of expired sessions (runs every hour by default)
// Uses sessionTtlMs from resolved config
// Guarded so importing the module does not pin a process open.
import { startPeriodicCleanup, stopPeriodicCleanup } from "./state.js";
let periodicCleanupStarted = false;
let tuiConfigSyncAttempted = false;

function ensurePeriodicCleanupStarted() {
    if (periodicCleanupStarted) {
        return;
    }
    periodicCleanupStarted = true;
    startPeriodicCleanup(60 * 60 * 1000, resolveConfig().sessionTtlMs);
}

function syncTuiConfigForCurrentInstall(log, ctx = {}) {
    if (tuiConfigSyncAttempted) {
        return;
    }
    tuiConfigSyncAttempted = true;

    const candidateDirs = new Set();
    const addDir = (value) => {
        if (!value || typeof value !== "string") return;
        candidateDirs.add(value);
    };

    addDir(process.env.OPENCODE_CONFIG_DIR);
    addDir(join(process.cwd(), ".opencode"));
    addDir(join(os.homedir(), ".config", "opencode"));
    if (ctx?.directory) addDir(join(ctx.directory, ".opencode"));
    if (ctx?.worktree) addDir(join(ctx.worktree, ".opencode"));

    for (const baseDir of candidateDirs) {
        try {
            const result = syncTuiConfigFromOpencode(baseDir, id);
            if (result.changed) {
                log("info", "Synced TUI plugin config from opencode.json", {
                    baseDir,
                    spec: result.spec,
                });
            }
        } catch (error) {
            log("warn", "Failed to sync TUI plugin config", {
                baseDir,
                error: error?.message ?? error,
            });
        }
    }
}

export const createContinuePlugin = (options = {}) => {
    const config = { ...resolveConfig(), ...options };
    if (process.env.VITEST && options.nudgeDelayMs === undefined && process.env.FORCE_CONTINUE_NUDGE_DELAY_MS === undefined) {
        config.nudgeDelayMs = 0;
    }
    if (options.sessionTtlMs !== undefined) {
        setSessionTtl(options.sessionTtlMs);
    }

    return async (ctx) => {
        ensurePeriodicCleanupStarted();
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

        syncTuiConfigForCurrentInstall(log, ctx);

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
