import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState, writeAutopilotState, readAutopilotState } from '../src/autopilot.js';

describe('TUI disable autopilot', () => {
  it('selecting Disable Autopilot leaves autopilot disabled', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    let getCommandsFn: (() => any[]) | null = null;

    const mockApi: any = {
      command: {
        register: (fn: any) => {
          getCommandsFn = fn;
          return () => {};
        },
      },
      ui: {
        toast: (_: any) => {},
      },
    };

    await tui(mockApi);

    const commands = getCommandsFn!();
    expect(commands[0].title).toBe('Disable Autopilot');

    // Select command — autopilot disables directly
    commands[0].onSelect();

    // State must be disabled
    expect(readAutopilotState().enabled).toBe(false);

    // Fresh commands now show "Enable Autopilot"
    expect(getCommandsFn!()[0].title).toBe('Enable Autopilot');
  });
});
