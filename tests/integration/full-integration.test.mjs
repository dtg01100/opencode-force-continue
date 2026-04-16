import { describe, it, expect, afterEach } from 'vitest';
import {
  spawnWithMessage,
} from './harness/spawn-opencode.mjs';
import {
  assertHealthCheckValid,
  assertNoErrors,
  parseJsonLines,
} from './harness/assertions.mjs';

describe('Full Integration Tests', () => {
  let spawned;

  afterEach(async () => {
    if (spawned) {
      spawned.kill();
      await spawned.cleanup();
      spawned = null;
    }
  });

  it('should complete a simple task end-to-end on a clean install', async () => {
    spawned = await spawnWithMessage(
      'Read sample.txt and tell me what it says',
      { timeout: 20000 }
    );

    await spawned.waitForExit();

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();
    const jsonObjects = parseJsonLines(output);
    const readCall = jsonObjects.find((entry) => entry.type === 'tool_use' && entry.part?.tool === 'read');

    assertNoErrors(stderr);
    expect(readCall).toBeDefined();
    expect(readCall.part.state.output).toContain('Hello World');
  }, 25000);

  it('should surface env overrides through healthCheck full detail', async () => {
    spawned = await spawnWithMessage(
      'Call the healthCheck tool with detail=full and report the JSON result',
      {
        timeout: 25000,
        env: {
          FORCE_CONTINUE_MAX_CONTINUATIONS: '2'
        }
      }
    );

    await spawned.waitForExit();

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();
    const jsonObjects = parseJsonLines(output);
    const toolCall = jsonObjects.find((entry) => entry.type === 'tool_use' && entry.part?.tool === 'healthCheck');
    const fullResult = toolCall?.part?.state?.output;
    const parsed = JSON.parse(fullResult);

    assertNoErrors(stderr);
    assertHealthCheckValid(parsed);
    expect(parsed.config.maxContinuations).toBe(2);
  }, 30000);

  it('should return a healthCheck summary and final answer text', async () => {
    spawned = await spawnWithMessage(
      'Call the healthCheck tool with detail=summary and report the result',
      { timeout: 30000 }
    );

    await spawned.waitForExit();

    const output = await spawned.getOutput();
    const stderr = await spawned.getStderr();
    const jsonObjects = parseJsonLines(output);
    const toolCall = jsonObjects.find((entry) => entry.type === 'tool_use' && entry.part?.tool === 'healthCheck');
    const summary = toolCall?.part?.state?.output;

    assertNoErrors(stderr);
    expect(toolCall).toBeDefined();
    assertHealthCheckValid(summary);
    expect(summary).toContain('Plugin health:');
  }, 35000);
});
