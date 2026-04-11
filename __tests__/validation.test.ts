import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('configuration fuzzing', () => {
  let originalEnv;
  let tempDir;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = join(tmpdir(), `fc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => {
      if (!originalEnv[k]) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('environment variable parsing', () => {
    it('should handle non-numeric values for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = 'not-a-number';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle negative values for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '-5';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle float values for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '3.7';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(3);
    });

    it('should handle very large integer values', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '999999999999';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(999999999999);
    });

    it('should handle empty string env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle whitespace-only env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '   ';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle "true" for boolean env vars', async () => {
      process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'true';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.enableLoopDetection).toBe(true);
    });

    it('should handle "TRUE" for boolean env vars (case insensitive)', async () => {
      process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'TRUE';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.enableLoopDetection).toBe(true);
    });

    it('should handle random string for boolean env vars (treated as true)', async () => {
      process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'random-text';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.enableLoopDetection).toBe(true);
    });

    it('should handle "false" for boolean env vars', async () => {
      process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'false';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.enableLoopDetection).toBe(false);
    });

    it('should handle "FALSE" for boolean env vars (case insensitive)', async () => {
      process.env.FORCE_CONTINUE_ENABLE_LOOP_DETECTION = 'FALSE';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.enableLoopDetection).toBe(false);
    });

    it('should handle Infinity for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = 'Infinity';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle NaN for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = 'NaN';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle hex values for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '0x10';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(16);
    });

    it('should handle scientific notation for integer env vars', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '1e2';
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(100);
    });
  });

  describe('config file parsing', () => {
    it('should handle malformed JSON in config file', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, '{ not valid json }');
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args);

      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      console.warn = originalWarn;
      process.chdir(originalCwd);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0][0]).toContain('Failed to parse config file');
      expect(config.maxContinuations).toBe(5);
    });

    it('should handle empty config file', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, '');
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args);

      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      console.warn = originalWarn;
      process.chdir(originalCwd);

      expect(config.maxContinuations).toBe(5);
    });

    it('should handle config file with null values', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({ maxContinuations: null }));
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(5);
    });

    it('should ignore config file properties with wrong types', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({
        maxContinuations: "should-be-number",
        enableLoopDetection: "should-be-boolean",
        ignoreTools: "should-be-array"
      }));
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(5);
      expect(config.enableLoopDetection).toBe(true);
      expect(config.ignoreTools).toEqual(["read", "glob", "grep"]);
    });

    it('should ignore config file unknown properties', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({
        unknownProperty: "some-value",
        anotherUnknown: 123
      }));
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(5);
      expect(config.unknownProperty).toBeUndefined();
      expect(config.anotherUnknown).toBeUndefined();
    });

    it('should handle deeply nested malformed config', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, '{"nested": {"deeply": {"value": undefined}}}');
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args);

      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      console.warn = originalWarn;
      process.chdir(originalCwd);

      expect(config.maxContinuations).toBe(5);
    });

    it('should prefer .opencode/force-continue.json over force-continue.config.json', async () => {
      mkdirSync(join(tempDir, '.opencode'), { recursive: true });
      writeFileSync(join(tempDir, '.opencode', 'force-continue.json'), JSON.stringify({ maxContinuations: 99 }));
      writeFileSync(join(tempDir, 'force-continue.config.json'), JSON.stringify({ maxContinuations: 50 }));
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(99);
    });
  });

  describe('config precedence', () => {
    it('should override file config with env vars', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({ maxContinuations: 10 }));
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '20';
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(20);
    });

    it('should override defaults with file config', async () => {
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({ maxContinuations: 15 }));
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(15);
    });
  });

  describe('edge cases', () => {
    it('should handle zero values correctly', async () => {
      process.env.FORCE_CONTINUE_MAX_CONTINUATIONS = '0';
      process.env.FORCE_CONTINUE_COOLDOWN_MS = '0';
      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.maxContinuations).toBe(0);
      expect(config.cooldownMs).toBe(0);
    });

    it('should handle unicode in config file paths', async () => {
      const unicodeDir = join(tempDir, '测试-τєѕт-🎭');
      mkdirSync(unicodeDir, { recursive: true });
      const configPath = join(unicodeDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({ maxContinuations: 42 }));
      const originalCwd = process.cwd();
      process.chdir(unicodeDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.maxContinuations).toBe(42);
    });

    it('should handle very long string values', async () => {
      const longString = 'x'.repeat(10000);
      const configPath = join(tempDir, 'force-continue.config.json');
      writeFileSync(configPath, JSON.stringify({ customProperty: longString }));
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      vi.resetModules();
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();

      process.chdir(originalCwd);
      expect(config.customProperty).toBeUndefined();
    });
  });
});

describe('schema validation', () => {
  it('should validate correct config', async () => {
    const { validateConfig } = await import('../src/validation.js');
    const result = validateConfig({
      maxContinuations: 5,
      escalationThreshold: 3,
      enableLoopDetection: true
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject config with wrong types', async () => {
    const { validateConfig } = await import('../src/validation.js');
    const result = validateConfig({
      maxContinuations: "not-a-number",
      enableLoopDetection: "not-a-boolean"
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject negative values for minimum-constrained fields', async () => {
    const { validateConfig } = await import('../src/validation.js');
    const result = validateConfig({
      maxContinuations: -5
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('less than minimum'))).toBe(true);
  });

  it('should reject unknown properties when additionalProperties is false', async () => {
    const { validateConfig } = await import('../src/validation.js');
    const result = validateConfig({
      unknownProperty: 'value'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Unknown property'))).toBe(true);
  });

  it('should validate session state', async () => {
    const { validateSessionState } = await import('../src/validation.js');
    const result = validateSessionState({
      continuationCount: 2,
      autoContinuePaused: { reason: 'completed', timestamp: Date.now() }
    });
    expect(result.valid).toBe(true);
  });

  it('should reject session state with invalid pause reason', async () => {
    const { validateSessionState } = await import('../src/validation.js');
    const result = validateSessionState({
      autoContinuePaused: { reason: 'invalid_reason', timestamp: Date.now() }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('one of'))).toBe(true);
  });

  it('should validate session state with paused estimatedTime and nullable guidance/progress fields', async () => {
    const { validateSessionState } = await import('../src/validation.js');
    const result = validateSessionState({
      autoContinuePaused: { reason: 'user_paused', timestamp: Date.now(), estimatedTime: '5 minutes' },
      awaitingGuidance: { question: 'Use A or B?', context: null, options: null, timestamp: Date.now() },
      lastProgressReport: { progress: 'Working', nextSteps: null, blockers: null, timestamp: Date.now() }
    });
    expect(result.valid).toBe(true);
  });

  it('should validate completionSignal tool input', async () => {
    const { validateToolInput } = await import('../src/validation.js');
    const result = validateToolInput('completionSignal', { status: 'completed' });
    expect(result.valid).toBe(true);
  });

  it('should reject completionSignal with invalid status', async () => {
    const { validateToolInput } = await import('../src/validation.js');
    const result = validateToolInput('completionSignal', { status: 'invalid' });
    expect(result.valid).toBe(false);
  });

  it('should validate statusReport tool input', async () => {
    const { validateToolInput } = await import('../src/validation.js');
    const result = validateToolInput('statusReport', {
      progress: 'Made progress',
      nextSteps: 'Continue',
      blockers: null
    });
    expect(result.valid).toBe(true);
  });

  it('should allow statusReport with only progress', async () => {
    const { validateToolInput } = await import('../src/validation.js');
    const result = validateToolInput('statusReport', { progress: 'Only progress' });
    expect(result.valid).toBe(true);
  });

  it('should validate validate tool input', async () => {
    const { validateToolInput } = await import('../src/validation.js');
    const result = validateToolInput('validate', { mode: 'dry' });
    expect(result.valid).toBe(true);
  });

  it('should reject validate with invalid mode', async () => {
    const { validateToolInput } = await import('../src/validation.js');
    const result = validateToolInput('validate', { mode: 'invalid' });
    expect(result.valid).toBe(false);
  });
});
