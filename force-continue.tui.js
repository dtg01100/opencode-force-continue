import { readAutopilotState, writeAutopilotState } from "./src/autopilot.js";

export const id = "force-continue";

export const tui = async (api, options, meta) => {
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
                        // DialogConfirm returns a JSX element; must use api.ui.dialog.replace to render it
                        api.ui.dialog.replace(() =>
                            api.ui.DialogConfirm({
                                title: "Enable Autopilot",
                                message: "Autopilot allows the AI to make decisions and take actions without asking for confirmation. This may result in unintended changes. Are you sure?",
                                onConfirm: () => {
                                    writeAutopilotState({ enabled: true, timestamp: Date.now() });
                                    api.ui.dialog.clear();
                                    api.ui.toast({
                                        message: "Autopilot enabled",
                                        variant: "warning",
                                    });
                                },
                                onCancel: () => {
                                    api.ui.dialog.clear();
                                },
                            })
                        );
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

    api.command.register(getCommands);
};

export default { id, tui };
