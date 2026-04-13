import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { getAutopilotEnabled, setAutopilotEnabled } from '../src/state.js';

function makeMockApi(sessionID = 'test-session-123') {
  let registeredCommands: any[] | null = null;

  const mockApi: any = {
    command: {
      register: (commands: any) => {
        registeredCommands = Array.isArray(commands) ? commands : null;
        return () => {};
      },
    },
    route: {
      current: {
        name: 'session',
        params: { sessionID },
      },
    },
    ui: {
      toast: (_: any) => {},
    },
    _getRegisteredCommands: () => registeredCommands ?? [],
  };

  return mockApi;
}

describe('TUI autopilot toggle', () => {
  const sessionID = 'test-session-123';

  it('registers a command with title "Enable Autopilot" when disabled', async () => {
    setAutopilotEnabled(sessionID, false);

    const mockApi = makeMockApi(sessionID);
    await tui(mockApi);

    const commands = mockApi._getRegisteredCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].title).toBe('Enable Autopilot');
  });

  it('enables autopilot directly on select without confirmation dialog', async () => {
    setAutopilotEnabled(sessionID, false);

    const mockApi = makeMockApi(sessionID);
    await tui(mockApi);

    const commands = mockApi._getRegisteredCommands();
    commands[0].onSelect();

    expect(getAutopilotEnabled(sessionID)).toBe(true);

    // Commands are registered once with initial state; we don't re-register on select
    // since opencode 1.4.3 has a bug with callback-based registration
  });

  it('registers command with title "Disable Autopilot" when already enabled', async () => {
    setAutopilotEnabled(sessionID, true);

    const mockApi = makeMockApi(sessionID);

    await tui(mockApi);

    expect(mockApi._getRegisteredCommands()[0].title).toBe('Disable Autopilot');
  });

  it('uses array registration (callback registration removed due to opencode 1.4.3 bug)', async () => {
    setAutopilotEnabled(sessionID, false);

    let registeredCommands: any = null;
    const mockApi: any = {
      command: {
        register: (value: any) => {
          registeredCommands = value;
          return () => {};
        },
      },
      route: {
        current: {
          name: 'session',
          params: { sessionID },
        },
      },
      ui: {
        toast: (_: any) => {},
      },
    };

    await tui(mockApi);

    expect(Array.isArray(registeredCommands)).toBe(true);
    expect(registeredCommands[0].title).toBe('Enable Autopilot');
  });

  it('shows toast notification when enabling autopilot', async () => {
    setAutopilotEnabled(sessionID, false);

    let toastMessage = '';
    let toastVariant = '';
    let registeredCommands: any = null;
    const mockApi: any = {
      command: {
        register: (commands: any) => {
          registeredCommands = commands;
          return () => {};
        },
      },
      route: {
        current: {
          name: 'session',
          params: { sessionID },
        },
      },
      ui: {
        toast: ({ message, variant }: any) => {
          toastMessage = message;
          toastVariant = variant;
        },
      },
    };

    await tui(mockApi);
    registeredCommands[0].onSelect();

    expect(toastMessage).toBe('Autopilot enabled');
    expect(toastVariant).toBe('warning');
  });

  it('shows toast notification when disabling autopilot', async () => {
    setAutopilotEnabled(sessionID, true);

    let toastMessage = '';
    let toastVariant = '';
    let registeredCommands: any = null;
    const mockApi: any = {
      command: {
        register: (commands: any) => {
          registeredCommands = commands;
          return () => {};
        },
      },
      route: {
        current: {
          name: 'session',
          params: { sessionID },
        },
      },
      ui: {
        toast: ({ message, variant }: any) => {
          toastMessage = message;
          toastVariant = variant;
        },
      },
    };

    await tui(mockApi);
    registeredCommands[0].onSelect();

    expect(toastMessage).toBe('Autopilot disabled');
    expect(toastVariant).toBe('info');
  });
});
