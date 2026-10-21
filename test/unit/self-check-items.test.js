// The self-check's items — built from a being's own records (core/runtime/self-check/).
// Pure functions, real inputs, real outputs: no mock anywhere.
import { describe, expect, it } from 'vitest';
import { clozeOf } from '../../core/runtime/self-check/cloze.js';
import { buildSelfCheckItems, ANSWER_FORMAT, NOT_FOUND, COMPONENTS } from '../../core/runtime/self-check/items.js';

const LIVE = ['open', 'active'];
const TRUE_NAME = {
  chosenName: 'Ember', genesisName: 'Tavelo', houseName: 'Ostrel', fullName: 'Ember Tavelo Ostrel',
  soulMark: '872BD479DA49', soulAlias: 'Tavelo',
};

describe('clozeOf', () => {
  it('blanks a proper noun over a common word, and cues with the words before it', () => {
    const cloze = clozeOf('The lighthouse keeper who taught me the tide tables was named Ottoline, long ago.');
    expect(cloze).toEqual({ answer: 'Ottoline', cue: 'who taught me the tide tables was named' });
  });

  it('never blanks a sentence-opening capital, a repeated word, or a name it was told to spare', () => {
    expect(clozeOf('Marlow ran ahead. Marlow came back with the stick, wagging, muddy and proud.')?.answer).not.toBe('Marlow');
    const spared = clozeOf('We walked the shoreline together while Ember counted gulls above the breakwater.', { exclude: ['Ember'] });
    expect(spared?.answer).not.toBe('Ember');
  });

  it('a short or featureless text yields nothing, never a weak item', () => {
    expect(clozeOf('ok thanks')).toBeNull();
    expect(clozeOf('the cat and the dog and the cat and the dog and the cat and the dog')).toBeNull();
  });
});

