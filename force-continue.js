import { tool } from "@opencode-ai/plugin";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Single-file Force Continue plugin
// - Always active
// - Persists session metadata (enabled, lastSeen) to tmpdir/state.json
// - Provides a task-driven babysitter factory (createTaskBabysitter)
// - Injects system prompt and continues sessions when idle; queries host task helpers for unfinished tasks

const STATE_DIR = join(tmpdir(), "opencode-force-continue");
const STATE_FILE = join(STATE_DIR, "state.json");

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  if (!existsSync(STATE_FILE)) return { sessions: {}, nextSession: false, version: 0 };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch (e) {
    return { sessions: {}, nextSession: false, version: 0 };
  }
}

function writeState(state) {
  ensureStateDir();
  const tmpFile = STATE_FILE + ".tmp." + process.pid;
  writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpFile, STATE_FILE);
}

function migrateLegacyFlags() {
  const state = readState();
  let migrated = false;
  const legacyNextFlag = join(tmpdir(), "opencode-force-continue-next");
  if (existsSync(legacyNextFlag)) {
    state.nextSession = true;
    try { unlinkSync(legacyNextFlag); } catch (e) {}
    migrated = true;
  }
  try {
    const files = readdirSync(tmpdir());
    for (const file of files) {
      if (file.startsWith("opencode-force-continue-") && file !== "opencode-force-continue-next") {
        const sessionID = file.slice("opencode-force-continue-".length);
        if (sessionID) {
          state.sessions[sessionID] = { enabled: true, lastSeen: Date.now() };
          try { unlinkSync(join(tmpdir(), file)); } catch (e) {}
          migrated = true;
        }
      }
    }
  } catch (e) {}
  if (migrated) writeState(state);
}

function updateLastSeen(sessionID) {
  if (!sessionID) return;
  const state = readState();
  const meta = state.sessions[sessionID];
  if (meta && (meta.enabled === true || meta === true)) {
    state.sessions[sessionID] = Object.assign({}, meta, { enabled: true, lastSeen: Date.now() });
    writeState(state);
  } else if (!meta) {
    // create metadata for always-active
    state.sessions[sessionID] = { enabled: true, lastSeen: Date.now() };
    writeState(state);
  }
}

function setSessionCompleted(sessionID, completed = true) {
  if (!sessionID) return;
  // Keep completion state in-memory only
  if (completed) {
    inMemoryCompletion.set(sessionID, { completedAt: Date.now() });
    // clear any paused in-memory state
    if (inMemoryPaused.has(sessionID)) inMemoryPaused.delete(sessionID);
  } else {
    inMemoryCompletion.delete(sessionID);
  }
}

function setSessionPaused(sessionID, paused = true, reason) {
  if (!sessionID) return;
  if (paused) {
    inMemoryPaused.set(sessionID, { pauseAt: Date.now(), pauseReason: reason || null });
  } else {
    inMemoryPaused.delete(sessionID);
  }
}

function getSessionMeta(sessionID) {
  if (!sessionID) return null;
  const state = readState();
  const meta = state.sessions[sessionID] || {};
  if (meta === true) return { enabled: true, lastSeen: 0, completed: !!inMemoryCompletion.has(sessionID), paused: !!inMemoryPaused.has(sessionID) };
  return {
    enabled: !!meta.enabled,
    lastSeen: meta.lastSeen || 0,
    completed: !!inMemoryCompletion.has(sessionID),
    completedAt: inMemoryCompletion.get(sessionID)?.completedAt || null,
    paused: !!inMemoryPaused.has(sessionID),
    pauseReason: inMemoryPaused.get(sessionID)?.pauseReason || null,
    pauseAt: inMemoryPaused.get(sessionID)?.pauseAt || null,
  };
}

// List paused sessions (in-memory)
export function listPausedSessions() {
  const out = [];
  for (const [sessionID, info] of inMemoryPaused.entries()) {
    out.push({ sessionID, pauseReason: info.pauseReason || null, pauseAt: info.pauseAt || null });
  }
  return out;
}

// Clear paused session (in-memory)
export function clearPausedSession(sessionID) {
  if (!sessionID) return false;
  if (inMemoryPaused.has(sessionID)) { inMemoryPaused.delete(sessionID); return true; }
  return false;
}

