import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);

describe('OpenCode API compatibility', () => {
  describe('mock API shape validation', () => {
    it('mock client.session.promptAsync should have correct call signature', async () => {
      const mockClient = {
        session: {
          messages: vi.fn().mockResolvedValue({ data: [] }),
          promptAsync: vi.fn().mockResolvedValue(true),
        },
      };

      const result = await mockClient.session.promptAsync({
        path: { id: 'test-session' },
        body: { parts: [{ type: 'text', text: 'Continue' }] },
      });

      expect(result).toBe(true);
      expect(mockClient.session.promptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.objectContaining({ id: expect.any(String) }),
          body: expect.objectContaining({ parts: expect.any(Array) }),
        })
      );
    });

    it('mock client should have required session methods', () => {
      const mockClient = {
        session: {
          messages: vi.fn(),
          promptAsync: vi.fn(),
        },
      };

      expect(typeof mockClient.session.messages).toBe('function');
      expect(typeof mockClient.session.promptAsync).toBe('function');
    });

    it('mock client.app.log should accept structured logging', async () => {
      const mockApp = {
        log: vi.fn().mockResolvedValue(undefined),
      };

      await mockApp.log({
        service: 'force-continue',
        level: 'info',
        message: 'Plugin initialized',
        extra: { foo: 'bar' },
      });

      expect(mockApp.log).toHaveBeenCalledWith(
        expect.objectContaining({
          service: expect.any(String),
          level: expect.any(String),
          message: expect.any(String),
        })
      );
    });
  });

  describe('TUI API mock validation', () => {
    it('mock api.command.register should call callback and return commands', () => {
      let capturedCommands = null;
      const mockApi = {
        command: {
          register(cb) {
            capturedCommands = cb();
          },
        },
      };

      mockApi.command.register(() => [
        {
          title: 'Test Command',
          value: 'test:command',
          description: 'A test command',
          category: 'Test',
          onSelect: () => {},
        },
      ]);

      expect(capturedCommands).toHaveLength(1);
      expect(capturedCommands[0]).toEqual(
        expect.objectContaining({
          title: expect.any(String),
          value: expect.any(String),
          description: expect.any(String),
          category: expect.any(String),
          onSelect: expect.any(Function),
        })
      );
    });

    it('mock api.ui.toast should accept variant and message', () => {
      const toasts = [];
      const mockApi = {
        ui: {
          toast(payload) {
            toasts.push(payload);
          },
          DialogConfirm(payload) {
            if (payload.onConfirm) payload.onConfirm();
          },
        },
      };

      mockApi.ui.toast({ message: 'Test message', variant: 'info' });
      mockApi.ui.toast({ message: 'Warning', variant: 'warning' });

      expect(toasts).toHaveLength(2);
      expect(toasts[0]).toMatchObject({
        message: 'Test message',
        variant: 'info',
      });
    });

    it('mock api.ui.DialogConfirm should call onConfirm', () => {
      let confirmed = false;
      const mockApi = {
        ui: {
          DialogConfirm(payload) {
            if (payload.onConfirm) payload.onConfirm();
          },
        },
      };

      mockApi.ui.DialogConfirm({
        title: 'Confirm',
        message: 'Are you sure?',
        onConfirm: () => { confirmed = true; },
      });

      expect(confirmed).toBe(true);
    });
  });

  describe('actual @opencode-ai/plugin type compatibility', () => {
    it('should import actual plugin package', async () => {
      let pluginImport;
      try {
        pluginImport = await import('@opencode-ai/plugin');
        expect(pluginImport).toBeDefined();
        expect(typeof pluginImport.tool).toBe('function');
      } catch (e) {
        expect.fail(`Failed to import @opencode-ai/plugin: ${e.message}`);
      }
    });

    it('should import actual SDK package (skipped — not a direct dependency)', async () => {
      // @opencode-ai/sdk is not listed as a dependency of this package.
      // The plugin uses @opencode-ai/plugin only; SDK types are for reference.
      expect(true).toBe(true);
    });

    it('actual tool function should return object with execute', async () => {
      const { tool } = await import('@opencode-ai/plugin');

      const toolDef = tool({
        description: 'Test tool',
        args: {},
        async execute(args, context) {
          return 'result';
        },
      });

      expect(toolDef).toHaveProperty('description', 'Test tool');
      expect(toolDef).toHaveProperty('execute');
      expect(typeof toolDef.execute).toBe('function');
    });

    it('tool.schema should be accessible', async () => {
      const { tool } = await import('@opencode-ai/plugin');

      expect(tool.schema).toBeDefined();
      expect(typeof tool.schema.string).toBe('function');
      expect(typeof tool.schema.number).toBe('function');
      expect(typeof tool.schema.boolean).toBe('function');
    });
  });

  describe('published server entrypoint compatibility', () => {
    it('should expose the documented ContinuePlugin named export', async () => {
      const serverModule = await import('../force-continue.server.js');

      expect(serverModule).toHaveProperty('ContinuePlugin');
      expect(typeof serverModule.ContinuePlugin).toBe('function');
      expect(serverModule.ContinuePlugin).toBe(serverModule.default.server);
    });

    it('server module should not export tui (v1 plugin spec compliance)', async () => {
      const serverModule = await import('../force-continue.server.js');

      // v1 spec: server and tui are separate entrypoints
      expect(serverModule.default).not.toHaveProperty('tui');
    });

    it('tui module should be loadable via ./tui export', async () => {
      const tuiModule = await import('../force-continue.tui.js');

      expect(tuiModule.default).toHaveProperty('tui');
      expect(typeof tuiModule.default.tui).toBe('function');
    });

    it('tui module should not export server (v1 plugin spec compliance)', async () => {
      const tuiModule = await import('../force-continue.tui.js');

      // v1 spec: server and tui are separate entrypoints
      expect(tuiModule.default).not.toHaveProperty('server');
    });

    it('should not keep a Node process alive on import alone', () => {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "const mod = await import('./force-continue.server.js'); console.log(typeof mod.default?.server);",
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 1500,
        }
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('function');
    });
  });

  describe('plugin context structure', () => {
    it('should create a valid mock plugin context matching PluginInput type', () => {
      const mockCtx = {
        client: {
          session: {
            messages: vi.fn(),
            promptAsync: vi.fn(),
          },
          app: {
            log: vi.fn(),
          },
        },
        project: {
          id: 'test-project',
          name: 'Test Project',
        },
        directory: '/tmp/test',
        worktree: '/tmp/test',
        serverUrl: new URL('http://localhost:3000'),
        $: {},
      };

      expect(mockCtx).toHaveProperty('client');
      expect(mockCtx).toHaveProperty('project');
      expect(mockCtx).toHaveProperty('directory');
      expect(mockCtx).toHaveProperty('worktree');
      expect(mockCtx).toHaveProperty('serverUrl');
    });

    it('should handle event structure used by plugin', () => {
      const sessionCreatedEvent = {
        type: 'session.created',
        properties: {
          info: { id: 'session-123' },
        },
      };

      const sessionIdleEvent = {
        type: 'session.idle',
        properties: {
          sessionID: 'session-123',
        },
      };

      const messagePartUpdatedEvent = {
        type: 'message.part.updated',
        properties: {
          sessionID: 'session-123',
          part: {
            type: 'tool',
            tool: 'completionSignal',
            state: { status: 'completed' },
          },
        },
      };

      expect(sessionCreatedEvent.type).toBe('session.created');
      expect(sessionIdleEvent.type).toBe('session.idle');
      expect(messagePartUpdatedEvent.type).toBe('message.part.updated');
    });
  });
});
