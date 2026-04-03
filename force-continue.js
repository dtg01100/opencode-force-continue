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
    state.sessions[sessionID] = { enabled: true, lastSeen: Date.now() };
    writeState(state);
  } else if (!meta) {
    // create metadata for always-active
    state.sessions[sessionID] = { enabled: true, lastSeen: Date.now() };
    writeState(state);
  }
}

function getSessionMeta(sessionID) {
  if (!sessionID) return null;
  const state = readState();
  const meta = state.sessions[sessionID];
  if (!meta) return null;
  if (meta === true) return { enabled: true, lastSeen: 0 };
  return { enabled: !!meta.enabled, lastSeen: meta.lastSeen || 0 };
}

function cleanupOrphanSessions(thresholdMs = 5 * 60 * 1000) {
  const state = readState();
  let changed = false;
  const now = Date.now();
  for (const [sessionID, meta] of Object.entries(state.sessions)) {
    const enabled = (meta && meta.enabled) || meta === true;
    const lastSeen = (meta && meta.lastSeen) || 0;
    if (!enabled || (lastSeen && now - lastSeen > thresholdMs)) {
      delete state.sessions[sessionID];
      changed = true;
    }
  }
  if (changed) writeState(state);
}

migrateLegacyFlags();

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

      'chat.message': async ({ sessionID }) => {
        try { updateLastSeen(sessionID); } catch (e) {}
        sessionCompletionState.set(sessionID, false);
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
                  await client.session.promptAsync({ sessionID, parts: [{ type: 'text', text: 'Continue' }] });
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
