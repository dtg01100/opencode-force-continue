import { readAutopilotState, writeAutopilotState } from "./src/autopilot.js";

export const id = "force-continue";

export const tui = async (api, options, meta) => {
    const showToast = (props) => {
        if (api.ui?.toast) {
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
                },
            },
        ];
    };

    const registerCommands = (commandsProvider) => {
        if (typeof api.command?.register !== "function") {
            return;
        }

        try {
            api.command.register(commandsProvider);
        } catch (error) {
            const commands = commandsProvider();
            if (Array.isArray(commands)) {
                api.command.register(commands);
            } else {
                throw error;
            }
        }
    };

    registerCommands(getCommands);
};

export default { id, tui };
