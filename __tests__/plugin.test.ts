import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@opencode-ai/plugin', () => ({
  tool: vi.fn(() => ({ type: 'tool' })),
}));

function getFlagPath(sessionID: string): string {
  return join(tmpdir(), `opencode-force-continue-${sessionID}`);
}

function getNextSessionFlagPath(): string {
  return join(tmpdir(), 'opencode-force-continue-next');
}

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

    // Clean up any leftover flag files
    const files = ['opencode-force-continue-next'];
    for (const f of files) {
      const p = join(tmpdir(), f);
      if (existsSync(p)) unlinkSync(p);
    }
  });

  afterEach(() => {
    // Clean up flag files after each test
    try {
      const nextFlag = getNextSessionFlagPath();
      if (existsSync(nextFlag)) unlinkSync(nextFlag);
    } catch {}
  });

  it('should do nothing when disabled (no state file)', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);

    await plugin['chat.message']({ sessionID: 'test-session-1' });

    expect(sessionCompletionState.has('test-session-1')).toBe(false);
  });

  it('should track session as incomplete on chat.message when enabled', async () => {
    const flagPath = getFlagPath('test-session-2');
    writeFileSync(flagPath, '');

    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);

    await plugin['chat.message']({ sessionID: 'test-session-2' });

    expect(sessionCompletionState.get('test-session-2')).toBe(false);

    // Cleanup
    if (existsSync(flagPath)) unlinkSync(flagPath);
  });

  it('should mark session complete when completionSignal tool is used', async () => {
    const flagPath = getFlagPath('test-session-3');
    writeFileSync(flagPath, '');

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
          part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-3' }
        }
      }
    });

    expect(sessionCompletionState.get('test-session-3')).toBe(true);

    // Cleanup
    if (existsSync(flagPath)) unlinkSync(flagPath);
  });

  it('should mark session complete when message.part.updated has part.sessionID', async () => {
    const flagPath = getFlagPath('test-session-3b');
    writeFileSync(flagPath, '');

    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);

    await plugin['chat.message']({ sessionID: 'test-session-3b' });

    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          part: { type: 'tool', tool: 'completionSignal', sessionID: 'test-session-3b' }
        }
      }
    });

    expect(sessionCompletionState.get('test-session-3b')).toBe(true);

    // Cleanup
    if (existsSync(flagPath)) unlinkSync(flagPath);
  });

  it('should send Continue prompt when session becomes idle without completion', async () => {
    const flagPath = getFlagPath('test-session-4');
    writeFileSync(flagPath, '');

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

    // Cleanup
    if (existsSync(flagPath)) unlinkSync(flagPath);
  });

  it('should not send Continue prompt when session is marked complete', async () => {
    const flagPath = getFlagPath('test-session-5');
    writeFileSync(flagPath, '');

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

    // Cleanup
    if (existsSync(flagPath)) unlinkSync(flagPath);
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

  it('should enable force-continue for next session when next-session flag exists', async () => {
    const nextFlag = getNextSessionFlagPath();
    writeFileSync(nextFlag, '');

    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin(sessionCompletionState);
    const plugin = await createPlugin(mockCtx);

    await plugin.event({
      event: {
        type: 'session.created',
        properties: { sessionID: 'new-session-1' }
      }
    });

    // After consuming the next-session flag, a session flag should be created
    const flagPath = getFlagPath('new-session-1');
    expect(existsSync(flagPath)).toBe(true);

    // Cleanup
    if (existsSync(flagPath)) unlinkSync(flagPath);
    if (existsSync(nextFlag)) unlinkSync(nextFlag);
  });
});

describe('TUI Plugin', () => {
  it('should register force-continue command', async () => {
    const tuiModule = await import('../force-continue.tui.js');
    expect(tuiModule.default).toBeDefined();
    expect(tuiModule.default.id).toBe('force-continue');
    expect(tuiModule.default.tui).toBeDefined();
    expect(typeof tuiModule.default.tui).toBe('function');
  });
});
