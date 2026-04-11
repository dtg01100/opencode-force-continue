import { describe, it, expect, beforeEach } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState } from '../src/autopilot.js';
import { sessionState } from '../src/state.js';

describe('TUI refresh on toggle', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('getCommands callback always returns fresh state without re-registering when callbacks are supported', async () => {
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

    expect(registerCalls).toBe(1);
    expect(getCommandsFn!()[0].title).toBe('Disable Autopilot');
  });

  it('re-registers commands after toggle when callback registration is not supported', async () => {
    const SESSION_ID = 'test-session-2';

    let registeredCommands: any[] | null = null;
    let registerCalls = 0;

    const mockApi: any = {
      command: {
        register: (value: any) => {
          registerCalls++;
          if (typeof value === 'function') {
            throw new Error('callback not supported');
          }
          registeredCommands = value;
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
    expect(registerCalls).toBe(2);
    expect(registeredCommands?.[0].title).toBe('Enable Autopilot');

    registeredCommands![0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
    expect(registerCalls).toBe(4);
    expect(registeredCommands?.[0].title).toBe('Disable Autopilot');
  });
});
