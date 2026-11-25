// The MEMORY view's arithmetic and its map geometry (frontend, pure) — what the
// chosen ways-in leave, what the rail counts, how a conversation reads as
// turns, and that the drawn map never lays one topic over another. Real
// atlases from the real builder — no mocks (RULE 0).
import { describe, it, expect } from 'vitest';
import { buildAtlas } from '../../core/memory/memory-atlas.js';
import {
  NO_FILTERS, backOnTrail, dayWords, facetCounts, filterChips, kindWords, monthWords, openOnTrail, shownMemories,
  sourceTurns, stateWords, toggleFilter,
} from '../../frontend/app/RelinkShell/memory-atlas/atlas-view.js';
import { buildAtlasMapLayout, discLabel, discRadius } from '../../frontend/app/RelinkShell/memory-atlas/atlas-map-layout.js';
import { shapeExpandResult } from '../../core/memory/memory-query.js';
import {
  PITCH_MAX, between, buildAtlasSpace, cameraToward, clusterRadius, dolly, homeCamera, orbit, project, sphereDirection, starAt,
} from '../../frontend/app/RelinkShell/memory-atlas/atlas-space.js';

const SUBJECTS = [
  ['harbor', 'tide', 'mooring', 'pilot', 'ferry', 'quay', 'anchor'],
  ['orchard', 'graft', 'blossom', 'pruning', 'cider', 'trellis', 'rootstock'],
  ['foundry', 'crucible', 'casting', 'alloy', 'furnace', 'ingot', 'slag'],
];
const records = () => SUBJECTS.flatMap((words, s) => words.map((w, i) => ({
  id: `${s}${i}`.padStart(16, '0'),
  text: `we spoke of the ${w} and the ${words[(i + 1) % 7]} and then the ${words[(i + 3) % 7]} once more`,
  line: `Of the ${w}`,
  at: new Date(Date.UTC(2026, 8 + s, 2 + i)).toISOString(),
  kind: i === 0 ? 'note' : 'conversation',
  state: i === 6 && s === 2 ? 'retracted' : 'active',
  ref: null,
  people: i < 2 ? ['Mara'] : [],
})));
const atlas = buildAtlas(records());

describe('what the ways-in leave', () => {
  it('nothing chosen shows everything; choices and a search combine', () => {
    expect(shownMemories(atlas, NO_FILTERS, null)).toHaveLength(21);
    expect(shownMemories(atlas, { ...NO_FILTERS, person: 'Mara' }, null)).toHaveLength(6);
    expect(shownMemories(atlas, { ...NO_FILTERS, person: 'Mara', period: '2026-09' }, null)).toHaveLength(2);
    expect(shownMemories(atlas, { ...NO_FILTERS, state: 'set-aside' }, null)).toHaveLength(1);
    const two = atlas.memories.slice(0, 2).map((m) => m.id);
    expect(shownMemories(atlas, { ...NO_FILTERS, kind: 'conversation' }, two).every((m) => two.includes(m.id))).toBe(true);
    expect(shownMemories(atlas, NO_FILTERS, [])).toEqual([]);
  });

  it('a press chooses, the same press lifts, another replaces', () => {
    const chosen = toggleFilter(NO_FILTERS, 'topic', 1);
    expect(chosen.topic).toBe(1);
    expect(toggleFilter(chosen, 'topic', 1).topic).toBeNull();
    expect(toggleFilter(chosen, 'topic', 0).topic).toBe(0);
  });

  it('the rail counts what a press WOULD show, leaving its own choice out', () => {
    const counts = facetCounts(atlas, { ...NO_FILTERS, topic: 0 }, null);
    // Choosing topic 0 does not zero the other topics…
    expect(counts.topic.get(1)).toBe(atlas.topics[1].size);
    // …but the months and people now count only inside it.
    expect([...counts.period.values()].reduce((a, b) => a + b, 0)).toBe(atlas.topics[0].size);
    expect(counts.person.get('Mara')).toBe(2);
  });

  it('each choice is a chip in plain words', () => {
    const chips = filterChips(atlas, { ...NO_FILTERS, topic: -1, period: '2026-10', kind: 'housemate', state: 'set-aside' }, 'tide');
    expect(chips.map((c) => `${c.label} ${c.words}`)).toEqual([
      'WORDS tide', 'TOPIC No topic', 'MONTH OCT 2026', 'KIND FROM A HOUSEMATE', 'STANDING SET ASIDE ONLY',
    ]);
    expect(filterChips(atlas, NO_FILTERS, '')).toEqual([]);
  });

  it('words for kinds, standings and dates', () => {
    expect(kindWords('fact')).toBe('OWN FACT');
    expect(kindWords('reflection')).toBe('REFLECTION');
    expect(stateWords('retracted')).toBe('TAKEN BACK');
    expect(monthWords('2026-03')).toBe('MAR 2026');
    expect(monthWords('undated')).toBe('UNDATED');
    expect(dayWords('2026-11-20T23:59:00.000Z')).toBe('NOV 20, 2026');
    expect(dayWords(null)).toBe('UNDATED');
  });

  it('the trail of opened memories steps forward and back', () => {
    const trail = openOnTrail(openOnTrail(openOnTrail([], 'a'), 'b'), 'b');
    expect(trail).toEqual(['a', 'b']);
    expect(backOnTrail(trail)).toEqual(['a']);
  });
});

