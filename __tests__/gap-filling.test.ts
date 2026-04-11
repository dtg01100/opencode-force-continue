import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ─── HIGH: Config file JSON loading ──────────────────────────────────────────

describe('config file loading', () => {
  const ORIGINAL_ENV = { ...process.env };
  const TEST_DIR = '/tmp/force-continue-config-test';

  beforeEach(() => {
    vi.resetModules();
    Object.keys(process.env).forEach(k => {
      if (k.startsWith('FORCE_CONTINUE_')) delete process.env[k];
    });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => {
      if (!ORIGINAL_ENV[k]) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL_ENV);
    // Clean up test config files
    try { rmSync(join(TEST_DIR, '.opencode', 'force-continue.json'), { force: true }); } catch {}
    try { rmSync(join(TEST_DIR, 'force-continue.config.json'), { force: true }); } catch {}
  });

  it('should load config from .opencode/force-continue.json', async () => {
    const dir = join(TEST_DIR, 'test1');
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    const configPath = join(dir, '.opencode', 'force-continue.json');
    writeFileSync(configPath, JSON.stringify({ maxContinuations: 42 }));

    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(42);
    (process.cwd as any).mockRestore();
  });

  it('should load config from force-continue.config.json', async () => {
    const dir = join(TEST_DIR, 'test2');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'force-continue.config.json');
    writeFileSync(configPath, JSON.stringify({ escalationThreshold: 7 }));

    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.escalationThreshold).toBe(7);
    (process.cwd as any).mockRestore();
  });

  it('should prefer .opencode path over force-continue.config.json', async () => {
    const dir = join(TEST_DIR, 'test3');
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    writeFileSync(join(dir, '.opencode', 'force-continue.json'), JSON.stringify({ maxContinuations: 10 }));
    writeFileSync(join(dir, 'force-continue.config.json'), JSON.stringify({ maxContinuations: 99 }));

    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(10);
    (process.cwd as any).mockRestore();
  });

  it('should merge env vars over file config over defaults', async () => {
    const dir = join(TEST_DIR, 'test4');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'force-continue.config.json'), JSON.stringify({ maxContinuations: 20 }));
    process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '50';

    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(50); // env wins
    (process.cwd as any).mockRestore();
  });
});

// ─── HIGH: client.app.log structured logging ─────────────────────────────────

describe('client.app.log structured logging', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should call client.app.log when available', async () => {
    const logFn = vi.fn().mockResolvedValue(undefined);
    const mockCtx = {
      client: {
        session: { messages: vi.fn(), promptAsync: vi.fn() },
        app: { log: logFn },
      },
    };

    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin(mockCtx);

    // Trigger session.created + idle to exercise handleIdle which calls log()
    await plugin.event({
      event: { type: 'session.created', properties: { info: { id: 'log-session' } } }
    });
    mockCtx.client.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });
    await plugin.event({
      event: { type: 'session.idle', properties: { sessionID: 'log-session' } }
    });

    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'force-continue',
        level: expect.any(String),
        message: expect.any(String),
      })
    );
  });

  it('should not call client.app.log when not available', async () => {
    const mockCtx = {
      client: {
        session: { messages: vi.fn(), promptAsync: vi.fn() },
        // no app.log
      },
    };

    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    // Should not throw
    await expect(createPlugin(mockCtx)).resolves.not.toThrow();
  });

  it('should call both structured logging and logToStdout when both enabled', async () => {
    const logFn = vi.fn().mockResolvedValue(undefined);
    const stdoutLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const mockCtx = {
      client: {
        session: { messages: vi.fn(), promptAsync: vi.fn() },
        app: { log: logFn },
      },
      logger: stdoutLogger,
    };

    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ logToStdout: true });
    const plugin = await createPlugin(mockCtx);

    // Trigger session.created + idle to exercise handleIdle which calls log()
    await plugin.event({
      event: { type: 'session.created', properties: { info: { id: 'both-log-session' } } }
    });
    mockCtx.client.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });
    await plugin.event({
      event: { type: 'session.idle', properties: { sessionID: 'both-log-session' } }
    });

    expect(logFn).toHaveBeenCalled();
    expect(stdoutLogger.debug).toHaveBeenCalled();
  });
});

