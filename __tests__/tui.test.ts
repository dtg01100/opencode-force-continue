import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { readAutopilotState, writeAutopilotState, resetAutopilotState } from '../src/autopilot.js';

describe('TUI autopilot toggle', () => {
  it('registers a command, toggles state on confirm, and updates label on subsequent register', async () => {
    // Ensure clean state
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    let capturedCommands: any = null;

    const mockApi = {
      command: {
        register: (fn: any) => {
          capturedCommands = fn();
          return capturedCommands;
        },
      },
      ui: {
        DialogConfirm: (payload: any) => {
          // Simulate user confirming immediately
          if (payload.onConfirm) payload.onConfirm();
        },
        toast: (_payload: any) => {},
      },
    } as any;

    // First registration should show "Enable Autopilot"
    await tui(mockApi as any);
    expect(capturedCommands).toBeTruthy();
    expect(Array.isArray(capturedCommands)).toBe(true);
    expect(capturedCommands[0].title).toBe('Enable Autopilot');

    // Simulate user selecting the command
    await capturedCommands[0].onSelect();

    // State should now be enabled
    const state = readAutopilotState();
    expect(state.enabled).toBe(true);

    // Re-register to see updated label
    capturedCommands = null;
    await tui(mockApi as any);
    expect(capturedCommands).toBeTruthy();
    expect(capturedCommands[0].title).toBe('Disable Autopilot');
  });
});