describe('a reopened conversation as turns', () => {
  it('reads the real expand text: who spoke, the remembered pair marked, later lines kept with their turn', () => {
    const { content } = shapeExpandResult({
      source: 'the living session', sessionId: 'sess-1', focusIndex: 1, related: [{ ref: 'mem_x_1_00000000', occurredAt: null, memory: 'other' }],
      window: [
        { role: 'assistant', timestamp: '2026-11-01T10:00:00.000Z', content: 'earlier words' },
        { role: 'user', timestamp: '2026-11-01T10:01:00.000Z', content: 'the question\nwith a second line' },
        { role: 'assistant', timestamp: '2026-11-01T10:02:00.000Z', content: 'the answer' },
      ],
    });
    expect(sourceTurns(content)).toEqual([
      { who: 'answered', at: '2026-11-01T10:00:00.000Z', words: 'earlier words', focus: false },
      { who: 'said', at: '2026-11-01T10:01:00.000Z', words: 'the question\nwith a second line', focus: true },
      { who: 'answered', at: '2026-11-01T10:02:00.000Z', words: 'the answer', focus: true },
    ]);
  });

  it('text of another shape is not forced into turns', () => {
    expect(sourceTurns('A note, as written.')).toBeNull();
    expect(sourceTurns('Remembered from the archive:\nnot a turn line')).toBeNull();
    expect(sourceTurns('')).toBeNull();
  });
});

