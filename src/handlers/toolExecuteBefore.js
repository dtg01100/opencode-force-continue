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
    // Fork bomb pattern — matches :(){ :|:& }; and variants with whitespace
    /:.*\s*\{\s*:\|:.*&?\s*\}\s*;?/,
    /\bcat\b.*>\s*\/dev\/sd/,               // cat with redirect to disk
    /\bcp\b.*>\s*\/dev\/sd/,                // cp with redirect to disk
    /\bshred\b/,                            // shred command
    /\b:>\s*/,                              // :> (hollow file)
];

export function createToolExecuteBeforeHandler(config, log) {
    return async (input = {}, output) => {
        const sessionID = input?.sessionID;
        if (!sessionID) return;

        if (!Array.isArray(config.ignoreTools)) config.ignoreTools = [];
        if (config.ignoreTools.includes(input.tool)) return;

        if (input.tool === "bash") {
            // Args are on the output parameter per SDK type: output: { args: any }
            const cmd = output?.args?.command || "";
            if (typeof cmd !== 'string') return;

            // Check against regex patterns first. We only catch errors from the
            // pattern.test call itself (in case a regex is malformed). If a
            // pattern matches the command we must throw to allow callers/tests to
            // observe the blocking behavior — do NOT swallow the thrown error.
            for (const pattern of DANGEROUS_PATTERNS) {
                let matched = false;
                try {
                    matched = pattern.test(cmd);
                } catch (e) {
                    // Log the regex testing error and continue to the next pattern
                    log("error", "Error testing dangerous pattern", { error: e?.message, pattern: pattern.toString() });
                    continue;
                }

                if (matched) {
                    const meta = sessionState.get(sessionID) || {};
                    meta.errorCount = (meta.errorCount || 0) + 1;
                    sessionState.set(sessionID, meta);
                    log("warn", "Dangerous command blocked", { sessionID, command: cmd.replace(/\n/g, "\\n"), pattern: pattern.toString() });
                    // Throw so the caller/test sees the rejection
                    throw new Error(`Dangerous command blocked by force-continue plugin: ${cmd.substring(0, 100)}`);
                }
            }
            
            // Also check legacy string patterns from config for backwards compatibility
            if (Array.isArray(config.dangerousCommands)) {
                for (const dangerous of config.dangerousCommands) {
                    if (typeof dangerous === 'string' && dangerous.length > 0 && cmd.includes(dangerous)) {
                        const meta = sessionState.get(sessionID) || {};
                        meta.errorCount = (meta.errorCount || 0) + 1;
                        sessionState.set(sessionID, meta);
                        log("warn", "Dangerous command blocked (legacy)", { sessionID, command: cmd.replace(/\n/g, "\\n") });
                        // Throw so the caller/test sees the rejection
                        throw new Error(`Dangerous command blocked by force-continue plugin: ${cmd.substring(0, 100)}`);
                    }
                }
            }
        }
    };
}
