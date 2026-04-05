import { tool } from "@opencode-ai/plugin";

export function createValidateTool(client, config, logger) {
    return tool({
        description: "Validate plugin wiring. mode='dry' for capability checks, mode='probe' to optionally send a test prompt to a sessionID.",
        args: {
            mode: tool.schema.string().optional(),
            sessionID: tool.schema.string().optional(),
            promptText: tool.schema.string().optional(),
        },
        execute: async ({ mode = 'dry', sessionID, promptText } = {}) => {
            const result = { ok: true, checks: [] };
            try {
                const hasClient = !!client;
                const hasSession = !!(client && client.session);
                const hasMessages = hasSession && typeof client.session.messages === 'function';
                const hasPrompt = hasSession && typeof client.session.promptAsync === 'function';
                const hooksPresent = !!client?.hooks;

                result.checks.push({ name: 'client', ok: hasClient });
                result.checks.push({ name: 'client.session', ok: hasSession });
                result.checks.push({ name: 'client.session.messages', ok: hasMessages });
                result.checks.push({ name: 'client.session.promptAsync', ok: hasPrompt });
                result.checks.push({ name: 'ctx.hooks', ok: hooksPresent });

                if (!hasClient) result.ok = false;

                if (mode === 'probe') {
                    if (!sessionID) {
                        result.ok = false;
                        result.probe = { ok: false, error: 'sessionID required for probe mode' };
                    } else if (!hasPrompt) {
                        result.ok = false;
                        result.probe = { ok: false, error: 'promptAsync not available on client.session' };
                    } else {
                        try {
                            await client.session.promptAsync({ path: { id: sessionID }, body: { parts: [{ type: 'text', text: promptText || 'Plugin validation probe' }] } });
                            result.probe = { ok: true };
                        } catch (e) {
                            result.ok = false;
                            result.probe = { ok: false, error: String(e), stack: e?.stack };
                        }
                    }
                }
            } catch (e) {
                result.ok = false;
                result.error = String(e);
            }
            if (config.logToStdout && logger && typeof logger.info === 'function') {
                logger.info('validate result', result);
            }
            return result;
        },
    });
}