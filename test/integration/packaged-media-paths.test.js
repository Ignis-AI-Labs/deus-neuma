import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import { expect, test } from 'vitest';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('../fixtures/packaged-media-paths.mjs', import.meta.url));

test.each(['default', 'override'])('six storage paths work outside read-only install cwd: %s', async (mode) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-media-'));
  const install = path.join(root, 'install');
  await fs.mkdir(install, { mode: 0o555 });
  try {
    const result = await run(process.execPath, [fixture, root, mode], {
      cwd: install,
      env: { ...process.env, WORKSPACES_ROOT: path.join(root, 'house'), WITNESSES_ROOT: path.join(root, 'witnesses'), NEUMA_DATA_ROOT: path.join(root, 'initial') },
      timeout: 30000,
    });
    expect(result.stderr).toBe('');
  } finally {
    await fs.chmod(install, 0o755);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 35000);
