import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

describe('TUI ↔ server communication', () => {
  it('carries next-session autopilot from the TUI process into the server session.created handler', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(join(tmpdir(), 'force-continue-tui-server-'));
    const projectDir = join(tempRoot, 'project');
    const env = { ...process.env, FORCE_CONTINUE_SHARED_STATE_SCOPE: 'cross-process-next-session' };
    mkdirSync(projectDir, { recursive: true });

    const frontend = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import path from 'path';
        import { pathToFileURL } from 'url';

        function resolveCommands(commandsOrProvider) {
          if (typeof commandsOrProvider === 'function') {
            return commandsOrProvider();
          }
          return commandsOrProvider ?? [];
        }

        process.chdir(${JSON.stringify(projectDir)});
        const { tui } = await import(pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'force-continue.tui.js')).href);

        let registeredCommands = null;
        const api = {
          command: {
            register: (commands) => {
              registeredCommands = commands;
              return () => {};
            },
          },
          ui: {
            toast: () => {},
          },
          route: {
            current: { name: 'home' },
          },
        };

        await tui(api, {}, {});
        resolveCommands(registeredCommands)[0].onSelect();
        console.log('frontend-toggled');
      `],
      { cwd: repoRoot, env, encoding: 'utf-8' }
    );

    expect(frontend.status).toBe(0);
    expect(frontend.stdout).toContain('frontend-toggled');

    const backend = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import path from 'path';
        import { pathToFileURL } from 'url';

        process.chdir(${JSON.stringify(projectDir)});

        const { createSessionEventsHandler } = await import(
          pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'src', 'handlers', 'sessionEvents.js')).href
        );
        const { sessionState } = await import(
          pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'src', 'state.js')).href
        );

        const handler = createSessionEventsHandler({}, {}, {}, { record: () => {} }, () => {});
        await handler({
          event: {
            type: 'session.created',
            properties: {
              info: { id: 'cross-process-session' },
            },
          },
        });

        console.log(JSON.stringify(sessionState.get('cross-process-session') || {}));
      `],
      { cwd: repoRoot, env, encoding: 'utf-8' }
    );

    try {
      expect(backend.status).toBe(0);
      const sessionMeta = JSON.parse(backend.stdout.trim());
      expect(sessionMeta.autopilotEnabled).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('carries active-session autopilot from the TUI process into the server autopilot resolver', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(join(tmpdir(), 'force-continue-tui-server-'));
    const projectDir = join(tempRoot, 'project');
    const env = { ...process.env, FORCE_CONTINUE_SHARED_STATE_SCOPE: 'cross-process-session' };
    mkdirSync(projectDir, { recursive: true });

    const frontend = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import path from 'path';
        import { pathToFileURL } from 'url';

        function resolveCommands(commandsOrProvider) {
          if (typeof commandsOrProvider === 'function') {
            return commandsOrProvider();
          }
          return commandsOrProvider ?? [];
        }

        process.chdir(${JSON.stringify(projectDir)});
        const { tui } = await import(pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'force-continue.tui.js')).href);

        let registeredCommands = null;
        const api = {
          command: {
            register: (commands) => {
              registeredCommands = commands;
              return () => {};
            },
          },
          ui: {
            toast: () => {},
          },
          route: {
            current: { name: 'session', params: { sessionID: 'shared-session' } },
          },
        };

        await tui(api, {}, {});
        resolveCommands(registeredCommands)[0].onSelect();
        console.log('frontend-session-toggled');
      `],
      { cwd: repoRoot, env, encoding: 'utf-8' }
    );

    expect(frontend.status).toBe(0);
    expect(frontend.stdout).toContain('frontend-session-toggled');

    const backend = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import path from 'path';
        import { pathToFileURL } from 'url';

        process.chdir(${JSON.stringify(projectDir)});

        const { getAutopilotEnabled } = await import(
          pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'src', 'autopilot.js')).href
        );

        console.log(JSON.stringify({
          enabled: getAutopilotEnabled({ autopilotEnabled: false }, 'shared-session'),
        }));
      `],
      { cwd: repoRoot, env, encoding: 'utf-8' }
    );

    try {
      expect(backend.status).toBe(0);
      const result = JSON.parse(backend.stdout.trim());
      expect(result.enabled).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
