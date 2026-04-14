import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  upsertPluginSpec,
  normalizeConfigObject,
  syncTuiConfigFromOpencode,
} from '../src/install-config.js';

describe('install config helper', () => {
  it('adds plugin spec to an empty config object', () => {
    expect(upsertPluginSpec({}, 'force-continue')).toEqual({
      plugin: ['force-continue'],
    });
  });

  it('preserves existing config keys while appending the plugin once', () => {
    const updated = upsertPluginSpec(
      {
        theme: 'github-dark',
        plugin: ['other-plugin'],
      },
      'force-continue'
    );

    expect(updated).toEqual({
      theme: 'github-dark',
      plugin: ['other-plugin', 'force-continue'],
    });
  });

  it('does not duplicate an existing plugin spec', () => {
    const updated = upsertPluginSpec(
      {
        plugin: ['force-continue'],
      },
      'force-continue'
    );

    expect(updated.plugin).toEqual(['force-continue']);
  });

  it('normalizes invalid config content to an object with a plugin array', () => {
    expect(normalizeConfigObject(null)).toEqual({ plugin: [] });
    expect(normalizeConfigObject([])).toEqual({ plugin: [] });
  });

  it('mirrors the matching plugin spec from opencode.json into tui.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'force-continue-config-'));
    const spec = 'force-continue@git+https://github.com/dtg01100/opencode-force-continue.git';

    try {
      writeFileSync(
        join(dir, 'opencode.json'),
        JSON.stringify({ plugin: [spec] }, null, 2)
      );

      const result = syncTuiConfigFromOpencode(dir, 'force-continue');
      const tuiConfig = JSON.parse(readFileSync(join(dir, 'tui.json'), 'utf-8'));

      expect(result.synced).toBe(true);
      expect(result.changed).toBe(true);
      expect(tuiConfig.plugin).toContain(spec);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
