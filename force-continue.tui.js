import { sessionState, setNextSessionAutopilotEnabled, peekNextSessionAutopilotEnabled } from "./src/state.js";
import { setAutopilotEnabled, readAutopilotState } from "./src/autopilot.js";
import { resolveConfig } from "./src/config.js";

export const id = "force-continue";

let disposeCommands = [];
let callbackRegistrationSupported = false;

export const tui = async (api, options, meta) => {
    // Cleanup previous registrations
    for (const dispose of disposeCommands) {
        if (typeof dispose === "function") dispose();
    }
    disposeCommands = [];
    callbackRegistrationSupported = false;

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
        const sessionMeta = sessionID ? sessionState.get(sessionID) : null;
        const hasSessionOverride = sessionMeta && Object.prototype.hasOwnProperty.call(sessionMeta, "autopilotEnabled");
        const globalState = readAutopilotState();
        const globalEnabled = globalState.timestamp !== null ? globalState.enabled : resolveConfig().autopilotEnabled;
        const nextSessionEnabled = peekNextSessionAutopilotEnabled();
        const enabled = hasSessionOverride
            ? sessionMeta.autopilotEnabled
            : (sessionID ? globalEnabled : (nextSessionEnabled ?? globalEnabled));
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
                    const newEnabled = !state.enabled;
                    if (!sessionID) {
                        setNextSessionAutopilotEnabled(newEnabled);
                        showToast({
                            message: `[force-continue] ${newEnabled ? "Autopilot enabled for next session" : "Autopilot disabled for next session"}`,
                            variant: newEnabled ? "warning" : "info",
                        });
                    } else {
                        setAutopilotEnabled(sessionID, newEnabled);
                        showToast({
                            message: newEnabled ? "Autopilot enabled" : "Autopilot disabled",
                            variant: newEnabled ? "warning" : "info",
                        });
                    }

                    // If callback registration is not supported, re-register static
                    // commands so the UI can refresh the command list.
                    if (!callbackRegistrationSupported) {
                        for (const dispose of disposeCommands) {
                            if (typeof dispose === "function") dispose();
                        }
                        disposeCommands = [];
                        registerCommands(getCommands);
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
            callbackRegistrationSupported = true;
            if (typeof dispose === "function") disposeCommands.push(dispose);
        } catch (error) {
            callbackRegistrationSupported = false;
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
