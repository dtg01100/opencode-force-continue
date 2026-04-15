/**
 * Assertion helpers for plugin-specific validation
 */
export function assertPluginLoaded(output) {
  if (!output && output !== '') {
    throw new Error('No output provided to assertPluginLoaded');
  }
  // Plugin should appear in logs or tool registrations
  const loadedPatterns = [
    /force-continue/,
    /completionSignal/,
    /healthCheck/,
    /validate/
  ];
  const found = loadedPatterns.some(p => p.test(output));
  if (!found) {
    throw new Error(`Plugin not detected in output. Expected force-continue, completionSignal, healthCheck, or validate. Got: ${output.slice(0, 500)}`);
  }
  return true;
}

export function assertNoErrors(output) {
  const errorPatterns = [
    /Error:/i,
    /ENOENT/,
    /Cannot find module/,
    /SyntaxError/,
    /TypeError/,
    /ReferenceError/
  ];
  const errors = errorPatterns.filter(p => p.test(output));
  if (errors.length > 0) {
    throw new Error(`Errors detected in output: ${errors.map(e => e.source).join(', ')}\nOutput: ${output.slice(0, 1000)}`);
  }
  return true;
}

export function assertToolRegistered(output, toolName) {
  const pattern = new RegExp(`tool[:\\s].*${toolName}`, 'i');
  if (!pattern.test(output)) {
    // Alternative check: tool might appear in JSON output
    const jsonPattern = new RegExp(`"${toolName}"`);
    if (!jsonPattern.test(output)) {
      throw new Error(`Tool ${toolName} not found in output`);
    }
  }
  return true;
}

export function parseJsonLines(output) {
  const lines = output.split('\n').filter(l => l.trim());
  const jsonObjects = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      jsonObjects.push(obj);
    } catch (e) {
      // Not a JSON line, skip
    }
  }
  return jsonObjects;
}

export function findToolResult(jsonObjects, toolName) {
  for (const obj of jsonObjects) {
    if (obj.type === 'tool_result' && obj.name === toolName) {
      return obj;
    }
    if (obj.tool_name === toolName) {
      return obj;
    }
    if (obj.name === toolName) {
      return obj;
    }
  }
  return null;
}

export function assertHealthCheckValid(result) {
  if (typeof result === 'string') {
    // Summary format: "Plugin health: X sessions, Y continuations..."
    if (!result.includes('Plugin health:')) {
      throw new Error(`healthCheck returned unexpected format: ${result}`);
    }
    return true;
  }
  if (typeof result === 'object') {
    if (result.ok === false) {
      throw new Error(`healthCheck failed: ${JSON.stringify(result)}`);
    }
    return true;
  }
  throw new Error(`healthCheck returned unexpected type: ${typeof result}`);
}

export function assertAutoContinueTriggered(output) {
  const patterns = [
    /Continue/,
    /continue/,
    /auto.continue/i,
    /idle/
  ];
  const found = patterns.some(p => p.test(output));
  if (!found) {
    throw new Error('Auto-continue not detected in output');
  }
  return true;
}

export function assertCompletionSignaled(output) {
  const patterns = [
    /completionSignal/,
    /completed/,
    /session.*complete/i
  ];
  const found = patterns.some(p => p.test(output));
  if (!found) {
    throw new Error('Completion signal not detected in output');
  }
  return true;
}

export function assertAutopilotToggled(output, enabled) {
  const expectedState = enabled ? 'enabled' : 'disabled';
  const pattern = new RegExp(`[Aa]utopilot.*${expectedState}`, 'i');
  if (!pattern.test(output)) {
    throw new Error(`Autopilot toggle to ${expectedState} not detected in output`);
  }
  return true;
}

export function createTestTimeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Test timeout after ${ms}ms`)), ms);
  });
}
