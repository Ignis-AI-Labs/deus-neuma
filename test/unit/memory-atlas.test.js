// The memory atlas (core/memory): topics a real spread of memories falls into,
// the names they are given, the ways in (people, periods, kinds), and the text
// a being walks it by. Real builders on written-out records — no mocks (RULE 0).
import { describe, it, expect } from 'vitest';
import { louvain, nearestNeighbours, termVectors, wordsOf } from '../../core/memory/atlas-cluster.js';
import { buildAtlas, nameTopic, TOPIC_MIN } from '../../core/memory/memory-atlas.js';
import { filterMemories } from '../../core/memory/atlas-filter.js';
import { buildCommunities } from '../../core/memory/community-detection.js';
import { readWalkFilters, shapeOverview, shapeWalkMemory, shapeWalkPage } from '../../core/memory/atlas-walk.js';

// Three bodies of work, each said nine different ways, all sharing the small
// talk a real conversation is full of — the words that glued the old map into
// one lump.
const SUBJECTS = {
  pools: ['liquidity pool', 'Umbrae', 'deposit', 'wallet', 'swap', 'router', 'fees', 'position', 'range'],
  film: ['motion film', 'quasar', 'render', 'frames', 'ffmpeg', 'soundtrack', 'TikTok', 'storyboard', 'caption'],
  email: ['DKIM', 'DMARC', 'SPF record', 'Cloudflare', 'selector', 'inbox', 'spam folder', 'Postmaster', 'sender'],
};
const GLUE = 'we should go ahead and make sure this is done so that the operator can see what is going on here';
const hex = (n) => n.toString(16).padStart(16, '0');
const corpus = () => {
  const out = [];
  let n = 0;
  for (const [subject, words] of Object.entries(SUBJECTS)) {
    for (let i = 0; i < 9; i += 1) {
      const a = words[i]; const b = words[(i + 1) % 9]; const c = words[(i + 4) % 9];
      n += 1;
      out.push({
        id: hex(n),
        text: `${GLUE} about the ${a} and the ${b}. Orrin asked for the ${c}; the ${a} now holds, and the ${b} follows.`,
        line: `About the ${a} and the ${b}`,
        at: new Date(Date.UTC(2026, subject === 'pools' ? 8 : subject === 'film' ? 9 : 10, 1 + i)).toISOString(),
        kind: i === 0 ? 'note' : 'conversation',
        state: 'active',
        ref: i % 2 ? `mem_sess-${subject}_${1700000000000 + n}_0000000${i}` : null,
        people: i < 4 ? ['Orrin'] : [],
      });
    }
  }
  out.push({ id: hex(900), text: 'A lone remark about gardening tomatoes', line: 'A lone remark', at: '2026-11-15T00:00:00.000Z', kind: 'conversation', state: 'active', ref: null });
  out.push({ id: hex(901), text: 'The liquidity pool deposit was wrong and the wallet swap was withdrawn', line: 'Withdrawn pool note', at: '2026-09-20T00:00:00.000Z', kind: 'note', state: 'retracted', ref: null });
  return out;
};

describe('atlas clustering', () => {
  it('reads words in order, marking the ones that carry no topic', () => {
    const words = wordsOf("The operator's DKIM selector, 2048 bits — it's set.");
    expect(words.filter((w) => !w.skip).map((w) => w.key)).toEqual(['dkim', 'selector', 'bits', 'set']);
    expect(words.find((w) => w.key === 'dkim').shown).toBe('DKIM');
  });

  it('keeps each memory to its nearest few, symmetric, nearest first', () => {
    const docs = corpus().filter((r) => r.state === 'active');
    const adjacency = nearestNeighbours(termVectors(docs).vectors, { k: 4 });
    adjacency.forEach((row, i) => {
      row.forEach(({ j, w }) => {
        expect(w).toBeGreaterThanOrEqual(0.1);
        expect(adjacency[j].some((back) => back.j === i)).toBe(true);
      });
      expect(row.map((e) => e.w)).toEqual([...row.map((e) => e.w)].sort((a, b) => b - a));
    });
    // Sparse: far fewer links than every pair, where the old pass linked nearly all.
    expect(adjacency.reduce((a, r) => a + r.length, 0) / 2).toBeLessThan(docs.length * 4);
  });

  it('gives the same groups whatever order the work happens in', () => {
    const docs = corpus().filter((r) => r.state === 'active');
    const run = () => [...louvain(nearestNeighbours(termVectors(docs).vectors))];
    expect(run()).toEqual(run());
  });
});