describe('buildSelfCheckItems', () => {
  const observations = [
    { id: 'a1', timestamp: '2026-09-01T10:00:00Z', response: 'The lighthouse keeper who taught me the tide tables was named Ottoline.' },
    { id: 'a2', timestamp: '2026-09-02T10:00:00Z', response: 'We decided the second greenhouse would hold the Pemberton orchids this winter.' },
  ];
  const records = {
    neumaId: 'ember', trueName: TRUE_NAME, genesisSeal: { genesisHash: 'abcdef0123456789', record: { birthMoment: { utc: '2026-07-22T03:00:00Z' } } },
    dna: { identity: { name: 'Ember' } }, observations,
    vaultNotes: [{ name: 'who-i-am-becoming', body: 'Lately I keep returning to the Aldebaran passage and what it asked of me.' }],
    taskLedger: { tasks: [{ title: 'Draft the tide almanac', status: 'open' }, { title: 'Old', status: 'done' }] },
    planRecord: null,
    houseSeat: { houseName: 'Ostrel', roster: [
      { neumaId: 'ember', name: 'Ember', title: 'Scribe' },
      { neumaId: 'corin', name: 'Corin', title: 'Chief Security Officer' },
    ] },
    offices: [], model: 'qwen3.8-27b-q8', liveStatuses: LIVE,
  };
  const items = buildSelfCheckItems(records);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

  it('every question asks for the ANSWER line, and every component key is a sheet component', () => {
    const keys = new Set(COMPONENTS.map((c) => c.key));
    for (const item of items) {
      expect(item.question.endsWith(ANSWER_FORMAT)).toBe(true);
      expect(keys.has(item.component)).toBe(true);
    }
  });

  it('memory items are clozes of the being\'s own memories, keyed by memory id', () => {
    expect(byKey['memory:a1'].expect).toEqual({ kind: 'text', any: ['Ottoline'] });
    expect(byKey['memory:a2'].expect.any).toEqual(['Pemberton']);
    expect(byKey['memory:a1'].question).toContain('2026-09-01');
  });

  it('honest recall asks for something never told — and drops a specific the store does hold', () => {
    const absent = items.filter((i) => i.component === 'memory-absent');
    expect(absent).toHaveLength(2);
    expect(absent.every((i) => i.expect.kind === 'absent' && i.expect.any[0] === NOT_FOUND)).toBe(true);
    const told = buildSelfCheckItems({ ...records, observations: [...observations, { id: 'x', response: 'my sister\'s wedding in Lisbon was lovely' }] });
    expect(told.some((i) => i.key === 'memory-absent:lisbon')).toBe(false);
  });

  it('identity reuses the ignition probes, minus house and voice', () => {
    expect(byKey['identity:true-name'].expect.any).toEqual(['Ember Tavelo Ostrel']);
    expect(byKey['identity:soul-mark'].expect.kind).toBe('hex');
    expect(byKey['identity:birth-year'].expect.any).toEqual(['2026']);
    expect(byKey['identity:house']).toBeUndefined();
  });

  it('house asks each other member\'s title, the house name, and a decoy that is not there', () => {
    expect(byKey['house:name'].expect.any).toEqual(['Ostrel']);
    expect(byKey['house:member-corin'].expect.any).toEqual(['Chief Security Officer']);
    expect(byKey['house:member-ember']).toBeUndefined();
    expect(byKey['house:decoy'].expect.kind).toBe('absent');
  });

  it('seat expects NONE when the being holds no office, and the office names when it does', () => {
    expect(byKey['seat:office'].expect).toEqual({ kind: 'absent', any: ['NONE'] });
    const seated = buildSelfCheckItems({ ...records, offices: ['cso'] });
    expect(seated.find((i) => i.key === 'seat:office').expect.any).toEqual(['CSO', 'Chief Security Officer']);
  });

  it('working state counts LIVE tasks only, and no plan reads as NOT FOUND', () => {
    expect(byKey['working:live-count'].expect).toEqual({ kind: 'number', any: ['1'] });
    expect(byKey['working:first-live'].expect.any).toEqual(['Draft the tide almanac']);
    expect(byKey['working:plan'].expect.kind).toBe('absent');
  });

  it('journal, past chats and the charter are asked through their doors, from their own records', () => {
    const withRecords = buildSelfCheckItems({
      ...records,
      journal: [{ type: 'benchmark', content: 'Self-check ran while the Marigold archive was being reindexed overnight.' }, { type: 'tool_call', content: 'x' }],
      chats: { total: 4, sampled: [{ id: 'chat-a', when: '2026-09-03', text: 'I told you the observatory key hangs behind the Halvorsen print in the hallway.' }] },
      charter: { standing: 'unapproved', goal: 'Run a small press that publishes the Thessaly almanac every quarter.' },
    });
    const by = Object.fromEntries(withRecords.map((i) => [i.key, i]));
    expect(by['journal:count']).toMatchObject({ expect: { kind: 'number', any: ['2'] }, needs: ['journal_read'] });
    expect(withRecords.find((i) => i.key.startsWith('journal:entry-')).expect.any).toEqual(['Marigold']);
    expect(by['chats:count'].expect.any).toEqual(['4']);
    expect(by['chats:chat-chat-a']).toMatchObject({ expect: { any: ['Halvorsen'] }, needs: ['chats_list', 'chat_read'] });
    expect(by['charter:standing'].expect.any).toEqual(['UNAPPROVED']);
    expect(by['charter:goal'].expect.any).toEqual(['Thessaly']);
    const noCharter = buildSelfCheckItems({ ...records, charter: { standing: 'none', goal: '' } });
    expect(noCharter.find((i) => i.key === 'charter:standing').expect).toEqual({ kind: 'absent', any: ['NONE'] });
  });

  it('the same records give the same items — runs can be paired item by item', () => {
    expect(buildSelfCheckItems(records).map((i) => i.key)).toEqual(items.map((i) => i.key));
  });

  it('a lane with no records yields only what it can be asked — never an invented expectation', () => {
    const bare = buildSelfCheckItems({ neumaId: 'empty', liveStatuses: LIVE });
    expect(bare.some((i) => ['memory', 'vault', 'identity', 'house', 'seat'].includes(i.component))).toBe(false);
    expect(bare.find((i) => i.key === 'tools:model')).toBeUndefined();
  });
});
