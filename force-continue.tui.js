import { readAutopilotState, writeAutopilotState } from "./src/autopilot.js";

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

    const getCommands = () => {
        const state = readAutopilotState() ?? { enabled: false, timestamp: null };
        return [
            {
                title: state.enabled ? "Disable Autopilot" : "Enable Autopilot",
                value: "force-continue:autopilot",
                description: state.enabled
                    ? "Autopilot is ON - AI makes decisions autonomously"
                    : "Autopilot is OFF - AI asks for guidance",
                category: "Force Continue",
                onSelect: () => {
                    const current = readAutopilotState() ?? { enabled: false };
                    const newEnabled = !current.enabled;
                    writeAutopilotState({ enabled: newEnabled, timestamp: Date.now() });
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