function cleanupOrphanSessions(thresholdMs = 5 * 60 * 1000) {
  const state = readState();
  let changed = false;
  const now = Date.now();
  const PAUSE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  for (const [sessionID, meta] of Object.entries(state.sessions)) {
    const enabled = (meta && meta.enabled) || meta === true;
    const lastSeen = (meta && meta.lastSeen) || 0;
    if (!enabled || (lastSeen && now - lastSeen > thresholdMs)) {
      delete state.sessions[sessionID];
      changed = true;
      continue;
    }

    // Clear stale paused state after TTL so sessions don't remain permanently paused
    if (meta && meta.paused && meta.pauseAt && now - meta.pauseAt > PAUSE_TTL_MS) {
      delete meta.paused;
      delete meta.pauseReason;
      delete meta.pauseAt;
      state.sessions[sessionID] = Object.assign({}, meta);
      changed = true;
    }
  }
  if (changed) writeState(state);
}

migrateLegacyFlags();

const inMemoryCompletion = new Map();
const inMemoryPaused = new Map();

// Task-driven babysitter factory
const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function createTaskBabysitter({ client, getTasksByParentSession, directory, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const reminderCooldowns = new Map();

  async function handleEvent({ event }) {
    if (event.type !== 'session.idle') return;
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;

    const tasks = typeof getTasksByParentSession === 'function'
      ? await getTasksByParentSession(sessionID)
      : [];

    if (!tasks || tasks.length === 0) return;

    const now = Date.now();
    const tms = timeoutMs || DEFAULT_TIMEOUT_MS;

    for (const task of tasks) {
      if (!task || task.status !== 'running') continue;
      const lastMessageAt = task.progress?.lastMessageAt;
      if (!lastMessageAt) continue;
      const idleMs = now - new Date(lastMessageAt).getTime();
      if (idleMs < tms) continue;

      const lastReminderAt = reminderCooldowns.get(task.id);
      if (lastReminderAt && now - lastReminderAt < COOLDOWN_MS) continue;

      const reminder = `Reminder: task ${task.id} appears idle (${Math.floor(idleMs/1000)}s). Continue?`;

      try {
        await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: reminder }], query: { directory } });
        reminderCooldowns.set(task.id, now);
        // best-effort logging
        try { console.log(`[babysitter] injected reminder for task ${task.id} in session ${sessionID}`); } catch (e) {}
      } catch (e) {
        try { console.error('[babysitter] failed to inject reminder', e); } catch (e) {}
      }
    }
  }

  return {
    event: handleEvent,
  };
}

