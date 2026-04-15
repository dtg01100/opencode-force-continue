import { spawn } from 'child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

/**
 * Spawns an isolated OpenCode instance for testing
 * Uses bash to redirect output to a file for reliable capture
 * @param {Object} options
 * @param {string} options.mode - 'run' for non-interactive, 'tui' for interactive
 * @param {string[]} options.args - Additional arguments
 * @param {number} options.timeout - Max runtime in ms (default: 30000)
 * @param {Object} options.env - Extra environment variables
 */
export async function spawnOpenCode(options = {}) {
  const { mode = 'run', args = [], timeout = 30000, env = {} } = options;

  // Create isolated temp directory for test files
  const tempDir = await mkdtemp(join(tmpdir(), 'opencode-test-'));
  const testProjectDest = join(tempDir, 'test-project');
  await mkdir(testProjectDest, { recursive: true });

  // Copy test project files
  const testProjectSrc = join(FIXTURES_DIR, 'test-project');
  const sampleContent = await import('fs/promises').then(fs =>
    fs.readFile(join(testProjectSrc, 'sample.txt'), 'utf-8')
  );
  await writeFile(join(testProjectDest, 'sample.txt'), sampleContent);

  // Create isolated config directory with minimal config
  // opencode looks for config in ~/.config/opencode/
  const configDir = join(tempDir, '.config', 'opencode');
  await mkdir(configDir, { recursive: true });

  // Create minimal config with just our plugin
  const pluginFile = join(PROJECT_ROOT, 'force-continue.server.js');
  const config = {
    "$schema": "https://opencode.ai/config.json",
    plugin: [`force-continue@file://${pluginFile}`]
  };
  await writeFile(join(configDir, 'opencode.json'), JSON.stringify(config, null, 2));

  // Copy auth data to preserve credentials (needed for API access)
  const realAuthDir = join(process.env.HOME, '.local', 'share', 'opencode');
  const testAuthDir = join(tempDir, '.local', 'share', 'opencode');
  await mkdir(testAuthDir, { recursive: true });
  try {
    await copyFile(
      join(realAuthDir, 'auth.json'),
      join(testAuthDir, 'auth.json')
    );
  } catch {
    // Auth might not exist - opencode may still work with fallback providers
  }

  // Output file to capture stdout
  const outputFile = join(tempDir, 'output.txt');
  const stderrFile = join(tempDir, 'stderr.txt');

  // Build command based on mode
  let commandStr;
  if (mode === 'tui') {
    commandStr = `opencode ${args.join(' ')}`;
  } else {
    commandStr = `opencode run --format json ${args.join(' ')}`;
  }

  // Use bash to run command and redirect output
  const bashCmd = `${commandStr} > '${outputFile}' 2> '${stderrFile}'`;

  const proc = spawn('bash', ['-c', bashCmd], {
    cwd: testProjectDest,
    env: {
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
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let killed = false;

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
    outputFile,
    stderrFile,
    async getOutput() {
      try {
        return await readFile(outputFile, 'utf-8');
      } catch {
        return '';
      }
    },
    async getStderr() {
      try {
        return await readFile(stderrFile, 'utf-8');
      } catch {
        return '';
      }
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
