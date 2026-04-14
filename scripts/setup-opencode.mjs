#!/usr/bin/env node

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getConfigPaths, installPluginIntoConfig } from "../src/install-config.js";

function readPackageSpec() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
  const name = pkg.name || "force-continue";
  const repoUrl = typeof pkg.repository?.url === "string"
    ? pkg.repository.url.replace(/^git\+/, "")
    : "https://github.com/dtg01100/opencode-force-continue.git";
  return `${name}@git+${repoUrl}`;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const specIndex = argv.indexOf("--spec");
  const spec = specIndex >= 0 ? argv[specIndex + 1] : undefined;

  if (args.has("--help") || args.has("-h")) {
    console.log("Usage: force-continue [--global] [--spec <plugin-spec>]");
    console.log("Adds the plugin to both opencode.json and tui.json.");
    process.exit(0);
  }

  return {
    scope: args.has("--global") ? "global" : "local",
    spec: spec || readPackageSpec(),
  };
}

try {
  const { scope, spec } = parseArgs(process.argv.slice(2));
  const paths = getConfigPaths(scope, process.cwd());

  installPluginIntoConfig(paths.opencodePath, spec);
  installPluginIntoConfig(paths.tuiPath, spec);

  console.log(`[force-continue] Added ${spec} to:`);
  console.log(`- ${paths.opencodePath}`);
  console.log(`- ${paths.tuiPath}`);
  console.log("[force-continue] Restart OpenCode, then search for Toggle Autopilot or /autopilot in the TUI.");
} catch (error) {
  console.error(`[force-continue] Setup failed: ${error?.message ?? error}`);
  process.exit(1);
}
