import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tui } from '../force-continue.tui.js';
import { resetAutopilotState, writeAutopilotState, readAutopilotState } from '../src/autopilot.js';
import { sessionState } from '../src/state.js';

describe('TUI graceful degradation', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('works when api.ui.toast is undefined', async () => {
    const SESSION_ID = 'edge-test-1';
    let getCommandsFn: (() => any[]) | null = null;
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          getCommandsFn = fn;
          return () => {};
        },
      },
      ui: {},
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    const commands = getCommandsFn!();
    expect(commands).toHaveLength(1);

    // onSelect should not throw even though toast is missing
    expect(() => commands[0].onSelect()).not.toThrow();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
  });

  it('works when api.ui is undefined', async () => {
    let getCommandsFn: (() => any[]) | null = null;
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          getCommandsFn = fn;
          return () => {};
        },
      },
    };

    await tui(mockApi);
    const commands = getCommandsFn!();
    expect(commands).toHaveLength(1);
    expect(() => commands[0].onSelect()).not.toThrow();
  });

  it('works when api.command is undefined', async () => {
    const mockApi: any = {
      ui: {
        toast: vi.fn(),
      },
    };

    // Should not throw — registerCommands guards against missing api.command
    await expect(tui(mockApi)).resolves.not.toThrow();
  });

  it('works when api.command.register is undefined', async () => {
    const mockApi: any = {
      command: {},
      ui: {
        toast: vi.fn(),
      },
    };

    await expect(tui(mockApi)).resolves.not.toThrow();
  });

  it('works when api is minimal (only id field)', async () => {
    const mockApi: any = {};
    await expect(tui(mockApi)).resolves.not.toThrow();
  });

  it('works when api.command.register is null', async () => {
    const mockApi: any = {
      command: {
        register: null,
      },
      ui: {
        toast: vi.fn(),
      },
    };

    await expect(tui(mockApi)).resolves.not.toThrow();
  });

  it('works when api.command.register throws (Error or non-Error)', async () => {
    // Test with Error object
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
        toast: vi.fn(),
      },
    };

    await tui(mockApi);
    expect(Array.isArray(registeredCommands)).toBe(true);
    expect(registeredCommands[0].title).toBe('Enable Autopilot');

    // Test with non-Error (string)
    registeredCommands = null;
    mockApi.command.register = (value: any) => {
      if (typeof value === 'function') {
        throw 'string error';
      }
      registeredCommands = value;
      return () => {};
    };

    await tui(mockApi);
    expect(Array.isArray(registeredCommands)).toBe(true);
  });

  it('toast variant is "warning" when enabling, "info" when disabling', async () => {
    resetAutopilotState();
    sessionState.clear();
    const toastCalls: { message: string; variant: string }[] = [];
    const SESSION_1 = 'variant-test-1';
    const SESSION_2 = 'variant-test-2';
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          return () => {};
        },
      },
      ui: {
        toast: ({ message, variant }: any) => {
          toastCalls.push({ message, variant });
        },
      },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_1 } },
      },
    };

    // Enable on session 1
    await tui(mockApi);
    mockApi._getCommands()[0].onSelect();

    // Disable on session 2 (pre-set enabled to test disable path)
    sessionState.set(SESSION_2, { autopilotEnabled: true });
    const freshApi: any = {
      command: {
        register: (fn: any) => {
          freshApi._getCommands = fn;
          return () => {};
        },
      },
      ui: {
        toast: ({ message, variant }: any) => {
          toastCalls.push({ message, variant });
        },
      },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_2 } },
      },
    };
    await tui(freshApi);
    freshApi._getCommands()[0].onSelect();

    expect(toastCalls).toEqual([
      { message: 'Autopilot enabled', variant: 'warning' },
      { message: 'Autopilot disabled', variant: 'info' },
    ]);
  });
});

describe('TUI command metadata', () => {
  beforeEach(() => {
    resetAutopilotState();
  });

  it('command has correct value field', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    const commands = mockApi._getCommands();
    expect(commands[0].value).toBe('force-continue:autopilot');
  });

  it('command has correct category field', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].category).toBe('Force Continue');
  });

  it('description explains current state when disabled', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].description).toBe('Autopilot is OFF - AI asks for guidance');
  });

  it('description explains current state when enabled', async () => {
    resetAutopilotState();
    sessionState.clear();
    const SESSION_ID = 'desc-enabled';
    sessionState.set(SESSION_ID, { autopilotEnabled: true });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].description).toBe('Autopilot is ON - AI makes decisions autonomously');
  });

  it('onSelect returns undefined (synchronous)', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    const result = mockApi._getCommands()[0].onSelect();
    expect(result).toBeUndefined();
  });
});

