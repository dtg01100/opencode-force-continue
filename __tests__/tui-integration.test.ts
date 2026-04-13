import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

describe('TUI integration', () => {
  it('TUI module should be loadable via package.json exports', async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
    );
    const tuiExport = pkg.exports['./tui'];
    expect(tuiExport).toBeDefined();
    expect(tuiExport.import).toBe('./force-continue.tui.js');
  });

  it('TUI module should export expected shape for OpenCode', async () => {
    const tuiModule = await import('../force-continue.tui.js');
    expect(tuiModule.default).toBeDefined();
    expect(tuiModule.default.tui).toBeDefined();
    expect(typeof tuiModule.default.tui).toBe('function');
    expect(tuiModule.default.id).toBe('force-continue');
  });

  it('TUI should support callback-based command registration', async () => {
    const { tui } = await import('../force-continue.tui.js');

    let capturedProvider;
    const mockApi = {
      command: {
        register: vi.fn((provider) => {
          capturedProvider = provider;
          return vi.fn();
        }),
      },
      ui: {
        toast: vi.fn(),
      },
      route: {
        current: {
          name: 'session',
          params: { sessionID: 'callback-session' },
        },
      },
    };

    await tui(mockApi, {}, {});

    expect(mockApi.command.register).toHaveBeenCalledTimes(1);
    expect(typeof capturedProvider).toBe('function');
    const commands = capturedProvider();
    expect(Array.isArray(commands)).toBe(true);
    expect(commands[0]).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        value: 'force-continue:autopilot',
        onSelect: expect.any(Function),
      })
    );
  });

  it('TUI function should accept OpenCode API and register commands', async () => {
    const { tui } = await import('../force-continue.tui.js');
    
    // Mock OpenCode runtime API
    const mockApi = {
      command: {
        register: vi.fn(() => vi.fn()), // dispose function
      },
      ui: {
        toast: vi.fn(),
      },
      route: {
        current: {
          name: 'session',
          params: { sessionID: 'test-session-123' },
        },
      },
    };

    // Call tui with mock API
    await tui(mockApi, {}, {});

    // Verify command registration occurred
    expect(mockApi.command.register).toHaveBeenCalled();
  });

  it('TUI should handle missing API gracefully', async () => {
    const { tui } = await import('../force-continue.tui.js');
    
    // Mock minimal API without command support
    const minimalApi = {
      route: {
        current: null,
      },
    };

    // Should not throw
    await expect(tui(minimalApi, {}, {})).resolves.not.toThrow();
  });

  it('server module should not export tui (v1 spec compliance)', async () => {
    const serverModule = await import('../force-continue.server.js');
    expect(serverModule.default).not.toHaveProperty('tui');
  });

  it('TUI module should load without side effects in isolation', () => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import path from 'path';
        import { pathToFileURL } from 'url';
        const tuiPath = pathToFileURL(path.join(process.cwd(), 'force-continue.tui.js')).href;
        await import(tuiPath);
        console.log('loaded');
      `],
      { cwd: process.cwd() }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toContain('loaded');
  });
});
