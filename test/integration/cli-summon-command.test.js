// C-06 RULE 9 Step 4 — gnosis on `neuma summon <being>` via real subprocess
// + real fs + real temp git project. Writes .neuma/active at project root.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const NEUMA_BIN = resolve(
  new URL('../../bin/neuma', import.meta.url).pathname,
);

const runNeuma = (args, { cwd }) => {
  const r = spawnSync(process.execPath, [NEUMA_BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

const createTempProject = async (label) => {
  const dir = await createTempDir(label);
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
};

describe('cli/commands/summon — integration (real subprocess, real fs)', () => {
  test('summon writes <project>/.neuma/active with the being name', async () => {
    const project = await createTempProject('cli-summon-basic');
    const r = runNeuma(['summon', 'fenna'], { cwd: project });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/active being set to "fenna"/);
    expect(readFileSync(join(project, '.neuma', 'active'), 'utf8')).toBe('fenna\n');
  });

  test('summon from a SUBDIR writes to project-root .neuma/, not subdir/.neuma/', async () => {
    const project = await createTempProject('cli-summon-subdir');
    const subdir = join(project, 'src');
    mkdirSync(subdir);

    const r = runNeuma(['summon', 'galen'], { cwd: subdir });
    expect(r.status).toBe(0);

    expect(existsSync(join(project, '.neuma', 'active'))).toBe(true);
    expect(existsSync(join(subdir, '.neuma'))).toBe(false);
    expect(readFileSync(join(project, '.neuma', 'active'), 'utf8')).toBe('galen\n');
  });

  test('summon overwrites an existing active', async () => {
    const project = await createTempProject('cli-summon-overwrite');
    runNeuma(['summon', 'fenna'], { cwd: project });
    runNeuma(['summon', 'cael'], { cwd: project });
    expect(readFileSync(join(project, '.neuma', 'active'), 'utf8')).toBe('cael\n');
  });

  test('summon without a being name → exit 1 (yargs strict)', async () => {
    const project = await createTempProject('cli-summon-noarg');
    const r = runNeuma(['summon'], { cwd: project });
    expect(r.status).not.toBe(0);
  });

  test('summon with WHITESPACE-only being name → exit 1 (no silent empty write)', async () => {
    // ai6 R1: 'neuma summon "   "' was reporting success + writing empty
    // .neuma/active before the fix; now must reject with exit 1.
    const project = await createTempProject('cli-summon-whitespace');
    const r = runNeuma(['summon', '   '], { cwd: project });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a being name or id is required \(non-whitespace\)/);
    expect(existsSync(join(project, '.neuma', 'active'))).toBe(false);
  });
});
