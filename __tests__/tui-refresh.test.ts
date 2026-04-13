import { describe, it, expect, beforeEach } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState } from '../src/autopilot.js';
import { sessionState, clearNextSessionAutopilotEnabled } from '../src/state.js';

function resolveCommands(commandsOrProvider: any) {
  if (typeof commandsOrProvider === 'function') {
    return commandsOrProvider();
  }
  return commandsOrProvider ?? [];
}

describe('TUI refresh on toggle', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
    clearNextSessionAutopilotEnabled();
  });

  it('updates the visible command after toggle with runtime-compatible registration', async () => {
    const SESSION_ID = 'test-session-1';

    let registeredCommands: any = null;
    let registerCalls = 0;
    let disposeCalls = 0;

    const mockApi: any = {
      command: {
        register: (commands: any) => {
          registerCalls++;
          registeredCommands = commands;
          return () => { disposeCalls++; };
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
    expect(resolveCommands(registeredCommands)[0].title).toBe('Enable Autopilot');

    resolveCommands(registeredCommands)[0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
    expect(registerCalls).toBe(1);
    expect(disposeCalls).toBe(0);
    expect(resolveCommands(registeredCommands)[0].title).toBe('Disable Autopilot');
  });

  it('returns fresh command state after toggle', async () => {
    const SESSION_ID = 'test-session-2';

    let registeredCommands: any = null;
    let registerCalls = 0;

    const mockApi: any = {
      command: {
        register: (commands: any) => {
          registerCalls++;
          registeredCommands = commands;
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
    const initialCommands = resolveCommands(registeredCommands);
    expect(registerCalls).toBe(1);
    expect(initialCommands[0].title).toBe('Enable Autopilot');

    initialCommands[0].onSelect();

    const refreshedCommands = resolveCommands(registeredCommands);
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
    expect(refreshedCommands[0].title).toBe('Disable Autopilot');
    expect(refreshedCommands[0].description).toContain('Autopilot is ON');
  });

  it('host-visible command list updates after toggle via provider refresh', async () => {
    const SESSION_ID = 'test-session-3';

    let activeCommandsSource: any = [];
    const commandRegistry: any[] = [];

    const mockApi: any = {
      command: {
        register: (commands: any) => {
          commandRegistry.push(commands);
          activeCommandsSource = commands;
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
    expect(resolveCommands(activeCommandsSource)[0].title).toBe('Enable Autopilot');

    resolveCommands(activeCommandsSource)[0].onSelect();

    expect(commandRegistry).toHaveLength(1);
    expect(resolveCommands(activeCommandsSource)[0].title).toBe('Disable Autopilot');
  });

  it('host trigger uses the latest command view', async () => {
    const SESSION_ID = 'test-session-4';

    let registrations: { id: number; commands: any }[] = [];
    let nextID = 1;
    const triggeredTitles: string[] = [];

    const resolveLatestCommand = (value: string) => {
      for (let i = registrations.length - 1; i >= 0; i--) {
        const entry = registrations[i];
        if (!entry) continue;
        const hit = resolveCommands(entry.commands).find((cmd: any) => cmd.value === value);
        if (hit) return hit;
      }
      return undefined;
    };

    const mockApi: any = {
      command: {
        register: (commands: any) => {
          const id = nextID++;
          registrations.push({ id, commands });
          return () => {
            registrations = registrations.filter((entry) => entry.id !== id);
          };
        },
        trigger: (value: string) => {
          const cmd = resolveLatestCommand(value);
          if (!cmd) return;
          triggeredTitles.push(cmd.title);
          cmd.onSelect?.();
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
    expect(resolveLatestCommand('force-continue:autopilot')?.title).toBe('Enable Autopilot');

    mockApi.command.trigger('force-continue:autopilot');
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
    expect(resolveLatestCommand('force-continue:autopilot')?.title).toBe('Disable Autopilot');

    mockApi.command.trigger('force-continue:autopilot');
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
    expect(resolveLatestCommand('force-continue:autopilot')?.title).toBe('Enable Autopilot');

    expect(triggeredTitles).toEqual(['Enable Autopilot', 'Disable Autopilot']);
  });
});