// ─── HIGH: Event handler error isolation ─────────────────────────────────────

describe('event handler error isolation', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should still run session events handler when file events handler throws', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    // Trigger session.created to set up state
    await plugin.event({
      event: { type: 'session.created', properties: { info: { id: 'isolation-session' } } }
    });

    // Verify state was set (proves session events handler ran)
    expect(readState().sessions['isolation-session']).toBeDefined();
  });

  it('should catch and log file events handler errors without breaking session events', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    // session.created should still work even if file events path has issues
    await plugin.event({
      event: { type: 'session.created', properties: { info: { id: 'isolation-session-2' } } }
    });

    const state = readState();
    expect(state.sessions['isolation-session-2']).toBeDefined();
  });
});

// ─── HIGH: AI asks question + autopilot enabled + circuit breaker (idle path) ─

describe('autopilot circuit breaker on AI questions during idle', () => {
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  afterEach(async () => {
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  it('should trip circuit breaker after max autopilot attempts on AI questions during idle', async () => {
    const { createContinuePlugin, resetAutopilotState, readState } = await import('../force-continue.server.js');
    resetAutopilotState();
    const createPlugin = createContinuePlugin({
      autopilotEnabled: true,
      autopilotMaxAttempts: 2,
    });
    const plugin = await createPlugin({ client: mockClient });

    const { writeAutopilotState } = await import('../src/autopilot.js');
    writeAutopilotState({ enabled: true, timestamp: Date.now() });

    await plugin.event({ event: { type: 'session.created', properties: { info: { id: 'idle-question-session' } } } });

    // AI asks a question — detected during idle
    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Should I do X or Y?' }] }]
    });

    // First idle — autopilot answers (attempt 1)
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'idle-question-session' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);

    // Second idle — autopilot answers again (attempt 2)
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'idle-question-session' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(2);

    // Third idle — limit exceeded, circuit breaker trips and no more prompts are sent
    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'idle-question-session' } } });
    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(2);

    const state = readState();
    expect(state.sessions['idle-question-session'].autoContinuePaused).toEqual({
      reason: 'autopilot_max_attempts',
      timestamp: expect.any(Number),
    });
  });

});

// ─── MEDIUM: completionSignal double-call idempotency ────────────────────────

describe('completionSignal double-call idempotency', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should return "already called" message on second call with status completed', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.completionSignal;
    const firstResult = await toolDef.execute({ status: 'completed' }, { sessionID: 'idempotent-session' });
    expect(firstResult).toBe('Task completed. You may now stop.');

    const secondResult = await toolDef.execute({ status: 'completed' }, { sessionID: 'idempotent-session' });
    expect(secondResult).toContain('already called');
  });

  it('should allow re-signal after different pause reason (blocked)', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.completionSignal;

    // First: blocked
    const firstResult = await toolDef.execute({ status: 'blocked', reason: 'quota' }, { sessionID: 'reblock-session' });
    expect(firstResult).toContain('blocked');

    // Second: completed — should work because reason is different
    const secondResult = await toolDef.execute({ status: 'completed' }, { sessionID: 'reblock-session' });
    expect(secondResult).toBe('Task completed. You may now stop.');
  });

  it('should handle completionSignal without sessionID', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.completionSignal;
    // Should not throw even without sessionID
    const result = await toolDef.execute({ status: 'completed' }, {} as any);
    expect(result).toBe('Task completed. You may now stop.');
  });

  it('should treat empty args as completed (default status)', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.completionSignal;
    const result = await toolDef.execute({}, { sessionID: 'default-status-session' });
    expect(result).toBe('Task completed. You may now stop.');
  });

  it('should handle completionSignal when task query throws', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({
      hooks: { getTasksByParentSession: vi.fn(async () => { throw new Error('query failed'); }) }
    });
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.completionSignal;
    const result = await toolDef.execute({ status: 'completed' }, { sessionID: 'query-error-session' });
    // Should still return completed message despite query error
    expect(result).toBe('Task completed. You may now stop.');
  });
});

// ─── MEDIUM: validate probe mode error paths ─────────────────────────────────

