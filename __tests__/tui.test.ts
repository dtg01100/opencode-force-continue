import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { getAutopilotEnabled, setAutopilotEnabled } from '../src/state.js';

function makeMockApi(sessionID = 'test-session-123') {
  let getCommandsFn: (() => any[]) | null = null;

  const mockApi: any = {
    command: {
      register: (fn: any) => {
        getCommandsFn = fn;
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
    _getCommands: () => getCommandsFn?.() ?? [],
  };

  return mockApi;
}

describe('TUI autopilot toggle', () => {
  const sessionID = 'test-session-123';

  it('registers a command with title "Enable Autopilot" when disabled', async () => {
    setAutopilotEnabled(sessionID, false);

    const mockApi = makeMockApi(sessionID);
    await tui(mockApi);

    const commands = mockApi._getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].title).toBe('Enable Autopilot');
  });

  it('enables autopilot directly on select without confirmation dialog', async () => {
    setAutopilotEnabled(sessionID, false);

    const mockApi = makeMockApi(sessionID);
    await tui(mockApi);

    const commands = mockApi._getCommands();
    commands[0].onSelect();

    expect(getAutopilotEnabled(sessionID)).toBe(true);

    // getCommands callback always reads fresh state — label should now be "Disable Autopilot"
    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
  });

  it('registers command with title "Disable Autopilot" when already enabled', async () => {
    setAutopilotEnabled(sessionID, true);

    const mockApi = makeMockApi(sessionID);

    await tui(mockApi);

    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
  });

  it('uses array registration when api.command.register rejects callbacks', async () => {
    setAutopilotEnabled(sessionID, false);

    let registeredCommands: any = null;
    const mockApi: any = {
      command: {
        register: (value: any) => {
          if (typeof value === 'function') {
            throw new Error('callback not supported');
          }
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
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
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
    mockApi._getCommands()[0].onSelect();

    expect(toastMessage).toBe('Autopilot enabled');
    expect(toastVariant).toBe('warning');
  });

  it('shows toast notification when disabling autopilot', async () => {
    setAutopilotEnabled(sessionID, true);

    let toastMessage = '';
    let toastVariant = '';
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
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
    mockApi._getCommands()[0].onSelect();

    expect(toastMessage).toBe('Autopilot disabled');
    expect(toastVariant).toBe('info');
  });
});
