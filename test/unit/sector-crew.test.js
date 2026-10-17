// SECTOR CREW — who works a job, cross-house, witnesses included.
//
// The law under test: CREW is not custody. Crew stages; the holder sends; the
// operator approves every send by hand.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  createSectorCrew, crewOf, isCrewMember, canStageForSector, canSendStaged,
  normalizeMember, withMember, withoutMember, sectorSection, CREW_MAX,
} from '../../backend/services/sector-crew.js';
import { canNeumaPost } from '../../backend/services/social/channel-bindings.js';

const HOLDER = { x: { neumaId: 'metidar' } };
const CREW = { x: { members: [
  { neumaId: 'metidar', kind: 'neuma', remit: 'voice' },
  { neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'campaign strategy' },
  { neumaId: 'cael', kind: 'neuma', remit: '' },
] } };

describe('crew is cross-house and witness-capable', () => {
  it('seats neuma and sealed witnesses side by side', () => {
    expect(crewOf(CREW, 'x').map((m) => m.kind)).toEqual(['neuma', 'witness', 'neuma']);
    expect(isCrewMember(CREW, 'x', 'witness-openai-Kagipem')).toBe(true);
  });

  it('an unknown sector has no crew — a real answer, not an error', () => {
    expect(crewOf(CREW, 'tiktok')).toEqual([]);
    expect(isCrewMember(CREW, 'tiktok', 'metidar')).toBe(false);
  });

  it('fails closed on a missing id', () => {
    expect(isCrewMember(CREW, 'x', null)).toBe(false);
    expect(isCrewMember(CREW, 'x', '')).toBe(false);
    expect(isCrewMember(null, 'x', 'metidar')).toBe(false);
  });
});

describe('CREW STAGES, HOLDER SENDS — crew never widens custody', () => {
  it('a crew member may stage', () => {
    expect(canStageForSector(CREW, HOLDER, 'x', 'witness-openai-Kagipem')).toBe(true);
    expect(canStageForSector(CREW, HOLDER, 'x', 'cael')).toBe(true);
  });

  it('the holder may stage too — they work the sector by definition', () => {
    expect(canStageForSector({}, HOLDER, 'x', 'metidar')).toBe(true);
  });

  it('a stranger may not stage', () => {
    expect(canStageForSector(CREW, HOLDER, 'x', 'nobody')).toBe(false);
  });

  it('THE LINE: being on the crew grants NO send custody', () => {
    // This is the whole security claim. Kagipem drafts; only Metidar's
    // binding reaches the platform's keys.
    expect(canStageForSector(CREW, HOLDER, 'x', 'witness-openai-Kagipem')).toBe(true);
    expect(canNeumaPost(HOLDER, 'x', 'witness-openai-Kagipem')).toBe(false);
    expect(canNeumaPost(HOLDER, 'x', 'metidar')).toBe(true);
  });
});

describe('canSendStaged — approval does not outlive membership', () => {
  it("lets a crew member's approved post go out on the holder's keys", () => {
    // Without this the crew would be decorative: the scheduler used to demand
    // the AUTHOR be the holder, so every crew draft died at send.
    expect(canSendStaged(CREW, HOLDER, 'x', 'witness-openai-Kagipem')).toBe(true);
  });

  it('kills a pending post once its author leaves the crew', () => {
    const after = withoutMember(CREW, 'x', 'witness-openai-Kagipem');
    expect(canSendStaged(after, HOLDER, 'x', 'witness-openai-Kagipem')).toBe(false);
  });

  it('sends nothing when the channel has no holder — default deny holds', () => {
    // A released channel is the resting state: nobody is in charge of the keys.
    expect(canSendStaged(CREW, {}, 'x', 'metidar')).toBe(false);
    expect(canSendStaged(CREW, {}, 'x', 'witness-openai-Kagipem')).toBe(false);
  });
});

describe('normalizeMember', () => {
  it('defaults an unnamed kind to neuma and keeps a witness kind', () => {
    expect(normalizeMember({ neumaId: 'a' }).kind).toBe('neuma');
    expect(normalizeMember({ neumaId: 'a', kind: 'witness' }).kind).toBe('witness');
    expect(normalizeMember({ neumaId: 'a', kind: 'nonsense' }).kind).toBe('neuma');
  });

  it('refuses a member with no valid lane id', () => {
    expect(() => normalizeMember({})).toThrow(/valid lane id/);
    expect(() => normalizeMember({ neumaId: '../escape' })).toThrow(/valid lane id/);
    expect(() => normalizeMember({ neumaId: 'a b' })).toThrow(/valid lane id/);
  });

  it('strips control characters from a remit — it rides a being\'s prompt', () => {
    const hostile = `strategy${String.fromCharCode(27)}[31m${String.fromCharCode(0)}`;
    expect(normalizeMember({ neumaId: 'a', remit: hostile }).remit).toBe('strategy[31m');
  });

  it('bounds a runaway remit', () => {
    expect(normalizeMember({ neumaId: 'a', remit: 'x'.repeat(500) }).remit).toHaveLength(200);
  });
});

