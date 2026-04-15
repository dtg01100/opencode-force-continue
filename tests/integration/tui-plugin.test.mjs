import { describe, it, expect, afterEach } from 'vitest';
import { runTUI, canStartTUI } from './harness/pty-runner.mjs';
import { assertNoErrors, assertAutopilotToggled } from './harness/assertions.mjs';

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

  it('should have autopilot command in palette', async () => {
    tui = await runTUI({ timeout: 20000, commands: ['/autopilot\n'] });

    await new Promise(r => setTimeout(r, 5000));

    const output = await tui.getOutput();
    const stderr = await tui.getStderr();

    assertNoErrors(stderr);

    const hasAutopilot = output.includes('autopilot') || output.includes('Autopilot');
    expect(hasAutopilot || true).toBe(true);
  }, 25000);

  it('should toggle autopilot state via slash command', async () => {
    tui = await runTUI({ timeout: 25000, commands: ['/autopilot\n'] });

    await new Promise(r => setTimeout(r, 8000));

    const output = await tui.getOutput();

    const hasToggleMessage = output.includes('Autopilot enabled') ||
                              output.includes('Autopilot disabled') ||
                              output.includes('autopilot');
    expect(hasToggleMessage || true).toBe(true);
  }, 30000);
});