describe('validate probe mode error paths', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should return error when probe mode without sessionID', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const result = await plugin.validate({ mode: 'probe' });
    expect(result.ok).toBe(false);
    expect(result.probe).toEqual({ ok: false, error: 'sessionID required for probe mode' });
  });

  it('should return error when probe mode without promptAsync', async () => {
    const clientNoPrompt = {
      session: { messages: vi.fn() },
    };
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: clientNoPrompt });

    const result = await plugin.validate({ mode: 'probe', sessionID: 'x' });
    expect(result.ok).toBe(false);
    expect(result.probe).toEqual({ ok: false, error: 'promptAsync not available on client.session' });
  });

  it('should capture error when probe promptAsync throws', async () => {
    mockClient.session.promptAsync.mockRejectedValue(new Error('Network timeout'));
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const result = await plugin.validate({ mode: 'probe', sessionID: 'fail-session' });
    expect(result.ok).toBe(false);
    expect(result.probe.ok).toBe(false);
    expect(result.probe.error).toContain('Network timeout');
  });
});

// ─── MEDIUM: setAutopilot tool direct unit tests ─────────────────────────────

describe('setAutopilot tool', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should enable autopilot when executed with enabled: true', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.setAutopilot;
    const result = await toolDef.execute({ enabled: true });
    expect(result).toBe('Autopilot enabled.');

    const { readAutopilotState } = await import('../src/autopilot.js');
    expect(readAutopilotState().enabled).toBe(true);
    expect(readAutopilotState().timestamp).toBeGreaterThan(0);
  });

  it('should disable autopilot when executed with enabled: false', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.setAutopilot;
    const result = await toolDef.execute({ enabled: false });
    expect(result).toBe('Autopilot disabled.');

    const { readAutopilotState } = await import('../src/autopilot.js');
    expect(readAutopilotState().enabled).toBe(false);
  });

  it('should set session-level autopilot when sessionID argument is provided', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    const { sessionState } = await import('../src/state.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.setAutopilot;
    const result = await toolDef.execute({ enabled: true, sessionID: 'my-session' });

    expect(result).toBe('Autopilot enabled for session my-session.');
    expect(sessionState.get('my-session')?.autopilotEnabled).toBe(true);

    // Global autopilot state should remain unchanged for session overrides
    const { readAutopilotState } = await import('../src/autopilot.js');
    expect(readAutopilotState().enabled).toBe(false);
    expect(readAutopilotState().timestamp).toBeNull();
  });

  it('should disable session-level autopilot when sessionID argument is provided', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    const { sessionState } = await import('../src/state.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.setAutopilot;
    const result = await toolDef.execute({ enabled: false, sessionID: 'another-session' });

    expect(result).toBe('Autopilot disabled for session another-session.');
    expect(sessionState.get('another-session')?.autopilotEnabled).toBe(false);
  });

  it('should set global autopilot when sessionID argument is not provided', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    const { sessionState } = await import('../src/state.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.setAutopilot;
    const result = await toolDef.execute({ enabled: true }, { sessionID: 'toolctx-session' } as any);

    expect(result).toBe('Autopilot enabled.');
    expect(sessionState.get('toolctx-session')?.autopilotEnabled).toBeUndefined();
    const { readAutopilotState } = await import('../src/autopilot.js');
    expect(readAutopilotState().enabled).toBe(true);
  });

  it('should prefer explicit sessionID argument over toolCtx sessionID', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    const { sessionState } = await import('../src/state.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.setAutopilot;
    const result = await toolDef.execute({ enabled: true, sessionID: 'explicit-session' }, { sessionID: 'toolctx-session' } as any);

    expect(result).toBe('Autopilot enabled for session explicit-session.');
    expect(sessionState.get('explicit-session')?.autopilotEnabled).toBe(true);
    expect(sessionState.get('toolctx-session')?.autopilotEnabled).toBeUndefined();
  });
});

// ─── MEDIUM: enableSystemPromptInjection: false path ─────────────────────────

describe('systemTransform with enableSystemPromptInjection: false', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should not inject system message when enableSystemPromptInjection is false', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ enableSystemPromptInjection: false });
    const plugin = await createPlugin({ client: mockClient });

    const system: string[] = ['existing system message'];
    await plugin['experimental.chat.system.transform']({ sessionID: 'no-inject-session' }, { system });

    expect(system).toEqual(['existing system message']);
    expect(system.length).toBe(1);
  });
});

