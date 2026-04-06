import { describe, it, expect, vi } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { readAutopilotState, writeAutopilotState, resetAutopilotState } from '../src/autopilot.js';

describe('TUI refresh on toggle', () => {
  it('re-registers commands automatically when toggling autopilot', async () => {
    // Ensure clean state
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    const registrations: Array<() => any> = [];
    let registerCalls = 0;

    const mockApi = {
      command: {
        register: (fn: any) => {
          registerCalls++;
          registrations.push(fn);
          return fn();
        },
      },
      ui: {
        DialogConfirm: (payload: any) => {
          // trigger confirmation immediately
          if (payload.onConfirm) payload.onConfirm();
        },
        toast: (_: any) => {},
      },
    } as any;

    await tui(mockApi as any);
    expect(registerCalls).toBe(1);

    // invoke initial onSelect
    const initialCommands = registrations[0]();
    await initialCommands[0].onSelect();

    // After toggling, register should have been called again to refresh commands
    expect(registerCalls).toBeGreaterThan(1);

    const lastRegisteredCommands = registrations[registrations.length - 1]();
    expect(lastRegisteredCommands[0].title).toBe('Disable Autopilot');
  });
});
