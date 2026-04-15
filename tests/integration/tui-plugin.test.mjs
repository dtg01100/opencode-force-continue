import { describe, it, expect, afterEach } from 'vitest';
import { runTUI, canStartTUI } from './harness/pty-runner.mjs';
import { assertNoErrors } from './harness/assertions.mjs';

describe('TUI Plugin Integration', () => {
  let tui;

  afterEach(async () => {
    if (tui) {
      await tui.cleanup();
      tui = null;
    }
  });

  it('should start TUI without error', async () => {
    const result = await canStartTUI(15000);
    expect(result.success).toBe(true);
  }, 20000);

  it('should run TUI and produce output', async () => {
    tui = await runTUI({ timeout: 20000, commands: [] });

    await new Promise(r => setTimeout(r, 10000));

    const output = await tui.getOutput();
    const stderr = await tui.getStderr();

    assertNoErrors(stderr);

    // Should have some output
    expect(output.length + stderr.length).toBeGreaterThan(0);
  }, 25000);

  it('should handle autopilot command in TUI', async () => {
    tui = await runTUI({ timeout: 25000, commands: ['/autopilot\n'] });

    await new Promise(r => setTimeout(r, 10000));

    const stderr = await tui.getStderr();

    assertNoErrors(stderr);
  }, 30000);
});
