import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('state machine validation', () => {
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

  afterEach(async () => {
    vi.resetModules();
  });

  const getPaused = async (sessionID: string) => {
    const { readState } = await import('../force-continue.server.js');
    return readState().sessions[sessionID]?.autoContinuePaused ?? null;
  };

  describe('session lifecycle', () => {
    it('should start with null pause state on session created', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin.event({
        event: { type: 'session.created', properties: { info: { id: 'lifecycle-1' } } }
      });

      const state = readState();
      expect(state.sessions['lifecycle-1']).toBeDefined();
      expect(state.sessions['lifecycle-1'].autoContinuePaused).toBeNull();
    });

    it('should initialize state on chat.message', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'lifecycle-2' });

      const state = readState();
      expect(state.sessions['lifecycle-2']).toBeDefined();
      expect(state.sessions['lifecycle-2'].continuationCount).toBe(0);
    });

    it('should clean up state on session.deleted', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'lifecycle-3' });
      expect(readState().sessions['lifecycle-3']).toBeDefined();

      await plugin.event({
        event: { type: 'session.deleted', properties: { sessionID: 'lifecycle-3' } }
      });

      expect(readState().sessions['lifecycle-3']).toBeUndefined();
    });
  });

  describe('pause state transitions', () => {
    it('should transition from null to completed on completionSignal', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-1' });
      expect(await getPaused('pause-1')).toBeNull();

      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'pause-1',
            part: { type: 'tool', tool: 'completionSignal', sessionID: 'pause-1', state: { status: 'completed' } }
          }
        }
      });

      const paused = await getPaused('pause-1');
      expect(paused).not.toBeNull();
      expect(paused.reason).toBe('completed');
    });

    it('should transition from null to blocked on completionSignal blocked', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-2' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'pause-2',
            part: { type: 'tool', tool: 'completionSignal', state: { status: 'completed', input: { status: 'blocked', reason: 'quota' } } }
          }
        }
      });

      const paused = await getPaused('pause-2');
      expect(paused).not.toBeNull();
      expect(paused.reason).toBe('blocked');
    });

    it('should transition from null to interrupted on completionSignal interrupted', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-3' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'pause-3',
            part: { type: 'tool', tool: 'completionSignal', state: { status: 'completed', input: { status: 'interrupted' } } }
          }
        }
      });

      const paused = await getPaused('pause-3');
      expect(paused).not.toBeNull();
      expect(paused.reason).toBe('interrupted');
    });

    it('should transition from null to circuit_breaker on threshold errors', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin({ circuitBreakerThreshold: 2 });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      mockClient.session.promptAsync.mockRejectedValue(new Error('Network error'));
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-4' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'pause-4' } } });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'pause-4' } } });

      const paused = await getPaused('pause-4');
      expect(paused).not.toBeNull();
      expect(paused.reason).toBe('circuit_breaker');
    });

    it('should transition to max_continuations at cap', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin({ maxContinuations: 2 });
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'No progress' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-5' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'pause-5' } } });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'pause-5' } } });

      const paused = await getPaused('pause-5');
      expect(paused).not.toBeNull();
      expect(paused.reason).toBe('max_continuations');
    });

    it('should transition from null to user_paused on pauseAutoContinue', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-6' });
      const toolDef = plugin.tool.pauseAutoContinue;
      await toolDef.execute({ reason: 'Need time' }, { sessionID: 'pause-6' } as any);

      const paused = await getPaused('pause-6');
      expect(paused).not.toBeNull();
      expect(paused.reason).toBe('user_paused');
    });

    it('should remain paused after subsequent chat.message when completed', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'pause-7' });
      await plugin.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'pause-7',
            part: { type: 'tool', tool: 'completionSignal', state: { status: 'completed' } }
          }
        }
      });

      expect(await getPaused('pause-7')).not.toBeNull();
      await plugin['chat.message']({ sessionID: 'pause-7' });
      expect(await getPaused('pause-7')).not.toBeNull();
    });
  });

  describe('continuation count transitions', () => {
    it('should increment on each idle', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'count-1' });

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'count-1' } } });
      expect(readState().sessions['count-1'].continuationCount).toBe(1);

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'count-1' } } });
      expect(readState().sessions['count-1'].continuationCount).toBe(2);
    });

    it('should reset to 0 on chat.message', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'count-2' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'count-2' } } });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'count-2' } } });
      expect(readState().sessions['count-2'].continuationCount).toBe(2);

      await plugin['chat.message']({ sessionID: 'count-2' });
      expect(readState().sessions['count-2'].continuationCount).toBe(0);
    });

    it('should reset on statusReport', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'count-3' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'count-3' } } });
      expect(readState().sessions['count-3'].continuationCount).toBe(1);

      const toolDef = plugin.tool.statusReport;
      await toolDef.execute(
        { progress: 'Done', nextSteps: 'Continue', blockers: null },
        { sessionID: 'count-3' } as any
      );

      expect(readState().sessions['count-3'].continuationCount).toBe(0);
    });
  });

  describe('response history transitions', () => {
    it('should accumulate response history', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages
        .mockResolvedValueOnce({ data: [{ role: 'assistant', parts: [{ type: 'text', text: 'First' }] }] })
        .mockResolvedValueOnce({ data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Second' }] }] });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'history-1' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'history-1' } } });
      expect(readState().sessions['history-1'].responseHistory).toContain('First');

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'history-1' } } });
      expect(readState().sessions['history-1'].responseHistory).toContain('Second');
    });

    it('should reset response history on chat.message', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Response' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'history-2' });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'history-2' } } });
      expect(readState().sessions['history-2'].responseHistory.length).toBe(1);

      await plugin['chat.message']({ sessionID: 'history-2' });
      expect(readState().sessions['history-2'].responseHistory).toEqual([]);
    });
  });

  describe('autopilot state transitions', () => {
    it('should transition autopilot attempts on guidance request', async () => {
      const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
      resetAutopilotState();
      const createPlugin = createContinuePlugin({ autopilotEnabled: true, autopilotMaxAttempts: 5 });
      const plugin = await createPlugin(mockCtx);

      const { writeAutopilotState } = await import('../src/autopilot.js');
      writeAutopilotState({ enabled: true, timestamp: Date.now() });

      await plugin['chat.message']({ sessionID: 'auto-1' });

      const toolDef = plugin.tool.requestGuidance;
      await toolDef.execute({ question: 'Q1' }, { sessionID: 'auto-1' } as any);
      await toolDef.execute({ question: 'Q2' }, { sessionID: 'auto-1' } as any);

      const { readState } = await import('../force-continue.server.js');
      const state = readState();
      expect(state.sessions['auto-1'].autopilotAttempts).toBeDefined();
    });

    it('should reset autopilot attempts on user message', async () => {
      const { createContinuePlugin, resetAutopilotState } = await import('../force-continue.server.js');
      resetAutopilotState();
      const createPlugin = createContinuePlugin({ autopilotEnabled: true, autopilotMaxAttempts: 5 });
      const plugin = await createPlugin(mockCtx);

      const { writeAutopilotState } = await import('../src/autopilot.js');
      writeAutopilotState({ enabled: true, timestamp: Date.now() });

      await plugin['chat.message']({ sessionID: 'auto-2' });
      const toolDef = plugin.tool.requestGuidance;
      await toolDef.execute({ question: 'Q1' }, { sessionID: 'auto-2' } as any);

      await plugin['chat.message']({ sessionID: 'auto-2' });

      const { readState } = await import('../force-continue.server.js');
      expect(readState().sessions['auto-2'].autopilotAttempts).toBe(0);
    });
  });

  describe('tool call history transitions', () => {
    it('should accumulate tool calls', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'tool-1' });
      await plugin['tool.execute.after']({ sessionID: 'tool-1', tool: 'bash', args: { command: 'ls' } });
      await plugin['tool.execute.after']({ sessionID: 'tool-1', tool: 'edit', args: { filePath: 'test.js' } });

      const state = readState();
      expect(state.sessions['tool-1'].toolCallHistory.length).toBe(2);
    });

    it('should maintain bounded history', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'tool-2' });

      for (let i = 0; i < 100; i++) {
        await plugin['tool.execute.after']({ sessionID: 'tool-2', tool: 'bash', args: { cmd: i } });
      }

      const state = readState();
      expect(state.sessions['tool-2'].toolCallHistory.length).toBeLessThanOrEqual(50);
    });
  });

  describe('file tracking transitions', () => {
    it('should accumulate modified files', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'file-1' });
      await plugin['tool.execute.after']({ sessionID: 'file-1', tool: 'edit', args: { filePath: 'a.js' } });
      await plugin['tool.execute.after']({ sessionID: 'file-1', tool: 'write', args: { filePath: 'b.js' } });

      const state = readState();
      const files = Array.from(state.sessions['file-1'].filesModified || []);
      expect(files).toContain('a.js');
      expect(files).toContain('b.js');
    });

    it('should dedupe files in tracking', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'file-2' });
      await plugin['tool.execute.after']({ sessionID: 'file-2', tool: 'edit', args: { filePath: 'same.js' } });
      await plugin['tool.execute.after']({ sessionID: 'file-2', tool: 'edit', args: { filePath: 'same.js' } });

      const state = readState();
      const files = Array.from(state.sessions['file-2'].filesModified || []);
      expect(files.filter(f => f === 'same.js').length).toBe(1);
    });
  });

  describe('illegal state transitions', () => {
    it('should not decrement continuation count below zero', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'illegal-1' });
      expect(readState().sessions['illegal-1'].continuationCount).toBe(0);

      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'illegal-1' } } });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'illegal-1' } } });
      expect(readState().sessions['illegal-1'].continuationCount).toBeGreaterThanOrEqual(0);
    });

    it('should not allow negative error count', async () => {
      const { createContinuePlugin, readState } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      await plugin['chat.message']({ sessionID: 'illegal-2' });
      const state = readState();
      expect(state.sessions['illegal-2'].errorCount || 0).toBeGreaterThanOrEqual(0);
    });
  });
});
