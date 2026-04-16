import { spawn } from 'child_process';
import { join } from 'path';

export async function installLocalPlugin(projectRoot, projectDir, env) {
  const pluginSpec = `force-continue@file://${projectRoot}`;
  const installer = spawn(
    process.execPath,
    [join(projectRoot, 'scripts', 'setup-opencode.mjs'), '--spec', pluginSpec],
    {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';

  installer.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  installer.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  const exitCode = await new Promise((resolve) => {
    installer.on('close', resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`Plugin install failed with code ${exitCode}: ${stderr || stdout}`);
  }
}
