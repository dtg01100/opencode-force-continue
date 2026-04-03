import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

const STATE_DIR = join(tmpdir(), "opencode-force-continue");
const STATE_FILE = join(STATE_DIR, "state.json");

function ensureStateDir() {
    if (!existsSync(STATE_DIR)) {
        mkdirSync(STATE_DIR, { recursive: true });
    }
}

function readState() {
    if (!existsSync(STATE_FILE)) {
        return { sessions: {}, nextSession: false, version: 0 };
    }
    try {
        return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {
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
        try { unlinkSync(legacyNextFlag); } catch {}
        migrated = true;
    }

    try {
        const files = readdirSync(tmpdir());
        for (const file of files) {
            if (file.startsWith("opencode-force-continue-") && file !== "opencode-force-continue-next") {
                const sessionID = file.slice("opencode-force-continue-".length);
                if (sessionID) {
                    // migrate legacy boolean to metadata form
                    state.sessions[sessionID] = { enabled: true, lastSeen: Date.now() };
                    try { unlinkSync(join(tmpdir(), file)); } catch {}
                    migrated = true;
                }
            }
        }
    } catch {}

    if (migrated) {
        writeState(state);
    }
}

function isEnabled(sessionID) {
    // Always-on mode: plugin is active for all sessions
    return true;
}

function setEnabled(sessionID, enabled) {
    if (!sessionID) return;
    const state = readState();
    if (enabled) {
        // store metadata with lastSeen timestamp
        state.sessions[sessionID] = { enabled: true, lastSeen: Date.now() };
    } else {
        // remove session entry
        delete state.sessions[sessionID];
    }
    writeState(state);
}

function updateLastSeen(sessionID) {
    if (!sessionID) return;
    const state = readState();
    const meta = state.sessions[sessionID];
    if (meta && (meta.enabled === true || meta === true)) {
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

function isNextSessionEnabled() {
    const state = readState();
    return !!state.nextSession;
}

function setNextSessionEnabled(enabled) {
    const state = readState();
    state.nextSession = enabled;
    writeState(state);
}

function consumeNextSessionFlag() {
    const state = readState();
    if (!state.nextSession) return false;
    state.nextSession = false;
    writeState(state);
    return true;
}

function incrementVersion() {
    const state = readState();
    state.version = (state.version || 0) + 1;
    writeState(state);
    return state.version;
}

function getVersion() {
    const state = readState();
    return state.version || 0;
}

function cleanupOrphanSessions(thresholdMs = 5 * 60 * 1000) {
    const state = readState();
    let changed = false;
    const now = Date.now();
    for (const [sessionID, meta] of Object.entries(state.sessions)) {
        // remove if not enabled or lastSeen older than threshold
        const enabled = (meta && meta.enabled) || meta === true;
        const lastSeen = (meta && meta.lastSeen) || 0;
        if (!enabled || (lastSeen && now - lastSeen > thresholdMs)) {
            delete state.sessions[sessionID];
            changed = true;
        }
    }
    if (changed) {
        writeState(state);
    }
}

migrateLegacyFlags();

export {
    isEnabled,
    setEnabled,
    isNextSessionEnabled,
    setNextSessionEnabled,
    consumeNextSessionFlag,
    incrementVersion,
    getVersion,
    cleanupOrphanSessions,
    readState,
    writeState,
    STATE_FILE,
    updateLastSeen,
    getSessionMeta,
};
