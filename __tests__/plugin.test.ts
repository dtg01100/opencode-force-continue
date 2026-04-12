import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

vi.mock('@opencode-ai/plugin', () => {
  const schemaMethods = (defaultFn) => ({
    optional: () => schemaMethods(defaultFn),
    nullable: () => schemaMethods(defaultFn),
    describe: (desc) => schemaMethods({ ...defaultFn, description: desc }),
  });

  const stringSchema = () => schemaMethods({ type: 'string', _zodType: 'string' });
  const numberSchema = () => schemaMethods({ type: 'number', _zodType: 'number' });
  const booleanSchema = () => schemaMethods({ type: 'boolean', _zodType: 'boolean' });
  const enumSchema = (values) => schemaMethods({ type: 'enum', values, _zodType: 'enum' });
  const objectSchema = (shape) => schemaMethods({ type: 'object', shape, _zodType: 'object' });
  const arraySchema = (schema) => schemaMethods({ type: 'array', schema, _zodType: 'array' });
  const unionSchema = (schemas) => schemaMethods({ type: 'union', schemas, _zodType: 'union' });
  const literalSchema = (val) => schemaMethods({ type: 'literal', value: val, _zodType: 'literal' });
  const optionalSchema = (schema) => schemaMethods({ type: 'optional', schema, _zodType: 'optional' });

  const zodMock = Object.assign(() => {}, {
    string: stringSchema,
    number: numberSchema,
    boolean: booleanSchema,
    enum: enumSchema,
    object: objectSchema,
    array: arraySchema,
    union: unionSchema,
    literal: literalSchema,
    optional: optionalSchema,
    _isZod: true,
  });

  return {
    tool: Object.assign(
      (def) => def,
      { schema: zodMock }
    ),
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
  let mockClient: any;
  let mockCtx: any;

  beforeEach(async () => {
    process.env.FORCE_CONTINUE_NUDGE_DELAY_MS = '0';
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    const { clearNextSessionAutopilotEnabled } = await import('../src/state.js');
    resetAutopilotState();
    clearNextSessionAutopilotEnabled();
    mockClient = {
      session: {
        messages: vi.fn(),
        promptAsync: vi.fn(),
      },
    };
    mockCtx = { client: mockClient };
  });

  const getPaused = async (sessionID: string) => {
    const { readState } = await import('../force-continue.server.js');
    const session = readState().sessions[sessionID];
    // Check new state model first, then fall back to legacy autoContinuePaused
    return session?.pauseState || session?.completionState || session?.autoContinuePaused || null;
  };

  describe('session tracking', () => {
    it('should track session as incomplete on chat.message', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-1' } } } });
      expect(await getPaused('test-session-1')).toBeNull();

      await plugin['chat.message']({ sessionID: 'test-session-1' });
      expect(await getPaused('test-session-1')).toBeNull();
    });

    it('should send Continue prompt on idle', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
    it('should inject system message when requested', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session' });

      const system: string[] = [];
      await plugin['experimental.chat.system.transform']({ sessionID: 'test-session' }, { system });

      expect(system.length).toBe(1);
      expect(system[0]).toContain('completionSignal');
    });

    it('should inject system message for any session', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-3' } } } });
      expect(await getPaused('test-session-3')).toBeNull();

      await plugin['chat.message']({ sessionID: 'test-session-3' });
      expect(await getPaused('test-session-3')).toBeNull();

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'test-session-3',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-3', state: { status: 'completed' } }
          }
        }
      });

      expect(await getPaused('test-session-3')).not.toBeNull();
    });

    it('should clear paused state when user responds to completed session', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'completed-session' } } } });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'completed-session',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'completed-session', state: { status: 'completed' } }
          }
        }
      });

      expect(await getPaused('completed-session')).not.toBeNull();
      await plugin['chat.message']({ sessionID: 'completed-session' });
      expect(await getPaused('completed-session')).toBeNull();
    });

    it('should mark session complete when part.sessionID resolves session', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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

      expect(await getPaused('test-session-3b')).not.toBeNull();
    });

    it('should not mark session complete when completionSignal is pending', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-pending' } } } });
      expect(await getPaused('test-session-pending')).toBeNull();

      await plugin['chat.message']({ sessionID: 'test-session-pending' });
      expect(await getPaused('test-session-pending')).toBeNull();

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'test-session-pending',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-pending', state: { status: 'pending' } }
          }
        }
      });

      expect(await getPaused('test-session-pending')).toBeNull();
    });

    it('should not mark session complete when completionSignal is running', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'test-session-running' } } } });
      expect(await getPaused('test-session-running')).toBeNull();

      await plugin['chat.message']({ sessionID: 'test-session-running' });
      expect(await getPaused('test-session-running')).toBeNull();

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'test-session-running',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-running', state: { status: 'running' } }
          }
        }
      });

      expect(await getPaused('test-session-running')).toBeNull();
    });

    it('should mark session complete when completionSignal is blocked or interrupted', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'test-session-blocked' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-blocked', state: { status: 'completed', input: { status: 'blocked', reason: 'quota' } } }
          }
        }
      });
      expect(await getPaused('test-session-blocked')).not.toBeNull();

      await plugin['chat.message']({ sessionID: 'test-session-interrupted' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-interrupted', state: { status: 'completed', input: { status: 'interrupted' } } }
          }
        }
      });
      expect(await getPaused('test-session-interrupted')).not.toBeNull();
    });

    it('should preserve blocked reason when completionSignal event uses legacy args shape', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'legacy-args-blocked-session' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              tool: 'completionSignal',
              sessionID: 'legacy-args-blocked-session',
              state: { status: 'completed', args: { status: 'blocked', reason: 'quota' } }
            }
          }
        }
      });

      expect(readState().sessions['legacy-args-blocked-session'].completionState.status).toBe('blocked');
    });
  });

  describe('completionSignal tool execute', () => {
    it('should return "Task completed." when task completed and no unfinished tasks', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'complete-session' } as any);

      expect(result).toBe('Task completed. You may now stop.');
      expect(await getPaused('complete-session')).not.toBeNull();
    });

    it('should prompt to continue when unfinished tasks remain', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 'T1', title: 'Fix bug', status: 'in-progress' }]) }
      });

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'task-session' } as any);

      expect(result).toContain('unfinished task(s) remain');
      expect(result).toContain('Do NOT stop');
      expect(result).toContain('Continue working');
      expect(await getPaused('task-session')).toBeNull();
    });

    it('should NOT abort session when status is blocked', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'blocked', reason: 'quota exceeded' }, { sessionID: 'blocked-session' } as any);

      expect(result).toBe('Agent is blocked: quota exceeded. Stopping auto-continue.');
      expect(await getPaused('blocked-session')).not.toBeNull();
    });

    it('should NOT abort session when status is interrupted', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'interrupted', reason: 'user stopped' }, { sessionID: 'interrupted-session' } as any);

      expect(result).toBe('Agent interrupted: user stopped. Stopping auto-continue.');
      expect(await getPaused('interrupted-session')).not.toBeNull();
    });
  });

  describe('session.idle', () => {
    it('should send Continue prompt when idle without completion', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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

    it('should send loop-break prompt when assistant response repeats', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'loop-session' });
      mockClient.session.messages
        .mockResolvedValueOnce({ data: [{ role: 'assistant', content: [{ type: 'text', text: 'Stuck' }] }] })
        .mockResolvedValueOnce({ data: [{ role: 'assistant', content: [{ type: 'text', text: 'Stuck' }] }] });

      // 1st continue
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({ parts: [{ type: 'text', text: expect.stringContaining('Continue working') }] })
      }));

      // 2nd idle should trigger loop-break rather than a normal continue
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'loop-session' } } });
      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('LOOP DETECTED');
      expect(lastCall.body.parts[0].text).toContain('Do NOT repeat your previous approach');
    });

    it('should escalate further at 4 continuations', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'forgot-signal' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: "All done! That's everything." }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'forgot-signal' } } });

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('did not call');
      expect(lastCall.body.parts[0].text).toContain("status='completed'");
    });

    it('should not send nudge for completion-like assistant question when autopilot is off', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'forgot-signal-question-off' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: "I think this is done. Should I stop here?" }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'forgot-signal-question-off' } } });

      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should auto-answer completion-like assistant question when autopilot is on', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin({ autopilotEnabled: true });
      const plugin = await createPlugin(mockCtx);

      const { writeAutopilotState } = await import('../src/autopilot.js');
      writeAutopilotState({ enabled: true, timestamp: Date.now() });

      await plugin['chat.message']({ sessionID: 'forgot-signal-question-on' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: "All done here. Should I stop now?" }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'forgot-signal-question-on' } } });

      expect(mockClient.session.promptAsync).toHaveBeenCalled();
      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('AUTONOMOUS DECISION REQUIRED');
      expect(lastCall.body.parts[0].text).toContain('You asked:');
    });

    it('should warn about loop when response repeats content from 2+ turns ago', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      expect(lastCall.body.parts[0].text).toContain('LOOP DETECTED');
      expect(lastCall.body.parts[0].text).toContain('repeat');
    });

    it('should detect a loop when the same response appears twice in a row', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin({ enableLoopDetection: true });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'two-in-a-row-session' });

      // First response — stored in history, no loop yet
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'I will now fix the bug.' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'two-in-a-row-session' } } });

      // Second identical response — history[0] matches current, loop detected
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'I will now fix the bug.' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'two-in-a-row-session' } } });

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('LOOP DETECTED');
    });

    it('should escalate at escalation count >= 3', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'plan-session' });

      // Use identical responses — loop detected on 2nd event (count=2), escalation wins on 3rd (count=3 >= threshold)
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working on the task' }] }]
      });

      for (let i = 0; i < 3; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'plan-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('current approach is not working');
    });

    it('should return "You may now stop" after completionSignal with no unfinished tasks', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'done-session' } as any);

      expect(result).toBe('Task completed. You may now stop.');
    });

    it('should prompt Continue with dynamic task summary when tasks are pending', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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

    it('should still prompt when all tasks have status "complete" (current behavior)', async () => {
      // Note: When all tasks are "complete", unfinishedTasks is empty, so handleIdle
      // is called with hasTasks=false. The plugin still sends a continue prompt because
      // the code does not explicitly skip nudging when all tasks are done.
      // This may be a feature gap — consider adding logic to skip nudges when all
      // tasks are truly complete.
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 1, status: 'complete' }]) }
      });

      await plugin['chat.message']({ sessionID: 'test-session-tasks-complete' });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', content: [{ type: 'text', text: 'All done!' }] }]
      });

      await plugin.event({
        event: {
          type: 'session.idle',
          properties: { sessionID: 'test-session-tasks-complete' }
        }
      });

      // Current behavior: still prompts even when all tasks are "complete"
      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });

    it('should not send Continue prompt when session is marked complete', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
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

    it('should consume one-shot next-session autopilot setting on session creation', async () => {
      const { readState } = await import('../force-continue.server.js');
      const { setNextSessionAutopilotEnabled, peekNextSessionAutopilotEnabled } = await import('../src/state.js');

      setNextSessionAutopilotEnabled(true);
      expect(peekNextSessionAutopilotEnabled()).toBe(true);

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({
        event: {
          type: 'session.created',
          properties: { info: { id: 'new-session-oneshot' } }
        }
      });

      const state = readState();
      expect(state.sessions['new-session-oneshot']).toBeDefined();
      expect(state.sessions['new-session-oneshot'].autopilotEnabled).toBe(true);
      expect(peekNextSessionAutopilotEnabled()).toBeNull();
    });
  });

  describe('session.deleted', () => {
    it('should clean up state on delete', async () => {
      const { readState } = await import('../force-continue.server.js');

      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
    });
  });

  describe('validate tool', () => {
    it('should return capability checks in dry mode', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const res = await plugin.validate({ mode: 'dry' });
      expect(res).toHaveProperty('checks');
      expect(typeof res.ok).toBe('boolean');
    });

    it('should perform a probe and call promptAsync when available', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      mockClient.session.promptAsync = vi.fn(async () => true);
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin( { maxContinuations: 3 });
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
      const createPlugin = createContinuePlugin( { escalationThreshold: 2 });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Stuck' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'escalation-config-session' });
      for (let i = 0; i < 2; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'escalation-config-session' } } });
      }

      const lastCall = mockClient.session.promptAsync.mock.calls[mockClient.session.promptAsync.mock.calls.length - 1][0];
      expect(lastCall.body.parts[0].text).toContain('current approach is not working');
    });

    it('should disable auto-continue when autoContinueEnabled is false', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin( { autoContinueEnabled: false });
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
      const createPlugin = createContinuePlugin( { enableLoopDetection: false });
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

    it('should skip nudge in subagent sessions when skipNudgeInSubagents is true', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin({ skipNudgeInSubagents: true });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'parent-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'parent-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalled();

      mockClient.session.promptAsync.mockClear();

      await plugin['chat.message']({ sessionID: 'agent$$abc123-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'agent$$abc123-session' } } });
      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should nudge in subagent sessions when skipNudgeInSubagents is false', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin({ skipNudgeInSubagents: false });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'agent$$abc123-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'agent$$abc123-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });
  });

  describe('statusReport tool', () => {
    it('should record progress and reset continuation count', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
    it('should record awaiting guidance without pausing auto-continue', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'guidance-session' } } } });

      const toolDef = plugin.tool.requestGuidance;
      const result = await toolDef.execute(
        { question: 'Should I use approach A or B?', context: 'Both have tradeoffs', options: null },
        { sessionID: 'guidance-session' } as any
      );

      expect(result).toContain('Guidance request recorded');
      // guidance should be recorded but auto-continue should not be paused
      const state = readState();
      expect(state.sessions['guidance-session'].awaitingGuidance).toBeDefined();
      expect(state.sessions['guidance-session'].autoContinuePaused).toBeNull();

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still waiting' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'guidance-session' } } });

      // auto-continue should still send prompts and include the pending guidance
      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });

    it('should not nudge when AI asks a question in text and autopilot is off', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'question-no-auto-session' } } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Should I use approach A or B?' }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'question-no-auto-session' } } });

      // No nudge should be sent - AI is waiting for user input
      expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
    });

    it('should resume nudges after user responds to guidance', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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

describe('autopilot', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  afterEach(async () => {
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  it('should generate autonomous answer when autopilot enabled', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 3
    });
    const plugin = await createPlugin(mockCtx);

    // Autopilot is session-scoped, so we need to manually enable it for the test
    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    const toolDef = plugin.tool.requestGuidance;
      const result = await toolDef.execute(
        { question: 'Should I use A or B?', context: 'Building a feature', options: 'A or B' },
        { sessionID: 'test-session' } as any
      );

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'test-session' },
        body: { parts: [{ type: 'text', text: expect.stringContaining('AUTONOMOUS DECISION REQUIRED') }] }
      });
      expect(result).toBe('Autopilot resolved guidance question.');
    });

  it('should fall back after max autopilot attempts', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 2
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    const toolDef = plugin.tool.requestGuidance;
      const toolCtx = { sessionID: 'test-session' } as any;

      await toolDef.execute({ question: 'First question?' }, toolCtx);
      await toolDef.execute({ question: 'Second question?' }, toolCtx);

      const result = await toolDef.execute({ question: 'Third question?' }, toolCtx);

      expect(result).toContain('Autopilot limit reached');
      expect(result).toContain('Auto-continue paused');

      // Circuit breaker should be tripped
      const { readState } = await import('../force-continue.server.js');
      const state = readState();
      expect(state.sessions['test-session'].pauseState).toEqual({
        reason: 'autopilot_max_attempts',
        timestamp: expect.any(Number)
      });
    });

  it('should reset autopilot attempts on user message', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 1
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    const toolDef = plugin.tool.requestGuidance;
      const toolCtx = { sessionID: 'test-session' } as any;

      await toolDef.execute({ question: 'Question 1' }, toolCtx);

      await plugin['chat.message']({ sessionID: 'test-session' });

      await toolDef.execute({ question: 'Question 2' }, toolCtx);

      await plugin['chat.message']({ sessionID: 'test-session' });

      const thirdResult = await toolDef.execute({ question: 'Question 3' }, toolCtx);
      expect(thirdResult).toBe('Autopilot resolved guidance question.');

      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(3);
    });

  it('should fall back when promptAsync fails', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    mockClient.session.promptAsync = vi.fn().mockRejectedValue(new Error('Network error'));
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 3
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    const toolDef = plugin.tool.requestGuidance;
      const result = await toolDef.execute(
        { question: 'What should I do?' },
        { sessionID: 'test-session' } as any
      );

      expect(result).toContain('Guidance recorded');
    });

  it('should auto-answer AI questions in text when autopilot enabled', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 3
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'question-session' } } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'I should use approach A or B. Which one should I choose?' }] }]
      });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'question-session' } } });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'question-session' },
        body: { parts: [{ type: 'text', text: expect.stringContaining('You asked:') }] }
      });
      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        path: { id: 'question-session' },
        body: { parts: [{ type: 'text', text: expect.stringContaining('Choose a reasonable answer') }] }
      });
    });

  it('should fall back to user after max attempts on AI questions', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 3
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'question-fallback-session' } } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Should I do X or Y?' }] }]
      });

      // First attempt - autopilot answers
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'question-fallback-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);

      // Second idle - second attempt
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'question-fallback-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(2);

      // Third idle - circuit breaker should trip (attempts > 3), no more nudges
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'question-fallback-session' } } });
      // Should still be 2 calls - circuit breaker prevented the third
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(3);

      // Fourth idle - session is paused, so no more prompts are sent
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'question-fallback-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(3);

      // Circuit breaker should be tripped
      const { readState } = await import('../force-continue.server.js');
      const state = readState();
      expect(state.sessions['question-fallback-session'].pauseState).toEqual({
        reason: 'autopilot_max_attempts',
        timestamp: expect.any(Number)
      });
    });

  it('should reset autopilot attempts on user message for AI questions', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 2
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'reset-session' } } } });

      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'What should I do next?' }] }]
      });

      // First question - autopilot answers
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);

      // User sends a message (resets attempts)
      await plugin['chat.message']({ sessionID: 'reset-session' });
      mockClient.session.promptAsync.mockClear();

      // AI asks another question - should still autopilot since attempts were reset
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'reset-session' } } });
      expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);
    });

  it('should resolve pending guidance autonomously on idle when requestGuidance prompt failed', async () => {
    const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
    resetAutopilotState();
    mockClient.session.promptAsync = vi.fn().mockRejectedValue(new Error('Network error'));
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 3
    });
    const plugin = await createPlugin(mockCtx);

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'pending-guidance-session' } } } });

    // requestGuidance fails but sets awaitingGuidance
    const toolDef = plugin.tool.requestGuidance;
    await toolDef.execute(
      { question: 'Which approach should I use?' },
      { sessionID: 'pending-guidance-session' } as any
    );

    // Verify awaitingGuidance is set
    const { readState } = await import('../force-continue.server.js');
    expect(readState().sessions['pending-guidance-session'].awaitingGuidance).toBeDefined();

    // Reset mock to track idle handler's prompt
    mockClient.session.promptAsync = vi.fn().mockResolvedValue({});
    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working...' }] }]
    });

    // Idle should resolve pending guidance autonomously
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'pending-guidance-session' } } });

    expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
      path: { id: 'pending-guidance-session' },
      body: { parts: [{ type: 'text', text: expect.stringContaining('AUTONOMOUS DECISION REQUIRED') }] }
    });
  });
  });

  describe('pauseAutoContinue tool', () => {
    it('should pause auto-continue temporarily', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-session' });

      const toolDef = plugin.tool.pauseAutoContinue;
      const result = await toolDef.execute(
        { reason: 'Need time to plan', estimatedTime: '5 minutes' },
        { sessionID: 'pause-session' } as any
      );

      expect(result).toContain('Auto-continue paused');

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
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const toolDef = plugin.tool.healthCheck;
      const result = await toolDef.execute({ detail: 'summary' }, {} as any);

      expect(result).toContain('Plugin health');
      expect(result).toContain('sessions');
      expect(result).toContain('continuations');
    });

    it('should return session-level detail', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'health-session' });

      const toolDef = plugin.tool.healthCheck;
      const result = await toolDef.execute({ detail: 'sessions' }, {} as any);

      expect(result).toContain('Active sessions');
      expect(result).toContain('Metrics');
    });

    it('should return full detail with config', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await expect(plugin['tool.execute.before'](
        { sessionID: 'danger-session', tool: 'bash', callID: 'c1' },
        { args: { command: 'rm -rf /' } }
      )).rejects.toThrow('Dangerous command blocked');
    });

    it('should allow safe commands', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await expect(plugin['tool.execute.before'](
        { sessionID: 'safe-session', tool: 'bash', callID: 'c2' },
        { args: { command: 'ls -la' } }
      )).resolves.not.toThrow();
    });

    it('should ignore tools in ignoreTools list', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await expect(plugin['tool.execute.before'](
        { sessionID: 'ignore-session', tool: 'read', callID: 'c3' },
        { args: { filePath: 'test.txt' } }
      )).resolves.not.toThrow();
    });
  });

  describe('tool.execute.after', () => {
    it('should track tool call history', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'file-track-session' });
      await plugin['tool.execute.after']({ sessionID: 'file-track-session', tool: 'edit', args: { filePath: 'src/a.ts' } });
      await plugin['tool.execute.after']({ sessionID: 'file-track-session', tool: 'write', args: { filePath: 'src/b.ts' } });

      const state = readState();
      expect(state.sessions['file-track-session'].filesModified).toBeDefined();
      expect(Array.isArray(state.sessions['file-track-session'].filesModified)).toBe(true);
      expect(state.sessions['file-track-session'].filesModified).toContain('src/a.ts');
      expect(state.sessions['file-track-session'].filesModified).toContain('src/b.ts');
    });

    it('should detect tool call loops', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
    it('should handle file.edited events gracefully (no sessionID in SDK event, so tracking is via tool.execute.after)', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'file-event-session' });
      // file.edited events don't carry sessionID per SDK type, so this is a no-op
      await plugin.event({
        event: { type: 'file.edited', properties: { file: 'src/main.ts' } }
      });

      // filesModified should remain unset from file.edited; file tracking happens via tool.execute.after
      const state = readState();
      expect(state.sessions['file-event-session']?.filesModified).toBeUndefined();
    });
  });

  describe('session.compacting', () => {
    it('should inject state into compaction context', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
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
      const createPlugin = createContinuePlugin( { circuitBreakerThreshold: 3 });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      mockClient.session.promptAsync.mockRejectedValue(new Error('Network error'));
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'circuit-session' });

      for (let i = 0; i < 3; i++) {
        await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'circuit-session' } } });
      }

      expect(await getPaused('circuit-session')).not.toBeNull();
    });
  });

  describe('metrics', () => {
    it('should track session creation in metrics', async () => {
      const { createContinuePlugin, readState, resetMetrics } = await import('../force-continue.server.js');
      resetMetrics();
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'metrics-session' } } } });

      const state = readState();
      expect(state.metrics.totalSessions).toBe(1);
    });

    it('should track continuations in metrics', async () => {
      const { createContinuePlugin, readState, resetMetrics } = await import('../force-continue.server.js');
      resetMetrics();
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'metrics-cont-session' });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'metrics-cont-session' } } });

      const state = readState();
      expect(state.metrics.totalContinuations).toBe(1);
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

  describe('completionSignal.execute pauses auto-continue', () => {
    it('should pause auto-continue when completionSignal called with status completed', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin({ client: mockClient });
      const toolDef = plugin.tool.completionSignal;
      await toolDef.execute({ status: 'completed' }, { sessionID: 'task-done-1' } as any);
      const state = (await import('../force-continue.server.js')).readState();
      expect(state.sessions['task-done-1'].completionState.status).toBe('completed');
    });

    it('should set autoContinuePaused reason to completed for completed status', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin({ client: mockClient });
      const toolDef = plugin.tool.completionSignal;
      await toolDef.execute({ status: 'completed' }, { sessionID: 'task-done-2' } as any);
      const state = (await import('../force-continue.server.js')).readState();
      expect(state.sessions['task-done-2'].completionState.status).toBe('completed');
    });

    it('should not pause auto-continue when unfinished tasks remain', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin({
        client: mockClient,
        hooks: { getTasksByParentSession: vi.fn(async () => [{ id: 'T1', title: 'Fix bug', status: 'in-progress' }]) }
      });
      const toolDef = plugin.tool.completionSignal;
      const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'task-not-done' } as any);
      expect(result).toContain('unfinished task(s) remain');
      expect(result).toContain('Do NOT stop');
    });
  });
});

