import { sessionState } from "../state.js";

/**
 * Pre-built dangerous command patterns for common destructive operations.
 * Uses regex for more precise matching with word boundaries.
 */
const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+[\/~]/,                    // rm -rf / or rm -rf ~
    /\brm\s+-rf\s+\/\*/,                    // rm -rf /*
    /\bmkfs\b/,                             // mkfs (any form)
    /\bdd\b.*\bif\b.*\/dev\/zero/,          // dd with /dev/zero input
    /\bdd\b.*\bof\b.*\/dev\/sd/,            // dd writing to disk devices
    />\s*\/dev\/sd[a-z]/,                   // Output redirection to disk devices
    />\s*\/dev\/nvme/,                      // Output redirection to NVMe devices
    /:()\s*\{\s*:\|:\s*&\s*\}\s*;/,        // Fork bomb pattern
    /\bcat\b.*>\s*\/dev\/sd/,               // cat with redirect to disk
    /\bcp\b.*>\s*\/dev\/sd/,                // cp with redirect to disk
    /\bshred\b/,                            // shred command
    /\b:>\s*/,                              // :> (hollow file)
];

export function createToolExecuteBeforeHandler(config, log) {
    return async (input, output) => {
        const sessionID = input?.sessionID;
        if (!sessionID) return;

        if (config.ignoreTools.includes(input.tool)) return;

        if (input.tool === "bash") {
            const cmd = input.args?.command || "";
            
            // Check against regex patterns first
            for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(cmd)) {
                    const meta = sessionState.get(sessionID) || {};
                    meta.errorCount = (meta.errorCount || 0) + 1;
                    sessionState.set(sessionID, meta);
                    log("warn", "Dangerous command blocked", { sessionID, command: cmd.replace(/\n/g, "\\n"), pattern: pattern.toString() });
                    throw new Error(`Dangerous command blocked by force-continue plugin: ${cmd.substring(0, 100)}`);
                }
            }
            
            // Also check legacy string patterns from config for backwards compatibility
            for (const dangerous of config.dangerousCommands) {
                if (cmd.includes(dangerous)) {
                    const meta = sessionState.get(sessionID) || {};
                    meta.errorCount = (meta.errorCount || 0) + 1;
                    sessionState.set(sessionID, meta);
                    log("warn", "Dangerous command blocked (legacy)", { sessionID, command: cmd.replace(/\n/g, "\\n") });
                    throw new Error(`Dangerous command blocked by force-continue plugin: ${cmd.substring(0, 100)}`);
                }
            }
        }
    };
}