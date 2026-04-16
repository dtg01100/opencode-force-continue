import { existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { runTUI, canStartTUI, waitForTUIOutput } from './harness/pty-runner.mjs';

describe('TUI Plugin Integration', () => {
  let tui;

  afterEach(async () => {
    if (tui) {
      await tui.cleanup();
      tui = null;
    }
  });

  it('should start TUI process', async () => {
    const result = await canStartTUI(12000);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.stderr).not.toMatch(/unexpected number of arguments/i);
    expect(existsSync(result.tempDir)).toBe(false);
  }, 16000);

  it('should emit terminal output when a TUI session starts', async () => {
    tui = await runTUI({ timeout: 12000, commands: [] });
    const output = await waitForTUIOutput(tui, /./, 10000);
    const stderr = await tui.getStderr();

    expect(output.length).toBeGreaterThan(0);
    expect(stderr).not.toMatch(/unexpected number of arguments/i);
  }, 16000);

  it('should create tui.json during clean install before launching the TUI', async () => {
    tui = await runTUI({ timeout: 12000, commands: [] });

    expect(existsSync(join(tui.configDir, 'opencode.json'))).toBe(true);
    expect(existsSync(join(tui.configDir, 'tui.json'))).toBe(true);
  }, 16000);

  it('should clean up its isolated workspace after TUI shutdown', async () => {
    tui = await runTUI({ timeout: 12000, commands: [] });
    const tempDir = tui.tempDir;

    await waitForTUIOutput(tui, /./, 10000);
    await tui.cleanup();
    tui = null;

    expect(existsSync(tempDir)).toBe(false);
  }, 16000);
});
