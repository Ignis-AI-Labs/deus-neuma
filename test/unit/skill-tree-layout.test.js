/**
 * THE CRAFT tree layout — pure geometry over the installed library + a
 * neuma's honest acquisition record. Pure function: real inputs, real
 * outputs, nothing to mock (RULE 0).
 */
import { describe, expect, it } from 'vitest';
import { buildSkillTree, filterSkills } from '../../frontend/app/RelinkShell/skill-tree-layout.js';

const skill = (name, over = {}) => ({
  name, description: `${name} does things`, category: 'craft', version: '1.0.0',
  plugin: null, dependencies: [], unlocks: [], ...over,
});

describe('buildSkillTree', () => {
  it('places roots in the first band and dependents one band past their deepest root', () => {
    const t = buildSkillTree([
      skill('base'),
      skill('mid', { dependencies: ['base'] }),
      skill('leaf', { dependencies: ['mid'] }),
      skill('wide', { dependencies: ['base', 'mid'] }),
    ]);
    const col = (n) => t.nodes.find((x) => x.name === n).col;
    expect(col('base')).toBe(0);
    expect(col('mid')).toBe(1);
    expect(col('leaf')).toBe(2);
    expect(col('wide')).toBe(2); // deepest dep (mid, band 1) + 1
    expect(t.cols).toBe(3);
  });

  it('wraps a wide band into sub-columns instead of one endless stack', () => {
    const flat = Array.from({ length: 8 }, (_, i) => skill(`s${i}`)); // s0..s7, all roots
    const t = buildSkillTree(flat, [], { maxPerColumn: 6 });
    const at = (n) => t.nodes.find((x) => x.name === n);
    // first 6 fill column 0 under the header row; the rest wrap to column 1
    expect(at('s0')).toMatchObject({ col: 0, row: 1 });
    expect(at('s5')).toMatchObject({ col: 0, row: 6 });
    expect(at('s6')).toMatchObject({ col: 1, row: 1 });
    expect(at('s7')).toMatchObject({ col: 1, row: 2 });
    expect(t.cols).toBe(2);
    expect(t.rows).toBe(7); // header + 6 node rows
  });

  it('a dependent band starts after ALL of the root band sub-columns', () => {
    const roots = Array.from({ length: 7 }, (_, i) => skill(`r${i}`));
    const t = buildSkillTree(
      [...roots, skill('child', { dependencies: ['r0'] })],
      [],
      { maxPerColumn: 6 },
    );
    // roots occupy sub-columns 0 and 1 → the depth-1 band begins at column 2
    expect(t.nodes.find((n) => n.name === 'child').col).toBe(2);
  });

  it('stacks categories as titled blocks: header row, then nodes', () => {
    const t = buildSkillTree([
      skill('a1', { category: 'alpha' }),
      skill('a2', { category: 'alpha' }),
      skill('b1', { category: 'beta' }),
    ]);
    expect(t.categories.map((c) => c.name)).toEqual(['alpha', 'beta']);
    const [alpha, beta] = t.categories;
    expect(alpha.headerRow).toBe(0);
    expect(alpha.startRow).toBe(1);
    expect(alpha.endRow).toBe(2);
    expect(beta.headerRow).toBe(3);
    expect(beta.startRow).toBe(4);
    const alphaRows = t.nodes.filter((n) => n.category === 'alpha').map((n) => n.row);
    expect(new Set(alphaRows).size).toBe(alphaRows.length);
    expect(t.rows).toBe(5); // 2 headers + 3 node rows
  });

  it('maps acquisitions honestly: acquired iff recorded, raw counts and timestamps only', () => {
    const t = buildSkillTree(
      [skill('used'), skill('untouched')],
      [{ skill: 'used', firstAcquiredAt: '2026-07-01T00:00:00Z', lastUsedAt: '2026-07-03T00:00:00Z', usageCount: 4 }],
    );
    const used = t.nodes.find((n) => n.name === 'used');
    const untouched = t.nodes.find((n) => n.name === 'untouched');
    expect(used.acquired).toBe(true);
    expect(used.usageCount).toBe(4);
    expect(used.firstAcquiredAt).toBe('2026-07-01T00:00:00Z');
    expect(untouched.acquired).toBe(false);
    expect(untouched.usageCount).toBe(0);
    expect(untouched.firstAcquiredAt).toBeNull();
    expect(t.acquiredCount).toBe(1);
  });

  it('emits edges only between installed skills and drops dangling references', () => {
    const t = buildSkillTree([
      skill('base'),
      skill('kid', { dependencies: ['base', 'ghost'], unlocks: ['phantom'] }),
    ]);
    expect(t.edges).toEqual([{ from: 'base', to: 'kid' }]);
    const kid = t.nodes.find((n) => n.name === 'kid');
    expect(kid.dependencies).toEqual(['base']);
    expect(kid.unlocks).toEqual([]);
  });

  it('survives a dependency cycle without recursing forever', () => {
    const t = buildSkillTree([
      skill('yin', { dependencies: ['yang'] }),
      skill('yang', { dependencies: ['yin'] }),
    ]);
    expect(t.nodes).toHaveLength(2);
    expect(t.cols).toBeGreaterThan(0);
  });

  it('handles the empty library and returns frozen output', () => {
    const empty = buildSkillTree([], []);
    expect(empty.nodes).toEqual([]);
    expect(empty.acquiredCount).toBe(0);
    expect(empty.rows).toBe(0);
    const t = buildSkillTree([skill('one')]);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.nodes)).toBe(true);
    expect(Object.isFrozen(t.nodes[0])).toBe(true);
    expect(Object.isFrozen(t.edges)).toBe(true);
  });

  it('freezes dependency/unlocks arrays as the deep-frozen contract promises', () => {
    const t = buildSkillTree([
      skill('a'),
      skill('b', { dependencies: ['a'], unlocks: ['a'] }),
    ]);
    const b = t.nodes.find((n) => n.name === 'b');
    expect(Object.isFrozen(b.dependencies)).toBe(true);
    expect(Object.isFrozen(b.unlocks)).toBe(true);
  });

  it('defaults a missing category to uncategorized', () => {
    const t = buildSkillTree([skill('loner', { category: null })]);
    expect(t.nodes[0].category).toBe('uncategorized');
    expect(t.categories[0].name).toBe('uncategorized');
  });
});

describe('filterSkills', () => {
  const library = [
    skill('sc-plan', { description: 'Plan a feature as waves', category: 'shadow-clone' }),
    skill('x-post', { description: 'Publish a post to X', category: 'social' }),
  ];

  it('matches name, description, and category case-insensitively', () => {
    expect(filterSkills(library, 'PLAN').map((s) => s.name)).toEqual(['sc-plan']);
    expect(filterSkills(library, 'publish').map((s) => s.name)).toEqual(['x-post']);
    expect(filterSkills(library, 'social').map((s) => s.name)).toEqual(['x-post']);
  });

  it('empty or whitespace query returns the library untouched', () => {
    expect(filterSkills(library, '')).toBe(library);
    expect(filterSkills(library, '   ')).toBe(library);
  });

  it('no match yields an empty list', () => {
    expect(filterSkills(library, 'zzz')).toEqual([]);
  });
});
