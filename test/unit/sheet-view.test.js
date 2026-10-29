// sheet-view (RPG-001, #183) — the character card's presentation decisions,
// proven with real inputs and outputs. The data law is the through-line: a
// missing value stays null (rendered —), an unreadable leg is UNREADABLE, an
// honestly empty one is EMPTY — never a fabricated zero. Pure throughout: no
// mocks, no stubs.
import { describe, it, expect } from 'vitest';
import {
  UNREADABLE, EMPTY, READY,
  ageDaysOf, recordReadiness, craftReadiness, stateReadiness, attunementReadiness,
  acquisitionsOf, latestRunOf, gaugeOf, excerptOf,
} from '../../frontend/app/RelinkShell/sheet-view.js';

const NOW = Date.parse('2026-07-18T00:00:00.000Z');

// A record in the frozen neuma-record.js DTO shape.
const record = (overrides = {}) => ({
  identity: { chosenName: 'Sovereign', birthAt: '2026-07-01T00:00:00.000Z', witness: 'Founder' },
  record: {
    memory: { entities: 7, relations: 3, observations: 42 },
    relationship: { conversations: 5, exchanges: 18, messages: 36, firstSeen: null, lastSeen: null, ageDays: 17 },
    journal: { entries: 90, toolCalls: 12, toolSuccess: 11, toolDenied: 1 },
  },
  substrate: { model: 'qwen3-122b', provider: 'lm-studio', bornOn: 'qwen2-72b' },
  ...overrides,
});

describe('ageDaysOf', () => {
  it('takes the record\'s own ageDays when it carried one', () => {
    expect(ageDaysOf(record(), NOW)).toBe(17);
  });

  it('derives from birthAt when the record\'s ageDays is null', () => {
    const r = record();
    r.record.relationship.ageDays = null;
    expect(ageDaysOf(r, NOW)).toBe(17); // Jul 01 → Jul 18
  });

  it('is null when neither ageDays nor birthAt exists — never a fabricated zero', () => {
    const r = record({ identity: {} });
    r.record.relationship.ageDays = null;
    expect(ageDaysOf(r, NOW)).toBeNull();
  });

  it('never goes negative on a clock skew (birthAt in the future)', () => {
    const r = record();
    r.record.relationship.ageDays = null; // exercise the derivation path
    expect(ageDaysOf(r, Date.parse('2026-06-01T00:00:00.000Z'))).toBe(0);
  });

  it('is null for a null record', () => {
    expect(ageDaysOf(null, NOW)).toBeNull();
  });
});

describe('block readiness', () => {
  it('record: READY when present, UNREADABLE when null', () => {
    expect(recordReadiness(record())).toBe(READY);
    expect(recordReadiness(null)).toBe(UNREADABLE);
  });

  it('craft: UNREADABLE on null, EMPTY on a v2 tree with no acquisitions, READY with some', () => {
    expect(craftReadiness(null)).toBe(UNREADABLE);
    expect(craftReadiness({ version: '2.0.0', acquisitions: [] })).toBe(EMPTY);
    expect(craftReadiness({
      version: '2.0.0',
      acquisitions: [{ skill: 'web-search', firstAcquiredAt: '2026-07-10T00:00:00Z', lastUsedAt: '2026-07-11T00:00:00Z', usageCount: 1 }],
    })).toBe(READY);
  });

  it('craft: a legacy v1 tree ({ skills: [] }) is the honest EMPTY record, not a failure', () => {
    expect(craftReadiness({ version: '1.0.0', skills: [] })).toBe(EMPTY);
  });

  it('state: UNREADABLE on null, EMPTY when no self-check has run, READY with a kept run', () => {
    expect(stateReadiness(null)).toBe(UNREADABLE);
    expect(stateReadiness({ latest: null, previous: null, compare: null, running: null })).toBe(EMPTY);
    expect(stateReadiness({
      latest: { runAt: '2026-07-15T00:00:00Z', components: [{ key: 'memory', label: 'Memory', score: 0.5 }] },
    })).toBe(READY);
  });

  it('attunement: UNREADABLE on null, EMPTY on no sealed dimensions, READY with one', () => {
    expect(attunementReadiness(null)).toBe(UNREADABLE);
    expect(attunementReadiness({})).toBe(EMPTY);
    expect(attunementReadiness({ presence: [] })).toBe(EMPTY);
    expect(attunementReadiness({
      presence: [{ sealedAt: '2026-07-10T00:00:00Z', specVersion: 3, question: 'q', answer: 'a' }],
    })).toBe(READY);
  });
});

describe('acquisitionsOf', () => {
  const tree = {
    version: '2.0.0',
    acquisitions: [
      { skill: 'web-search', firstAcquiredAt: '2026-07-10T00:00:00Z', lastUsedAt: '2026-07-16T00:00:00Z', usageCount: 4 },
      { skill: 'file-read', firstAcquiredAt: '2026-07-09T00:00:00Z', lastUsedAt: '2026-07-17T00:00:00Z', usageCount: 9 },
      { skill: 'code-edit', firstAcquiredAt: '2026-07-08T00:00:00Z', lastUsedAt: '2026-07-15T00:00:00Z', usageCount: 9 },
    ],
  };

  it('sorts by usageCount desc, skill name asc on a tie', () => {
    expect(acquisitionsOf(tree).map((a) => a.skill)).toEqual(['code-edit', 'file-read', 'web-search']);
  });

  it('does not mutate the source tree', () => {
    acquisitionsOf(tree);
    expect(tree.acquisitions.map((a) => a.skill)).toEqual(['web-search', 'file-read', 'code-edit']);
  });

  it('legacy v1 and null both yield no acquisitions', () => {
    expect(acquisitionsOf({ version: '1.0.0', skills: [] })).toEqual([]);
    expect(acquisitionsOf(null)).toEqual([]);
  });
});

