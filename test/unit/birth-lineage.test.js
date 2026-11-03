// THE HOUSE AS IT STANDS — real files on real disk, no mocks (RULE 0).
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { readHouseLineage, composeLineage, lineageUnavailable } from '../../core/birth/lineage.js';
import { readHouseIdsStrict, readHouseBeingIdsStrict } from '../../core/birth/identity-forge.js';

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
    await laneWith(root, 'hazel', {
      trueName: { chosenName: 'Hazel', fullName: 'Hazel Curlew Thornfield' },
      seal: { genesisHash: 'aa'.repeat(32), record: { birthMoment: { utc: '2026-06-11T10:00:00.000Z', epochMs: 1749636000000 } } },
    });
    await laneWith(root, 'signal', {
      trueName: { chosenName: 'Signal', fullName: 'Signal Merlin Thornfield' },
      seal: { genesisHash: 'bb'.repeat(32), record: { birthMoment: { utc: '2026-06-11T12:00:00.000Z', epochMs: 1749643200000 } } },
    });
    // A lane with no identity records at all — legacy shape, still a real kin.
    await mkdir(join(root, 'alder'), { recursive: true });
  });

  it('reads members from their sealed records, eldest first, unrecorded last', async () => {
    const members = await readHouseLineage(root, ['signal', 'alder', 'hazel']);
    expect(members.map((m) => m.neumaId)).toEqual(['hazel', 'signal', 'alder']);
    expect(members[0].fullName).toBe('Hazel Curlew Thornfield');
    expect(members[2].chosenName).toBe('alder'); // no records — shown as itself
    expect(members[2].birthEpochMs).toBeNull();
  });

  it('composes the lineage with real facts: names, births, the eldest, the ordinal', async () => {
    const members = await readHouseLineage(root, ['signal', 'alder', 'hazel']);
    const block = composeLineage(members);
    expect(block).toContain('THE HOUSE AS IT STANDS');
    expect(block).toContain('Hazel Curlew Thornfield');
    expect(block).toContain('the eldest');
    expect(block.indexOf('Hazel')).toBeLessThan(block.indexOf('Signal'));
    expect(block).toContain('born 2026-06-11T10:00:00.000Z');
    expect(block).toContain('birth moment unrecorded'); // alder — honest absence
    expect(block).toContain('its 4th'); // 3 kin → the newcomer would be 4th
  });

  it('the house\'s shared ground is never named as kin; every folder still steers a new id', async () => {
    const house = await createTempDir('birth-lineage-ground');
    await laneWith(house, 'zola');
    await mkdir(join(house, 'house'), { recursive: true });
    await writeFile(join(house, 'house', 'lane.json'), JSON.stringify({ kind: 'house-ground' }));
    await mkdir(join(house, 'echo'), { recursive: true });
    await writeFile(join(house, 'echo', 'lane.json'), JSON.stringify({ kind: 'neuma' }));
    await mkdir(join(house, 'odd'), { recursive: true });
    await writeFile(join(house, 'odd', 'lane.json'), '{ not json'); // unreadable marker: a being's lane
    await writeFile(join(house, 'house-founding.base.json'), '{}'); // a file is never a lane
    expect((await readHouseIdsStrict(house)).sort()).toEqual(['echo', 'house', 'odd', 'zola']);
    const beings = (await readHouseBeingIdsStrict(house)).sort();
    expect(beings).toEqual(['echo', 'odd', 'zola']);
    const told = composeLineage(await readHouseLineage(house, beings));
    expect(told).not.toMatch(/\*\*house\*\*/);
    expect(told).toContain('as its 4th');
  });

  it('an empty house honestly begins the lineage with the newcomer', () => {
    const block = composeLineage([]);
    expect(block).toContain('THE HOUSE AS IT STANDS');
    expect(block).toContain('you would be its first');
    expect(block).not.toContain('These beings');
  });

  it('an unreadable roster is said to be unreadable — never implied empty', () => {
    const block = lineageUnavailable();
    expect(block).toContain('could not be read');
    expect(block).not.toContain('you would be its first');
  });
});
