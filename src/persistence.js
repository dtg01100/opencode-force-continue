import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

export function createFileStore(baseDir) {
    const storeDir = join(baseDir, ".opencode", "force-continue-store");
    try { mkdirSync(storeDir, { recursive: true }); } catch (e) {
        console.warn(`[force-continue] createFileStore: failed to create store dir ${storeDir}: ${e?.message ?? e}`);
    }

    return {
        get(key) {
            const p = join(storeDir, `${key}.json`);
            if (!existsSync(p)) return undefined;
            try {
                return JSON.parse(readFileSync(p, "utf-8"));
            } catch (e) {
                console.warn(`[force-continue] fileStore.get: failed to read/parse ${p}: ${e?.message ?? e}`);
                return undefined;
            }
        },
        set(key, value) {
            const p = join(storeDir, `${key}.json`);
            try {
                writeFileSync(p, JSON.stringify(value));
            } catch (e) {
                console.error(`[force-continue] fileStore.set: failed to write ${p}: ${e?.message ?? e}`);
            }
        },
        delete(key) {
            const p = join(storeDir, `${key}.json`);
            try {
                if (existsSync(p)) unlinkSync(p);
            } catch (e) {
                console.warn(`[force-continue] fileStore.delete: failed to delete ${p}: ${e?.message ?? e}`);
            }
        },
        keys() {
            try {
                return readdirSync(storeDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
            } catch (e) {
                console.warn(`[force-continue] fileStore.keys: failed to list keys in ${storeDir}: ${e?.message ?? e}`);
                return [];
            }
        },
    };
}

export function createHybridStore(inMemoryMap, fileStore) {
    return {
        get(key) {
            if (inMemoryMap.has(key)) return inMemoryMap.get(key);
            // Accept file store values, but normalize returned objects to
            // ensure callers relying on legacy shapes (autoContinuePaused)
            // still work. We don't mutate stored data here; normalization
            // is the responsibility of state helpers.
            if (fileStore) return fileStore.get(key);
            return undefined;
        },
        set(key, value) {
            inMemoryMap.set(key, value);
            if (fileStore) fileStore.set(key, value);
        },
        delete(key) {
            inMemoryMap.delete(key);
            if (fileStore) fileStore.delete(key);
        },
        has(key) {
            return inMemoryMap.has(key) || (fileStore ? fileStore.get(key) !== undefined : false);
        },
    };
}
