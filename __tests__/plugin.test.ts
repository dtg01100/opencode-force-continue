import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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
  let testDir: string;

  beforeEach(() => {
    sessionCompletionState = new Map();
    mockClient = {
      session: {
        messages: vi.fn(),
        promptAsync: vi.fn(),
      },
    };
    testDir = '/tmp/test-force-continue-' + Date.now();
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.opencode'), { recursive: true });
    mockCtx = { client: mockClient, directory: testDir };
  });

  it('should do nothing when disabled (no state file)', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-1' });
    
    expect(sessionCompletionState.has('test-session-1')).toBe(false);
  });

  it('should track session as incomplete on chat.message when enabled', async () => {
    writeFileSync(join(testDir, '.opencode', 'force-continue-state.json'), JSON.stringify({ enabled: true }));
    
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-2' });
    
    expect(sessionCompletionState.get('test-session-2')).toBe(false);
  });

  it('should mark session complete when completionSignal tool is used', async () => {
    writeFileSync(join(testDir, '.opencode', 'force-continue-state.json'), JSON.stringify({ enabled: true }));
    
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-3' });
    expect(sessionCompletionState.get('test-session-3')).toBe(false);
    
    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-3' }
        }
      }
    });
    
    expect(sessionCompletionState.get('test-session-3')).toBe(true);
  });

  it('should send Continue prompt when session becomes idle without completion', async () => {
    writeFileSync(join(testDir, '.opencode', 'force-continue-state.json'), JSON.stringify({ enabled: true }));
    
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
      path: { sessionID: 'test-session-4' },
      body: { parts: [{ type: 'text', text: 'Continue' }] }
    });
  });

  it('should not send Continue prompt when session is marked complete', async () => {
    writeFileSync(join(testDir, '.opencode', 'force-continue-state.json'), JSON.stringify({ enabled: true }));
    
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);
    
    await plugin['chat.message']({ sessionID: 'test-session-5' });
    
    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-5' }
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