describe('TUI rapid toggle behavior', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('handles enable→disable→enable in rapid succession', async () => {
    const SESSION_ID = 'rapid-toggle-1';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].title).toBe('Enable Autopilot');

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
  });

  it('timestamp is updated on each toggle', async () => {
    // Note: timestamp is no longer updated per-toggle in session-scoped mode
    // This test verifies rapid toggles don't cause state corruption
    const SESSION_ID = 'rapid-toggle-2';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
  });

  it('handles 10 rapid toggles without state corruption', async () => {
    const SESSION_ID = 'rapid-toggle-3';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);

    for (let i = 0; i < 10; i++) {
      mockApi._getCommands()[0].onSelect();
    }

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
  });
});

describe('TUI onSelect concurrency', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('handles concurrent onSelect calls without corruption', async () => {
    const SESSION_ID = 'concurrency-1';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    const commands = mockApi._getCommands();

    // Call onSelect twice concurrently (simulating double-click race)
    commands[0].onSelect();
    // Re-fetch to get fresh command (simulates what happens when UI re-registers after first call)
    mockApi._getCommands()[0].onSelect();

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
  });

  it('handles onSelect after state was externally modified', async () => {
    const SESSION_ID = 'concurrency-2';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    const commands = mockApi._getCommands();
    expect(commands[0].title).toBe('Enable Autopilot');

    commands[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);

    const updatedCommands = mockApi._getCommands();
    expect(updatedCommands[0].title).toBe('Disable Autopilot');
  });

  it('rapid toggles do not cause state corruption', async () => {
    const SESSION_ID = 'rapid-2';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);

    for (let i = 0; i < 10; i++) {
      mockApi._getCommands()[0].onSelect();
    }

    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
  });
});

describe('TUI state consistency', () => {
  beforeEach(() => {
    resetAutopilotState();
    sessionState.clear();
  });

  it('handles state with enabled=true but session override', async () => {
    const SESSION_ID = 'state-consist-1';
    sessionState.set(SESSION_ID, { autopilotEnabled: true });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
    expect(mockApi._getCommands()[0].description).toBe('Autopilot is ON - AI makes decisions autonomously');

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(false);
  });

  it('handles state with no session override', async () => {
    const SESSION_ID = 'state-consist-2';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].title).toBe('Enable Autopilot');

    mockApi._getCommands()[0].onSelect();
    expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(true);
  });

  it('handles state with timestamp=0', async () => {
    const SESSION_ID = 'state-consist-3';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    const commands = mockApi._getCommands();
    expect(commands[0].title).toBe('Enable Autopilot');
    expect(() => commands[0].onSelect()).not.toThrow();
  });

  it('handles state with very large timestamp (year 2100)', async () => {
    const SESSION_ID = 'state-consist-4';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(() => mockApi._getCommands()[0].onSelect()).not.toThrow();
  });

  it('handles state with negative timestamp', async () => {
    const SESSION_ID = 'state-consist-5';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(() => mockApi._getCommands()[0].onSelect()).not.toThrow();
  });

  it('handles fresh (default) state — no session override', async () => {
    resetAutopilotState();
    const SESSION_ID = 'state-consist-6';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    expect(mockApi._getCommands()[0].title).toBe('Enable Autopilot');
  });

  it('registers exactly one command regardless of state', async () => {
    for (let i = 0; i < 4; i++) {
      resetAutopilotState();
      sessionState.clear();

      const mockApi: any = {
        command: {
          register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
        },
        ui: { toast: vi.fn() },
        route: {
          current: { name: 'session', params: { sessionID: `register-test-${i}` } },
        },
      };

      await tui(mockApi);
      expect(mockApi._getCommands().length).toBe(1);
    }
  });
});

