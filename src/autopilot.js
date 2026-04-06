let autopilotState = { enabled: false, timestamp: null };

export function resetAutopilotState() {
  autopilotState = { enabled: false, timestamp: null };
}

export function readAutopilotState() {
  return autopilotState;
}

export function writeAutopilotState(state) {
  if (!state || typeof state !== "object") {
    throw new Error("writeAutopilotState: state must be an object with { enabled: boolean, timestamp: number|null }");
  }
  autopilotState = {
    enabled: Boolean(state.enabled),
    timestamp: typeof state.timestamp === "number" ? state.timestamp : null,
  };
}

export function buildAutopilotPrompt(question, context, options) {
  if (!question || typeof question !== "string") {
    throw new Error("buildAutopilotPrompt: question is required and must be a string");
  }
  let prompt = `AUTONOMOUS DECISION REQUIRED\n\n`;
  prompt += `Question: ${question}\n\n`;
  if (context) prompt += `Context: ${context}\n\n`;
  if (options) prompt += `Options: ${options}\n\n`;
  prompt += `Instructions:\n`;
  prompt += `1. Make a specific, reasonable decision based on the context.\n`;
  prompt += `2. State your decision briefly, then proceed with the work.\n`;
  prompt += `3. If genuinely unable to decide, call completionSignal with status='blocked'.\n`;
  prompt += `4. Do NOT ask for guidance again or re-ask this question.\n`;
  return prompt;
}

export function getAutopilotEnabled(config) {
  const stored = readAutopilotState();
  // Runtime toggle takes precedence over config default
  if (stored.timestamp !== null) return stored.enabled;
  return config?.autopilotEnabled ?? false;
}

export function getAutopilotMaxAttempts(config) {
  return config?.autopilotMaxAttempts ?? 3;
}