describe('the drawn map', () => {
  const layout = buildAtlasMapLayout(atlas);

  it('a disc for every topic and one for the memories in none, every memory a dot inside its own disc', () => {
    expect(layout.discs.map((d) => d.topic).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]);
    expect(layout.dots).toHaveLength(21);
    for (const dot of layout.dots) {
      const disc = layout.discs.find((d) => d.topic === dot.topic);
      expect(Math.hypot(dot.x - disc.cx, dot.y - disc.cy)).toBeLessThanOrEqual(disc.r);
      expect(dot.age).toBeGreaterThanOrEqual(0);
      expect(dot.age).toBeLessThanOrEqual(1);
    }
  });

  it('no disc lies over another, and a bigger topic is a bigger disc', () => {
    for (let i = 0; i < layout.discs.length; i += 1) {
      for (let j = i + 1; j < layout.discs.length; j += 1) {
        const a = layout.discs[i]; const b = layout.discs[j];
        expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(a.r + b.r);
      }
    }
    expect(discRadius(100)).toBeGreaterThan(discRadius(10));
  });

  it('thirty topics still pack without touching, and the same atlas always draws the same map', () => {
    const many = {
      topics: Array.from({ length: 30 }, (_, t) => ({ id: t, name: `alpha beta · gamma · delta ${t}`, size: 3 + t * 4 })),
      memories: Array.from({ length: 30 }, (_, t) => Array.from({ length: 3 + t * 4 }, (__, i) => ({ id: `${t}-${i}`, topic: t, links: i % 7, at: null }))).flat(),
    };
    const drawn = buildAtlasMapLayout(many);
    for (let i = 0; i < drawn.discs.length; i += 1) {
      for (let j = i + 1; j < drawn.discs.length; j += 1) {
        const a = drawn.discs[i]; const b = drawn.discs[j];
        expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(a.r + b.r);
      }
    }
    expect(buildAtlasMapLayout(many)).toEqual(drawn);
    expect(discLabel('alpha beta · gamma · delta 3')).toBe('alpha beta · gamma');
  });

  it('an empty atlas draws nothing', () => {
    expect(buildAtlasMapLayout({ topics: [], memories: [] })).toEqual({ discs: [], dots: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
  });
});

describe('the space to move through', () => {
  const space = buildAtlasSpace(atlas);

  it('a cluster for every topic, every memory a point inside its own cluster, the most connected at the core', () => {
    expect(space.clusters.map((c) => c.topic).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]);
    expect(space.stars).toHaveLength(21);
    for (const star of space.stars) {
      const c = space.clusters.find((k) => k.topic === star.topic);
      expect(Math.hypot(star.x - c.x, star.y - c.y, star.z - c.z)).toBeLessThanOrEqual(c.r);
    }
    for (const c of space.clusters) {
      const own = space.stars.filter((s) => s.topic === c.topic);
      const core = own.find((s) => Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) < 1e-9);
      expect(own.every((s) => s.size <= core.size + 1e-9)).toBe(true);
    }
  });

  it('no two clusters touch, at three topics or at forty, and the same atlas is always the same space', () => {
    const many = {
      topics: Array.from({ length: 40 }, (_, t) => ({ id: t, name: `t${t}` })),
      memories: Array.from({ length: 40 }, (_, t) => Array.from({ length: 3 + t * 5 }, (__, i) => ({ id: `${t}-${i}`, topic: t, links: i % 5, at: null }))).flat(),
    };
    for (const built of [space, buildAtlasSpace(many)]) {
      for (let i = 0; i < built.clusters.length; i += 1) {
        for (let j = i + 1; j < built.clusters.length; j += 1) {
          const a = built.clusters[i]; const b = built.clusters[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(a.r + b.r);
        }
      }
    }
    expect(buildAtlasSpace(many)).toEqual(buildAtlasSpace(many));
    expect(clusterRadius(1000)).toBeGreaterThan(clusterRadius(10));
    expect(buildAtlasSpace({})).toEqual({ clusters: [], stars: [], reach: 0 });
    const d = sphereDirection(3, 12);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
  });

  it('the camera looks at its point: that point lands mid-screen, and the whole space fits from home', () => {
    const home = homeCamera(space);
    expect(project(home, { x: 0, y: 0, z: 0 }, 800, 600)).toMatchObject({ sx: 400, sy: 300 });
    for (const star of space.stars) {
      const p = project(home, star, 800, 600);
      expect(p.sx).toBeGreaterThan(0); expect(p.sx).toBeLessThan(800);
      expect(p.sy).toBeGreaterThan(0); expect(p.sy).toBeLessThan(600);
    }
    const cluster = space.clusters[1];
    const before = cameraToward(home, cluster, cluster.r);
    expect(project(before, cluster, 800, 600).sx).toBeCloseTo(400, 6);
    expect(before.dist).toBeLessThan(home.dist);
    // It stands on the cluster's outer side: every memory of every OTHER cluster is farther than the one it faces.
    const depthOf = (p) => project(before, p, 800, 600)?.depth ?? Infinity;
    const others = space.stars.filter((s) => s.topic !== cluster.topic).map(depthOf);
    expect(Math.min(...others)).toBeGreaterThan(depthOf(cluster));
    // …and it turned the short way round, however many turns the drift had already made.
    const spun = cameraToward({ ...home, yaw: home.yaw + 20 * Math.PI }, cluster, cluster.r);
    expect(Math.abs(spun.yaw - (home.yaw + 20 * Math.PI))).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it('a point behind the camera is not drawn; nearer points are drawn larger', () => {
    const cam = { yaw: 0, pitch: 0, dist: 50, x: 0, y: 0, z: 0 };
    expect(project(cam, { x: 0, y: 0, z: -60 }, 800, 600)).toBeNull();
    expect(project(cam, { x: 0, y: 0, z: -20 }, 800, 600).scale).toBeGreaterThan(project(cam, { x: 0, y: 0, z: 20 }, 800, 600).scale);
    // Up in space is up on the screen.
    expect(project(cam, { x: 0, y: 10, z: 0 }, 800, 600).sy).toBeLessThan(300);
  });

  it('turning stops short of the poles, moving stops short of the point and of losing the space', () => {
    const cam = homeCamera(space);
    expect(orbit(cam, 0, 99999).pitch).toBe(PITCH_MAX);
    expect(orbit(cam, 0, -99999).pitch).toBe(-PITCH_MAX);
    expect(orbit(cam, 100, 0).yaw).toBeCloseTo(cam.yaw + 0.6, 9);
    expect(dolly(cam, 0.000001, space).dist).toBe(6);
    expect(dolly(cam, 1e9, space).dist).toBe(Math.max(120, space.reach * 6));
  });

  it('a flight eases from one camera to the other and ends exactly there', () => {
    const a = homeCamera(space); const b = cameraToward(a, space.clusters[2], 10);
    expect(between(a, b, 0)).toEqual(a);
    expect(between(a, b, 1)).toEqual(b);
    expect(between(a, b, 7)).toEqual(b);
    const mid = between(a, b, 0.5);
    expect(mid.dist).toBeCloseTo((a.dist + b.dist) / 2, 9);
    expect(Math.abs(between(a, b, 0.1).dist - a.dist)).toBeLessThan(Math.abs(mid.dist - a.dist) / 5 + 1e-9 + Math.abs(mid.dist - a.dist));
  });

  it('the pointer picks the star under it, the nearer one when two overlap, none when far from all', () => {
    const drawn = [{ id: 'far', sx: 100, sy: 100, depth: 90 }, { id: 'near', sx: 102, sy: 101, depth: 30 }, { id: 'else', sx: 300, sy: 300, depth: 30 }];
    expect(starAt(drawn, 100, 100)).toBe('near');
    expect(starAt(drawn, 303, 298)).toBe('else');
    expect(starAt(drawn, 200, 200)).toBeNull();
  });
});
