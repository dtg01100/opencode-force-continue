import { sessionState } from "../state.js";
import { metrics } from "../metrics.js";

export function createToolExecuteAfterHandler(config, log) {
    return async (input) => {
        const sessionID = input?.sessionID;
        if (!sessionID) return;
        if (config.ignoreTools.includes(input.tool)) return;

        const meta = sessionState.get(sessionID) || {};
        meta.toolCallHistory = meta.toolCallHistory || [];
        meta.toolCallHistory.push({ tool: input.tool, args: input.args, timestamp: Date.now() });
        if (meta.toolCallHistory.length > 20) meta.toolCallHistory = meta.toolCallHistory.slice(-20);

        if (config.enableFileTracking && (input.tool === "edit" || input.tool === "write")) {
            meta.filesModified = meta.filesModified || new Set();
            if (input.args?.filePath) meta.filesModified.add(input.args.filePath);
        }

        if (config.enableToolLoopDetection) {
            const history = meta.toolCallHistory;
            if (history.length >= 4) {
                const recent = history.slice(-4);
                const allSame = recent.every(t => t.tool === recent[0].tool && JSON.stringify(t.args) === JSON.stringify(recent[0].args));
                if (allSame) {
                    metrics.record(sessionID, "tool.loop.detected");
                    meta.toolLoopDetected = true;
                    log("warn", "Tool call loop detected", { sessionID, tool: recent[0].tool });
                }
            }
        }

        sessionState.set(sessionID, meta);
    };
}