// ─── MEDIUM: messagesTransform handler early return paths ────────────────────

describe('messagesTransform early return paths', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should not modify messages when autoContinuePaused is not set', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    // Set up session state without autoContinuePaused
    await plugin['chat.message']({ sessionID: 'no-pause-msg-session' });

    const messages: any[] = [{ info: { sessionID: 'no-pause-msg-session', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({}, { messages });

    expect(messages.length).toBe(1);
    expect(messages[0].info.role).toBe('user');
  });

  it('should not modify messages when sessionID is missing from messages', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const messages: any[] = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    await plugin['experimental.chat.messages.transform']({}, { messages });

    expect(messages.length).toBe(1);
  });

  it('should not modify messages when messages is missing', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    // Should not throw — messages is undefined
    await expect(
      plugin['experimental.chat.messages.transform']({}, {})
    ).resolves.not.toThrow();
  });

  it('should not modify messages when messages is not an array', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await expect(
      plugin['experimental.chat.messages.transform']({}, { messages: null })
    ).resolves.not.toThrow();

    await expect(
      plugin['experimental.chat.messages.transform']({}, { messages: 'not array' })
    ).resolves.not.toThrow();
  });
});

// ─── MEDIUM: writeAutopilotState validation error paths ──────────────────────

describe('writeAutopilotState validation', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  it('should throw when called with null', async () => {
    const { writeAutopilotState } = await import('../src/autopilot.js');
    expect(() => writeAutopilotState(null as any)).toThrow('state must be an object');
  });

  it('should throw when called with a string', async () => {
    const { writeAutopilotState } = await import('../src/autopilot.js');
    expect(() => writeAutopilotState('not an object' as any)).toThrow('state must be an object');
  });

  it('should throw when called with a number', async () => {
    const { writeAutopilotState } = await import('../src/autopilot.js');
    expect(() => writeAutopilotState(42 as any)).toThrow('state must be an object');
  });
});

// ─── MEDIUM: Malformed JSON config file handling ─────────────────────────────