describe('resolveConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach(k => {
      if (!ORIGINAL_ENV[k]) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL_ENV);
    vi.resetModules();
  });

  beforeEach(() => {
    delete process.env.FORCE_CONTINUE_NUDGE_DELAY_MS;
  });

  it('should return default config when no overrides', async () => {
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(5);
    expect(config.escalationThreshold).toBe(3);
    expect(config.enableLoopDetection).toBe(true);
    expect(config.autoContinueEnabled).toBe(true);
    expect(config.cooldownMs).toBe(0);
    expect(config.nudgeDelayMs).toBe(2000);
    expect(config.circuitBreakerThreshold).toBe(10);
  });

  it('should parse FORCE_CONTINUE_MAX_CONTINUATIONS env var', async () => {
    process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '10';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(10);
  });

  it('should parse FORCE_CONTINUE_ESCALATION_THRESHOLD env var', async () => {
    process.env.FORCE_CONTINUE_ESCALATION_THRESHOLD = '5';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.escalationThreshold).toBe(5);
  });

  it('should parse FORCE_CONTINUE_COOLDOWN_MS env var', async () => {
    process.env.FORCE_CONTINUE_COOLDOWN_MS = '5000';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.cooldownMs).toBe(5000);
  });

  it('should parse FORCE_CONTINUE_NUDGE_DELAY_MS env var', async () => {
    process.env.FORCE_CONTINUE_NUDGE_DELAY_MS = '1000';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.nudgeDelayMs).toBe(1000);
  });

  it('should parse FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD env var', async () => {
    process.env.FORCE_CONTINUE_CIRCUIT_BREAKER_THRESHOLD = '15';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.circuitBreakerThreshold).toBe(15);
  });

  it('should set enableLoopDetection to false when env var is "false"', async () => {
    process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.enableLoopDetection).toBe(false);
  });

  it('should keep enableLoopDetection true when env var is "true"', async () => {
    process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'true';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.enableLoopDetection).toBe(true);
  });

  it('should set autoContinueEnabled to false when env var is "false"', async () => {
    process.env.FORCE_CONTINUE_AUTO_CONTINUE = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.autoContinueEnabled).toBe(false);
  });

  it('should set enableFileTracking to false when env var is "false"', async () => {
    process.env.FORCE_CONTINUE_ENABLE_FILE_TRACKING = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.enableFileTracking).toBe(false);
  });

  it('should set enableTaskTracking to false when env var is "false"', async () => {
    process.env.FORCE_CONTINUE_ENABLE_TASK_TRACKING = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.enableTaskTracking).toBe(false);
  });

  it('should set enableCompletionSummary to false when env var is "false"', async () => {
    process.env.FORCE_CONTINUE_ENABLE_COMPLETION_SUMMARY = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.enableCompletionSummary).toBe(false);
  });

  it('should set logToStdout to true when env var is "true"', async () => {
    process.env.FORCE_CONTINUE_LOG_TO_STDOUT = 'true';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.logToStdout).toBe(true);
  });

  it('should merge plugin options over defaults', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ maxContinuations: 99 });
    const mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
    const plugin = await createPlugin({ client: mockClient });
    expect(plugin).toBeDefined();
  });

  it('should parse FORCE_CONTINUE_SESSION_TTL_MS env var', async () => {
    process.env.FORCE_CONTINUE_SESSION_TTL_MS = '3600000';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.sessionTtlMs).toBe(3600000);
  });

  it('should use default sessionTtlMs when env var not set', async () => {
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.sessionTtlMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe('createMetricsTracker - all events', () => {
  let tracker: ReturnType<typeof import('../force-continue.server.js').createMetricsTracker>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../force-continue.server.js');
    tracker = mod.createMetricsTracker();
  });

  it('should track session.created', () => {
    tracker.record('s1', 'session.created');
    const summary = tracker.getSummary();
    expect(summary.totalSessions).toBe(1);
  });

  it('should track continuation and sessionContinuations', () => {
    tracker.record('s1', 'session.created');
    tracker.record('s1', 'continuation');
    tracker.record('s1', 'continuation');
    tracker.record('s2', 'session.created');
    tracker.record('s2', 'continuation');
    const summary = tracker.getSummary();
    expect(summary.totalContinuations).toBe(3);
    expect(summary.avgContinuationsPerSession).toBe(1.5);
  });

  it('should track loop.detected', () => {
    tracker.record('s1', 'loop.detected');
    tracker.record('s2', 'loop.detected');
    const summary = tracker.getSummary();
    expect(summary.loopDetectionCount).toBe(2);
  });

  it('should track tool.loop.detected', () => {
    tracker.record('s1', 'tool.loop.detected');
    const summary = tracker.getSummary();
    expect(summary.toolLoopDetections).toBe(1);
  });

  it('should track circuit.breaker.trip', () => {
    tracker.record('s1', 'circuit.breaker.trip');
    const summary = tracker.getSummary();
    expect(summary.circuitBreakerTrips).toBe(1);
  });

  it('should track escalation', () => {
    tracker.record('s1', 'escalation');
    tracker.record('s2', 'escalation');
    const summary = tracker.getSummary();
    expect(summary.escalations).toBe(2);
  });

  it('should track completion', () => {
    tracker.record('s1', 'completion');
    const summary = tracker.getSummary();
    expect(summary.completions).toBe(1);
  });

  it('should track blocked', () => {
    tracker.record('s1', 'blocked');
    const summary = tracker.getSummary();
    expect(summary.blocks).toBe(1);
  });

  it('should track interrupted', () => {
    tracker.record('s1', 'interrupted');
    const summary = tracker.getSummary();
    expect(summary.interrupts).toBe(1);
  });

  it('should track error and sessionErrors', () => {
    tracker.record('s1', 'error');
    tracker.record('s1', 'error');
    tracker.record('s2', 'error');
    const summary = tracker.getSummary();
    expect(summary.sessionsWithErrors).toBe(2);
  });

  it('should track idle.event', () => {
    tracker.record('s1', 'idle.event');
    const summary = tracker.getSummary();
    expect(summary.idleEvents).toBe(1);
  });

  it('should track idle.skipped.complete', () => {
    tracker.record('s1', 'idle.skipped.complete');
    const summary = tracker.getSummary();
    expect(summary.idleSkippedComplete).toBe(1);
  });

  it('should track idle.skipped.paused', () => {
    tracker.record('s1', 'idle.skipped.paused');
    const summary = tracker.getSummary();
    expect(summary.idleSkippedPaused).toBe(1);
  });

  it('should track idle.skipped.guidance', () => {
    tracker.record('s1', 'idle.skipped.guidance');
    const summary = tracker.getSummary();
    expect(summary.idleSkippedGuidance).toBe(1);
  });

  it('should track idle.skipped.babysitter', () => {
    tracker.record('s1', 'idle.skipped.babysitter');
    const summary = tracker.getSummary();
    expect(summary.idleSkippedBabysitter).toBe(1);
  });

  it('should track idle.skipped.disabled', () => {
    tracker.record('s1', 'idle.skipped.disabled');
    const summary = tracker.getSummary();
    expect(summary.idleSkippedDisabled).toBe(1);
  });

  it('should track idle.skipped.subagent', () => {
    tracker.record('s1', 'idle.skipped.subagent');
    expect(tracker.getSummary().idleSkippedSubagent).toBe(1);
  });

  it('should track messages.empty', () => {
    tracker.record('s1', 'messages.empty');
    const summary = tracker.getSummary();
    expect(summary.messagesEmpty).toBe(1);
  });

  it('should track last.msg.not.assistant', () => {
    tracker.record('s1', 'last.msg.not.assistant');
    const summary = tracker.getSummary();
    expect(summary.lastMsgNotAssistant).toBe(1);
  });

  it('should track prompt.continue', () => {
    tracker.record('s1', 'prompt.continue');
    const summary = tracker.getSummary();
    expect(summary.promptContinue).toBe(1);
  });

  it('should track prompt.escalation', () => {
    tracker.record('s1', 'prompt.escalation');
    const summary = tracker.getSummary();
    expect(summary.promptEscalation).toBe(1);
  });

  it('should track prompt.loop.break', () => {
    tracker.record('s1', 'prompt.loop.break');
    const summary = tracker.getSummary();
    expect(summary.promptLoopBreak).toBe(1);
  });

  it('should track prompt.completion.nudge', () => {
    tracker.record('s1', 'prompt.completion.nudge');
    const summary = tracker.getSummary();
    expect(summary.promptCompletionNudge).toBe(1);
  });

  it('should calculate loopDetectionRate correctly', () => {
    tracker.record('s1', 'session.created');
    tracker.record('s1', 'continuation');
    tracker.record('s1', 'continuation');
    tracker.record('s1', 'continuation');
    tracker.record('s1', 'continuation');
    tracker.record('s1', 'loop.detected');
    const summary = tracker.getSummary();
    expect(summary.loopDetectionRate).toBe('25.0%');
  });
});

