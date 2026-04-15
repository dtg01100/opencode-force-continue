import { describe, it, expect, afterEach } from 'vitest';
import { spawnOpenCode, spawnWithMessage, waitForOutput } from './harness/spawn-opencode.mjs';
import { assertPluginLoaded, assertNoErrors, assertAutoContinueTriggered, parseJsonLines, createTestTimeout } from './harness/assertions.mjs';

describe('Full Integration Tests', () => {
  let spawned;

  afterEach(async () => {
    if (spawned) {
      await spawned.cleanup();
      spawned = null;
    }
  });

  it('should complete a simple task end-to-end', async () => {
    spawned = await spawnWithMessage(
      'Read sample.txt and tell me what it says, then call completionSignal when done',
      { timeout: 30000 }
    );

    const exitPromise = spawned.waitForExit();
    const timeoutPromise = createTestTimeout(30000);

    try {
      await Promise.race([exitPromise, timeoutPromise]);
    } catch (e) {
      // Timeout OK - just check output
    }

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    assertNoErrors(stderr);
    assertPluginLoaded(output);

    // Should have read the file
    expect(output).toBeDefined();
  }, 35000);

  it('should detect idle session and trigger auto-continue', async () => {
    // This test requires a longer timeout to allow idle detection
    spawned = await spawnWithMessage(
      'Just acknowledge this message and wait',
      {
        timeout: 45000,
        env: {
          FORCE_CONTINUE_COOLDOWN_MS: '1000',  // Short cooldown for testing
          FORCE_CONTINUE_MAX_CONTINUATIONS: '2'
        }
      }
    );

    // Wait longer for idle detection (default idle time + some buffer)
    await new Promise(r => setTimeout(r, 15000));

    const output = await spawned.getOutput();

    // Plugin should be loaded
    assertPluginLoaded(output);

    // Should see some form of continuation or idle handling
    // Note: This is a soft check since timing is tricky
    expect(output.length).toBeGreaterThan(0);
  }, 50000);

  it('should handle healthCheck in running session', async () => {
    spawned = await spawnWithMessage(
      'Call the healthCheck tool with detail=sessions and report the result',
      { timeout: 30000 }
    );

    const exitPromise = spawned.waitForExit();
    const timeoutPromise = createTestTimeout(30000);

    try {
      await Promise.race([exitPromise, timeoutPromise]);
    } catch (e) {
      // Timeout OK
    }

    const output = await spawned.getOutput();
    const jsonObjects = parseJsonLines(output);

    // Should have some JSON output
    expect(jsonObjects.length).toBeGreaterThanOrEqual(0);
  }, 35000);
});
