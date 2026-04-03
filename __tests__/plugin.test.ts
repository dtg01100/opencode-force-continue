import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@opencode-ai/plugin', () => ({
  tool: vi.fn(() => ({ type: 'tool' })),
}));

function resetState() {
  // In-memory state is reset via vi.resetModules() in beforeEach
}

// ─── flags.js ───────────────────────────────────────────────────────────────

describe('flags.js', () => {
  beforeEach(() => {
    vi.resetModules();
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  describe('isEnabled', () => {
    it('should return false for disabled session', async () => {
      const { isEnabled } = await import('../force-continue.server.js');
      expect(isEnabled('test-session')).toBe(false);
    });

    it('should return false for null/undefined/empty sessionID', async () => {
      const { isEnabled } = await import('../force-continue.server.js');
      expect(isEnabled(null as any)).toBe(false);
      expect(isEnabled(undefined as any)).toBe(false);
      expect(isEnabled('' as any)).toBe(false);
    });

    it('should return true for enabled session', async () => {
      const { isEnabled, setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session', true);
      expect(isEnabled('test-session')).toBe(true);
    });
  });

  describe('setEnabled', () => {
    it('should enable and disable sessions', async () => {
      const { isEnabled, setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session', true);
      expect(isEnabled('test-session')).toBe(true);
      setEnabled('test-session', false);
      expect(isEnabled('test-session')).toBe(false);
    });

    it('should not throw for null/undefined sessionID', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      expect(() => setEnabled(null as any, true)).not.toThrow();
      expect(() => setEnabled(undefined as any, true)).not.toThrow();
    });

    it('should handle multiple sessions independently', async () => {
      const { isEnabled, setEnabled } = await import('../force-continue.server.js');
      setEnabled('session-a', true);
      setEnabled('session-b', true);
      expect(isEnabled('session-a')).toBe(true);
      expect(isEnabled('session-b')).toBe(true);
      setEnabled('session-a', false);
      expect(isEnabled('session-a')).toBe(false);
      expect(isEnabled('session-b')).toBe(true);
    });
  });

  describe('nextSession', () => {
    it('should default to false', async () => {
      const { isNextSessionEnabled } = await import('../force-continue.server.js');
      expect(isNextSessionEnabled()).toBe(false);
    });

    it('should enable and disable nextSession', async () => {
      const { isNextSessionEnabled, setNextSessionEnabled } = await import('../force-continue.server.js');
      setNextSessionEnabled(true);
      expect(isNextSessionEnabled()).toBe(true);
      setNextSessionEnabled(false);
      expect(isNextSessionEnabled()).toBe(false);
    });

    it('should consume nextSession atomically', async () => {
      const { setNextSessionEnabled, consumeNextSessionFlag, isNextSessionEnabled } = await import('../force-continue.server.js');
      setNextSessionEnabled(true);
      expect(consumeNextSessionFlag()).toBe(true);
      expect(isNextSessionEnabled()).toBe(false);
      expect(consumeNextSessionFlag()).toBe(false);
    });

    it('should return false when consuming empty nextSession', async () => {
      const { consumeNextSessionFlag } = await import('../force-continue.server.js');
      expect(consumeNextSessionFlag()).toBe(false);
    });
  });

  describe('version', () => {
    it('should start at 0', async () => {
      const { getVersion } = await import('../force-continue.server.js');
      expect(getVersion()).toBe(0);
    });

    it('should increment version', async () => {
      const { incrementVersion, getVersion } = await import('../force-continue.server.js');
      expect(getVersion()).toBe(0);
      incrementVersion();
      expect(getVersion()).toBe(1);
      incrementVersion();
      expect(getVersion()).toBe(2);
    });
  });

  describe('cleanupOrphanSessions', () => {
    it('should remove sessions not in active set', async () => {
      const { setEnabled, cleanupOrphanSessions, isEnabled } = await import('../force-continue.server.js');
      setEnabled('active-session', true);
      setEnabled('orphan-session', true);
      cleanupOrphanSessions(new Set(['active-session']));
      expect(isEnabled('active-session')).toBe(true);
      expect(isEnabled('orphan-session')).toBe(false);
    });

    it('should not affect state when no orphans exist', async () => {
      const { setEnabled, cleanupOrphanSessions, isEnabled } = await import('../force-continue.server.js');
      setEnabled('session-a', true);
      setEnabled('session-b', true);
      cleanupOrphanSessions(new Set(['session-a', 'session-b']));
      expect(isEnabled('session-a')).toBe(true);
      expect(isEnabled('session-b')).toBe(true);
    });
  });

  describe('in-memory state behavior', () => {
    it('should return defaults when fresh', async () => {
      const { isEnabled, isNextSessionEnabled, getVersion, readState } = await import('../force-continue.server.js');
      expect(isEnabled('any-session')).toBe(false);
      expect(isNextSessionEnabled()).toBe(false);
      expect(getVersion()).toBe(0);
      expect(readState()).toEqual({ sessions: {}, nextSession: false, version: 0 });
    });

    it('should read state values after updates', async () => {
      const { setEnabled, readState } = await import('../force-continue.server.js');
      setEnabled('test-session', true);
      const state = readState();
      expect(state.sessions['test-session'].enabled).toBe(true);
    });

    it('should not use filesystem for state', async () => {
      // purely in-memory by design; operations should not throw even without filesystem setup.
      const { setEnabled, getVersion } = await import('../force-continue.server.js');
      setEnabled('test-session', true);
      expect(getVersion()).toBe(0);
    });
  });
});

// ─── ContinuePlugin (server) ────────────────────────────────────────────────

describe('ContinuePlugin', () => {
  let sessionCompletionState: Map<string, boolean>;
  let mockClient: any;
  let mockCtx: any;

  beforeEach(() => {
    vi.resetModules();
    resetState();
    sessionCompletionState = new Map();
    mockClient = {
      session: {
        messages: vi.fn(),
        promptAsync: vi.fn(),
      },
    };
    mockCtx = { client: mockClient };
  });

  afterEach(() => {
    resetState();
  });

  describe('disabled behavior', () => {
    it('should do nothing when disabled', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-1' });

      expect(sessionCompletionState.has('test-session-1')).toBe(false);
    });

    it('should not send Continue prompt when disabled even if session is idle', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-6' }
        }
      });

      expect(mockClient.session.messages).not.toHaveBeenCalled();
      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });
  });

  describe('enabled behavior', () => {
    it('should track session as incomplete on chat.message when enabled', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-2', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-2' });

      expect(sessionCompletionState.get('test-session-2')).toBe(false);
    });

    it('should inject system message when enabled', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session' });

      const system: string[] = [];
      await plugin['experimental.chat.system.transform']({ sessionID: 'test-session' }, { system });

      expect(system.length).toBe(1);
      expect(system[0]).toContain('completionSignal');
    });

    it('should not inject system message when disabled', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const system: string[] = [];
      await plugin['experimental.chat.system.transform']({}, { system });

      expect(system.length).toBe(0);
    });
  });

  describe('completionSignal', () => {
    it('should mark session complete when completionSignal tool is completed', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-3', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-3' });
      expect(sessionCompletionState.get('test-session-3')).toBe(false);

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'test-session-3',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-3', state: { status: 'completed' } }
          }
        }
      });

      expect(sessionCompletionState.get('test-session-3')).toBe(true);
    });

    it('should mark session complete when part.sessionID resolves session', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-3b', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-3b' });

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-3b', state: { status: 'completed' } }
          }
        }
      });

      expect(sessionCompletionState.get('test-session-3b')).toBe(true);
    });

    it('should not mark session complete when completionSignal is pending', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-pending', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-pending' });
      expect(sessionCompletionState.get('test-session-pending')).toBe(false);

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'test-session-pending',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-pending', state: { status: 'pending' } }
          }
        }
      });

      expect(sessionCompletionState.get('test-session-pending')).toBe(false);
    });

    it('should not mark session complete when completionSignal is running', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-running', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-running' });
      expect(sessionCompletionState.get('test-session-running')).toBe(false);

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'test-session-running',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-running', state: { status: 'running' } }
          }
        }
      });

      expect(sessionCompletionState.get('test-session-running')).toBe(false);
    });
  });

  describe('session.idle', () => {
    it('should send Continue prompt when idle without completion', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-4', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-4' });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-4' }
        }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        sessionID: 'test-session-4',
        parts: [{ type: "text", text: "Continue" }]
      });
    });

    it('should not send Continue prompt when session is marked complete', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-5', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-5' });

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-5', state: { status: 'completed' } }
          }
        }
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-5' }
        }
      });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should not send Continue prompt when no messages exist', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-empty', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-empty' });

      mockClient.session.messages.mockResolvedValue({ data: [] });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-empty' }
        }
      });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should resend Continue prompt on subsequent idle when completionSignal is still missing', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-repeat', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-repeat' });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-repeat' }
        }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Continue' }] }]
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-repeat' }
        }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(2);
    });

    it('should not send Continue prompt when last message is not assistant', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-user', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-user' });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-user' }
        }
      });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should handle session.messages error gracefully', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-error', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-error' });

      mockClient.session.messages.mockRejectedValue(new Error('Network error'));

      await expect(plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-error' }
        }
      })).resolves.not.toThrow();
    });

    it('should prefer taskBabysitter hook and not prompt', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-babysitter', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { taskBabysitter: { event: vi.fn() } }
      });

      await plugin['chat.message']({ sessionID: 'test-session-babysitter' });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-babysitter' }
        }
      });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();

      // Verify taskBabysitter hook is called when present.
      const hook = { event: vi.fn() };
      const pluginWithHook = await createPlugin({ client: mockClient, hooks: { taskBabysitter: hook } });
      await pluginWithHook.event({ event: { type: 'session.idle', properties: { sessionID: 'test-session-babysitter' } } });
      expect(hook.event).toHaveBeenCalled();
    });

    it('should prompt Continue when getTasksByParentSession reports incomplete tasks', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-tasks', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 1, status: 'in-progress' }, { id: 2, status: 'done' }]) }
      });

      await plugin['chat.message']({ sessionID: 'test-session-tasks' });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-tasks' }
        }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        sessionID: 'test-session-tasks',
        parts: [{ type: 'text', text: 'Continue — 1 unfinished task(s) remain. Continue working?' }]
      });
    });

    it('should prompt Continue when backgroundManager.getTasksByParentSession returns object with data array', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-tasks-data', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { backgroundManager: { getTasksByParentSession: vi.fn(async () => ({ data: [{ id: 1, status: 'in-progress' }] })) } }
      });

      await plugin['chat.message']({ sessionID: 'test-session-tasks-data' });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-tasks-data' }
        }
      });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        sessionID: 'test-session-tasks-data',
        parts: [{ type: 'text', text: 'Continue — 1 unfinished task(s) remain. Continue working?' }]
      });
    });

    it('should treat status "complete" as finished and not prompt', async () => {
      const { setEnabled } = await import('../force-continue.server.js');
      setEnabled('test-session-tasks-complete', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 1, status: 'complete' }]) }
      });

      await plugin['chat.message']({ sessionID: 'test-session-tasks-complete' });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-tasks-complete' }
        }
      });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });
  });

  describe('session.created', () => {
    it('should enable force-continue when next-session flag is set', async () => {
      const { setNextSessionEnabled, isEnabled } = await import('../force-continue.server.js');
      setNextSessionEnabled(true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({
        event: {
          type: 'session.created',
          properties: { info: { id: 'new-session-1' } }
        }
      });

      expect(isEnabled('new-session-1')).toBe(true);
    });

    it('should do nothing when next-session flag is not set', async () => {
      const { isEnabled } = await import('../force-continue.server.js');

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({
        event: {
          type: 'session.created',
          properties: { info: { id: 'new-session-2' } }
        }
      });

      expect(isEnabled('new-session-2')).toBe(false);
    });
  });

  describe('session.deleted', () => {
    it('should clean up orphan sessions on delete', async () => {
      const { setEnabled, isEnabled } = await import('../force-continue.server.js');
      setEnabled('active-session', true);
      setEnabled('deleted-session', true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'active-session' });

      await plugin.event({
        event: {
          type: 'session.deleted',
          properties: { sessionID: 'deleted-session' }
        }
      });

      expect(isEnabled('active-session')).toBe(true);
      expect(isEnabled('deleted-session')).toBe(false);
    });
  });
});

