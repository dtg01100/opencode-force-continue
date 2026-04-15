import { spawn } from 'child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

/**
 * Spawns an isolated OpenCode instance for testing
 * @param {Object} options
 * @param {string} options.mode - 'run' for non-interactive, 'tui' for interactive
 * @param {string[]} options.args - Additional arguments
 * @param {number} options.timeout - Max runtime in ms (default: 30000)
 * @param {Object} options.env - Extra environment variables
 */
export async function spawnOpenCode(options = {}) {
  const { mode = 'run', args = [], timeout = 30000, env = {} } = options;

  // Create isolated temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  const configDir = join(tempDir, '.opencode');
  await mkdir(configDir, { recursive: true });

  // Create config with local plugin loaded
  const pluginPath = PROJECT_ROOT;
  const config = {
    plugin: [`force-continue@file://${pluginPath}`]
  };
  await writeFile(join(configDir, 'opencode.json'), JSON.stringify(config, null, 2));

  // Copy test project to temp dir
  const testProjectSrc = join(FIXTURES_DIR, 'test-project');
  const testProjectDest = join(tempDir, 'test-project');
  await mkdir(testProjectDest, { recursive: true });

  const sampleContent = await import('fs/promises').then(fs =>
    fs.readFile(join(testProjectSrc, 'sample.txt'), 'utf-8')
  );
  await writeFile(join(testProjectDest, 'sample.txt'), sampleContent);

  // Build command
  const command = mode === 'tui' ? 'opencode' : 'opencode';
  const commandArgs = mode === 'run'
    ? ['run', '--format', 'json', ...args]
    : args;

  // Spawn with isolated environment
  const proc = spawn(command, commandArgs, {
    cwd: testProjectDest,
    env: {
      ...process.env,
      ...env,
      HOME: tempDir,
      OPENCODE_CONFIG_DIR: configDir,
      NODE_ENV: 'test'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  let killed = false;

  proc.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data) => {
    stderr += data.toString();
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
    testProjectDir: testProjectDest,
    async getOutput() {
      return stdout;
    },
    async getStderr() {
      return stderr;
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
 * Spawn OpenCode with a specific message in run mode
 */
export async function spawnWithMessage(message, options = {}) {
  const result = await spawnOpenCode({
    mode: 'run',
    args: ['--', message],
    ...options
  });
  return result;
}

/**
 * Wait for specific output pattern with timeout
 */
export async function waitForOutput(spawned, pattern, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = await spawned.getOutput();
    if (pattern.test(output)) {
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for pattern: ${pattern}`);
}