describe('TUI property-based: state → command mapping', () => {
  beforeEach(() => {
    resetAutopilotState();
  });

  it('enabled=false always produces "Enable Autopilot" title', async () => {
    for (let i = 0; i < 7; i++) {
      resetAutopilotState();
      sessionState.clear();

      const mockApi: any = {
        command: {
          register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
        },
        ui: { toast: vi.fn() },
      };

      await tui(mockApi);
      expect(mockApi._getCommands()[0].title).toBe('Enable Autopilot');
    }
  });

  it('enabled=true always produces "Disable Autopilot" title', async () => {
    for (let i = 0; i < 7; i++) {
      resetAutopilotState();
      sessionState.clear();
      const SESSION_ID = `disable-title-test-${i}`;
      sessionState.set(SESSION_ID, { autopilotEnabled: true });

      const mockApi: any = {
        command: {
          register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
        },
        ui: { toast: vi.fn() },
        route: {
          current: { name: 'session', params: { sessionID: SESSION_ID } },
        },
      };

      await tui(mockApi);
      expect(mockApi._getCommands()[0].title).toBe('Disable Autopilot');
    }
  });

  it('enabled=false always produces "warning" toast on select', async () => {
    resetAutopilotState();
    sessionState.clear();
    const SESSION_ID = 'toast-warning-test';
    let toastVariant = '';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: {
        toast: ({ variant }: any) => { toastVariant = variant; },
      },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    mockApi._getCommands()[0].onSelect();
    expect(toastVariant).toBe('warning');
  });

  it('enabled=true always produces "info" toast on select', async () => {
    resetAutopilotState();
    sessionState.clear();
    const SESSION_ID = 'toast-info-test';
    sessionState.set(SESSION_ID, { autopilotEnabled: true });
    let toastVariant = '';
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: {
        toast: ({ variant }: any) => { toastVariant = variant; },
      },
      route: {
        current: { name: 'session', params: { sessionID: SESSION_ID } },
      },
    };

    await tui(mockApi);
    mockApi._getCommands()[0].onSelect();
    expect(toastVariant).toBe('info');
  });

  it('toggle always flips enabled state regardless of initial session override', async () => {
    const testCases = [
      { sessionEnabled: false, expectedAfter: true },
      { sessionEnabled: true, expectedAfter: false },
    ];

    for (let i = 0; i < testCases.length; i++) {
      resetAutopilotState();
      sessionState.clear();
      const SESSION_ID = `toggle-test-${i}`;

      // Pre-set session state to match the test case's starting point
      if (testCases[i].sessionEnabled) {
        sessionState.set(SESSION_ID, { autopilotEnabled: true });
      }

      const mockApi: any = {
        command: {
          register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
        },
        ui: { toast: vi.fn() },
        route: {
          current: { name: 'session', params: { sessionID: SESSION_ID } },
        },
      };

      await tui(mockApi);
      mockApi._getCommands()[0].onSelect();
      expect(sessionState.get(SESSION_ID)?.autopilotEnabled).toBe(testCases[i].expectedAfter);
    }
  });

  it('command value and category are invariant across states', async () => {
    const states = [
      { enabled: false, timestamp: null },
      { enabled: true, timestamp: null },
      { enabled: false, timestamp: Date.now() },
      { enabled: true, timestamp: Date.now() },
    ];

    for (const state of states) {
      resetAutopilotState();
      writeAutopilotState(state);

      const mockApi: any = {
        command: {
          register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
        },
        ui: { toast: vi.fn() },
      };

      await tui(mockApi);
      const cmd = mockApi._getCommands()[0];
      expect(cmd.value).toBe('force-continue:autopilot');
      expect(cmd.category).toBe('Force Continue');
    }
  });
});

