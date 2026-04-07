import { describe, it, expect, beforeEach } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState } from '../src/autopilot.js';
import { sessionState } from '../src/state.js';

describe('TUI disable autopilot', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('selecting Disable Autopilot leaves autopilot disabled for session', async () => {
    const SESSION_ID = 'cancel-test-1';
    sessionState.set(SESSION_ID, { autopilotEnabled: true });

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
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);

    const commands = getCommandsFn!();
    expect(commands[0].title).toBe('Disable Autopilot');

    commands[0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);

    expect(getCommandsFn!()[0].title).toBe('Enable Autopilot');
  });
});