// Main plugin factory
export const createContinuePlugin = (sessionCompletionState = new Map()) => {
  return async (ctx) => {
    const { client } = ctx;

    // Run a cleanup pass on init and schedule periodic cleanup to auto-clear stale paused sessions
    try {
      cleanupOrphanSessions();
      // hourly cleanup
      setInterval(() => {
        try { cleanupOrphanSessions(); } catch (e) { /* ignore */ }
      }, 60 * 60 * 1000);
    } catch (e) {}

    return {
      tool: {
        completionSignal: tool({
          description: "Call this tool when you are genuinely finished with the task and ready for user input. Do NOT stop until you have called this.",
          args: {},
          execute: async () => {
            return "Ready for user.";
          },
        }),
      },

      'chat.message': async ({ sessionID, message } = {}) => {
        try { updateLastSeen(sessionID); } catch (e) {}
        // reset in-memory completion state
        sessionCompletionState.set(sessionID, false);

        // If session was paused and a human (user) just replied, unpause automatically
        try {
          const meta = getSessionMeta(sessionID);
          if (meta && meta.paused) {
            const role = message?.role || (message?.parts && message.parts[0] && message.parts[0].role) || null;
            if (role === 'user' || role === 'human') {
              try {
                setSessionPaused(sessionID, false);
                await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: 'Human reply received — unpausing auto-continue.' }] });
              } catch (e) { console.error('Failed to unpause on human reply:', e); }
            }
          }
        } catch (e) {}
      },


      'experimental.chat.system.transform': async ({ sessionID } = {}, { system }) => {
        if (!sessionID) return;
        system.push(
          "IMPORTANT: You must call the 'completionSignal' tool when you are finished. " +
          "Do not stop or ask for user input until you have called this tool. " +
          "If you stop without calling it, you will be forced to continue."
        );
      },

      event: async ({ event }) => {
        let sessionID = event.properties?.sessionID;
        if (event.type === 'session.created') {
          sessionID = event.properties?.info?.id;
        }
        const part = event.properties?.part;
        if (!sessionID && part?.sessionID) sessionID = part.sessionID;
        if (!sessionID) return;

        if (event.type === 'session.created') {
          try { updateLastSeen(sessionID); } catch (e) {}
          sessionCompletionState.set(sessionID, false);
          return;
        }

        // completion detection
        if (event.type === 'message.part.updated') {
          if (part?.type === 'tool' && part.tool === 'completionSignal' && part.state?.status === 'completed') {
            // mark complete in-memory
            sessionCompletionState.set(sessionID, true);
            // persist completion across restarts/processes
            try { setSessionCompleted(sessionID, true); } catch (e) { console.error('Failed to persist completion state:', e); }
          }
        }

        if (event.type === 'session.idle') {
          const isComplete = sessionCompletionState.get(sessionID);

          // prefer host-provided babysitter hook
          if (ctx?.hooks?.taskBabysitter?.event) {
            try { await ctx.hooks.taskBabysitter.event({ event }); } catch (e) { console.error('Babysitter hook error:', e); }
            return;
          }

          // query host helpers for unfinished tasks
          let unfinishedCount = 0;
          try {
            const getTasksCandidates = [
              ctx?.hooks?.getTasksByParentSession,
              ctx?.hooks?.backgroundManager?.getTasksByParentSession,
              ctx?.getTasksByParentSession,
              ctx?.backgroundManager?.getTasksByParentSession,
            ];
            for (const fn of getTasksCandidates) {
              if (typeof fn !== 'function') continue;
              try {
                const tasks = await fn(sessionID);
                if (Array.isArray(tasks)) {
                  unfinishedCount = tasks.filter(t => t && t.status && t.status !== 'done' && t.status !== 'completed').length;
                  break;
                }
                if (tasks && Array.isArray(tasks.data)) {
                  unfinishedCount = tasks.data.filter(t => t && t.status && t.status !== 'done' && t.status !== 'completed').length;
                  break;
                }
              } catch (e) {}
            }
          } catch (e) { console.error('Failed to query tasks:', e); }

          if (unfinishedCount > 0) {
            try {
              const msg = `Continue — ${unfinishedCount} unfinished task(s) remain. Continue working?`;
              await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: msg }] });
            } catch (e) { console.error('Plugin error:', e); }
            return;
          }

          if (!isComplete) {
            try {
              const response = await client.session.messages({ sessionID });
              const messages = response?.data;
              if (messages && messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role === 'assistant') {
                  // Extract last text (support parts and legacy text)
                  const lastText = (lastMsg.parts || []).map(p => p.text || p.thinking || p.reasoning || '').join(' ').trim() || (typeof lastMsg.text === 'string' ? lastMsg.text : '');

                  // Heuristic: looks like a question
                  const looksLikeQuestion = /\?\s*$/.test(lastText) || /\b(should|could|would|do|did|why|how|what|when|where|who)\b/i.test(lastText);

                  // Explicit signal: structured metadata or explicit tag in text
                  const explicitRequiresHuman = (lastMsg.metadata && lastMsg.metadata.requiresHuman) === true || /\[requires-?human\]/i.test(lastText) || /requires human input|need(?:s)? your input|please confirm|please review|awaiting(?: me| human)/i.test(lastText);

                  // Sensitive topics that should trigger human review
                  const sensitiveKeyword = /\b(legal|law|lawsuit|safety|danger|exploit|password|credential|secret|approval|authorize|deploy|production|pci|hipaa)\b/i.test(lastText);

                  if (explicitRequiresHuman || sensitiveKeyword) {
                    // Prefer to pause auto-continue for explicit signals or sensitive topics
                    try {
                      const pauseMsg = explicitRequiresHuman
                        ? 'Assistant requested human input — pausing auto-continue.'
                        : 'Potentially sensitive question detected — pausing auto-continue for human review.';
                      await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: pauseMsg }] });
                    } catch (e) {
                      console.error('Failed to send pause notification:', e);
                    }
                    // persist paused state so host/UI can surface it
                    try { setSessionPaused(sessionID, true, explicitRequiresHuman ? 'assistant-request' : 'sensitive-topic'); } catch (e) { console.error('Failed to persist paused state:', e); }
                    // Do not auto-respond; allow host or a human to handle
                    return;
                  }

                  if (looksLikeQuestion) {
                    // Auto-respond with a safe default: instruct assistant to continue and not wait for user
                    const autoResp = "(Auto-response) Please continue without waiting for user input.";
                    try {
                      await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: autoResp }] });
                    } catch (e) {
                      console.error('Failed to auto-respond to assistant question:', e);
                      // fallback to generic Continue prompt
                      try { await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: 'Continue' }] }); } catch (e2) { console.error(e2); }
                    }
                  } else {
                    try { await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: 'Continue' }] }); } catch (e) { console.error(e); }
                  }
                }
              }
            } catch (e) { console.error('Plugin error:', e); }
          }
        }

        if (event.type === 'session.deleted') {
          sessionCompletionState.delete(sessionID);
        }
      },
    };
  };
};

export const ContinuePlugin = createContinuePlugin();
export default { server: ContinuePlugin, taskBabysitter: createTaskBabysitter };