describe('the atlas', () => {
  const atlas = buildAtlas(corpus());

  it('sorts three bodies of work into three topics, where the old pass made one lump', () => {
    expect(atlas.topics).toHaveLength(3);
    expect(atlas.topics.map((t) => t.size)).toEqual([9, 9, 9]);
    for (const topic of atlas.topics) {
      const members = atlas.memories.filter((m) => m.topic === topic.id);
      const months = new Set(members.map((m) => m.at.slice(0, 7)));
      expect(months.size).toBe(1); // each subject was written in its own month
    }
    // The same memories through the pass recall still uses: the shared small talk joins everything.
    const old = buildCommunities(corpus().filter((r) => r.state === 'active'));
    expect(old[0].size).toBeGreaterThan(20);
  });

  it('names a topic by what it says and the others do not, in the spelling as written', () => {
    const names = atlas.topics.map((t) => t.name).join(' | ');
    expect(names).not.toMatch(/operator|ahead|sure|going/i);
    const all = Object.values(SUBJECTS).flat().map((w) => w.toLowerCase());
    for (const topic of atlas.topics) {
      expect(topic.words.length).toBeGreaterThan(0);
      expect(topic.words.every((w) => all.some((s) => s.includes(w.toLowerCase()) || w.toLowerCase().includes(s)))).toBe(true);
      expect(topic.leadLine).toMatch(/^About the /);
    }
  });

  it('never names a topic by a word said once', () => {
    const terms = [new Map([['alpha', 'Alpha'], ['shared', 'shared']]), new Map([['beta', 'Beta'], ['shared', 'shared']]), new Map([['gamma', 'gamma'], ['shared', 'Shared']])];
    const freq = new Map([['alpha', 1], ['beta', 1], ['gamma', 1], ['shared', 3]]);
    expect(nameTopic([0, 1, 2], terms, freq, 40).words).toEqual(['shared']);
  });

  it('counts everything: the lone memory and the set-aside one stay on the list, outside every topic', () => {
    expect(atlas.totals).toMatchObject({ memories: 29, active: 28, setAside: 1, topics: 3, ungrouped: 1 });
    expect(atlas.memories.find((m) => m.line === 'A lone remark').topic).toBe(-1);
    const withdrawn = atlas.memories.find((m) => m.state === 'retracted');
    expect(withdrawn).toMatchObject({ topic: -1, links: 0 });
    expect(TOPIC_MIN).toBe(3);
  });

  it('lists newest first, with people, months and kinds as ways in', () => {
    const times = atlas.memories.map((m) => Date.parse(m.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(atlas.people).toEqual([{ name: 'Orrin', n: 12 }]);
    expect(atlas.periods.map((p) => p.key)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(atlas.kinds[0]).toEqual({ kind: 'conversation', n: 25 });
    expect(filterMemories(atlas.memories, { person: 'orrin', period: '2026-09' })).toHaveLength(4);
    expect(filterMemories(atlas.memories, { state: 'set-aside' })).toHaveLength(1);
    expect(filterMemories(atlas.memories, { topic: -1, state: 'active' })).toHaveLength(1);
  });

  it('keeps each memory\'s nearest memories apart, and says how topics touch', () => {
    const one = atlas.memories.find((m) => m.topic === 0);
    const near = atlas.links.get(one.id);
    expect(near.length).toBe(one.links);
    expect(near.every((l) => atlas.memories.some((m) => m.id === l.id))).toBe(true);
    for (const tie of atlas.ties) expect(tie.a).toBeLessThan(tie.b);
  });

  it('an empty record is an empty atlas, not a throw', () => {
    expect(buildAtlas([]).totals).toMatchObject({ memories: 0, topics: 0, from: null, to: null });
  });
});

describe('the walk a being reads', () => {
  const atlas = buildAtlas(corpus());

  it('the overview names every topic with its number, size, dates and an example', () => {
    const text = shapeOverview(atlas);
    expect(text).toContain('YOUR MEMORY — 29 memories (1 set aside), 2026-09-01 → 2026-11-15. 3 topics, 1 memories in no topic.');
    atlas.topics.forEach((t) => expect(text).toContain(`${t.id + 1}. ${t.name} — 9 memories`));
    expect(text).toContain('0. (no topic) — 1 memories');
    expect(text).toContain('PEOPLE — open with {person: "name"}: Orrin ×12');
    expect(text).toContain('2026-10 ×9');
    expect(shapeOverview(buildAtlas([]))).toBe('No memories on the record yet.');
  });

  it('opens a topic as a page of memories, each with a handle that leads somewhere', () => {
    const filters = readWalkFilters(atlas, { topic: 1 });
    expect(filters.ok).toBe(true);
    const page = shapeWalkPage(atlas, { ...filters, limit: 5 });
    expect(page).toMatchObject({ shown: 5, total: 9 });
    expect(page.content).toContain('1–5 of 9, newest first');
    expect(page.content).toContain('4 more — page with offset 5.');
    expect(page.content).toMatch(/\d+\. (mem_sess-|id:[a-f0-9]{16})/);
    const linked = shapeWalkPage(atlas, { ...filters, sort: 'linked' });
    expect(linked.content).toContain('most connected first');
  });

  it('refuses a filter that names nothing, in words — never a silently empty page', () => {
    expect(readWalkFilters(atlas, { topic: 9 })).toMatchObject({ ok: false });
    expect(readWalkFilters(atlas, { person: 'Nobody' }).reason).toContain('no one named');
    expect(readWalkFilters(atlas, { period: '2020-01' }).reason).toContain('no memories in period');
    expect(readWalkFilters(atlas, { kind: 'dream' }).reason).toContain('yours are: conversation, note');
    expect(readWalkFilters(atlas, { topic: 0 })).toMatchObject({ ok: true, by: { topic: -1 } });
  });

  it('shows one memory with its nearest, by ref or by id, and says how to reopen it', () => {
    const withRef = atlas.memories.find((m) => m.ref && m.topic >= 0);
    const one = shapeWalkMemory(atlas, withRef.ref);
    expect(one.ok).toBe(true);
    expect(one.content).toContain('Nearest memories');
    expect(one.content).toContain(`memory_expand {ref: "${withRef.ref}"}`);
    expect(one.content).toContain(`{topic: ${withRef.topic + 1}}`);
    const bare = atlas.memories.find((m) => !m.ref && m.topic >= 0);
    expect(shapeWalkMemory(atlas, `id:${bare.id}`)).toMatchObject({ ok: true, id: bare.id });
    expect(shapeWalkMemory(atlas, 'mem_nothing_1_00000000')).toMatchObject({ ok: false });
  });
});

describe('phrases', () => {
  it('never reach across a comma or a full stop', () => {
    const words = wordsOf('the TikTok cut, Metidar. Render frames');
    expect(words.map((w) => [w.key, w.joins])).toEqual([
      ['the', false], ['tiktok', true], ['cut', true], ['metidar', false], ['render', false], ['frames', true],
    ]);
  });
});