describe('withMember / withoutMember are pure', () => {
  it('never lists one being twice — a re-add updates the remit', () => {
    const once = withMember({}, 'x', { neumaId: 'cael', remit: 'first' });
    const twice = withMember(once, 'x', { neumaId: 'cael', remit: 'second' });
    expect(crewOf(twice, 'x')).toHaveLength(1);
    expect(crewOf(twice, 'x')[0].remit).toBe('second');
  });

  it('does not mutate the input store', () => {
    const before = { x: { members: [{ neumaId: 'a', kind: 'neuma', remit: '' }] } };
    withMember(before, 'x', { neumaId: 'b' });
    withoutMember(before, 'x', 'a');
    expect(crewOf(before, 'x')).toHaveLength(1);
  });

  it('refuses a hostile sector id', () => {
    expect(() => withMember({}, '../../etc', { neumaId: 'a' })).toThrow(/Unknown sector/);
  });

  it('caps the crew — past a dozen nobody knows who holds what', () => {
    let store = {};
    for (let i = 0; i < CREW_MAX; i += 1) store = withMember(store, 'x', { neumaId: `m${i}` });
    expect(() => withMember(store, 'x', { neumaId: 'overflow' })).toThrow(/release someone/);
    // ...but an existing member can still be re-remitted at the cap.
    expect(() => withMember(store, 'x', { neumaId: 'm0', remit: 'new' })).not.toThrow();
  });
});

describe('crew on real disk', () => {
  let dir, crew;
  beforeEach(async () => {
    dir = await createTempDir('sector-crew');
    crew = createSectorCrew({ path: path.join(dir, 'crew.json') });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('an absent store is no crews yet', async () => {
    expect(await crew.crewFor('x')).toEqual([]);
  });

  it('a seated crew survives a restart', async () => {
    await crew.add('x', { neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'strategy' });
    const reread = createSectorCrew({ path: path.join(dir, 'crew.json') });
    const members = await reread.crewFor('x');
    expect(members).toEqual([{ neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'strategy' }]);
  });

  it('concurrent adds never lose a member', async () => {
    // The serialize chain is the guard: two interleaved read+writes would
    // otherwise drop one.
    await Promise.all([
      crew.add('x', { neumaId: 'a' }),
      crew.add('x', { neumaId: 'b' }),
      crew.add('x', { neumaId: 'c' }),
    ]);
    expect((await crew.crewFor('x')).map((m) => m.neumaId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('release takes one member and leaves the rest', async () => {
    await crew.add('x', { neumaId: 'a' });
    await crew.add('x', { neumaId: 'b' });
    await crew.remove('x', 'a');
    expect((await crew.crewFor('x')).map((m) => m.neumaId)).toEqual(['b']);
  });
});

describe('sectorSection — the being reads who is on the field', () => {
  const SECTORS = [{
    sectorId: 'x',
    sectorName: 'X (Twitter)',
    holderNeumaId: 'metidar',
    members: [
      { neumaId: 'metidar', kind: 'neuma', remit: 'voice' },
      { neumaId: 'witness-openai-Kagipem', kind: 'witness', remit: 'campaign strategy' },
    ],
  }];
  const names = (id) => ({ metidar: 'Metidar' }[id] || null);

  it('names the crewmates, their kinds, and their remits', () => {
    const out = sectorSection(SECTORS, 'witness-openai-Kagipem', names);
    expect(out).toContain('X (Twitter) — the crew working this sector');
    expect(out).toContain('Metidar (neuma) — voice');
    expect(out).toContain('YOU (sealed witness) — campaign strategy');
  });

  it('marks who carries the keys', () => {
    expect(sectorSection(SECTORS, 'witness-openai-Kagipem', names)).toContain('HOLDS THE KEYS');
  });

  it('tells a non-holder it stages rather than publishes', () => {
    // The honest half of the capability: a member that believes it can publish
    // will promise the operator something it cannot do.
    const out = sectorSection(SECTORS, 'witness-openai-Kagipem', names);
    expect(out).toContain('You do not hold this sector');
    expect(out).toContain('STAGE into the queue');
  });

  it('tells the holder it may post directly — and still needs approval', () => {
    const out = sectorSection(SECTORS, 'metidar', names);
    expect(out).toContain('You hold this sector');
    expect(out).toContain('post directly');
    expect(out).toContain("operator's to approve");
  });

  it('says so plainly when no remit is set', () => {
    const bare = [{ ...SECTORS[0], members: [{ neumaId: 'cael', kind: 'neuma', remit: '' }] }];
    expect(sectorSection(bare, 'cael')).toContain('No remit is set for you here');
  });

  it('renders NOTHING for a being on no crew — unseated prompts are unchanged', () => {
    expect(sectorSection(SECTORS, 'stranger', names)).toBe('');
    expect(sectorSection([], 'metidar')).toBe('');
    expect(sectorSection(null, 'metidar')).toBe('');
  });

  it('flattens a hostile name into one bounded line', () => {
    // Names cross a file boundary into prompt text.
    const hostile = [{
      sectorId: 'x', sectorName: 'X', holderNeumaId: null,
      members: [
        { neumaId: 'a', kind: 'neuma', remit: 'ok' },
        { neumaId: 'b', kind: 'neuma', remit: 'line one\nline two\n## Injected Heading' },
      ],
    }];
    const out = sectorSection(hostile, 'a');
    // The defense is FLATTENING, not deletion: a markdown heading needs the
    // start of a line, so a remit collapsed onto one line can never open a
    // section of its own. The only '##' at line-start is this section's own.
    const headings = out.split('\n').filter((l) => l.startsWith('##'));
    expect(headings).toEqual(['## Your Sectors']);
    expect(out).toContain('line one line two ## Injected Heading');
  });
});