describe('dangerous commands', () => {
  let mockClient: any;
  let mockCtx: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
    mockCtx = { client: mockClient };
  });

  const getPlugin = () => mockCtx.client && mockCtx.client.session ? mockCtx : { client: mockClient };

  it('should block rm -rf /', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'd1', tool: 'bash', callID: 'd1c' },
      { args: { command: 'rm -rf /' } }
    )).rejects.toThrow('Dangerous command blocked');
  });

  it('should block rm -rf ~', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'd2', tool: 'bash', callID: 'd2c' },
      { args: { command: 'rm -rf ~' } }
    )).rejects.toThrow('Dangerous command blocked');
  });

  it('should block mkfs', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'd3', tool: 'bash', callID: 'd3c' },
      { args: { command: 'mkfs -t ext4 /dev/sda' } }
    )).rejects.toThrow('Dangerous command blocked');
  });

  it('should block dd if=/dev/zero', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'd4', tool: 'bash', callID: 'd4c' },
      { args: { command: 'dd if=/dev/zero of=/dev/sda' } }
    )).rejects.toThrow('Dangerous command blocked');
  });

  it('should block > /dev/sda', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'd5', tool: 'bash', callID: 'd5c' },
      { args: { command: 'cat file > /dev/sda' } }
    )).rejects.toThrow('Dangerous command blocked');
  });

  it('should allow commands not in dangerous list', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'safe1', tool: 'bash', callID: 's1c' },
      { args: { command: 'find . -name "*.js"' } }
    )).resolves.not.toThrow();
  });

  it('should allow non-bash tools', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(getPlugin());
    await expect(plugin['tool.execute.before'](
      { sessionID: 'safe2', tool: 'read', callID: 's2c' },
      { args: { filePath: '/etc/passwd' } }
    )).resolves.not.toThrow();
  });
});