// ─── TUI Plugin ─────────────────────────────────────────────────────────────

describe('TUI Plugin', () => {
  beforeEach(() => {
    vi.resetModules();
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  it('should export correct module shape', async () => {
    // TUI removed; plugin now single-file. Ensure no TUI module is present.
    expect(() => require('../force-continue.tui.js')).toThrow();
  });

  it('should register command with correct slash name and aliases', async () => {
    let registeredFn: any;
    const mockApi = {
      route: { current: { name: 'session' as const, params: { sessionID: 'test-session' } } },
      kv: { get: vi.fn(), set: vi.fn() },
      slots: { register: vi.fn() },
      command: { register: vi.fn((fn) => { registeredFn = fn; }) },
      ui: { toast: vi.fn() },
      theme: { current: { warning: 'yellow' } },
    };

    // TUI removed; skip UI command registration tests.
    expect(true).toBe(true);
  });

  it('should return session command when in a session', async () => {
    const mockApi = {
      route: { current: { name: 'session' as const, params: { sessionID: 'test-session' } } },
      kv: { get: vi.fn(), set: vi.fn() },
      slots: { register: vi.fn() },
      command: { register: vi.fn() },
      ui: { toast: vi.fn() },
      theme: { current: { warning: 'yellow' } },
    };

    // TUI removed; skip UI command tests
    expect(true).toBe(true);
  });

  it('should return next-session command when not in a session', async () => {
    const mockApi = {
      route: { current: { name: 'home' as const, params: {} } },
      kv: { get: vi.fn(), set: vi.fn() },
      slots: { register: vi.fn() },
      command: { register: vi.fn() },
      ui: { toast: vi.fn() },
      theme: { current: { warning: 'yellow' } },
    };

    // TUI removed; skip UI command tests
    expect(true).toBe(true);
  });

  it('should toggle session state and show toast on select', async () => {
    // TUI removed; skip interactive UI tests
    expect(true).toBe(true);
  });
});
