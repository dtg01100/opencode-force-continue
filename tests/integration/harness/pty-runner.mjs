import { spawn } from 'child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

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

  // Create isolated temp directory
	const tempDir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  const configDir = join(tempDir, '.opencode');
  await mkdir(configDir, { recursive: true });

  // Create config with local plugin loaded
  const pluginPath = PROJECT_ROOT;
  const config = {
    "$schema": "https://opencode.ai/config.json",
    plugin: [`force-continue@file://${pluginPath}`]
  };
  await writeFile(join(configDir, 'opencode.json'), JSON.stringify(config, null, 2));

  // Use script(1) to capture PTY output
  const logFile = join(tempDir, 'tui-output.log');
  const proc = spawn('script', ['-q', '-O', logFile, 'opencode'], {
    cwd: tempDir,
    env: {
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
    },
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
    logFile,
    async getOutput() {
      return stdout;
    },
    async getStderr() {
      return stderr;
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
		// Wait a bit for TUI to initialize
		await new Promise(r => setTimeout(r, 2000));
		const output = await tui.getOutput();
		return { success: true, output };
	} finally {
		tui.kill();
	}
}
