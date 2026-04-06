import { describe, it, expect, vi } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState, writeAutopilotState, readAutopilotState } from '../src/autopilot.js';

describe('TUI cancel behavior', () => {
  it('cancelling DialogConfirm leaves autopilot disabled and re-register label stays Enable Autopilot', async () => {
    // Ensure clean state
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    // Capture registered commands across registrations
    const registeredCommands: any[] = [];

    const mockApi: any = {
      command: {
        register: (fn: any) => {
          const cmds = fn();
          registeredCommands.push(...(Array.isArray(cmds) ? cmds : [cmds]));
          return cmds;
        },
      },
      ui: {
        DialogConfirm: (payload: any) => {
          // Simulate user cancelling the dialog: do NOT call onConfirm, call onCancel if provided
          if (payload && typeof payload.onCancel === 'function') {
            payload.onCancel();
          }
        },
        toast: (_: any) => {},
      },
    };

    // First registration should provide 'Enable Autopilot'
    await tui(mockApi as any);
    expect(registeredCommands.length).toBeGreaterThan(0);
    const first = registeredCommands[0];
    expect(first.title).toBe('Enable Autopilot');

    // Simulate selecting the command
    await first.onSelect();

    // After cancelling, state should remain disabled
    const state = readAutopilotState();
    expect(state.enabled).toBe(false);

    // Re-register to see label remains 'Enable Autopilot'
    const before = registeredCommands.length;
    await tui(mockApi as any);
    const reReg = registeredCommands.slice(-1)[0];
    expect(reReg.title).toBe('Enable Autopilot');
  });
});
