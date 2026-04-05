import { sessionState } from "../state.js";

export function createToolExecuteBeforeHandler(config, log) {
    return async (input, output) => {
        const sessionID = input?.sessionID;
        if (!sessionID) return;

        if (config.ignoreTools.includes(input.tool)) return;

        if (input.tool === "bash") {
            const cmd = input.args?.command || "";
            for (const dangerous of config.dangerousCommands) {
                if (cmd.includes(dangerous)) {
                    const meta = sessionState.get(sessionID) || {};
                    meta.errorCount = (meta.errorCount || 0) + 1;
                    sessionState.set(sessionID, meta);
                    log("warn", "Dangerous command blocked", { sessionID, command: cmd });
                    throw new Error(`Dangerous command blocked by force-continue plugin: ${cmd.substring(0, 100)}`);
                }
            }
        }
    };
}