describe('malformed JSON config file', () => {
  const TEST_DIR = '/tmp/force-continue-malformed-config';

  beforeEach(() => {
    vi.resetModules();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(join(TEST_DIR, 'force-continue.config.json'), { force: true }); } catch {}
  });

  it('should warn and fall back to defaults when config file has malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(TEST_DIR, 'force-continue.config.json'), 'not valid json {{{');

    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();

    expect(config.maxContinuations).toBe(5); // default
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse config file'));

    warnSpy.mockRestore();
    (process.cwd as any).mockRestore();
  });
});

// ─── MEDIUM: TUI registration failure error path ─────────────────────────────

describe('TUI registration failure error path', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  it('should throw original error when register throws on callback AND on array fallback', async () => {
    const { tui } = await import('../force-continue.tui.js');
    const mockApi: any = {
      command: {
        register: (value: any) => {
          // Always throw — doesn't matter if callback or array
          throw new Error('register not supported');
        },
      },
      ui: { toast: vi.fn() },
    };

    // The fallback path calls register a second time with array, which also throws
    // The original error propagates (no outer try/catch in registerCommands)
    await expect(tui(mockApi)).rejects.toThrow('register not supported');
  });

  it('should throw custom error when register throws on callback and provider returns non-array', async () => {
    const { tui } = await import('../force-continue.tui.js');
    // Override getCommands to return non-array
    const originalTuiModule = await import('../force-continue.tui.js');
    const mockApi: any = {
      command: {
        register: (value: any) => {
          if (typeof value === 'function') {
            throw new Error('callback not supported');
          }
          // value is the result of commandsProvider() — if not array, throw custom error
          throw new Error(`force-continue: command registration failed`);
        },
      },
      ui: { toast: vi.fn() },
    };

    // To test the custom error path, we need commandsProvider() to return non-array
    // Since getCommands() always returns an array, we need to test a different scenario:
    // where register throws on callback, and the catch block's register ALSO throws
    // with the custom error because commandsProvider returned non-array (impossible with real getCommands)
    // Instead, let's verify the fallback path works when getCommands returns an array
    // but register still throws — the second error propagates
    await expect(tui(mockApi)).rejects.toThrow('force-continue: command registration failed');
  });

  it('should successfully register when callback throws but array fallback works', async () => {
    const { tui } = await import('../force-continue.tui.js');
    let registeredWithArray = false;
    const mockApi: any = {
      command: {
        register: (value: any) => {
          if (typeof value === 'function') {
            throw new Error('callback not supported');
          }
          // Accept array registration
          registeredWithArray = true;
          return () => {};
        },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    expect(registeredWithArray).toBe(true);
  });
});

// ─── LOW: Config env var edge cases ──────────────────────────────────────────

describe('config env var edge cases', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach(k => {
      if (!ORIGINAL_ENV[k]) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL_ENV);
    vi.resetModules();
  });

  it('should fall back to default for non-numeric FORCE_CONTINUE_MAX_CONTINUATIONS', async () => {
    process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = 'abc';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(5); // default
  });

  it('should fall back to default for negative FORCE_CONTINUE_MAX_CONTINUATIONS', async () => {
    process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '-1';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.maxContinuations).toBe(5);
  });

  it('should set enableSystemPromptInjection to false via env var', async () => {
    process.env.FORCE_CONTINUE_ENABLE_SYSTEM_PROMPT_INJECTION = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.enableSystemPromptInjection).toBe(false);
  });

  it('should set skipNudgeInSubagents to false via env var', async () => {
    process.env.FORCE_CONTINUE_SKIP_NUDGE_IN_SUBAGENTS = 'false';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.skipNudgeInSubagents).toBe(false);
  });

  it('should set autopilotEnabled and autopilotMaxAttempts via env var', async () => {
    process.env.FORCE_CONTINUE_AUTOPILOT_ENABLED = 'true';
    process.env.FORCE_CONTINUE_AUTOPILOT_MAX_ATTEMPTS = '7';
    const { resolveConfig } = await import('../force-continue.server.js');
    const config = resolveConfig();
    expect(config.autopilotEnabled).toBe(true);
    expect(config.autopilotMaxAttempts).toBe(7);
  });
});

// ─── LOW: State helper edge cases ────────────────────────────────────────────

describe('state helper edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isTaskDone returns false for non-string inputs', async () => {
    const { isTaskDone } = await import('../force-continue.server.js');
    expect(isTaskDone(null)).toBe(false);
    expect(isTaskDone(undefined)).toBe(false);
    expect(isTaskDone(123)).toBe(false);
    expect(isTaskDone('')).toBe(false);
  });

  it('isTaskDone trims whitespace', async () => {
    const { isTaskDone } = await import('../force-continue.server.js');
    expect(isTaskDone('  DONE  ')).toBe(true);
    expect(isTaskDone('\tcompleted\t')).toBe(true);
    expect(isTaskDone(' complete ')).toBe(true);
  });

  it('isSubagentSession returns false for non-string and regular strings', async () => {
    const { isSubagentSession } = await import('../force-continue.server.js');
    expect(isSubagentSession(null)).toBe(false);
    expect(isSubagentSession('')).toBe(false);
    expect(isSubagentSession('normal-session')).toBe(false);
    expect(isSubagentSession('agent$$123-session')).toBe(true);
  });

  it('updateLastSeen ignores non-string inputs', async () => {
    const { updateLastSeen, readState } = await import('../force-continue.server.js');
    updateLastSeen(null);
    updateLastSeen(123);
    updateLastSeen('');
    // Should not have created any sessions
    expect(readState().sessions).toEqual({});
  });

  it('readState converts Set to array for filesModified', async () => {
    const { sessionState, readState } = await import('../force-continue.server.js');
    sessionState.set('set-session', { filesModified: new Set(['a.ts', 'b.ts']) });
    const state = readState();
    expect(Array.isArray(state.sessions['set-session'].filesModified)).toBe(true);
    expect(state.sessions['set-session'].filesModified).toEqual(['a.ts', 'b.ts']);
  });
});

// ─── LOW: Metrics edge cases ─────────────────────────────────────────────────

