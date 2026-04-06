import { describe, it, expect } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { readAutopilotState, writeAutopilotState, resetAutopilotState } from '../src/autopilot.js';

function makeMockApi() {
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
    _getCommands: () => getCommandsFn?.() ?? [],
  };

  return mockApi;
}

describe('TUI autopilot toggle', () => {
  it('registers a command with title "Enable Autopilot" when disabled', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    const mockApi = makeMockApi();
    await tui(mockApi);

    const commands = mockApi._getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].title).toBe('Enable Autopilot');
  });

  it('enables autopilot directly on select without confirmation dialog', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    const mockApi = makeMockApi();
    await tui(mockApi);

    const commands = mockApi._getCommands();
    commands[0].onSelect();

    expect(readAutopilotState().enabled).toBe(true);

    // getCommands callback always reads fresh state — label should now be "Disable Autopilot"
    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
  });

  it('registers command with title "Disable Autopilot" when already enabled', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    const mockApi = makeMockApi();
    await tui(mockApi);

    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
  });

  it('uses array registration when api.command.register rejects callbacks', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

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
      ui: {
        toast: (_: any) => {},
      },
    };

    await tui(mockApi);

    expect(Array.isArray(registeredCommands)).toBe(true);
    expect(registeredCommands[0].title).toBe('Enable Autopilot');
  });

  it('shows toast notification when enabling autopilot', async () => {
    resetAutopilotState();
    writeAutopilotState({ enabled: false, timestamp: null });

    let toastMessage = '';
    let toastVariant = '';
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          return () => {};
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
    resetAutopilotState();
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    let toastMessage = '';
    let toastVariant = '';
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          return () => {};
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