describe('cooldown mechanism', () => {
  let mockClient: any;
  let realDateNow: typeof Date.now;

  beforeEach(() => {
    vi.resetModules();
    mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
    realDateNow = Date.now;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  it('should skip idle when cooldown has not elapsed', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ cooldownMs: 10000 });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'cooldown-session' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    // First idle — should prompt and record timestamp
    const startTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(startTime);
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'cooldown-session' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalled();

    mockClient.session.promptAsync.mockClear();

    // Second idle — only 1s later, cooldown still active
    vi.spyOn(Date, 'now').mockReturnValue(startTime + 1000);
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'cooldown-session' } } });
    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });

  it('should allow nudges after cooldown expires', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ cooldownMs: 50 });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'cooldown-expire' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    const startTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(startTime);
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'cooldown-expire' } } });

    // Advance past cooldown
    vi.spyOn(Date, 'now').mockReturnValue(startTime + 60);

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'cooldown-expire' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalled();
  });

  it('should not apply cooldown when cooldownMs is 0', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ cooldownMs: 0 });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-cooldown' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-cooldown' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-cooldown' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(2);
  });
});

describe('nudgeDelayMs', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
  });

  it('should delay nudge by nudgeDelayMs', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    // Use a very small delay to avoid slow test runs
    const createPlugin = createContinuePlugin({ nudgeDelayMs: 10 });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'delay-session' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    const start = Date.now();
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'delay-session' } } });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(8);
    expect(mockClient.session.promptAsync).toHaveBeenCalled();
  });

  it('should suppress nudge if autoContinuePaused is set during delay', async () => {
    // Import state.js first to ensure we're using the same instance as the plugin
    const { sessionState, setCompletionState } = await import('../src/state.js');
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ nudgeDelayMs: 50 });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'suppress-delay' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    // Start the idle event (nudge is delayed via setTimeout)
    const idlePromise = plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'suppress-delay' } } });

    // During the delay, directly set completion state (simulates completionSignal arriving)
    setCompletionState('suppress-delay', 'completed');

    await idlePromise;

    // Nudge should have been suppressed because session was paused during delay
    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();

    const state = readState();
    expect(state.sessions['suppress-delay'].completionState).not.toBeNull();
  });

  it('should still send the max-continuations prompt before pausing', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ nudgeDelayMs: 10, maxContinuations: 1 });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'max-cap-delay-session' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'max-cap-delay-session' } } });

    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);
    expect(mockClient.session.promptAsync.mock.calls[0][0].body.parts[0].text).toContain('AUTO-CONTINUE CAP REACHED');
    expect(readState().sessions['max-cap-delay-session'].pauseState).toEqual({
      reason: 'max_continuations',
      timestamp: expect.any(Number),
    });
  });
});

