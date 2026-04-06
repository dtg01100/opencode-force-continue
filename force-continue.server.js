export { createContinuePlugin, id, sessionState, updateLastSeen, readState, isTaskDone, isSubagentSession, createMetricsTracker, resolveConfig, DEFAULT_CONFIG, createFileStore, createHybridStore, getAutopilotEnabled, getAutopilotMaxAttempts } from "./src/plugin.js";

import { createContinuePlugin, id } from "./src/plugin.js";
import { tuiPlugin } from "./force-continue.tui.js";

const tuiFactory = (options = {}) => {
    return async (ctx) => {
        if (ctx?.api?.command) {
            await tuiPlugin(ctx);
        }
        return createContinuePlugin(options)(ctx);
    };
};

export { tuiPlugin as tui };

export default { id, server: createContinuePlugin, tui: tuiFactory };