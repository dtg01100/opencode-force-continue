import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import { dirname, join } from "path";

const DEFAULT_PACKAGE_NAME = "force-continue";

export function normalizeConfigObject(value) {
    const next = value && typeof value === "object" && !Array.isArray(value)
        ? { ...value }
        : {};

    next.plugin = Array.isArray(next.plugin)
        ? next.plugin.filter((item) => typeof item === "string")
        : [];

    return next;
}

export function upsertPluginSpec(config, spec) {
    if (!spec || typeof spec !== "string" || !spec.trim()) {
        throw new Error("Plugin spec must be a non-empty string");
    }

    const normalizedSpec = spec.trim();
    const next = normalizeConfigObject(config);

    if (!next.plugin.includes(normalizedSpec)) {
        next.plugin = [...next.plugin, normalizedSpec];
    }

    return next;
}

export function readConfigFile(filePath) {
    if (!existsSync(filePath)) {
        return normalizeConfigObject(null);
    }

    try {
        return normalizeConfigObject(JSON.parse(readFileSync(filePath, "utf-8")));
    } catch (error) {
        throw new Error(`Failed to parse ${filePath}: ${error?.message ?? error}`);
    }
}

export function writeConfigFile(filePath, config) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(normalizeConfigObject(config), null, 2)}\n`);
}

export function installPluginIntoConfig(filePath, spec) {
    const current = readConfigFile(filePath);
    const updated = upsertPluginSpec(current, spec);
    writeConfigFile(filePath, updated);
    return updated;
}

export function getConfigPaths(scope = "local", cwd = process.cwd(), homeDir = os.homedir()) {
    const baseDir = scope === "global"
        ? join(homeDir, ".config", "opencode")
        : join(cwd, ".opencode");

    return {
        baseDir,
        opencodePath: join(baseDir, "opencode.json"),
        tuiPath: join(baseDir, "tui.json"),
    };
}

export function matchesPluginSpec(value, packageName = DEFAULT_PACKAGE_NAME) {
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    const normalizedName = packageName.trim().toLowerCase();

    return normalized === normalizedName
        || normalized.startsWith(`${normalizedName}@`)
        || normalized.includes("opencode-force-continue")
        || normalized.includes("force-continue.git");
}

export function findMatchingPluginSpec(config, packageName = DEFAULT_PACKAGE_NAME) {
    const next = normalizeConfigObject(config);
    return next.plugin.find((item) => matchesPluginSpec(item, packageName)) ?? null;
}

export function syncTuiConfigFromOpencode(baseDir, packageName = DEFAULT_PACKAGE_NAME) {
    const opencodePath = join(baseDir, "opencode.json");
    const tuiPath = join(baseDir, "tui.json");

    if (!existsSync(opencodePath)) {
        return { synced: false, changed: false, reason: "missing_opencode", opencodePath, tuiPath };
    }

    const opencodeConfig = readConfigFile(opencodePath);
    const spec = findMatchingPluginSpec(opencodeConfig, packageName);
    if (!spec) {
        return { synced: false, changed: false, reason: "plugin_not_found", opencodePath, tuiPath };
    }

    const tuiConfig = readConfigFile(tuiPath);
    const before = JSON.stringify(tuiConfig);
    const updated = upsertPluginSpec(tuiConfig, spec);
    const after = JSON.stringify(updated);

    if (before !== after) {
        writeConfigFile(tuiPath, updated);
        return { synced: true, changed: true, spec, opencodePath, tuiPath };
    }

    return { synced: true, changed: false, spec, opencodePath, tuiPath };
}
