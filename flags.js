import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "fs";
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
        const files = require("fs").readdirSync(tmpdir());
        for (const file of files) {
            if (file.startsWith("opencode-force-continue-") && file !== "opencode-force-continue-next") {
                const sessionID = file.slice("opencode-force-continue-".length);
                if (sessionID) {
                    state.sessions[sessionID] = true;
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
    if (!sessionID) return false;
    const state = readState();
    return !!state.sessions[sessionID];
}

function setEnabled(sessionID, enabled) {
    if (!sessionID) return;
    const state = readState();
    if (enabled) {
        state.sessions[sessionID] = true;
    } else {
        delete state.sessions[sessionID];
    }
    writeState(state);
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

function cleanupOrphanSessions(activeSessionIds) {
    const state = readState();
    let changed = false;
    for (const sessionID of Object.keys(state.sessions)) {
        if (!activeSessionIds.has(sessionID)) {
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
};
