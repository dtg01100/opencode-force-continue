import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { readAutopilotState, writeAutopilotState, resetAutopilotState } from '../src/autopilot.js';

describe('TUI refresh on toggle', () => {
  it('getCommands callback always returns fresh state — no re-registration needed', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    let getCommandsFn: (() => any[]) | null = null;
    let registerCalls = 0;

    const mockApi: any = {
      command: {
        register: (fn: any) => {
          registerCalls++;
          getCommandsFn = fn;
          return () => {};
        },
      },
      ui: {
        toast: (_: any) => {},
      },
    };

    await tui(mockApi);
    expect(registerCalls).toBe(1);
    expect(getCommandsFn!()[0].title).toBe('Enable Autopilot');

    // Select command — autopilot enables directly
    getCommandsFn!()[0].onSelect();

    expect(readAutopilotState().enabled).toBe(true);

    // Re-registration is needed because the API may not re-call the provider callback
    expect(registerCalls).toBe(2);
    expect(getCommandsFn!()[0].title).toBe('Disable Autopilot');
  });
});
