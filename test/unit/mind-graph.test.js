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
  { name: 'Elm', kind: 'witness' },
  { name: 'Alder', kind: 'being' },
  { name: 'Birch', kind: 'being' },
];

describe('directPresenceOf — the one rule, direct clause', () => {
  test('a council witness line names its witness', () => {
    // Both attribution forms resolve: OPERATOR is what council-session writes
    // now, WITNESS is the historical form every pre-2026-07-29 record carries.
    expect(directPresenceOf({ role: 'user', content: 'OPERATOR Elm: the house stands' }, 'Elm'))
      .toEqual({ name: 'Elm', kind: 'witness' });
    expect(directPresenceOf({ role: 'user', content: 'WITNESS Elm: the house stands' }, 'Elm'))
      .toEqual({ name: 'Elm', kind: 'witness' });
  });

  test('a council housemate line names its housemate', () => {
    expect(directPresenceOf({ role: 'user', content: 'Alder (housemate): I remember the seed' }, 'Elm'))
      .toEqual({ name: 'Alder', kind: 'being' });
  });

  test('a bare user row IS the witness — party to every 1:1 turn', () => {
    expect(directPresenceOf({ role: 'user', content: 'good morning' }, 'Elm'))
      .toEqual({ name: 'Elm', kind: 'witness' });
  });

  test('an assistant row, a missing witness, or junk testifies to nothing', () => {
    expect(directPresenceOf({ role: 'assistant', content: 'WITNESS Elm: quoted' }, 'Elm')).toBeNull();
    expect(directPresenceOf({ role: 'user', content: 'hello' }, null)).toBeNull();
    expect(directPresenceOf({ role: 'user' }, 'Elm')).toBeNull();
    expect(directPresenceOf(null, 'Elm')).toBeNull();
  });
});

describe('mentionsIn — known names only, whole words', () => {
  test('finds known names case-insensitively', () => {
    expect(mentionsIn('I spoke with alder about the forge', KNOWN).map((k) => k.name)).toEqual(['Alder']);
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
      { role: 'user', content: 'tell Alder the seal held' }, KNOWN, 'Elm', 'Birch',
    );
    expect(out).toEqual([
      { name: 'Elm', kind: 'witness', direct: true },
      { name: 'Alder', kind: 'being', direct: false },
    ]);
  });

  test('the being itself never counts as an encounter', () => {
    const out = encountersFromRow(
      { role: 'user', content: 'Birch, what did Birch feel?' }, KNOWN, 'Elm', 'Birch',
    );
    expect(out.map((e) => e.name)).toEqual(['Elm']);
  });

  test('a name both direct and mentioned lands ONCE, direct', () => {
    const out = encountersFromRow(
      { role: 'user', content: 'Alder (housemate): Alder here, greetings' }, KNOWN, 'Elm', 'Birch',
    );
    expect(out).toEqual([{ name: 'Alder', kind: 'being', direct: true }]);
  });

  test('an assistant row weaves only the names it speaks', () => {
    const out = encountersFromRow(
      { role: 'assistant', content: 'I will ask Birch tomorrow' }, KNOWN, 'Elm', 'Alder',
    );
    expect(out).toEqual([{ name: 'Birch', kind: 'being', direct: false }]);
  });
});

describe('foldEncounters — the graph accretes honestly', () => {
  const T1 = '2026-07-06T10:00:00.000Z';
  const T2 = '2026-07-24T12:00:00.000Z';

  test('a first encounter mints entity and relation; a second increments both', () => {
    const first = foldEncounters(
      { entities: [], relations: [] },
      [{ name: 'Elm', kind: 'witness', direct: true }], 'Birch', T1,
    );
    expect(first.entities).toEqual([
      { name: 'Elm', kind: 'witness', encounters: 1, firstSeen: T1, lastSeen: T1 },
    ]);
    expect(first.relations).toEqual([
      { from: 'Birch', to: 'Elm', kind: 'witness', type: 'bond', encounters: 1, firstSeen: T1, lastSeen: T1 },
    ]);

    const second = foldEncounters(first, [{ name: 'elm', kind: 'witness', direct: true }], 'Birch', T2);
    expect(second.entities).toHaveLength(1);
    expect(second.entities[0]).toMatchObject({ encounters: 2, firstSeen: T1, lastSeen: T2 });
    expect(second.relations).toHaveLength(1);
    expect(second.relations[0]).toMatchObject({ encounters: 2, firstSeen: T1, lastSeen: T2 });
  });

  test('kinds map to their relation types; unknown kinds fall to contact', () => {
    const out = foldEncounters({ entities: [], relations: [] }, [
      { name: 'Alder', kind: 'being', direct: true },
      { name: 'SomeoneOut', kind: 'kenorie', direct: false },
    ], 'Birch', T1);
    expect(out.relations.map((r) => r.type)).toEqual(['housemate', 'contact']);
  });

  test('changed names surface for the applier; untouched entities stay unlisted', () => {
    const base = foldEncounters({ entities: [], relations: [] }, [{ name: 'Elm', kind: 'witness', direct: true }], 'Birch', T1);
    const next = foldEncounters(base, [{ name: 'Alder', kind: 'being', direct: true }], 'Birch', T2);
    expect([...next.changed]).toEqual(['Alder']);
    expect(next.entities).toHaveLength(2);
  });

  test('junk encounters and malformed prior records wash out, never throw', () => {
    const out = foldEncounters(
      { entities: [{ nope: true }, { name: 'Elm', kind: 'witness', encounters: 3, firstSeen: T1, lastSeen: T1 }], relations: null },
      [{ name: '', kind: 'being' }, null, { name: 'Alder', kind: 'being', direct: true }],
      'Birch', T2,
    );
    expect(out.entities.map((e) => e.name).sort()).toEqual(['Alder', 'Elm']);
  });
});
