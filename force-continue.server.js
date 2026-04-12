export { createContinuePlugin, ContinuePlugin, id, sessionState, updateLastSeen, readState, isTaskDone, isSubagentSession, createMetricsTracker, resetMetrics, resolveConfig, DEFAULT_CONFIG, createFileStore, createHybridStore, getAutopilotEnabled, getAutopilotMaxAttempts, resetAutopilotState, setAutopilotEnabled, readAutopilotState, writeAutopilotState, cleanupExpiredSessions, setSessionTtl, getSessionTtl, startPeriodicCleanup, stopPeriodicCleanup, getActiveSessionCount } from "./src/plugin.js";

import { ContinuePlugin, createContinuePlugin, id } from "./src/plugin.js";

export default { id, server: ContinuePlugin };
