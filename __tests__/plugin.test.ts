import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@opencode-ai/plugin', async () => {
  const actual = await vi.importActual('@opencode-ai/plugin');
  return {
    ...actual,
    tool: vi.fn().mockReturnValue({ type: 'tool' }),
  };
});

describe('ContinuePlugin', () => {
  let sessionCompletionState: Map<string, boolean>;
  let mockClient: any;
  let mockCtx: any;

  beforeEach(() => {
    sessionCompletionState = new Map();
    mockClient = {
      session: {
        messages: vi.fn(),
        promptAsync: vi.fn(),
      },
    };
    mockCtx = { client: mockClient };
  });

  it('should track session as incomplete on chat.message', async () => {
    const { createContinuePlugin } = await import('../index.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-1' });
    
    expect(sessionCompletionState.get('test-session-1')).toBe(false);
  });

  it('should mark session complete when completionSignal tool is used', async () => {
    const { createContinuePlugin } = await import('../index.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-2' });
    expect(sessionCompletionState.get('test-session-2')).toBe(false);
    
    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-2' }
        }
      }
    });
    
    expect(sessionCompletionState.get('test-session-2')).toBe(true);
  });

  it('should send Continue prompt when session becomes idle without completion', async () => {
    const { createContinuePlugin } = await import('../index.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-3' });
    
    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]
    });
    
    await plugin.event({
      event: {
        type: 'session.idle',
        properties: { sessionID: 'test-session-3' }
      }
    });
    
    expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
      path: { sessionID: 'test-session-3' },
      body: { parts: [{ type: 'text', text: 'Continue' }] }
    });
  });

  it('should not send Continue prompt when session is marked complete', async () => {
    const { createContinuePlugin } = await import('../index.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-4' });
    
    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-4' }
        }
      }
    });
    
    await plugin.event({
      event: {
        type: 'session.idle',
        properties: { sessionID: 'test-session-4' }
      }
    });
    
    expect(mockClient.session.promptAsync).not.toHaveBeenCalled();
  });
});