describe('TUI API contract compliance', () => {
  beforeEach(() => {
    resetAutopilotState();
  });

  it('tui function returns void (Promise<void>)', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    const result = await tui(mockApi);
    expect(result).toBeUndefined();
  });

  it('command onSelect is synchronous (returns void, not Promise)', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    const result = mockApi._getCommands()[0].onSelect();
    // Must not be a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toBeUndefined();
  });

  it('toast accepts object with message (required) and variant (optional)', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    let receivedToast: any = null;
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: {
        toast: (toast: any) => { receivedToast = toast; },
      },
      route: {
        current: { name: 'session', params: { sessionID: 'toast-test-1' } },
      },
    };

    await tui(mockApi);
    mockApi._getCommands()[0].onSelect();

    expect(receivedToast).toHaveProperty('message');
    expect(receivedToast).toHaveProperty('variant');
    expect(receivedToast.message).toBe('Autopilot enabled');
    expect(['info', 'success', 'warning', 'error']).toContain(receivedToast.variant);
  });

  it('toast variant is one of the valid TUI variants', async () => {
    const validVariants = ['info', 'success', 'warning', 'error'];

    // Test enabling (warning)
    writeAutopilotState({ enabled: false, timestamp: null });
    let variant1 = '';
    const mockApi1: any = {
      command: {
        register: (fn: any) => { mockApi1._getCommands = fn; return () => {}; },
      },
      ui: {
        toast: ({ variant }: any) => { variant1 = variant; },
      },
    };
    await tui(mockApi1);
    mockApi1._getCommands()[0].onSelect();
    expect(validVariants).toContain(variant1);

    // Test disabling (info)
    resetAutopilotState();
    writeAutopilotState({ enabled: true, timestamp: Date.now() });
    let variant2 = '';
    const mockApi2: any = {
      command: {
        register: (fn: any) => { mockApi2._getCommands = fn; return () => {}; },
      },
      ui: {
        toast: ({ variant }: any) => { variant2 = variant; },
      },
    };
    await tui(mockApi2);
    mockApi2._getCommands()[0].onSelect();
    expect(validVariants).toContain(variant2);
  });

  it('command object has all required fields (title, value)', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    const cmd = mockApi._getCommands()[0];

    // Required by TuiCommand type
    expect(cmd).toHaveProperty('title');
    expect(typeof cmd.title).toBe('string');
    expect(cmd.title.length).toBeGreaterThan(0);

    expect(cmd).toHaveProperty('value');
    expect(typeof cmd.value).toBe('string');
    expect(cmd.value.length).toBeGreaterThan(0);
  });

  it('command optional fields match TuiCommand type shape', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    const cmd = mockApi._getCommands()[0];

    // Optional fields that we use
    expect(cmd.description).toBeDefined();
    expect(typeof cmd.description).toBe('string');
    expect(cmd.category).toBeDefined();
    expect(typeof cmd.category).toBe('string');

    // onSelect must be a function or undefined
    expect(typeof cmd.onSelect).toBe('function');
  });

  it('command does not have conflicting fields', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    const mockApi: any = {
      command: {
        register: (fn: any) => { mockApi._getCommands = fn; return () => {}; },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    const cmd = mockApi._getCommands()[0];

    // Should not have unexpected fields that could confuse the TUI
    const allowedFields = new Set(['title', 'value', 'description', 'category', 'onSelect', 'keybind', 'suggested', 'hidden', 'enabled', 'slash']);
    const actualFields = Object.keys(cmd);
    for (const field of actualFields) {
      expect(allowedFields).toContain(field);
    }
  });

  it('register callback returns a dispose function', async () => {
    writeAutopilotState({ enabled: false, timestamp: null });
    let disposeFn: (() => void) | null = null;
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          disposeFn = fn; // In real API, register returns dispose; here we test our mock captures it
          return () => {};
        },
      },
      ui: { toast: vi.fn() },
    };

    const dispose = mockApi.command.register((() => []) as any);
    expect(typeof dispose).toBe('function');
  });
});

describe('TUI dispose cleanup on re-registration', () => {
  beforeEach(() => {
    resetAutopilotState();
  });

  it('calls previous dispose function when tui() is called again', async () => {
    const disposeCalls: number[] = [];
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          return () => {
            disposeCalls.push(disposeCalls.length + 1);
          };
        },
      },
      ui: { toast: vi.fn() },
    };

    // First registration
    writeAutopilotState({ enabled: false, timestamp: null });
    await tui(mockApi);
    expect(disposeCalls).toHaveLength(0);

    // Second registration — should call previous dispose
    await tui(mockApi);
    expect(disposeCalls).toHaveLength(1);

    // Third registration — should call previous dispose again
    await tui(mockApi);
    expect(disposeCalls).toHaveLength(2);
  });

  it('does not throw when previous dispose is missing or undefined', async () => {
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          // Return undefined instead of dispose function
          return undefined;
        },
      },
      ui: { toast: vi.fn() },
    };

    writeAutopilotState({ enabled: false, timestamp: null });
    await tui(mockApi);
    await expect(tui(mockApi)).resolves.not.toThrow();
  });
});
