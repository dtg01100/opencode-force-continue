import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const NEXT_SESSION_FLAG = join(tmpdir(), "opencode-force-continue-next");

function getFlagPath(sessionID) {
    return join(tmpdir(), `opencode-force-continue-${sessionID}`);
}

function isEnabled(sessionID) {
    if (!sessionID) return false;
    return existsSync(getFlagPath(sessionID));
}

function setEnabled(sessionID, enabled) {
    if (!sessionID) return;
    const flagPath = getFlagPath(sessionID);
    if (enabled) {
        writeFileSync(flagPath, "");
    } else {
        try { unlinkSync(flagPath); } catch {}
    }
}

function isNextSessionEnabled() {
    return existsSync(NEXT_SESSION_FLAG);
}

function setNextSessionEnabled(enabled) {
    if (enabled) {
        writeFileSync(NEXT_SESSION_FLAG, "");
    } else {
        try { unlinkSync(NEXT_SESSION_FLAG); } catch {}
    }
}

/** @type {import("@opencode-ai/plugin/tui").TuiPlugin} */
async function tuiPlugin(api) {
    function getSessionID() {
        const route = api.route.current;
        if (route.name === "session") {
            return route.params.sessionID;
        }
        return null;
    }

    api.slots.register({
        id: "force-continue-status",
        slot: "sidebar_footer",
        render() {
            const sessionID = getSessionID();
            if (sessionID) {
                return isEnabled(sessionID) ? "⚡ Force Continue" : null;
            }
            return isNextSessionEnabled() ? "⚡ Force Continue (next)" : null;
        },
    });

    api.slots.register({
        id: "force-continue-status",
        slot: "sidebar_footer",
        render() {
            const sessionID = getSessionID();
            if (sessionID) {
                return isEnabled(sessionID) ? "⚡ Force Continue" : null;
            }
            return isNextSessionEnabled() ? "⚡ Force Continue (next)" : null;
        },
    });

    api.command.register(() => {
        const sessionID = getSessionID();

        if (sessionID) {
            const s = isEnabled(sessionID);
            return [
                {
                    title: `Force Continue: ${s ? "ON" : "OFF"}`,
                    value: "force-continue",
                    description: "Toggle force-continue for this session",
                    category: "Plugins",
                    slash: {
                        name: "force-continue",
                        aliases: ["fc"],
                    },
                    onSelect() {
                        const currentState = isEnabled(sessionID);
                        const newState = !currentState;
                        setEnabled(sessionID, newState);
                        api.ui.toast({
                            title: "Force Continue",
                            message: newState
                                ? "Force continue enabled for this session"
                                : "Force continue disabled for this session",
                            variant: newState ? "success" : "info",
                        });
                    },
                },
            ];
        }

        const nextEnabled = isNextSessionEnabled();
        return [
            {
                title: `Force Continue: ${nextEnabled ? "ON" : "OFF"}`,
                value: "force-continue-next",
                description: nextEnabled
                    ? "Force continue is enabled for the next new session"
                    : "Enable force-continue for the next new session",
                category: "Plugins",
                slash: {
                    name: "force-continue",
                    aliases: ["fc"],
                },
                onSelect() {
                    const currentState = isNextSessionEnabled();
                    const newState = !currentState;
                    setNextSessionEnabled(newState);
                    api.ui.toast({
                        title: "Force Continue",
                        message: newState
                            ? "Force continue enabled for the next session"
                            : "Force continue disabled for the next session",
                        variant: newState ? "success" : "info",
                    });
                },
            },
        ];
    });
}

export default {
    id: "force-continue",
    tui: tuiPlugin
};
