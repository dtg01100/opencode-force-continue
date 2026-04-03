import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@opencode-ai/plugin', () => ({
  tool: vi.fn(() => ({ type: 'tool' })),
}));

// ─── flags.js ───────────────────────────────────────────────────────────────

describe('flags.js', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('isEnabled', () => {
    it('should return true for any non-empty session (always enabled)', async () => {
      const { isEnabled } = await import('../force-continue.server.js');
      expect(isEnabled('test-session')).toBe(true);
    });

    it('should return false for null/undefined/empty sessionID', async () => {
      const { isEnabled } = await import('../force-continue.server.js');
      expect(isEnabled(null as any)).toBe(false);
      expect(isEnabled(undefined as any)).toBe(false);
      expect(isEnabled('' as any)).toBe(false);
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

  describe('in-memory state behavior', () => {
    it('should return defaults when fresh', async () => {
      const { isEnabled, isNextSessionEnabled, readState } = await import('../force-continue.server.js');
      expect(isEnabled('any-session')).toBe(true);
      expect(isNextSessionEnabled()).toBe(false);
      expect(readState()).toEqual({ sessions: {}, nextSession: false });
    });

    it('should read state values after updates', async () => {
      const { updateLastSeen, readState } = await import('../force-continue.server.js');
      updateLastSeen('test-session');
      const state = readState();
      expect(state.sessions['test-session'].enabled).toBe(true);
    });

    it('should not use filesystem for state', async () => {
      const { updateLastSeen, isNextSessionEnabled } = await import('../force-continue.server.js');
      updateLastSeen('test-session');
      expect(isNextSessionEnabled()).toBe(false);
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
    sessionCompletionState = new Map();
    mockClient = {
      session: {
        messages: vi.fn(),
        promptAsync: vi.fn(),
      },
    };
    mockCtx = { client: mockClient };
  });

  describe('disabled behavior', () => {
    it('should track session as incomplete on chat.message even when not manually enabled', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-1' });

      expect(sessionCompletionState.has('test-session-1')).toBe(true);
      expect(sessionCompletionState.get('test-session-1')).toBe(false);
    });

    it('should send Continue prompt on idle even without manual enablement', async () => {
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

      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });
  });

  describe('enabled behavior', () => {
    it('should track session as incomplete on chat.message', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-2' });

      expect(sessionCompletionState.get('test-session-2')).toBe(false);
    });

    it('should inject system message when requested', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session' });

      const system: string[] = [];
      await plugin['experimental.chat.system.transform']({ sessionID: 'test-session' }, { system });

      expect(system.length).toBe(1);
      expect(system[0]).toContain('completionSignal');
    });

    it('should inject system message even when not manually enabled (always-on)', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const system: string[] = [];
      await plugin['experimental.chat.system.transform']({ sessionID: 'any-session' }, { system });

      expect(system.length).toBe(1);
      expect(system[0]).toContain('completionSignal');
    });
  });

  describe('completionSignal', () => {
    it('should mark session complete when completionSignal tool is completed', async () => {
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

      expect(isEnabled('new-session-2')).toBe(true);
    });
  });

  describe('session.deleted', () => {
    it('should clean up state on delete', async () => {
      const { isEnabled } = await import('../force-continue.server.js');

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

      const { readState } = await import('../force-continue.server.js');
      const state = readState();
      expect(state.sessions['deleted-session']).toBeUndefined();
    });
  });

  describe('validate tool', () => {
    it('should return capability checks in dry mode', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const res = await plugin.validate({ mode: 'dry' });
      expect(res).toHaveProperty('checks');
      expect(typeof res.ok).toBe('boolean');
    });

    it('should perform a probe and call promptAsync when available', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      mockClient.session.promptAsync = vi.fn(async () => true);
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const res = await plugin.validate({ mode: 'probe', sessionID: 'p1' });
      expect(res).toHaveProperty('probe');
      expect(res.probe.ok).toBe(true);
      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });
  });
});
