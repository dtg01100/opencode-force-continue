import { readAutopilotState, writeAutopilotState } from "./src/autopilot.js";

export const id = "force-continue";

export const tuiPlugin = async (ctx) => {
    const api = ctx?.api ?? ctx;
    if (!api?.command) {
        return {};
    }

  api.command.register(() => {
  const state = readAutopilotState();
  return [
            {
                title: state.enabled ? "Disable Autopilot" : "Enable Autopilot",
                value: "force-continue:autopilot",
                description: state.enabled
                    ? "Autopilot is ON - AI makes decisions autonomously"
                    : "Autopilot is OFF - AI asks for guidance",
                category: "Force Continue",
        onSelect: () => {
          console.log('[force-continue] Autopilot command selected, current state:', state.enabled);
          const newEnabled = !state.enabled;
          console.log('[force-continue] Toggling to:', newEnabled);
          if (newEnabled) {
            console.log('[force-continue] Showing confirmation dialog');
            api.ui.DialogConfirm({
                            title: "Enable Autopilot",
                            message: "Autopilot allows the AI to make decisions and take actions without asking for confirmation. This may result in unintended changes. Are you sure?",
            onConfirm: () => {
              console.log('[force-continue] Confirmation dialog confirmed');
              writeAutopilotState({ enabled: true, timestamp: Date.now() });
                                api.ui.toast({
                                    message: "Autopilot enabled",
                                    variant: "warning",
                                });
                            },
                        });
          } else {
            console.log('[force-continue] Disabling autopilot');
            writeAutopilotState({ enabled: false, timestamp: Date.now() });
                        api.ui.toast({
                            message: "Autopilot disabled",
                            variant: "info",
                        });
                    }
                },
            },
        ];
    });

    return {};
};

export const tui = tuiPlugin;

export default { id, tui: tuiPlugin };
