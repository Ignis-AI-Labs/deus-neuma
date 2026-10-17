/** Real file pressure inside the production bubblewrap shell. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';

test('the bounded shell holds 768 real files open concurrently and retains its other limits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-shell-fds-'));
  const previous = getWitnessesRoot();
  try {
    setWitnessesRoot(path.join(root, 'witnesses'));
    const lane = 'witness-test-DescriptorBudget';
    await workspace.create(lane);
    const ground = path.join(root, 'ground');
    await fs.mkdir(ground);
    await fs.writeFile(path.join(ground, 'scan.cjs'), `
      const fs = require('node:fs/promises');
      (async () => {
        await fs.mkdir('files', {recursive:true});
        for (let i = 0; i < 768; i++) await fs.writeFile('files/' + i, String(i));
        const handles = await Promise.all(Array.from({length:768}, (_, i) => fs.open('files/' + i)));
        try {
          const text = await Promise.all(handles.map(handle => handle.readFile('utf8')));
          if (text.some((value, i) => value !== String(i))) throw new Error('read mismatch');
          await fs.writeFile('scan-result.json', JSON.stringify({opened: handles.length}));
        } finally { await Promise.all(handles.map(handle => handle.close())); }
      })().catch(error => { process.stderr.write(error.stack); process.exitCode = 1; });
    `);
    const shell = await ensureWitnessCodingSandbox(lane, ground);
    const constrained = await runWitnessCommand({ ...shell, mode: 'write', command: 'ulimit -n 256; node scan.cjs' });
    expect(constrained.exitCode).not.toBe(0);
    expect(constrained.stderr).toContain('EMFILE');
    const result = await runWitnessCommand({ ...shell, mode: 'write', command: 'node scan.cjs' });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(shell.workspace, 'scan-result.json'), 'utf8'))).toEqual({ opened: 768 });
    const limits = await runWitnessCommand({ ...shell, mode: 'inspect', command:
      'test "$(ulimit -Sn)" = 4096 && test "$(ulimit -Hn)" = 4096 && test "$(ulimit -t)" = 120 && test "$(ulimit -u)" = 256 && test "$(ulimit -f)" = 1048576' });
    expect(limits.exitCode, limits.stderr).toBe(0);
    await expect(fs.stat(path.join(ground, 'files'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    setWitnessesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
