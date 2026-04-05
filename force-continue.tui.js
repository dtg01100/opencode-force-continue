import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

function getAutopilotStorePath() {
    return join(process.cwd(), ".opencode", "force-continue-store", "autopilot.json");
}

function readAutopilotState() {
    const p = getAutopilotStorePath();
    if (!existsSync(p)) return { enabled: false, timestamp: null };
    try {
        return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
        return { enabled: false, timestamp: null };
    }
}

function writeAutopilotState(state) {
    const p = getAutopilotStorePath();
    const dir = join(process.cwd(), ".opencode", "force-continue-store");
    try {
        existsSync(dir) || mkdirSync(dir, { recursive: true });
        writeFileSync(p, JSON.stringify(state));
    } catch (e) {
        console.warn(`force-continue: Failed to write autopilot state: ${e?.message ?? e}`);
    }
}

export const id = "force-continue";

export const tui = async (api, options, meta) => {
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
                suggested: true,
                onSelect: () => {
                    const newEnabled = !state.enabled;
                    writeAutopilotState({ enabled: newEnabled, timestamp: Date.now() });
                    api.ui.toast({
                        message: `Autopilot ${newEnabled ? "enabled" : "disabled"}`,
                        type: "info",
                    });
                },
            },
        ];
    });
};

export default { id, tui };