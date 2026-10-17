/** Real process lookup failure, isolated from the test runner's PATH. No replacement executable. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertCodingShellAvailable } from '../../backend/services/coding-shell-availability.js';

const execFileAsync = promisify(execFile);
const runner = fileURLToPath(new URL('../../backend/services/witness-coding-sandbox.js', import.meta.url));

test('the installed confinement executable passes its real version probe', async () => {
  await expect(assertCodingShellAvailable()).resolves.toBeUndefined();
});

test('missing bubblewrap refuses preparation and execution before creating a shell or running a command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shell-unavailable-'));
  try {
    const script = `
      const { ensureWitnessCodingSandbox, runWitnessCommand } = await import(${JSON.stringify(runner)});
      const errors = [];
      for (const act of [
        () => ensureWitnessCodingSandbox('witness-unavailable-proof', ${JSON.stringify(root)}),
        () => runWitnessCommand({ workspace: ${JSON.stringify(root)}, command: 'touch escaped' }),
      ]) {
        try { await act(); errors.push(null); }
        catch (error) { errors.push({ message: error.message, code: error.cause?.code }); }
      }
      process.stdout.write(JSON.stringify(errors));
    `;
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, PATH: root, NEUMA_DATA_ROOT: root, NEUMA_WITNESSES_ROOT: root },
      cwd: root, timeout: 10_000, maxBuffer: 16_384,
    });
    const errors = JSON.parse(stdout);
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error.code).toBe('ENOENT');
      expect(error.message).toContain('Coding shell execution is unavailable');
      expect(error.message).toContain('Commands will not run without confinement');
    }
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
