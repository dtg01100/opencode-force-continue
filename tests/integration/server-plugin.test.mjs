import { describe, it, expect, afterEach } from 'vitest';
import { spawnWithMessage, waitForOutput } from './harness/spawn-opencode.mjs';
import { assertNoErrors, parseJsonLines } from './harness/assertions.mjs';

describe('Server Plugin Integration', () => {
  let spawned;

  afterEach(async () => {
    if (spawned) {
      spawned.kill();
      await spawned.cleanup();
      spawned = null;
    }
  });

  it('should run without errors', async () => {
    spawned = await spawnWithMessage('list files', { timeout: 55000 });

    // Wait until opencode produces any output (up to 50s)
    await waitForOutput(spawned, /.+/, 50000).catch(() => {});

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    assertNoErrors(stderr);

    // Verify some output was produced
    expect(output.length + stderr.length).toBeGreaterThan(0);
  }, 60000);

  it('should process task and produce output', async () => {
    spawned = await spawnWithMessage('Read sample.txt', { timeout: 55000 });

    // Wait for any JSON output to appear
    await waitForOutput(spawned, /\{/, 50000);

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    assertNoErrors(stderr);
    assertNoErrors(output);

    // Should have JSON output with step events
    const jsonObjs = parseJsonLines(output);
    expect(jsonObjs.length).toBeGreaterThan(0);
  }, 60000);

  it('should complete healthCheck tool call', async () => {
    spawned = await spawnWithMessage('Call the healthCheck tool', { timeout: 55000 });

    // Wait for JSON output (opencode run --format json produces JSONL)
    await waitForOutput(spawned, /\{/, 50000);

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();

    assertNoErrors(stderr);

    // Should have JSON output
    const jsonObjs = parseJsonLines(output);
    expect(jsonObjs.length).toBeGreaterThan(0);

    // Should have tool usage events
    const hasToolUse = jsonObjs.some(obj => obj.type === 'tool_use' || obj.part?.type === 'tool');
    expect(hasToolUse).toBe(true);
  }, 60000);
});