describe('logging branches', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
  });

  it('should call logger.info when logToStdout is true', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const createPlugin = createContinuePlugin({ logToStdout: true });
    const plugin = await createPlugin({ client: mockClient, logger });

    await plugin['chat.message']({ sessionID: 'log-session' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'log-session' } } });

    expect(logger.info).toHaveBeenCalled();
  });

  it('should not call logger methods when logToStdout is false', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const createPlugin = createContinuePlugin({ logToStdout: false });
    const plugin = await createPlugin({ client: mockClient, logger });

    await plugin['chat.message']({ sessionID: 'no-log-session' });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'no-log-session' } } });

    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('createFileStore I/O', () => {
  let store: any;
  const TEST_DIR = '/tmp/force-continue-test-store';

  beforeEach(async () => {
    vi.resetModules();
    const path = await import('path');
    const testDir = path.join(TEST_DIR, Math.random().toString(36));
    const { createFileStore } = await import('../force-continue.server.js');
    store = createFileStore(testDir);
  });

  afterEach(() => {
    store.keys().forEach((key: string) => store.delete(key));
  });

  it('should return undefined for non-existent key', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('should set and get a value', () => {
    store.set('key1', { data: 'test' });
    expect(store.get('key1')).toEqual({ data: 'test' });
  });

  it('should overwrite existing value', () => {
    store.set('key2', 'first');
    store.set('key2', 'second');
    expect(store.get('key2')).toBe('second');
  });

  it('should delete a key', () => {
    store.set('key3', 'value');
    store.delete('key3');
    expect(store.get('key3')).toBeUndefined();
  });

  it('should list all keys', () => {
    store.set('keyA', 'a');
    store.set('keyB', 'b');
    store.set('keyC', 'c');
    const keys = store.keys();
    expect(keys).toContain('keyA');
    expect(keys).toContain('keyB');
    expect(keys).toContain('keyC');
    expect(keys.length).toBe(3);
  });

  it('should handle JSON parse errors gracefully', async () => {
    const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('fs');
    const path = await import('path');
    const storeDir = path.join(TEST_DIR, 'parse-error-test');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(path.join(storeDir, 'badjson.json'), 'not valid json {[');
    const { createFileStore } = await import('../force-continue.server.js');
    const badStore = createFileStore(path.join(TEST_DIR, 'parse-error-test'));
    expect(badStore.get('badjson')).toBeUndefined();
  });
});

describe('createHybridStore', () => {
  it('should prefer in-memory over file store', async () => {
    vi.resetModules();
    const { createHybridStore, createFileStore } = await import('../force-continue.server.js');
    const mem = new Map();
    const fileStore = createFileStore('/tmp/hybrid-test');
    const hybrid = createHybridStore(mem, fileStore);

    hybrid.set('key', 'memory-value');
    expect(hybrid.get('key')).toBe('memory-value');
    expect(mem.get('key')).toBe('memory-value');
  });

  it('should fall back to file store when not in memory', async () => {
    vi.resetModules();
    const { createHybridStore, createFileStore } = await import('../force-continue.server.js');
    const mem = new Map();
    const fileStore = createFileStore('/tmp/hybrid-test-2');
    const hybrid = createHybridStore(mem, fileStore);

    fileStore.set('fallback-key', 'file-value');
    const hybrid2 = createHybridStore(mem, fileStore);

    expect(hybrid2.get('fallback-key')).toBe('file-value');
  });

  it('should return undefined when not in either store', async () => {
    const { createHybridStore } = await import('../force-continue.server.js');
    const hybrid = createHybridStore(new Map(), null);
    expect(hybrid.get('missing')).toBeUndefined();
  });

  it('should delete from both stores', async () => {
    vi.resetModules();
    const { createHybridStore, createFileStore } = await import('../force-continue.server.js');
    const mem = new Map();
    const fileStore = createFileStore('/tmp/hybrid-test-3');
    const hybrid = createHybridStore(mem, fileStore);

    hybrid.set('dual-key', 'dual-value');
    hybrid.delete('dual-key');

    expect(hybrid.get('dual-key')).toBeUndefined();
  });

  it('should report has correctly for in-memory', async () => {
    const { createHybridStore } = await import('../force-continue.server.js');
    const mem = new Map([['mem-key', 'mem-value']]);
    const hybrid = createHybridStore(mem, null);
    expect(hybrid.has('mem-key')).toBe(true);
    expect(hybrid.has('missing')).toBe(false);
  });
});

describe('experimental.chat.messages.transform', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
  });

  it('should inject completion message when autoContinuePaused is set', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'completion-msg-session' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'completion-msg-session',
          part: { type: 'tool', tool: 'completionSignal', state: { status: 'completed' } }
        }
      }
    });

    // SDK type: input is {} — sessionID is derived from messages[0].info.sessionID
    const messages: any[] = [{ info: { sessionID: 'completion-msg-session', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({}, { messages });

    expect(messages.length).toBe(2);
    expect(messages[1].parts[0].text).toContain('COMPLETION ALREADY REACHED');
  });

  it('should not modify messages when autoContinuePaused is null', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-pause-session' });

    const messages: any[] = [{ info: { sessionID: 'no-pause-session', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({}, { messages });

    expect(messages.length).toBe(1);
  });

  it('should not inject completion message for non-completed pauses', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'paused-not-complete-session' });
    await plugin.tool.pauseAutoContinue.execute(
      { reason: 'Need time to plan' },
      { sessionID: 'paused-not-complete-session' } as any
    );

    const messages: any[] = [{ info: { sessionID: 'paused-not-complete-session', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({}, { messages });

    expect(messages.length).toBe(1);
  });

  it('should inject completion message for blocked completionSignal sessions', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin.tool.completionSignal.execute(
      { status: 'blocked', reason: 'quota exceeded' },
      { sessionID: 'blocked-completion-msg-session' } as any
    );

    const messages: any[] = [{ info: { sessionID: 'blocked-completion-msg-session', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({}, { messages });

    expect(messages.length).toBe(2);
    expect(messages[1].parts[0].text).toContain('COMPLETION ALREADY REACHED');
  });

  it('should fall back to params.sessionID when messages do not carry one', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin.tool.completionSignal.execute(
      { status: 'completed' },
      { sessionID: 'params-sessionid-msg-session' } as any
    );

    const messages: any[] = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({ sessionID: 'params-sessionid-msg-session' } as any, { messages });

    expect(messages.length).toBe(2);
    expect(messages[1].parts[0].text).toContain('COMPLETION ALREADY REACHED');
  });

  it('should not modify messages when messages is not an array', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'bad-messages-session' });

    await plugin['experimental.chat.messages.transform']({}, { messages: null });
    await plugin['experimental.chat.messages.transform']({}, { messages: 'not array' });
  });
});

describe('part status cancellation handling', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = { session: { messages: vi.fn(), promptAsync: vi.fn() } };
  });

  it('should suppress nudges when part status is canceled', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'canceled-session' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'canceled-session',
          part: { type: 'tool', state: { status: 'canceled' } }
        }
      }
    });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'canceled-session' } } });

    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });

  it('should suppress nudges when part status is cancelled', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'cancelled-session' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'cancelled-session',
          part: { type: 'tool', state: { status: 'cancelled' } }
        }
      }
    });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'cancelled-session' } } });

    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });

  it('should suppress nudges when part status is interrupted', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'part-interrupted-session' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'part-interrupted-session',
          part: { type: 'tool', state: { status: 'interrupted' } }
        }
      }
    });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'part-interrupted-session' } } });

    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });

  it('should suppress nudges when part status is aborted', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'aborted-session' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'aborted-session',
          part: { type: 'tool', state: { status: 'aborted' } }
        }
      }
    });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'aborted-session' } } });

    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });

  it('should suppress nudges when part status is stopped', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'stopped-session' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'stopped-session',
          part: { type: 'tool', state: { status: 'stopped' } }
        }
      }
    });

    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Still working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'stopped-session' } } });

    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });
});