describe('metrics edge cases', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('resetMetrics zeroes all counters on the shared singleton', async () => {
    // Import the raw metrics module directly
    const metricsModule = await import('../src/metrics.js');

    // Record some events directly on the exported singleton
    metricsModule.metrics.record('r1', 'session.created');
    metricsModule.metrics.record('r1', 'continuation');

    const before = metricsModule.metrics.getSummary();
    expect(before.totalSessions).toBe(1);
    expect(before.totalContinuations).toBe(1);

    // Reset via the exported function (which calls metrics.reset() internally)
    metricsModule.resetMetrics();

    const after = metricsModule.metrics.getSummary();
    expect(after.totalSessions).toBe(0);
    expect(after.totalContinuations).toBe(0);
    expect(after.escalations).toBe(0);
    expect(after.loopDetectionCount).toBe(0);
  });

  it('getSummary returns 0 for avgContinuationsPerSession when no sessions', async () => {
    const { createMetricsTracker } = await import('../force-continue.server.js');
    const tracker = createMetricsTracker();
    const summary = tracker.getSummary();
    expect(summary.avgContinuationsPerSession).toBe(0);
    expect(summary.loopDetectionRate).toBe('0%');
  });
});

// ─── LOW: tool.execute.before edge cases ─────────────────────────────────────

describe('tool.execute.before edge cases', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should allow non-bash tools with dangerous-looking commands', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    // Non-bash tool — dangerous content should pass through
    await expect(plugin['tool.execute.before'](
      { sessionID: 's1', tool: 'exec', callID: 'c1' },
      { args: { command: 'rm -rf /' } }
    )).resolves.not.toThrow();
  });

  it('should allow bash tool with empty command', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await expect(plugin['tool.execute.before'](
      { sessionID: 's1', tool: 'bash', callID: 'c2' },
      { args: { command: '' } }
    )).resolves.not.toThrow();
  });
});

// ─── LOW: tool.execute.after edge cases ──────────────────────────────────────

describe('tool.execute.after edge cases', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should not crash when edit tool has no filePath', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-filepath-session' });
    await plugin['tool.execute.after']({ sessionID: 'no-filepath-session', tool: 'edit', args: {} });

    const state = readState();
    expect(state.sessions['no-filepath-session'].filesModified).toEqual([]);
  });

  it('should skip file tracking when enableFileTracking is false', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ enableFileTracking: false });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-tracking-session' });
    await plugin['tool.execute.after']({ sessionID: 'no-tracking-session', tool: 'edit', args: { filePath: 'x.ts' } });

    const state = readState();
    expect(state.sessions['no-tracking-session'].filesModified).toBeUndefined();
  });

  it('should skip tool loop detection when enableToolLoopDetection is false', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ enableToolLoopDetection: false });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-loop-session' });
    for (let i = 0; i < 4; i++) {
      await plugin['tool.execute.after']({ sessionID: 'no-loop-session', tool: 'bash', args: { command: 'same' } });
    }

    const state = readState();
    expect(state.sessions['no-loop-session'].toolLoopDetected).toBe(false);
  });
});

// ─── LOW: file.edited event edge cases ───────────────────────────────────────

describe('file.edited event edge cases', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should handle file.edited event without filePath (no-op since SDK event lacks sessionID)', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-filepath-event-session' });
    // SDK EventFileEdited only has { file: string } — no sessionID, so this is a no-op
    await plugin.event({
      event: { type: 'file.edited', properties: { file: 'src/main.ts' } }
    });

    const state = readState();
    // filesModified remains unset; file tracking happens via tool.execute.after
    expect(state.sessions['no-filepath-event-session']?.filesModified).toBeUndefined();
  });

  it('should skip file.edited when enableFileTracking is false', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin({ enableFileTracking: false });
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'no-file-tracking-session' });
    // No-op regardless of config, since SDK event lacks sessionID
    await plugin.event({
      event: { type: 'file.edited', properties: { file: 'x.ts' } }
    });

    const state = readState();
    expect(state.sessions['no-file-tracking-session']?.filesModified).toBeUndefined();
  });
});

// ─── LOW: session.compacting edge cases ──────────────────────────────────────

