import { describe, it, expect, beforeEach } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState } from '../src/autopilot.js';
import { sessionState, clearNextSessionAutopilotEnabled } from '../src/state.js';

describe('TUI refresh on toggle', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
    clearNextSessionAutopilotEnabled();
  });

  it('commands are registered as static arrays (callback registration removed)', async () => {
    const SESSION_ID = 'test-session-1';

    let registeredCommands: any[] | null = null;
    let registerCalls = 0;
    let disposeCalls = 0;

    const mockApi: any = {
      command: {
        register: (commands: any[]) => {
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
    expect(registeredCommands![0].title).toBe('Enable Autopilot');

    registeredCommands![0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);

    // After toggle, commands are re-registered with updated state
    expect(registerCalls).toBe(2);
    expect(disposeCalls).toBe(1);
    expect(registeredCommands![0].title).toBe('Disable Autopilot');
  });

  it('re-registers commands after toggle with fresh state', async () => {
    const SESSION_ID = 'test-session-2';

    let registeredCommands: any[] | null = null;
    let registerCalls = 0;
    let disposeCalls = 0;
    const registrationHistory: any[][] = [];

    const mockApi: any = {
      command: {
        register: (commands: any[]) => {
          registerCalls++;
          registeredCommands = commands;
          registrationHistory.push(commands);
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
    expect(registeredCommands?.[0].title).toBe('Enable Autopilot');
    expect(registrationHistory).toHaveLength(1);

    registeredCommands![0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
    expect(registerCalls).toBe(2);
    expect(disposeCalls).toBe(1);
    expect(registrationHistory).toHaveLength(2);
    expect(registrationHistory[0]).not.toBe(registrationHistory[1]);
    expect(registeredCommands?.[0].title).toBe('Disable Autopilot');
  });

  it('host-visible command list updates after toggle via re-registration', async () => {
    const SESSION_ID = 'test-session-3';

    let activeCommands: any[] = [];
    const commandRegistry: any[][] = [];

    const mockApi: any = {
      command: {
        register: (commands: any[]) => {
          commandRegistry.push(commands);
          activeCommands = commands;
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
    expect(activeCommands[0].title).toBe('Enable Autopilot');

    // Simulate user selecting command from host command list.
    activeCommands[0].onSelect();

    // Host now sees updated list because plugin re-registered commands.
    expect(commandRegistry).toHaveLength(2);
    expect(activeCommands[0].title).toBe('Disable Autopilot');
  });

  it('host trigger uses latest registration and respects dispose', async () => {
    const SESSION_ID = 'test-session-4';

    let registrations: { id: number; commands: any[] }[] = [];
    let nextID = 1;
    const triggeredTitles: string[] = [];

    const resolveLatestCommand = (value: string) => {
      for (let i = registrations.length - 1; i >= 0; i--) {
        const entry = registrations[i];
        if (!entry) continue;
        const hit = entry.commands.find((cmd: any) => cmd.value === value);
        if (hit) return hit;
      }
      return undefined;
    };

    const mockApi: any = {
      command: {
        register: (commands: any[]) => {
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

    // First trigger toggles to enable and re-registers
    mockApi.command.trigger('force-continue:autopilot');
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
    expect(resolveLatestCommand('force-continue:autopilot')?.title).toBe('Disable Autopilot');

    // Second trigger toggles back to disable
    mockApi.command.trigger('force-continue:autopilot');
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
    expect(resolveLatestCommand('force-continue:autopilot')?.title).toBe('Enable Autopilot');

    expect(triggeredTitles).toEqual(['Enable Autopilot', 'Disable Autopilot']);
  });
});
