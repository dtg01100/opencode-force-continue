import { spawn } from 'child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { installLocalPlugin } from './install-plugin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

/**
 * Spawns an isolated OpenCode instance for testing.
 * The harness uses a clean temp HOME/XDG layout and does not copy user auth or config.
 * @param {Object} options
 * @param {string} options.mode - 'run' for non-interactive, 'tui' for interactive
 * @param {string[]} options.args - Additional arguments
 * @param {number} options.timeout - Max runtime in ms (default: 30000)
 * @param {Object} options.env - Extra environment variables
 */
export async function spawnOpenCode(options = {}) {
  const { mode = 'run', args = [], timeout = 30000, env = {} } = options;

  // Create isolated temp directory for test files.
  const tempDir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  const testProjectDest = join(tempDir, 'test-project');
  await mkdir(testProjectDest, { recursive: true });

  // Copy test project files
  const testProjectSrc = join(FIXTURES_DIR, 'test-project');
  const sampleContent = await import('fs/promises').then(fs =>
    fs.readFile(join(testProjectSrc, 'sample.txt'), 'utf-8')
  );
  await writeFile(join(testProjectDest, 'sample.txt'), sampleContent);

  const configDir = join(testProjectDest, '.opencode');
  const processEnv = {
    ...process.env,
    ...env,
    HOME: tempDir,
    // Override all XDG dirs so opencode uses a fresh isolated database
    // (without XDG_DATA_HOME override, opencode finds the running TUI server
    // in the real ~/.local/share/opencode/opencode.db and hangs instead of
    // starting its own server)
    XDG_CONFIG_HOME: join(tempDir, '.config'),
    XDG_DATA_HOME: join(tempDir, '.local', 'share'),
    XDG_CACHE_HOME: join(tempDir, '.cache'),
    OPENCODE_CONFIG_DIR: configDir,
    NODE_ENV: 'test'
  };

  await installLocalPlugin(PROJECT_ROOT, testProjectDest, processEnv);

  // Build command based on mode
  let command, commandArgs;
  if (mode === 'tui') {
    command = 'opencode';
    commandArgs = args;
  } else {
    command = 'opencode';
    commandArgs = ['run', '--format', 'json', ...args];
  }

  // Spawn directly with isolated environment
  const proc = spawn(command, commandArgs, {
    cwd: testProjectDest,
    env: processEnv,
    stdio: [mode === 'tui' ? 'pipe' : 'ignore', 'pipe', 'pipe']
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
    args: [message],
    ...options
  });
  return result;
}

/**
 * Wait for specific output pattern with timeout
 */
async function waitForStream(read, pattern, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const output = await read();
    if (pattern.test(output)) {
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for pattern: ${pattern}`);
}

export async function waitForOutput(spawned, pattern, timeout = 15000) {
  return waitForStream(() => spawned.getOutput(), pattern, timeout);
}

export async function waitForStderr(spawned, pattern, timeout = 15000) {
  return waitForStream(() => spawned.getStderr(), pattern, timeout);
}

export async function waitForAnyOutput(spawned, pattern, timeout = 15000) {
  return waitForStream(async () => {
    const [stdout, stderr] = await Promise.all([
      spawned.getOutput(),
      spawned.getStderr()
    ]);
    return stdout + stderr;
  }, pattern, timeout);
}
