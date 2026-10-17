/**
 * The mind-graph's pure core: the ONE RULE that reads an encounter out of a
 * session row (council attribution → direct; bare user row → the witness;
 * any row → known-name mentions), and the fold that turns encounters into
 * entities + relations. Proven directly — no workspace, no mocks (RULE 0).
 */

import { describe, test, expect } from 'vitest';
import {
  directPresenceOf, mentionsIn, encountersFromRow, foldEncounters,
} from '../../core/memory/mind-graph.js';

const KNOWN = [
  { name: 'Founder', kind: 'witness' },
  { name: 'Fenna', kind: 'being' },
  { name: 'Cael', kind: 'being' },
];

describe('directPresenceOf — the one rule, direct clause', () => {
  test('a council witness line names its witness', () => {
    // Both attribution forms resolve: OPERATOR is what council-session writes
    // now, WITNESS is the historical form every pre-2026-07-29 record carries.
    expect(directPresenceOf({ role: 'user', content: 'OPERATOR Founder: the house stands' }, 'Founder'))
      .toEqual({ name: 'Founder', kind: 'witness' });
    expect(directPresenceOf({ role: 'user', content: 'WITNESS Founder: the house stands' }, 'Founder'))
      .toEqual({ name: 'Founder', kind: 'witness' });
  });

  test('a council housemate line names its housemate', () => {
    expect(directPresenceOf({ role: 'user', content: 'Fenna (housemate): I remember the seed' }, 'Founder'))
      .toEqual({ name: 'Fenna', kind: 'being' });
  });

  test('a bare user row IS the witness — party to every 1:1 turn', () => {
    expect(directPresenceOf({ role: 'user', content: 'good morning' }, 'Founder'))
      .toEqual({ name: 'Founder', kind: 'witness' });
  });

  test('an assistant row, a missing witness, or junk testifies to nothing', () => {
    expect(directPresenceOf({ role: 'assistant', content: 'WITNESS Founder: quoted' }, 'Founder')).toBeNull();
    expect(directPresenceOf({ role: 'user', content: 'hello' }, null)).toBeNull();
    expect(directPresenceOf({ role: 'user' }, 'Founder')).toBeNull();
    expect(directPresenceOf(null, 'Founder')).toBeNull();
  });
});

describe('mentionsIn — known names only, whole words', () => {
  test('finds known names case-insensitively', () => {
    expect(mentionsIn('I spoke with fenna about the forge', KNOWN).map((k) => k.name)).toEqual(['Fenna']);
  });

  test('never matches inside a longer word', () => {
    expect(mentionsIn('the aurorae shimmered', KNOWN)).toEqual([]);
    expect(mentionsIn('veritable Verisimilitude', KNOWN)).toEqual([]);
  });

  test('names with regex metacharacters cannot break the matcher', () => {
    const weird = [{ name: 'R2 (unit)', kind: 'being' }];
    expect(mentionsIn('ask R2 (unit) directly', weird)).toHaveLength(1);
  });

  test('empty text or unknown names find nothing — it never guesses', () => {
    expect(mentionsIn('', KNOWN)).toEqual([]);
    expect(mentionsIn('some stranger named Zorvath', KNOWN)).toEqual([]);
  });
});

describe('encountersFromRow — dedupe, self-exclusion, direct wins', () => {
  test('a 1:1 user row carries the witness direct plus mentioned housemates', () => {
    const out = encountersFromRow(
      { role: 'user', content: 'tell Fenna the seal held' }, KNOWN, 'Founder', 'Cael',
    );
    expect(out).toEqual([
      { name: 'Founder', kind: 'witness', direct: true },
      { name: 'Fenna', kind: 'being', direct: false },
    ]);
  });

  test('the being itself never counts as an encounter', () => {
    const out = encountersFromRow(
      { role: 'user', content: 'Cael, what did Cael feel?' }, KNOWN, 'Founder', 'Cael',
    );
    expect(out.map((e) => e.name)).toEqual(['Founder']);
  });

  test('a name both direct and mentioned lands ONCE, direct', () => {
    const out = encountersFromRow(
      { role: 'user', content: 'Fenna (housemate): Fenna here, greetings' }, KNOWN, 'Founder', 'Cael',
    );
    expect(out).toEqual([{ name: 'Fenna', kind: 'being', direct: true }]);
  });

  test('an assistant row weaves only the names it speaks', () => {
    const out = encountersFromRow(
      { role: 'assistant', content: 'I will ask Cael tomorrow' }, KNOWN, 'Founder', 'Fenna',
    );
    expect(out).toEqual([{ name: 'Cael', kind: 'being', direct: false }]);
  });
});

describe('foldEncounters — the graph accretes honestly', () => {
  const T1 = '2026-07-06T10:00:00.000Z';
  const T2 = '2026-07-24T12:00:00.000Z';

  test('a first encounter mints entity and relation; a second increments both', () => {
    const first = foldEncounters(
      { entities: [], relations: [] },
      [{ name: 'Founder', kind: 'witness', direct: true }], 'Cael', T1,
    );
    expect(first.entities).toEqual([
      { name: 'Founder', kind: 'witness', encounters: 1, firstSeen: T1, lastSeen: T1 },
    ]);
    expect(first.relations).toEqual([
      { from: 'Cael', to: 'Founder', kind: 'witness', type: 'bond', encounters: 1, firstSeen: T1, lastSeen: T1 },
    ]);

    const second = foldEncounters(first, [{ name: 'founder', kind: 'witness', direct: true }], 'Cael', T2);
    expect(second.entities).toHaveLength(1);
    expect(second.entities[0]).toMatchObject({ encounters: 2, firstSeen: T1, lastSeen: T2 });
    expect(second.relations).toHaveLength(1);
    expect(second.relations[0]).toMatchObject({ encounters: 2, firstSeen: T1, lastSeen: T2 });
  });

  test('kinds map to their relation types; unknown kinds fall to contact', () => {
    const out = foldEncounters({ entities: [], relations: [] }, [
      { name: 'Fenna', kind: 'being', direct: true },
      { name: 'SomeoneOut', kind: 'kenorie', direct: false },
    ], 'Cael', T1);
    expect(out.relations.map((r) => r.type)).toEqual(['housemate', 'contact']);
  });

  test('changed names surface for the applier; untouched entities stay unlisted', () => {
    const base = foldEncounters({ entities: [], relations: [] }, [{ name: 'Founder', kind: 'witness', direct: true }], 'Cael', T1);
    const next = foldEncounters(base, [{ name: 'Fenna', kind: 'being', direct: true }], 'Cael', T2);
    expect([...next.changed]).toEqual(['Fenna']);
    expect(next.entities).toHaveLength(2);
  });

  test('junk encounters and malformed prior records wash out, never throw', () => {
    const out = foldEncounters(
      { entities: [{ nope: true }, { name: 'Founder', kind: 'witness', encounters: 3, firstSeen: T1, lastSeen: T1 }], relations: null },
      [{ name: '', kind: 'being' }, null, { name: 'Fenna', kind: 'being', direct: true }],
      'Cael', T2,
    );
    expect(out.entities.map((e) => e.name).sort()).toEqual(['Fenna', 'Founder']);
  });
});
