import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

export function createFileStore(baseDir) {
    const storeDir = join(baseDir, ".opencode", "force-continue-store");
    try { mkdirSync(storeDir, { recursive: true }); } catch {}

    return {
        get(key) {
            const p = join(storeDir, `${key}.json`);
            if (!existsSync(p)) return undefined;
            try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return undefined; }
        },
        set(key, value) {
            const p = join(storeDir, `${key}.json`);
            try { writeFileSync(p, JSON.stringify(value)); } catch {}
        },
        delete(key) {
            const p = join(storeDir, `${key}.json`);
            try { if (existsSync(p)) unlinkSync(p); } catch {}
        },
        keys() {
            try {
                return readdirSync(storeDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
            } catch { return []; }
        },
    };
}

export function createHybridStore(inMemoryMap, fileStore) {
    return {
        get(key) {
            if (inMemoryMap.has(key)) return inMemoryMap.get(key);
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