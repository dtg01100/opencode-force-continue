import { sessionState } from "./src/state.js";
import { setAutopilotEnabled, readAutopilotState } from "./src/autopilot.js";

export const id = "force-continue";

let disposeCommands = [];
let providerRegistered = false;

export const tui = async (api, options, meta) => {
    // Cleanup previous registrations
    for (const dispose of disposeCommands) {
        if (typeof dispose === "function") dispose();
    }
    disposeCommands = [];
    providerRegistered = false;

    const showToast = (props) => {
        if (typeof api.ui?.toast === "function") {
            api.ui.toast(props);
        }
    };

    const getCurrentSessionID = () => {
        const route = api?.route?.current;
        if (route?.name === "session" && route?.params?.sessionID) {
            return route.params.sessionID;
        }
        return null;
    };

    const getCommands = () => {
        const sessionID = getCurrentSessionID();
        // Read global file as the source of truth for the toast.
        // For the title/description, check session-level first (set by the plugin's
        // setAutopilot tool or direct state manipulation), falling back to global.
        const globalEnabled = readAutopilotState().enabled;
        const sessionMeta = sessionID ? sessionState.get(sessionID) : null;
        const hasSessionOverride = sessionMeta && Object.prototype.hasOwnProperty.call(sessionMeta, "autopilotEnabled");
        const enabled = hasSessionOverride ? sessionMeta.autopilotEnabled : globalEnabled;
        const state = { enabled };
        return [
            {
                title: state.enabled ? "Disable Autopilot" : "Enable Autopilot",
                value: "force-continue:autopilot",
                description: state.enabled
                    ? "Autopilot is ON - AI makes decisions autonomously"
                    : "Autopilot is OFF - AI asks for guidance",
                category: "Force Continue",
                onSelect: () => {
                    const sessionID = getCurrentSessionID();
                    // setAutopilotEnabled handles session-level AND global writes atomically,
                    // and also clears stale session overrides when globally toggling.
                    setAutopilotEnabled(sessionID, !state.enabled);

                    // Read back from the shared global file (source of truth across processes).
                    const newEnabled = readAutopilotState().enabled;
                    showToast({
                        message: newEnabled ? "Autopilot enabled" : "Autopilot disabled",
                        variant: newEnabled ? "warning" : "info",
                    });

                    // If the API supports a commands provider callback, it will read
                    // fresh state each time. Only re-register commands when provider
                    // support is NOT available (older UIs may only accept a static array).
                    if (!providerRegistered) {
                        try {
                            for (const dispose of disposeCommands) {
                                if (typeof dispose === "function") dispose();
                            }
                        } finally {
                            disposeCommands = [];
                            registerCommands(getCommands);
                        }
                    }
                },

            },
        ];
    };

    const registerCommands = (commandsProvider) => {
        if (typeof api.command?.register !== "function") {
            return;
        }

        try {
            const dispose = api.command.register(commandsProvider);
            providerRegistered = true;
            if (typeof dispose === "function") disposeCommands.push(dispose);
        } catch (error) {
            const commands = commandsProvider();
            if (Array.isArray(commands)) {
                const dispose = api.command.register(commands);
                if (typeof dispose === "function") disposeCommands.push(dispose);
            } else {
                throw new Error(`force-continue: command registration failed — callback not supported and provider did not return an array`);
            }
        }
    };

    registerCommands(getCommands);
};

export default { id, tui };
