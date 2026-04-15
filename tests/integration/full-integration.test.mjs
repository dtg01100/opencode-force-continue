import { describe, it, expect, afterEach } from 'vitest';
import { spawnWithMessage, waitForOutput } from './harness/spawn-opencode.mjs';
import { assertNoErrors, parseJsonLines } from './harness/assertions.mjs';

describe('Full Integration Tests', () => {
  let spawned;

  afterEach(async () => {
    if (spawned) {
      spawned.kill();
      await spawned.cleanup();
      spawned = null;
    }
  });

  it('should complete a simple task end-to-end', async () => {
    spawned = await spawnWithMessage(
      'Read sample.txt and tell me what it says',
      { timeout: 55000 }
    );

    // Wait for any JSON output (up to 50s)
    await waitForOutput(spawned, /\{/, 50000);

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    assertNoErrors(stderr);
    assertNoErrors(output);

    // Should have JSON output with step events
    const jsonObjs = parseJsonLines(output);
    expect(jsonObjs.length).toBeGreaterThan(0);
  }, 60000);

  it('should run with custom environment variables', async () => {
    spawned = await spawnWithMessage(
      'Just acknowledge',
      {
        timeout: 55000,
        env: {
          FORCE_CONTINUE_COOLDOWN_MS: '1000',
          FORCE_CONTINUE_MAX_CONTINUATIONS: '2'
        }
      }
    );

    // Wait for any output at all
    await waitForOutput(spawned, /.+/, 50000).catch(() => {});

    const stderr = await spawned.getStderr();
    assertNoErrors(stderr);
  }, 60000);

  it('should process healthCheck tool call', async () => {
    spawned = await spawnWithMessage(
      'Call the healthCheck tool',
      { timeout: 55000 }
    );

    // Wait for JSON output
    await waitForOutput(spawned, /\{/, 50000);

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    assertNoErrors(stderr);

    // Should have JSON output
    const jsonObjs = parseJsonLines(output);
    expect(jsonObjs.length).toBeGreaterThan(0);
  }, 60000);
});
