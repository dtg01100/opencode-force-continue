import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventSequenceBuilder, createMockClient, createMockContext } from './event-sequence';

describe('event sequence testing utilities', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockCtx: ReturnType<typeof createMockContext>;

  beforeEach(async () => {
    process.env.FORCE_CONTINUE_NUDGE_DELAY_MS = '0';
    vi.resetModules();
    mockClient = createMockClient();
    mockCtx = createMockContext(mockClient);
  });

  describe('basic sequence building', () => {
    it('should build and execute a simple session lifecycle', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .sessionCreated('seq-1')
        .assertSessionExists('seq-1');

      await builder.execute(plugin);
    });

    it('should build a complete session lifecycle', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .sessionCreated('seq-2')
        .chatMessage('seq-2')
        .sessionDeleted('seq-2')
        .assertSessionNotExists('seq-2');

      await builder.execute(plugin);
    });
  });

  describe('continuation flow sequences', () => {
    it('should verify idle → continuation flow', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-3')
        .sessionIdle('seq-3')
        .assertPromptAsyncCalled(1)
        .assertContinuationCount('seq-3', 1);

      await builder.execute(plugin);
    });

    it('should verify idle → pause on completion', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-4')
        .completionSignalCompleted('seq-4')
        .sessionIdle('seq-4')
        .assertPromptAsyncNotCalled()
        .assertSessionPaused('seq-4', 'completed');

      await builder.execute(plugin);
    });
  });

  describe('tool execution sequences', () => {
    it('should track tool call history', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-5')
        .toolExecuteAfter('seq-5', 'bash', { command: 'ls' })
        .toolExecuteAfter('seq-5', 'edit', { filePath: 'test.js' })
        .assertToolCallHistoryLength('seq-5', 2);

      await builder.execute(plugin);
    });

    it('should track file modifications', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-6')
        .toolExecuteAfter('seq-6', 'edit', { filePath: 'a.js' })
        .toolExecuteAfter('seq-6', 'write', { filePath: 'b.ts' })
        .assertFilesModified('seq-6', ['a.js', 'b.ts']);

      await builder.execute(plugin);
    });
  });

  describe('complex sequences', () => {
    it('should verify reset on new user message', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-7')
        .sessionIdle('seq-7')
        .sessionIdle('seq-7')
        .assertContinuationCount('seq-7', 2)
        .chatMessage('seq-7')
        .assertContinuationCount('seq-7', 0);

      await builder.execute(plugin);
    });

    it('should verify dangerous command blocking', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      const plugin = await createPlugin(mockCtx);

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-8')
        .assertSessionExists('seq-8');

      await builder.execute(plugin);

      await expect(
        plugin['tool.execute.before'](
          { sessionID: 'seq-8', tool: 'bash', callID: 'c1' },
          { args: { command: 'rm -rf /' } }
        )
      ).rejects.toThrow('Dangerous command blocked');
    });
  });

  describe('custom assertions', () => {
    it('should support custom assertions', async () => {
      const { createContinuePlugin } = await import('../force-continue.server.js');
      const createPlugin = createContinuePlugin();
      mockClient.session.messages.mockResolvedValue({
        data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
      });
      const plugin = await createPlugin(mockCtx);

      let customAssertionCalled = false;

      const builder = createEventSequenceBuilder(mockClient, mockCtx);
      builder
        .chatMessage('seq-9')
        .customAssertion(async ({ state, mockClient }) => {
          customAssertionCalled = true;
          expect(state.sessions['seq-9']).toBeDefined();
          expect(mockClient.session.messages).toBeDefined();
        });

      await builder.execute(plugin);
      expect(customAssertionCalled).toBe(true);
    });
  });
});
