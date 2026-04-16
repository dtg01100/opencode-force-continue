import { spawn } from 'child_process';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { installLocalPlugin } from './install-plugin.mjs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

/**
 * Run OpenCode in TUI mode using script(1) for PTY capture
 * This provides terminal emulation without requiring node-pty
 */
export async function runTUI(options = {}) {
  const {
    timeout = 30000,
    env = {},
    commands = [] // Array of strings to type, e.g. ['/autopilot', '\n']
  } = options;

  const tempDir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  const projectDir = join(tempDir, 'test-project');
  const configDir = join(projectDir, '.opencode');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'sample.txt'), 'Hello World\n');

  const processEnv = {
    ...process.env,
    ...env,
    HOME: tempDir,
    XDG_CONFIG_HOME: join(tempDir, '.config'),
    XDG_DATA_HOME: join(tempDir, '.local', 'share'),
    XDG_CACHE_HOME: join(tempDir, '.cache'),
    OPENCODE_CONFIG_DIR: configDir,
    TERM: 'xterm-256color',
    COLUMNS: '80',
    LINES: '24',
    NODE_ENV: 'test'
  };

  await installLocalPlugin(PROJECT_ROOT, projectDir, processEnv);

  // Use script(1) to capture PTY output
  const logFile = join(tempDir, 'tui-output.log');
  const proc = spawn('script', ['-q', '-f', '-e', '-c', 'opencode', logFile], {
    cwd: projectDir,
    env: processEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let killed = false;
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  proc.stderr.on('data', (data) => {
    stderr += data.toString();
  });

	// Send commands with delays
	const sendCommands = async () => {
		for (const cmd of commands) {
			// 500ms delay to allow TUI to process previous input
			await new Promise(r => setTimeout(r, 500));
			proc.stdin.write(cmd);
		}
	};
	sendCommands().catch(e => {
		console.debug('TUI command send error:', e.message);
	});

  const exitCode = new Promise((resolve) => {
    proc.on('close', (code) => {
      resolve(code);
    });
  });

	const timeoutId = setTimeout(() => {
		if (!killed) {
			killed = true;
			proc.kill('SIGTERM');
			setTimeout(() => {
				if (!killed) {
					proc.kill('SIGKILL');
				}
			}, 5000);
		}
	}, timeout);

  return {
    process: proc,
    tempDir,
    projectDir,
    configDir,
    logFile,
    async getOutput() {
      return stdout;
    },
    async getStderr() {
      return stderr;
    },
    async getLogOutput() {
      try {
        return await readFile(logFile, 'utf-8');
      } catch {
        return '';
      }
    },
    async sendCommand(cmd) {
      proc.stdin.write(cmd);
    },
    async waitForExit() {
      clearTimeout(timeoutId);
      return exitCode;
    },
    kill() {
      killed = true;
      clearTimeout(timeoutId);
      proc.kill('SIGTERM');
    },
    async cleanup() {
      this.kill();
      await exitCode.catch(() => {});
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };
}

/**
 * Simplified TUI test that just checks if OpenCode starts
 */
export async function canStartTUI(timeout = 10000) {
	const tui = await runTUI({ timeout });
	try {
		const output = await waitForTerminalOutput(tui, /./, Math.min(timeout, 10000));
    const stderr = await tui.getStderr();
		return { success: output.length > 0, output, stderr, tempDir: tui.tempDir };
	} finally {
		await tui.cleanup();
	}
}

async function waitForTerminalOutput(tui, pattern, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const [output, logOutput] = await Promise.all([
      tui.getOutput(),
      tui.getLogOutput(),
    ]);
    const combinedOutput = `${output}\n${logOutput}`;
    if (pattern.test(combinedOutput)) {
      return combinedOutput;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for TUI output matching ${pattern}`);
}

export async function waitForTUIOutput(tui, pattern, timeout = 10000) {
  return waitForTerminalOutput(tui, pattern, timeout);
}
