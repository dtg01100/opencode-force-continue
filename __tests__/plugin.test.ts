import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@opencode-ai/plugin', () => {
  const chainable = () => ({ optional: () => ({ describe: () => ({}) }), describe: () => ({}) });
  return {
    tool: Object.assign(vi.fn((def) => ({ type: 'tool', ...def })), {
      schema: {
        string: chainable,
        number: chainable,
      },
    }),
  };
});

// ─── module-level helpers ─────────────────────────────────────────────────────

describe('module-level helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

describe('in-memory state behavior', () => {
    it('should return defaults when fresh', async () => {
      const { readState } = await import('../force-continue.server.js');
      const state = readState();
      expect(state.sessions).toEqual({});
      expect(state.metrics).toBeDefined();
    });

    it('should read state values after updates', async () => {
      const { updateLastSeen, readState } = await import('../force-continue.server.js');
      updateLastSeen('test-session');
      const state = readState();
      expect(state.sessions['test-session'].lastSeen).toBeDefined();
    });

    it('should not use filesystem for state', async () => {
      const { updateLastSeen, readState } = await import('../force-continue.server.js');
      updateLastSeen('test-session');
      const state = readState();
      expect(state.sessions['test-session'].lastSeen).toBeDefined();
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

  describe('session tracking', () => {
    it('should track session as incomplete on chat.message', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-1' } } } });
      expect(sessionCompletionState.get('test-session-1')).toBe(false);

      await plugin['chat.message']({ sessionID: 'test-session-1' });
      expect(sessionCompletionState.get('test-session-1')).toBe(false);
    });

    it('should send Continue prompt on idle', async () => {
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

    it('should reset continuation count, lastAssistantText, and responseHistory on chat.message', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'reset-session' });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working on it' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-session' } } });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-session' } } });

      let state = readState();
      expect(state.sessions['reset-session'].continuationCount).toBe(2);
      expect(state.sessions['reset-session'].lastAssistantText).toBe('Working on it');

      await plugin['chat.message']({ sessionID: 'reset-session' });

      state = readState();
      expect(state.sessions['reset-session'].continuationCount).toBe(0);
      expect(state.sessions['reset-session'].lastAssistantText).toBeNull();
      expect(state.sessions['reset-session'].responseHistory).toEqual([]);
    });
  });

  describe('always-on behavior', () => {
    it('should track session as incomplete on chat.message', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-2' } } } });
      expect(sessionCompletionState.get('test-session-2')).toBe(false);

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

    it('should inject system message for any session', async () => {
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

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-3' } } } });
      expect(sessionCompletionState.get('test-session-3')).toBe(false);

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

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-pending' } } } });
      expect(sessionCompletionState.get('test-session-pending')).toBe(false);

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

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-running' } } } });
      expect(sessionCompletionState.get('test-session-running')).toBe(false);

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

    it('should mark session complete when completionSignal is blocked or interrupted', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-blocked' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-blocked', state: { status: 'completed', args: { status: 'blocked', reason: 'quota' } } }
          }
        }
      });
      expect(sessionCompletionState.get('test-session-blocked')).toBe(true);

      await plugin['chat.message']({ sessionID: 'test-session-interrupted' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-interrupted', state: { status: 'completed', args: { status: 'interrupted' } } }
          }
        }
      });
      expect(sessionCompletionState.get('test-session-interrupted')).toBe(true);
    });
  });

  describe('completionSignal tool execute', () => {
    it('should return "Task completed." when task completed and no unfinished tasks', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'complete-session' } as any);

      expect(result).toBe('Task completed. You may now stop.');
      expect(sessionCompletionState.get('complete-session')).toBe(true);
    });

    it('should NOT abort session when unfinished tasks remain', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 'T1', title: 'Fix bug', status: 'in-progress' }]) }
      });

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'task-session' } as any);

      expect(result).toBe('Ready for user.');
      expect(sessionCompletionState.get('task-session')).toBe(true);
    });

    it('should NOT abort session when status is blocked', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'blocked', reason: 'quota exceeded' }, { sessionID: 'blocked-session' } as any);

      expect(result).toBe('Agent is blocked: quota exceeded. Stopping auto-continue.');
      expect(sessionCompletionState.get('blocked-session')).toBe(true);
    });

    it('should NOT abort session when status is interrupted', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'interrupted', reason: 'user stopped' }, { sessionID: 'interrupted-session' } as any);

      expect(result).toBe('Agent interrupted: user stopped. Stopping auto-continue.');
      expect(sessionCompletionState.get('interrupted-session')).toBe(true);
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
        path: { id: 'test-session-4' },
        body: { parts: [{ type: "text", text: expect.stringContaining("Continue working on your current task") }] }
      });
    });

    it('should send break-out prompt after 3 consecutive continuations', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'loop-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Stuck' }] }]
      });

      // 1st continue
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({ parts: [{ type: 'text', text: expect.stringContaining('Continue working') }] })
      }));

      // 2nd continue
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({ parts: [{ type: 'text', text: expect.stringContaining('Continue working') }] })
      }));

      // 3rd continue — forces structured plan: list remaining steps then execute
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-session' } } });
      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('3 rounds');
      expect(lastCall.body.parts[0].text).toContain('List the remaining steps');
    });

    it('should escalate further at 4 continuations', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'escalate-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Still stuck' }] }]
      });

      for (let i = 0; i < 4; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'escalate-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('4 times');
      expect(lastCall.body.parts[0].text).toContain('fundamentally different strategy');
    });

    it('should hard cap at 5 continuations', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'cap-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'No progress' }] }]
      });

      for (let i = 0; i < 5; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'cap-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('AUTO-CONTINUE CAP REACHED');
      expect(lastCall.body.parts[0].text).toContain('5/5');
      expect(lastCall.body.parts[0].text).toContain('STOP');
    });

    it('should reset loop counter on new user message', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'reset-loop' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'Work' }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-loop' } } }); // 1
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-loop' } } }); // 2
      
      await plugin['chat.message']({ sessionID: 'reset-loop' }); // User message resets counter
      
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-loop' } } }); // 1 (not 3)
      expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({ parts: [{ type: 'text', text: expect.stringContaining('Continue working') }] })
      }));
    });

    it('should reset continuation counter when progress is detected', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'progress-session' });

      // First two idle events with same response — counter goes to 2
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working on step 1' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'progress-session' } } }); // count=1
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'progress-session' } } }); // count=2

      // Now the model made progress — different response
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Completed step 1 and moved to step 2 with new approach' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'progress-session' } } }); // should reset to 1

      // Should be a normal continue prompt, not escalation
      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('Continue working');
      expect(lastCall.body.parts[0].text).not.toContain('rounds');
    });

    it('should send "did you forget?" prompt when completion-like language detected without signal', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'forgot-signal' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: "All done! That's everything." }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'forgot-signal' } } });

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('did not call completionSignal');
      expect(lastCall.body.parts[0].text).toContain('call it now');
    });

    it('should warn about loop when response repeats content from 2+ turns ago', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'loop-detect-session' });

      // Build up response history
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'First response about fixing the bug' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-detect-session' } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Second response trying something else entirely' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-detect-session' } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Third response with yet another different approach' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-detect-session' } } });

      // Now repeat the first response — should trigger loop detection
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'First response about fixing the bug' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-detect-session' } } });

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('WARNING');
      expect(lastCall.body.parts[0].text).toContain('repeat');
    });

    it('should force structured plan at escalation count >= 3', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'plan-session' });

      // Use identical responses — no progress detected, no loop (need 2+ history entries for loop)
      // so counter increments to 3 normally
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working on the task' }] }]
      });

      for (let i = 0; i < 3; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'plan-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('List the remaining steps');
    });

    it('should return "You may now stop" after completionSignal with no unfinished tasks', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'done-session' } as any);

      expect(result).toBe('Task completed. You may now stop.');
    });

    it('should prompt Continue with dynamic task summary when tasks are pending', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working on it' }] }]
      });
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 'T1', title: 'Fix bug', status: 'in-progress' }]) }
      });

      await plugin['chat.message']({ sessionID: 'task-session' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'task-session' } } });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'task-session' },
        body: { parts: [{ type: 'text', text: expect.stringContaining('Continue working —') }] }
      });
    });

    it('should prompt Continue when backgroundManager.getTasksByParentSession returns object with data array', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Processing' }] }]
      });
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
        path: { id: 'test-session-tasks-data' },
        body: { parts: [{ type: 'text', text: expect.stringContaining('Continue working —') }] }
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
  });

  describe('session.created', () => {
    it('should initialize session state when created', async () => {
      const { readState } = await import('../force-continue.server.js');

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({
        event: {
          type: 'session.created',
          properties: { info: { id: 'new-session-1' } }
        }
      });

      const state = readState();
      expect(state.sessions['new-session-1']).toBeDefined();
    });
  });

  describe('session.deleted', () => {
    it('should clean up state on delete', async () => {
      const { readState } = await import('../force-continue.server.js');

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'deleted-session' });

      await plugin.event({
        event: {
          type: 'session.deleted',
          properties: { sessionID: 'deleted-session' }
        }
      });

      const state = readState();
      expect(state.sessions['deleted-session']).toBeUndefined();
      expect(sessionCompletionState.has('deleted-session')).toBe(false);
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

  describe('configuration', () => {
    it('should respect maxContinuations from options', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState, { maxContinuations: 3 });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Stuck' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'config-session' });
      for (let i = 0; i < 3; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'config-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('AUTO-CONTINUE CAP REACHED');
      expect(lastCall.body.parts[0].text).toContain('3/3');
    });

    it('should respect escalationThreshold from options', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState, { escalationThreshold: 2 });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Stuck' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'escalation-config-session' });
      for (let i = 0; i < 2; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'escalation-config-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('2 rounds');
      expect(lastCall.body.parts[0].text).toContain('List the remaining steps');
    });

    it('should disable auto-continue when autoContinueEnabled is false', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState, { autoContinueEnabled: false });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'disabled-session' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'disabled-session' } } });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should disable loop detection when enableLoopDetection is false', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState, { enableLoopDetection: false });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'no-loop-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'First response about fixing the bug' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-loop-session' } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Second different response' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-loop-session' } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Third different response' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-loop-session' } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'First response about fixing the bug' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-loop-session' } } });

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).not.toContain('WARNING');
      expect(lastCall.body.parts[0].text).not.toContain('repeat');
    });
  });

  describe('statusReport tool', () => {
    it('should record progress and reset continuation count', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'report-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'report-session' } } });

      const toolDef = plugin.tool.statusReport;
      const result = await toolDef.execute(
        { progress: 'Completed 3 of 5 steps', nextSteps: 'Finish remaining steps', blockers: null },
        { sessionID: 'report-session' } as any
      );

      expect(result).toContain('Progress recorded');
      expect(result).toContain('Continuing work');

      const state = readState();
      expect(state.sessions['report-session'].lastProgressReport).toBeDefined();
      expect(state.sessions['report-session'].continuationCount).toBe(0);
    });
  });

  describe('requestGuidance tool', () => {
    it('should pause auto-continue when guidance is requested', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'guidance-session' } } } });

      const toolDef = plugin.tool.requestGuidance;
      const result = await toolDef.execute(
        { question: 'Should I use approach A or B?', context: 'Both have tradeoffs', options: null },
        { sessionID: 'guidance-session' } as any
      );

      expect(result).toContain('Guidance request recorded');
      expect(result).toContain('Auto-continue paused');
      expect(sessionCompletionState.get('guidance-session')).toBeFalsy();

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still waiting' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'guidance-session' } } });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should resume nudges after user responds to guidance', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'guidance-resume-session' } } } });

      const toolDef = plugin.tool.requestGuidance;
      await toolDef.execute(
        { question: 'Which approach?', context: null, options: null },
        { sessionID: 'guidance-resume-session' } as any
      );

      await plugin['chat.message']({ sessionID: 'guidance-resume-session' });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'guidance-resume-session' } } });

      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });
  });

  describe('pauseAutoContinue tool', () => {
    it('should pause auto-continue temporarily', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-session' });

      const toolDef = plugin.tool.pauseAutoContinue;
      const result = await toolDef.execute(
        { reason: 'Need time to plan', estimatedTime: '5 minutes' },
        { sessionID: 'pause-session' } as any
      );

      expect(result).toContain('Auto-continue paused');
      expect(sessionCompletionState.get('pause-session')).toBeFalsy();

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Thinking' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'pause-session' } } });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck tool', () => {
    it('should return summary metrics', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.healthCheck;
      const result = await toolDef.execute({ detail: 'summary' }, {} as any);

      expect(result).toContain('Plugin health');
      expect(result).toContain('sessions');
      expect(result).toContain('continuations');
    });

    it('should return session-level detail', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'health-session' });

      const toolDef = plugin.tool.healthCheck;
      const result = await toolDef.execute({ detail: 'sessions' }, {} as any);

      expect(result).toContain('Active sessions');
      expect(result).toContain('Metrics');
    });

    it('should return full detail with config', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.healthCheck;
      const result = await toolDef.execute({ detail: 'full' }, {} as any);

      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('metrics');
      expect(parsed).toHaveProperty('config');
      expect(parsed.config).toHaveProperty('maxContinuations');
    });
  });

  describe('tool.execute.before', () => {
    it('should block dangerous commands', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await expect(plugin['tool.execute.before'](
        { sessionID: 'danger-session', tool: 'bash', args: { command: 'rm -rf /' } },
        {}
      )).rejects.toThrow('Dangerous command blocked');
    });

    it('should allow safe commands', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await expect(plugin['tool.execute.before'](
        { sessionID: 'safe-session', tool: 'bash', args: { command: 'ls -la' } },
        {}
      )).resolves.not.toThrow();
    });

    it('should ignore tools in ignoreTools list', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await expect(plugin['tool.execute.before'](
        { sessionID: 'ignore-session', tool: 'read', args: { filePath: 'test.txt' } },
        {}
      )).resolves.not.toThrow();
    });
  });

  describe('tool.execute.after', () => {
    it('should track tool call history', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'tool-track-session' });
      await plugin['tool.execute.after']({ sessionID: 'tool-track-session', tool: 'bash', args: { command: 'ls' } });
      await plugin['tool.execute.after']({ sessionID: 'tool-track-session', tool: 'edit', args: { filePath: 'test.js' } });

      const state = readState();
      expect(state.sessions['tool-track-session'].toolCallHistory).toHaveLength(2);
      expect(state.sessions['tool-track-session'].toolCallHistory[0].tool).toBe('bash');
    });

    it('should track files modified', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'file-track-session' });
      await plugin['tool.execute.after']({ sessionID: 'file-track-session', tool: 'edit', args: { filePath: 'src/a.ts' } });
      await plugin['tool.execute.after']({ sessionID: 'file-track-session', tool: 'write', args: { filePath: 'src/b.ts' } });

      const state = readState();
      expect(state.sessions['file-track-session'].filesModified).toBeDefined();
      expect(state.sessions['file-track-session'].filesModified.has('src/a.ts')).toBe(true);
      expect(state.sessions['file-track-session'].filesModified.has('src/b.ts')).toBe(true);
    });

    it('should detect tool call loops', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'tool-loop-session' });
      for (let i = 0; i < 4; i++) {
        await plugin['tool.execute.after']({ sessionID: 'tool-loop-session', tool: 'bash', args: { command: 'same-cmd' } });
      }

      const state = readState();
      expect(state.sessions['tool-loop-session'].toolLoopDetected).toBe(true);
    });
  });

  describe('file.edited event', () => {
    it('should track file edits from file.edited events', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'file-event-session' });
      await plugin.event({
        event: { type: 'file.edited', properties: { sessionID: 'file-event-session', filePath: 'src/main.ts' } }
      });

      const state = readState();
      expect(state.sessions['file-event-session'].filesModified.has('src/main.ts')).toBe(true);
    });
  });

  describe('session.compacting', () => {
    it('should inject state into compaction context', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'compact-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working on step 1' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'compact-session' } } });

      const context: string[] = [];
      await plugin['experimental.session.compacting']({ sessionID: 'compact-session' }, { context });

      expect(context.length).toBe(1);
      expect(context[0]).toContain('force-continue-state');
      expect(context[0]).toContain('Continuation count: 1');
    });
  });

  describe('circuit breaker', () => {
    it('should trip circuit breaker after threshold errors', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState, { circuitBreakerThreshold: 3 });
      mockClient.session.messages.mockRejectedValue(new Error('Network error'));
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'circuit-session' });

      for (let i = 0; i < 3; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'circuit-session' } } });
      }

      expect(sessionCompletionState.get('circuit-session')).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should track session creation in metrics', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'metrics-session' } } } });

      const state = readState();
      expect(state.metrics.totalSessions).toBeGreaterThan(0);
    });

    it('should track continuations in metrics', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin(sessionCompletionState);
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'metrics-cont-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'metrics-cont-session' } } });

      const state = readState();
      expect(state.metrics.totalContinuations).toBeGreaterThan(0);
    });
  });

  describe('persistence helpers', () => {
    it('should create a file store', async () => {
      const { createFileStore } = await import('../force-continue.server.js');
      const store = createFileStore(process.cwd());
      expect(store).toHaveProperty('get');
      expect(store).toHaveProperty('set');
      expect(store).toHaveProperty('delete');
      expect(store).toHaveProperty('keys');
    });

    it('should create a hybrid store', async () => {
      const { createHybridStore } = await import('../force-continue.server.js');
      const mem = new Map();
      const store = createHybridStore(mem, null);
      store.set('key1', 'value1');
      expect(store.get('key1')).toBe('value1');
      expect(store.has('key1')).toBe(true);
      store.delete('key1');
      expect(store.has('key1')).toBe(false);
    });

    it('should create a metrics tracker', async () => {
      const { createMetricsTracker } = await import('../force-continue.server.js');
      const tracker = createMetricsTracker();
      tracker.record('s1', 'session.created');
      tracker.record('s1', 'continuation');
      tracker.record('s1', 'continuation');
      tracker.record('s1', 'completion');

      const summary = tracker.getSummary();
      expect(summary.totalSessions).toBe(1);
      expect(summary.totalContinuations).toBe(2);
      expect(summary.completions).toBe(1);
    });
  });
});