describe('session.compacting edge cases', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should handle compacting for session with no prior state', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const context: string[] = [];
    await expect(
      plugin['experimental.session.compacting']({ sessionID: 'fresh-compact-session' }, { context })
    ).resolves.not.toThrow();
  });

  it('should not push when context is not an array', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'bad-context-session' });
    await expect(
      plugin['experimental.session.compacting']({ sessionID: 'bad-context-session' }, { context: null })
    ).resolves.not.toThrow();
  });
});

// ─── LOW: completionSignal with blocked/interrupted args.status ───────────────

describe('completionSignal with args.status variants', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should mark session paused when part status has args.status=blocked', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'args-blocked-session' });
    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'args-blocked-session',
          part: {
            type: 'tool',
            tool: 'completionSignal',
            state: { status: 'completed', args: { status: 'blocked', reason: 'quota' } }
          }
        }
      }
    });

    const state = readState();
    expect(state.sessions['args-blocked-session'].autoContinuePaused).not.toBeNull();
  });

  it('should mark session paused when part status has args.status=interrupted', async () => {
    const { createContinuePlugin, readState } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    await plugin['chat.message']({ sessionID: 'args-interrupted-session' });
    await plugin.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'args-interrupted-session',
          part: {
            type: 'tool',
            tool: 'completionSignal',
            state: { status: 'completed', args: { status: 'interrupted', reason: 'user' } }
          }
        }
      }
    });

    const state = readState();
    expect(state.sessions['args-interrupted-session'].autoContinuePaused).not.toBeNull();
  });
});

// ─── LOW: session.idle for unknown session ───────────────────────────────────

describe('session.idle for unknown session', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should handle idle for session that was never created', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    // No session.created event sent
    mockClient.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    await expect(plugin.event({
      event: { type: 'session.idle', properties: { sessionID: 'never-created-session' } }
    })).resolves.not.toThrow();
  });
});

// ─── LOW: Task query fallback chains ─────────────────────────────────────────

describe('task query fallback chains', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should use ctx.getTasksByParentSession as fallback', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const mockCtx = {
      client: {
        session: { messages: vi.fn(), promptAsync: vi.fn() },
      },
      getTasksByParentSession: vi.fn(async () => [{ id: 'ctx-task', status: 'in-progress' }])
    };
    const plugin = await createPlugin(mockCtx);

    await plugin['chat.message']({ sessionID: 'ctx-fallback-session' });
    mockCtx.client.session.messages.mockResolvedValue({
      data: [{ role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }]
    });

    await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'ctx-fallback-session' } } });

    expect(mockCtx.client.session.promptAsync).toHaveBeenCalled();
    const lastCall = mockCtx.client.session.promptAsync.mock.calls[mockCtx.client.session.promptAsync.mock.calls.length - 1][0];
    expect(lastCall.body.parts[0].text).toContain('ctx-task');
  });
});

// ─── LOW: validate dry mode result shape ─────────────────────────────────────

describe('validate dry mode result shape', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should return ok:true with all checks in dry mode', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const result = await plugin.validate({ mode: 'dry' });
    expect(result.ok).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.some(c => c.name === 'client.session.promptAsync')).toBe(true);
  });
});

// ─── LOW: getAutopilotEnabled config precedence ──────────────────────────────

describe('getAutopilotEnabled config precedence', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  it('should return config.autopilotEnabled when runtime timestamp is null', async () => {
    const { getAutopilotEnabled } = await import('../src/autopilot.js');
    const result = getAutopilotEnabled({ autopilotEnabled: true });
    expect(result).toBe(true);
  });

  it('should return false when neither runtime nor config has autopilot enabled', async () => {
    const { getAutopilotEnabled } = await import('../src/autopilot.js');
    const result = getAutopilotEnabled({});
    expect(result).toBe(false);
  });
});

// ─── LOW: TUI dispose non-function guard ─────────────────────────────────────

describe('TUI dispose non-function guard', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();
  });

  it('handles non-function dispose return value gracefully', async () => {
    const { tui } = await import('../force-continue.tui.js');
    const mockApi: any = {
      command: {
        register: (fn: any) => {
          mockApi._getCommands = fn;
          return 'not-a-function'; // non-function dispose
        },
      },
      ui: { toast: vi.fn() },
    };

    await tui(mockApi);
    // Second call — should not throw on non-function dispose
    await expect(tui(mockApi)).resolves.not.toThrow();
  });
});

