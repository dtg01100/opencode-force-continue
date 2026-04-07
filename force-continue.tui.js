import { setAutopilotEnabled, getAutopilotEnabled as getSessionAutopilotEnabled } from "./src/state.js";
import { getAutopilotEnabled as getGlobalAutopilotEnabled, readAutopilotState, writeAutopilotState } from "./src/autopilot.js";

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
        // Check session-level state first, fall back to global file store
        let enabled = null;
        if (sessionID) {
            enabled = getSessionAutopilotEnabled(sessionID);
        }
        // Only fall back to global state if session has no explicit setting (null)
        if (enabled === null) {
            const globalState = readAutopilotState();
            enabled = globalState.enabled;
        }
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
                    // Toggle session-level autopilot if session exists, otherwise toggle global
                    if (sessionID) {
                        const current = getSessionAutopilotEnabled(sessionID);
                        const newEnabled = !current;
                        setAutopilotEnabled(sessionID, newEnabled);
                        writeAutopilotState({ enabled: newEnabled, timestamp: Date.now() });
                    } else {
                        const globalState = readAutopilotState();
                        const current = globalState.enabled;
                        const newEnabled = !current;
                        writeAutopilotState({ enabled: newEnabled, timestamp: Date.now() });
                    }
                    showToast({
                        message: (sessionID ? getSessionAutopilotEnabled(sessionID) : readAutopilotState().enabled) ? "Autopilot enabled" : "Autopilot disabled",
                        variant: (sessionID ? getSessionAutopilotEnabled(sessionID) : readAutopilotState().enabled) ? "warning" : "info",
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