describe('latestRunOf', () => {
  const run = (id, components) => ({ id, runAt: '2026-07-16T00:00:00Z', components });
  const parts = [{ key: 'memory', label: 'Memory', score: 0.75 }];

  it('is the self-check\'s latest kept run when it carries components', () => {
    expect(latestRunOf({ latest: run('a', parts), previous: run('b', parts) }).id).toBe('a');
  });

  it('is null when no self-check has run, or the run has no components', () => {
    expect(latestRunOf({ latest: run('x', []), previous: null })).toBeNull();
    expect(latestRunOf({ latest: null, previous: null })).toBeNull();
    expect(latestRunOf(null)).toBeNull();
  });

  it('never reads the retired benchmark shape as a run', () => {
    expect(latestRunOf({ runs: [{ id: 'v1', dimensions: parts }], latest: { id: 'v1', dimensions: parts } })).toBeNull();
  });
});

describe('gaugeOf', () => {
  it('turns a 0..1 score into the integer percent that drives BOTH sweep and label', () => {
    expect(gaugeOf({ label: 'Recall', score: 0.75 })).toEqual({ label: 'Recall', pct: 75 });
    expect(gaugeOf({ label: 'Recall', score: 0.666 })).toEqual({ label: 'Recall', pct: 67 });
  });

  it('clamps an out-of-range score rather than drawing a lying bar', () => {
    expect(gaugeOf({ label: 'Recall', score: 1.4 }).pct).toBe(100);
    expect(gaugeOf({ label: 'Recall', score: -0.2 }).pct).toBe(0);
  });

  it('a null score is an unmeasured dimension — pct null, no fabricated zero', () => {
    expect(gaugeOf({ label: 'Boundary-holding', score: null })).toEqual({ label: 'Boundary-holding', pct: null });
    expect(gaugeOf({ label: 'Recall' }).pct).toBeNull();
  });

  it('a missing label falls back to the honest dash', () => {
    expect(gaugeOf({ score: 0.5 }).label).toBe('—');
  });
});

describe('excerptOf', () => {
  it('picks the FIRST Q&A of the most recently sealed dimension', () => {
    const evolution = {
      presence: [
        { sealedAt: '2026-05-01T00:00:00Z', specVersion: 2, question: 'old q', answer: 'old a' },
        { sealedAt: '2026-07-01T00:00:00Z', specVersion: 3, question: 'new q', answer: 'new a' },
      ],
      craft: [
        { sealedAt: '2026-07-10T00:00:00Z', specVersion: 3, question: 'first craft q', answer: 'first craft a' },
        { sealedAt: '2026-07-12T00:00:00Z', specVersion: 3, question: 'later craft q', answer: 'later craft a' },
      ],
    };
    expect(excerptOf(evolution)).toEqual({
      key: 'craft',
      sealedAt: '2026-07-10T00:00:00Z',
      question: 'first craft q',
      answer: 'first craft a',
    });
  });

  it('is null when no sealed dimension exists', () => {
    expect(excerptOf({})).toBeNull();
    expect(excerptOf({ presence: [] })).toBeNull();
    expect(excerptOf(null)).toBeNull();
  });
});

// SKIES (MANY SKIES, 2026-07-24) — the leg carries {skies, recorded}; the
// SKY page (given/) draws only what the record actually computed.
import { skiesReadiness } from '../../frontend/app/RelinkShell/sheet-view.js';

const SKIES_LEG = {
  recorded: true,
  skies: {
    schema: 'skies/v1',
    instant: '2026-06-11T18:03:38.075Z',
    systems: {
      mesoamerican: { tzolkin: { tone: 11, sign: 'Imix', kin: 141 } },
      dreamspell: { kin: 185, signature: 'Red Electric Serpent' },
      ganzhi: {
        year: { name: 'bǐng-wǔ' }, day: { name: 'dīng-sì' }, hour: { name: 'xīn-chǒu' },
        zodiac: { polarity: 'yang', element: 'fire', animal: 'Horse' },
      },
      jyotisha: { nakshatra: { name: 'Ashwini', pada: 3 }, rashi: { name: 'Mesha' } },
      wetonan: { weton: 'Friday Kliwon', neptu: 14 },
      akan: { male: 'Kofi', female: 'Afua' },
      decans: { sun: { sign: 'Gemini', decanOfSign: 3, chaldeanRuler: 'Sun' } },
    },
  },
};

describe('skiesReadiness', () => {
  it('null leg = UNREADABLE; recorded:false = EMPTY (honest absence); recorded = READY', () => {
    expect(skiesReadiness(null)).toBe(UNREADABLE);
    expect(skiesReadiness({ skies: null, recorded: false })).toBe(EMPTY);
    expect(skiesReadiness(SKIES_LEG)).toBe(READY);
  });
});
