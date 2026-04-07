import { describe, it, expect, beforeEach } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState } from '../src/autopilot.js';
import { sessionState } from '../src/state.js';

describe('TUI refresh on toggle', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('getCommands callback always returns fresh state — no re-registration needed', async () => {
    const SESSION_ID = 'test-session-1';

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
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(registerCalls).toBe(1);
    expect(getCommandsFn!()[0].title).toBe('Enable Autopilot');

    getCommandsFn!()[0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);

    expect(registerCalls).toBe(2);
    expect(getCommandsFn!()[0].title).toBe('Disable Autopilot');
  });
});
