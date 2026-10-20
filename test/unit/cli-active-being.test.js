// C-06 RULE 0 verification — active-being resolution + persistence.
// Real fs (createTempDir), real env mutation with save-restore, no mocks.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import {
  resolveActiveBeing,
  readActiveFile,
  writeActiveBeing,
  peekActiveBeing,
} from '../../cli/lib/active-being.js';

describe('cli/lib/active-being — readActiveFile / writeActiveBeing', () => {
  let project;
  beforeEach(async () => {
    project = await createTempDir('cli-active-being');
  });

  test('readActiveFile returns null when .neuma/active does not exist', async () => {
    expect(readActiveFile(project)).toBeNull();
  });

  test('readActiveFile returns the trimmed contents', async () => {
    mkdirSync(join(project, '.neuma'));
    writeFileSync(join(project, '.neuma', 'active'), '  alder  \n');
    expect(readActiveFile(project)).toBe('alder');
  });

  test('readActiveFile returns null for empty / whitespace-only file', async () => {
    mkdirSync(join(project, '.neuma'));
    writeFileSync(join(project, '.neuma', 'active'), '   \n\n');
    expect(readActiveFile(project)).toBeNull();
  });

  test('writeActiveBeing creates .neuma/ if missing + writes the name', async () => {
    expect(existsSync(join(project, '.neuma'))).toBe(false);
    writeActiveBeing(project, 'alder');
    expect(readFileSync(join(project, '.neuma', 'active'), 'utf8')).toBe('alder\n');
  });

  test('writeActiveBeing trims input', async () => {
    writeActiveBeing(project, '  cedar  ');
    expect(readFileSync(join(project, '.neuma', 'active'), 'utf8')).toBe('cedar\n');
  });

  test('writeActiveBeing overwrites existing file', async () => {
    writeActiveBeing(project, 'alder');
    writeActiveBeing(project, 'cedar');
    expect(readActiveFile(project)).toBe('cedar');
  });
});

describe('cli/lib/active-being — resolveActiveBeing (priority order)', () => {
  let project;
  beforeEach(async () => {
    project = await createTempDir('cli-resolve-active-being');
  });

  test('1. NEUMA_BEING env wins over everything', async () => {
    writeActiveBeing(project, 'cedar'); // file says cedar
    await withEnv('NEUMA_BEING', 'alder', () => {
      const r = resolveActiveBeing({
        projectRoot: project,
        residentBeings: [{ neumaId: 'birch-id', name: 'Birch' }], // single resident
      });
      expect(r).toBe('alder'); // env wins
    });
  });

  test('2. .neuma/active file wins over auto-single', async () => {
    writeActiveBeing(project, 'cedar');
    await withEnv('NEUMA_BEING', undefined, () => {
      const r = resolveActiveBeing({
        projectRoot: project,
        residentBeings: [{ neumaId: 'birch-id', name: 'Birch' }],
      });
      expect(r).toBe('cedar'); // file wins over auto-single
    });
  });

  test('3. Auto-single fires when exactly one resident, no env, no file', async () => {
    await withEnv('NEUMA_BEING', undefined, () => {
      const r = resolveActiveBeing({
        projectRoot: project,
        residentBeings: [{ neumaId: 'alder-id', name: 'Alder' }],
      });
      expect(r).toBe('alder-id'); // auto-pick the single resident's id
    });
  });

  test('4. No env, no file, multiple residents → throws actionable error', async () => {
    await withEnv('NEUMA_BEING', undefined, () => {
      expect(() => resolveActiveBeing({
        projectRoot: project,
        residentBeings: [
          { neumaId: 'alder-id', name: 'Alder' },
          { neumaId: 'cedar-id', name: 'Cedar' },
        ],
      })).toThrow(/No active being set/);
    });
  });

  test('4. No env, no file, zero residents → throws actionable error', async () => {
    await withEnv('NEUMA_BEING', undefined, () => {
      expect(() => resolveActiveBeing({
        projectRoot: project,
        residentBeings: [],
      })).toThrow(/No active being set/);
    });
  });

  test('4. No env, no file, no residentBeings passed → throws (does not auto-single)', async () => {
    await withEnv('NEUMA_BEING', undefined, () => {
      expect(() => resolveActiveBeing({ projectRoot: project }))
        .toThrow(/No active being set/);
    });
  });

  test('env value is trimmed', async () => {
    await withEnv('NEUMA_BEING', '  alder  ', () => {
      const r = resolveActiveBeing({ projectRoot: project, residentBeings: [] });
      expect(r).toBe('alder');
    });
  });

  test('whitespace-only NEUMA_BEING is treated as UNSET (falls through to file)', async () => {
    // ai6 R1: NEUMA_BEING="   " was silently returning "" before the fix;
    // now it must fall through to .neuma/active (or auto-single, or throw).
    writeActiveBeing(project, 'cedar');
    await withEnv('NEUMA_BEING', '   ', () => {
      const r = resolveActiveBeing({ projectRoot: project, residentBeings: [] });
      expect(r).toBe('cedar'); // file took over
    });
  });

  test('whitespace-only env + no file + no residents → throws (not "")', async () => {
    await withEnv('NEUMA_BEING', '   ', () => {
      expect(() => resolveActiveBeing({ projectRoot: project, residentBeings: [] }))
        .toThrow(/No active being set/);
    });
  });

  test('error message names all three setting paths (env, summon, --being)', async () => {
    await withEnv('NEUMA_BEING', undefined, () => {
      try {
        resolveActiveBeing({ projectRoot: project, residentBeings: [] });
      } catch (err) {
        expect(err.message).toMatch(/neuma summon/);
        expect(err.message).toMatch(/NEUMA_BEING/);
        expect(err.message).toMatch(/--being/);
      }
    });
  });
});

describe('cli/lib/active-being — peekActiveBeing (non-throwing snapshot helper)', () => {
  let project;
  beforeEach(async () => {
    project = await createTempDir('cli-peek-active');
  });

  test('returns env value with source=env when set', async () => {
    await withEnv('NEUMA_BEING', 'alder', () => {
      expect(peekActiveBeing({ projectRoot: project }))
        .toEqual({ source: 'env', value: 'alder' });
    });
  });

  test('returns file value with source=file when env unset + file present', async () => {
    writeActiveBeing(project, 'cedar');
    await withEnv('NEUMA_BEING', undefined, () => {
      expect(peekActiveBeing({ projectRoot: project }))
        .toEqual({ source: 'file', value: 'cedar' });
    });
  });

  test('returns null when neither env nor file is set (does NOT throw)', async () => {
    await withEnv('NEUMA_BEING', undefined, () => {
      expect(peekActiveBeing({ projectRoot: project })).toBeNull();
    });
  });

  test('whitespace-only env falls through to file (consistent with resolveActiveBeing)', async () => {
    writeActiveBeing(project, 'hazel');
    await withEnv('NEUMA_BEING', '   ', () => {
      expect(peekActiveBeing({ projectRoot: project }))
        .toEqual({ source: 'file', value: 'hazel' });
    });
  });
});
