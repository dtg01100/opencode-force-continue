import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

async function run() {
  const out = { registeredCommands: null, afterSelect: null, toastsBefore: [], toastsAfter: [], fileExists: false, filePath: null };

  let capturedCommands = null;
  const toasts = [];
  const kv = new Map();

  const mockApi = {
    command: {
      register(cb) {
        try {
          const cmds = cb();
          capturedCommands = cmds;
          out.registeredCommands = cmds.map(c => ({ title: c.title, value: c.value, hasOnSelect: typeof c.onSelect === 'function' }));
          return;
        } catch (err) {
          console.error('command.register callback error', err);
        }
      }
    },
    ui: {
      toast(payload) {
        toasts.push(payload);
      }
    },
    kv: {
      async get(key) { return kv.has(key) ? kv.get(key) : undefined; },
      async set(key, val) { kv.set(key, val); }
    },
    route: { current: { name: 'home' } },
    slots: { register: ()=>{} }
  };

  try {
    // dynamic import of local module
    const mod = await import('../force-continue.tui.js');
    const tui = mod.tui || (mod.default && mod.default.tui) || mod.default;
    if (!tui || typeof tui !== 'function') throw new Error('tui export not found');

    // call tui
    const maybePromise = tui(mockApi);
    if (maybePromise && typeof maybePromise.then === 'function') await maybePromise;

    out.toastsBefore = [...toasts];

    if (!capturedCommands) throw new Error('No commands captured from api.command.register');

    const target = capturedCommands.find(c => c.value === 'force-continue:autopilot');
    if (!target) {
      console.log(JSON.stringify({ error: 'command not found', registered: out.registeredCommands }, null, 2));
      process.exitCode = 2;
      return;
    }

    // call onSelect and await if returns promise
    const res = target.onSelect && target.onSelect();
    if (res && typeof res.then === 'function') await res;

    out.toastsAfter = [...toasts];

    // check file path used by module
    // module exposes helper? Not publicly; compute path from cwd
    const storePath = path.join(process.cwd(), '.opencode', 'force-continue-store', 'autopilot.json');
    out.filePath = storePath;
    out.fileExists = fsSync.existsSync(storePath);
    if (out.fileExists) {
      try {
        out.fileContents = JSON.parse(await fs.readFile(storePath, 'utf8'));
      } catch (e) { out.fileContents = { error: 'read failed', message: e.message } }
    }

    console.log(JSON.stringify({ success: true, registered: out.registeredCommands, toastsBefore: out.toastsBefore, toastsAfter: out.toastsAfter, fileExists: out.fileExists, filePath: out.filePath, fileContents: out.fileContents }, null, 2));
    process.exitCode = 0;
  } catch (err) {
    console.error('ERROR', err.stack || err);
    process.exitCode = 3;
  }
}

run();
