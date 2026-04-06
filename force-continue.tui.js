import { readAutopilotState, writeAutopilotState } from "./src/autopilot.js";

export const id = "force-continue";

export const tui = async (api, options, meta) => {
    const showConfirmDialog = (props) => {
        if (api.ui?.dialog?.setSize) {
            api.ui.dialog.setSize("medium");
        }

        const renderDialog = () => api.ui.DialogConfirm(props);
        if (api.ui?.dialog?.replace) {
            api.ui.dialog.replace(renderDialog);
            return;
        }
        if (api.ui?.dialog?.open) {
            const component = renderDialog();
            if (component !== undefined) {
                api.ui.dialog.open(component);
            } else {
                api.ui.dialog.open(renderDialog);
            }
            return;
        }
        renderDialog();
    };

    const clearDialog = () => {
        if (api.ui?.dialog?.clear) {
            api.ui.dialog.clear();
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
                    // Read fresh state at interaction time to avoid stale closure
                    const current = readAutopilotState() ?? { enabled: false };
                    const newEnabled = !current.enabled;
                    if (newEnabled) {
                        showConfirmDialog({
                            title: "Enable Autopilot",
                            message: "Autopilot allows the AI to make decisions and take actions without asking for confirmation. This may result in unintended changes. Are you sure?",
                            onConfirm: () => {
                                writeAutopilotState({ enabled: true, timestamp: Date.now() });
                                clearDialog();
                                api.ui.toast({
                                    message: "Autopilot enabled",
                                    variant: "warning",
                                });
                            },
                            onCancel: () => {
                                clearDialog();
                            },
                        });
                    } else {
                        writeAutopilotState({ enabled: false, timestamp: Date.now() });
                        api.ui.toast({
                            message: "Autopilot disabled",
                            variant: "info",
                        });
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
