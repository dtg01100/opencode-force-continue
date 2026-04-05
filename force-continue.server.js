export { createContinuePlugin, id, ContinuePlugin, sessionState, updateLastSeen, readState, isTaskDone, isSubagentSession, createMetricsTracker, resolveConfig, DEFAULT_CONFIG, createFileStore, createHybridStore, getAutopilotEnabled, getAutopilotMaxAttempts } from "./src/plugin.js";

import { createContinuePlugin, id } from "./src/plugin.js";

const ContinuePlugin = createContinuePlugin();

export default { id, server: ContinuePlugin };