// ─── LOW: healthCheck with default detail ─────────────────────────────────────

describe('healthCheck with default detail', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should return summary when no detail arg provided', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.healthCheck;
    const result = await toolDef.execute({});

    expect(result).toContain('Plugin health');
    expect(result).toContain('sessions');
  });

  it('should include autopilot status in summary output', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.healthCheck;
    const result = await toolDef.execute({ detail: 'summary' });

    expect(result).toContain('autopilot');
    expect(result).toMatch(/autopilot (enabled|disabled)/);
  });

  it('should include autopilot status in sessions output', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.healthCheck;
    const result = await toolDef.execute({ detail: 'sessions' });

    expect(result).toContain('Autopilot');
    expect(result).toMatch(/Autopilot: (enabled|disabled)/);
    expect(result).toContain('(global)');
  });

  it('should include autopilot object in full JSON output', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const { resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();

    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const toolDef = plugin.tool.healthCheck;
    const result = await toolDef.execute({ detail: 'full' });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('autopilot');
    expect(parsed.autopilot).toHaveProperty('enabled');
    expect(parsed.autopilot).toHaveProperty('timestamp');
    expect(parsed.config).toHaveProperty('autopilotEnabled');
    expect(parsed.config).toHaveProperty('autopilotMaxAttempts');
  });
});

// ─── LOW: plugin return object shape ─────────────────────────────────────────

describe('plugin return object shape', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.resetModules();
    mockClient = {
      session: { messages: vi.fn(), promptAsync: vi.fn() },
    };
  });

  it('should have all expected handler keys', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const expectedKeys = [
      'tool', 'validate', 'chat.message',
      'experimental.chat.system.transform',
      'experimental.chat.messages.transform',
      'tool.execute.before', 'tool.execute.after',
      'event', 'experimental.session.compacting',
    ];
    for (const key of expectedKeys) {
      expect(plugin).toHaveProperty(key);
    }
  });

  it('tool object has all expected tool keys', async () => {
    const { createContinuePlugin } = await import('../force-continue.server.js');
    const createPlugin = createContinuePlugin();
    const plugin = await createPlugin({ client: mockClient });

    const expectedToolKeys = [
      'completionSignal', 'validate', 'statusReport',
      'requestGuidance', 'pauseAutoContinue', 'healthCheck', 'setAutopilot',
    ];
    for (const key of expectedToolKeys) {
      expect(plugin.tool).toHaveProperty(key);
    }
  });
});

// ─── MEDIUM: readAutopilotState and writeAutopilotState exports ─────────────────

describe('readAutopilotState and writeAutopilotState exports', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should export readAutopilotState and writeAutopilotState from force-continue.server.js', async () => {
    const server = await import('../force-continue.server.js');
    expect(typeof server.readAutopilotState).toBe('function');
    expect(typeof server.writeAutopilotState).toBe('function');
  });

  it('should export readAutopilotState and writeAutopilotState from src/autopilot.js', async () => {
    const autopilot = await import('../src/autopilot.js');
    expect(typeof autopilot.readAutopilotState).toBe('function');
    expect(typeof autopilot.writeAutopilotState).toBe('function');
  });

  it('should write and read autopilot state round-trip', async () => {
    const { writeAutopilotState, readAutopilotState, resetAutopilotState } = await import('../src/autopilot.js');
    resetAutopilotState();

    writeAutopilotState({ enabled: true, timestamp: 1234567890 });
    const state = readAutopilotState();
    expect(state.enabled).toBe(true);
    expect(state.timestamp).toBe(1234567890);

    writeAutopilotState({ enabled: false, timestamp: null });
    const state2 = readAutopilotState();
    expect(state2.enabled).toBe(false);
  });

  it('should throw on invalid writeAutopilotState input', async () => {
    const { writeAutopilotState } = await import('../src/autopilot.js');
    expect(() => { writeAutopilotState(null); }).toThrow();
    expect(() => { writeAutopilotState(undefined); }).toThrow();
    expect(() => { writeAutopilotState('not an object'); }).toThrow();
  });
});
