import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

const cwd = process.cwd();
const cachedBase = `${process.env.HOME}/.cache/opencode/packages/force-continue@git+https:/github.com/dtg01100/opencode-force-continue.git/node_modules/force-continue`;

const targets = [
  { name: 'local.server', path: `${cwd}/force-continue.server.js` },
  { name: 'local.tui', path: `${cwd}/force-continue.tui.js` },
  { name: 'cached.server', path: `${cachedBase}/force-continue.server.js` },
  { name: 'cached.tui', path: `${cachedBase}/force-continue.tui.js` },
];

function safeLog(obj) {
  try {
    console.log(JSON.stringify(obj));
  } catch (e) {
    console.log(String(obj));
  }
}

for (const t of targets) {
  const exists = existsSync(t.path);
  if (!exists) {
    safeLog({ item: t.name, path: t.path, exists: false });
    continue;
  }

  try {
    const mod = await import(pathToFileURL(t.path).href);
    const def = mod && mod.default;
    const keys = def && typeof def === 'object' ? Object.keys(def) : null;
    safeLog({ item: t.name, path: t.path, exists: true, defaultType: typeof def, defaultKeys: keys });
    // Detect specific TypeError message in exported functions (not thrown here) - include full module
  } catch (e) {
    safeLog({ item: t.name, path: t.path, exists: true, error: e && e.stack ? e.stack : String(e) });
  }
}

// Exit cleanly
