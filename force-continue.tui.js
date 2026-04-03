import { isEnabled, setEnabled, isNextSessionEnabled, setNextSessionEnabled, incrementVersion } from "./flags.js";

/** @type {import("@opencode-ai/plugin/tui").TuiPlugin} */
async function tuiPlugin(api) {
    // Import @opentui/solid terminal rendering primitives.
    // Available inside OpenCode (bundled in binary); falls back gracefully in test environments.
    let createElement, createTextNode, insertNode, setProp;
    try {
        ({ createElement, createTextNode, insertNode, setProp } = await import("@opentui/solid"));
    } catch {}

    function getSessionID() {
        const route = api.route.current;
        if (route?.name === "session") {
            return route.params?.sessionID ?? null;
        }
        return null;
    }

    function renderStatus() {
        // Read KV version to opt into reactive re-renders when state is toggled
        api.kv.get("force-continue:version", 0);

        const sessionID = getSessionID();
        let text;
        if (sessionID) {
            text = isEnabled(sessionID) ? "⚡ Force Continue" : null;
        } else {
            text = isNextSessionEnabled() ? "⚡ Force Continue (next)" : null;
        }

        if (!text || !createElement) return null;

        const el = createElement("text");
        setProp(el, "fg", api.theme.current.warning);
        setProp(el, "newline", true);
        insertNode(el, createTextNode(text));
        return el;
    }

    api.slots.register({
        slots: {
            sidebar_footer: renderStatus,
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
                        api.kv.set("force-continue:version", incrementVersion());
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
                    api.kv.set("force-continue:version", incrementVersion());
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
