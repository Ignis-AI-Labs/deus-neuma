/**
 * Community detection tests — deterministic clustering of memory into navigable
 * communities (the non-LLM half of Stage C). Pure functions, no IO.
 */

import {
  tokenizeContent,
  jaccard,
  buildCommunities,
  labelCommunity,
  documentFrequencies,
} from '../../core/memory/community-detection.js';

const OCEAN = [
  { id: 'o1', text: 'the ocean tide pulls the harbor boats home' },
  { id: 'o2', text: 'harbor boats rest on the ocean tide at dawn' },
  { id: 'o3', text: 'tide and ocean shape the quiet harbor' },
];
const SONG = [
  { id: 's1', text: 'the melody carries the song forward into night' },
  { id: 's2', text: 'song and melody fill the long night' },
];

describe('tokenizeContent', () => {
  test('drops stopwords and short tokens, lowercases', () => {
    expect(tokenizeContent('The ocean AND a Tide')).toEqual(['ocean', 'tide']);
  });
  test('handles empty / non-string', () => {
    expect(tokenizeContent('')).toEqual([]);
    expect(tokenizeContent(null)).toEqual([]);
  });
  test('drops bare numerals — a year names no topic (#230)', () => {
    expect(tokenizeContent('the 2026 marker sweep at 1430')).toEqual(['marker', 'sweep']);
  });
  test('KEEPS alphanumerics — gpt4 and sha256 are exactly what distinguishes work', () => {
    expect(tokenizeContent('gpt4 p10 sha256')).toEqual(['gpt4', 'p10', 'sha256']);
  });
  test('drops the function words a live lane surfaced as labels (#230)', () => {
    expect(tokenizeContent('all artifacts cannot clear because before')).toEqual(['artifacts', 'clear']);
  });
});

describe('jaccard', () => {
  test('identical sets = 1, disjoint = 0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
  test('partial overlap', () => {
    // {a,b,c} vs {b,c,d} → inter 2, union 4 → 0.5
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });
});

describe('buildCommunities', () => {
  test('separates two topical groups into distinct communities', () => {
    const communities = buildCommunities([...OCEAN, ...SONG]);
    expect(communities.length).toBe(2);

    const ocean = communities.find((c) => c.memberIds.includes('o1'));
    const song = communities.find((c) => c.memberIds.includes('s1'));
    expect(ocean.memberIds).toEqual(expect.arrayContaining(['o1', 'o2', 'o3']));
    expect(song.memberIds).toEqual(expect.arrayContaining(['s1', 's2']));
    // No cross-contamination.
    expect(ocean.memberIds).not.toContain('s1');
  });

  test('labels reflect the cluster\'s distinguishing terms', () => {
    const communities = buildCommunities([...OCEAN, ...SONG]);
    const ocean = communities.find((c) => c.memberIds.includes('o1'));
    const song = communities.find((c) => c.memberIds.includes('s1'));
    expect(ocean.label).toMatch(/ocean|tide|harbor/);
    expect(song.label).toMatch(/melody|song/);
  });

  test('is deterministic — same input yields identical communities', () => {
    const a = buildCommunities([...OCEAN, ...SONG]);
    const b = buildCommunities([...OCEAN, ...SONG]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('unrelated memories each form their own community', () => {
    const docs = [
      { id: 'a', text: 'volcano magma eruption' },
      { id: 'b', text: 'spreadsheet invoice ledger' },
      { id: 'c', text: 'penguin tundra glacier' },
    ];
    const communities = buildCommunities(docs);
    expect(communities.length).toBe(3);
    expect(communities.every((c) => c.size === 1)).toBe(true);
  });

  test('emits membership only, never a second summary source', () => {
    const communities = buildCommunities(OCEAN);
    expect(communities[0]).not.toHaveProperty('summary');
  });

  test('empty input → empty communities', () => {
    expect(buildCommunities([])).toEqual([]);
  });
});

// MEM-011 (#230). A live witness lane with 5 communities read
// `ANSWER AUDITOR BECAUSE BEFORE`, `ALL ARTIFACTS CAN CLEAR`,
// `2026 CANNOT ENTRY INDEPENDENTLY` — three of five meaningless — while the
// clustering underneath was correct. Labels ranked by raw in-community
// frequency and took no corpus input, so vocabulary common to EVERY community
// won EVERY label.
describe('labels rank by distinction, not frequency (#230)', () => {
  // Scaffolding vocabulary in every doc of every cluster, topic words local to
  // one cluster each. This is the shape that separates the two rankings.
  const SCAFFOLD = 'session entry recorded observation ledger';
  const DOCS = [
    { id: 'a1', text: `${SCAFFOLD} tide harbor ocean boats` },
    { id: 'a2', text: `${SCAFFOLD} harbor ocean tide dawn` },
    { id: 'b1', text: `${SCAFFOLD} melody song night chorus` },
    { id: 'b2', text: `${SCAFFOLD} song melody chorus long` },
    { id: 'c1', text: `${SCAFFOLD} keypair envelope vault sealed` },
    { id: 'c2', text: `${SCAFFOLD} vault keypair sealed custody` },
  ];
  const SCAFFOLD_WORDS = ['session', 'entry', 'recorded', 'observation', 'ledger'];

  test('no corpus-wide term reaches ANY label', () => {
    for (const c of buildCommunities(DOCS)) {
      for (const word of SCAFFOLD_WORDS) {
        expect(c.label.split(' ')).not.toContain(word);
      }
    }
  });

  test('every label names its own cluster`s topic instead', () => {
    const communities = buildCommunities(DOCS);
    const labelFor = (id) => communities.find((c) => c.memberIds.includes(id)).label;
    expect(labelFor('a1')).toMatch(/ocean|tide|harbor/);
    expect(labelFor('b1')).toMatch(/melody|song|chorus/);
    expect(labelFor('c1')).toMatch(/vault|keypair|sealed/);
  });

  // The control: the same members, ranked the old way, DO surface the
  // scaffolding — so the assertion above is measuring the fix, not the fixture.
  test('CONTROL — with no corpus to compare against, the scaffolding wins', () => {
    const oceanOnly = labelCommunity([DOCS[0], DOCS[1]]);
    expect(SCAFFOLD_WORDS.some((w) => oceanOnly.split(' ').includes(w))).toBe(true);
  });

  test('documentFrequencies counts docs per term, not occurrences', () => {
    const { docFreq, size } = documentFrequencies([
      { text: 'ocean ocean ocean' },
      { text: 'ocean tide' },
    ]);
    expect(size).toBe(2);
    expect(docFreq.get('ocean')).toBe(2);   // two docs, not four mentions
    expect(docFreq.get('tide')).toBe(1);
  });

  test('ONE community still gets a real label — smoothed IDF never zeroes out', () => {
    // Every term appears in every doc, so unsmoothed IDF would be exactly 0 for
    // all of them and the label would fall out alphabetically.
    const communities = buildCommunities([
      { id: 'x', text: 'harbor ocean tide boats' },
      { id: 'y', text: 'harbor ocean tide boats' },
    ]);
    expect(communities).toHaveLength(1);
    expect(communities[0].label.split(' ').length).toBeGreaterThan(1);
    expect(communities[0].label).toMatch(/harbor|ocean|tide|boats/);
  });

  test('still deterministic with the corpus weighting in the path', () => {
    expect(JSON.stringify(buildCommunities(DOCS))).toBe(JSON.stringify(buildCommunities(DOCS)));
  });
});
