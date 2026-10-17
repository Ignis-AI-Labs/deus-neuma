// THE HOUSE AS IT STANDS — real files on real disk, no mocks (RULE 0).
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { readHouseLineage, composeLineage, lineageUnavailable } from '../../core/birth/lineage.js';

const laneWith = async (root, id, { trueName, seal } = {}) => {
  const identityDir = join(root, id, 'identity');
  await mkdir(identityDir, { recursive: true });
  if (trueName) await writeFile(join(identityDir, 'true-name.json'), JSON.stringify(trueName));
  if (seal) await writeFile(join(identityDir, 'genesis-seal.json'), JSON.stringify(seal));
};

describe('birth lineage — the house as it stands', () => {
  let root;
  beforeAll(async () => {
    root = await createTempDir('birth-lineage');
    await laneWith(root, 'keir', {
      trueName: { chosenName: 'Keir', fullName: 'Keir Napagum Aldmere' },
      seal: { genesisHash: 'aa'.repeat(32), record: { birthMoment: { utc: '2026-06-11T10:00:00.000Z', epochMs: 1749636000000 } } },
    });
    await laneWith(root, 'signal', {
      trueName: { chosenName: 'Signal', fullName: 'Signal Risebol Aldmere' },
      seal: { genesisHash: 'bb'.repeat(32), record: { birthMoment: { utc: '2026-06-11T12:00:00.000Z', epochMs: 1749643200000 } } },
    });
    // A lane with no identity records at all — legacy shape, still a real kin.
    await mkdir(join(root, 'fenna'), { recursive: true });
  });

  it('reads members from their sealed records, eldest first, unrecorded last', async () => {
    const members = await readHouseLineage(root, ['signal', 'fenna', 'keir']);
    expect(members.map((m) => m.neumaId)).toEqual(['keir', 'signal', 'fenna']);
    expect(members[0].fullName).toBe('Keir Napagum Aldmere');
    expect(members[2].chosenName).toBe('fenna'); // no records — shown as itself
    expect(members[2].birthEpochMs).toBeNull();
  });

  it('composes the lineage with real facts: names, births, the eldest, the ordinal', async () => {
    const members = await readHouseLineage(root, ['signal', 'fenna', 'keir']);
    const block = composeLineage(members);
    expect(block).toContain('THE HOUSE AS IT STANDS');
    expect(block).toContain('Keir Napagum Aldmere');
    expect(block).toContain('the eldest');
    expect(block.indexOf('Keir')).toBeLessThan(block.indexOf('Signal'));
    expect(block).toContain('born 2026-06-11T10:00:00.000Z');
    expect(block).toContain('birth moment unrecorded'); // fenna — honest absence
    expect(block).toContain('its 4th'); // 3 kin → the newcomer would be 4th
  });

  it('an empty house honestly begins the lineage with the newcomer', () => {
    const block = composeLineage([]);
    expect(block).toContain('THE HOUSE AS IT STANDS');
    expect(block).toContain('begins with you');
    expect(block).not.toContain('These beings');
  });

  it('an unreadable roster is said to be unreadable — never implied empty', () => {
    const block = lineageUnavailable();
    expect(block).toContain('could not be read');
    expect(block).not.toContain('begins with you');
  });
});
