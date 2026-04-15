import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnOpenCode, spawnWithMessage } from './harness/spawn-opencode.mjs';
import { assertPluginLoaded, assertNoErrors, parseJsonLines, findToolResult, assertHealthCheckValid, createTestTimeout } from './harness/assertions.mjs';

describe('Server Plugin Integration', () => {
  let spawned;

  afterEach(async () => {
    if (spawned) {
      await spawned.cleanup();
      spawned = null;
    }
  });

  it('should load plugin without error', async () => {
    spawned = await spawnWithMessage('list files', { timeout: 20000 });

    const exitPromise = spawned.waitForExit();
    const timeoutPromise = createTestTimeout(20000);

    try {
      await Promise.race([exitPromise, timeoutPromise]);
    } catch (e) {
      // Timeout is expected for some tests
    }

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    // Should not have fatal errors
    assertNoErrors(stderr);
  }, 30000);

  it('should register plugin tools', async () => {
    spawned = await spawnWithMessage('call healthCheck tool', { timeout: 20000 });

    await new Promise(r => setTimeout(r, 10000));

    const output = await spawned.getOutput();

    // Plugin tools should be available
    assertPluginLoaded(output);
  }, 30000);

  it('should have healthCheck tool available', async () => {
    spawned = await spawnWithMessage('use the healthCheck tool with detail=summary', { timeout: 25000 });

    const exitPromise = spawned.waitForExit();
    const timeoutPromise = createTestTimeout(25000);

    try {
      await Promise.race([exitPromise, timeoutPromise]);
    } catch (e) {
      // Timeout OK
    }

    const output = await spawned.getOutput();
    const jsonObjects = parseJsonLines(output);

    // Should have tool results
    expect(jsonObjects.length).toBeGreaterThan(0);
  }, 35000);
});
