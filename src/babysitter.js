import { log } from 'console';

// Lightweight task-driven babysitter for force-continue behavior.
// Designed to be simple and dependency-free so it can be integrated into the existing server plugin.

const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function createTaskBabysitter({ client, getTasksByParentSession, directory, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const reminderCooldowns = new Map();

  async function handleEvent({ event }) {
    if (event.type !== 'session.idle') return;
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;

    const tasks = typeof getTasksByParentSession === 'function'
      ? getTasksByParentSession(sessionID)
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
        log(`[babysitter] injected reminder for task ${task.id} in session ${sessionID}`);
      } catch (e) {
        log('[babysitter] failed to inject reminder', e);
      }
    }
  }

  return {
    event: handleEvent,
  };
}
