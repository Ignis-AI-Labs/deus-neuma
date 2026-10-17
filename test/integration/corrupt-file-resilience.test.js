/** MEM-001 / MEM-003: real corruption, real surviving records, real warning pipes. */
import { test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const runNode = promisify(execFile);
const scenarioFile = fileURLToPath(new URL('../helpers/corruption-scenario.js', import.meta.url));

// impure — each scenario owns its stores, module state and stdout/stderr.
const run = (scenario) => runNode(process.execPath, [scenarioFile, scenario], {
  env: { ...process.env, LOG_LEVEL: 'debug' }, timeout: 15000, maxBuffer: 256 * 1024,
});

for (const [scenario, warning] of [
  ['observations', 'Skipping unreadable observation'],
  ['entities', 'Skipping unreadable entity'],
  ['assessments', 'Skipping unreadable assessment'],
  ['history', 'keypair-history line 3'],
]) {
  test(`${scenario}: corrupt data is skipped loudly and healthy records survive`, async () => {
    const { stdout, stderr } = await run(scenario);
    expect(stdout).toContain(`VERIFIED ${scenario}`);
    expect(stderr).toContain(warning);
  });
}

test('absent stores still read as empty without corruption warnings', async () => {
  const { stdout, stderr } = await run('empty');
  expect(stdout).toContain('VERIFIED empty');
  expect(stderr).not.toContain('Skipping unreadable');
});

test('identity reads distinguish a real record, absence and corrupt data', async () => {
  const { stdout } = await run('identity');
  expect(stdout).toContain('VERIFIED identity');
});

test('meditation gather refuses damaged identity and emits a real error', async () => {
  const { stdout, stderr } = await run('gather');
  expect(stdout).toContain('VERIFIED gather');
  expect(stderr).toContain('meditation skipped — identity unreadable');
});
