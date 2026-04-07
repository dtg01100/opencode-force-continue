export { createContinuePlugin, id, sessionState, updateLastSeen, readState, isTaskDone, isSubagentSession, createMetricsTracker, resetMetrics, resolveConfig, DEFAULT_CONFIG, createFileStore, createHybridStore, getAutopilotEnabled, getAutopilotMaxAttempts, resetAutopilotState, setAutopilotEnabled, readAutopilotState, writeAutopilotState } from "./src/plugin.js";

import { createContinuePlugin, id } from "./src/plugin.js";
import { tui } from "./force-continue.tui.js";

const ContinuePlugin = createContinuePlugin();

export { tui };

export default { id, server: ContinuePlugin, tui };