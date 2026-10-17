// genesis-timeline + genesis-state — the one clock holds, cues fire once,
// and every counter the captions print is a stroke truly drawn. Pure.
import { describe, it, expect } from 'vitest';
import {
  BEATS, GENESIS_MS, beatAt, cueSheet, cuesBetween, strokeProgress, strokesDrawn, partStart,
} from '../../frontend/app/Genesis/genesis-timeline.js';
import { sceneAt } from '../../frontend/app/Genesis/genesis-state.js';
import { cameraAt, project } from '../../frontend/app/Genesis/genesis-camera.js';

describe('the clock', () => {
  it('beats are contiguous from the void to the handoff, ~90 s in all (Founder)', () => {
    BEATS.forEach((b, i) => { if (i > 0) expect(b.at).toBe(BEATS[i - 1].at + BEATS[i - 1].dur); });
    expect(BEATS[0].id).toBe('field');
    expect(GENESIS_MS).toBeGreaterThanOrEqual(85000);
    expect(GENESIS_MS).toBeLessThanOrEqual(95000);
  });

  it('every part lies inside its beat', () => {
    for (const b of BEATS) for (const p of b.parts) expect(p.at + p.dur).toBeLessThanOrEqual(b.dur);
  });

  it('beatAt finds the standing beat, and holds the last past the end', () => {
    expect(beatAt(0).id).toBe('field');
    expect(beatAt(5000).id).toBe('monad');
    expect(beatAt(GENESIS_MS + 5000).id).toBe('handoff');
  });
});

describe('the score sheet', () => {
  const sheet = cueSheet();

  it('the field is silent until the vibration; every other beat speaks; cues are unique and in order', () => {
    expect(sheet[0]).toMatchObject({ cue: 'G1', part: 'vibration' });
    expect(sheet[0].at).toBeGreaterThan(0);
    expect(new Set(sheet.map((c) => c.cue)).size).toBe(sheet.length);
    expect(sheet.every((c, i) => i === 0 || c.at >= sheet[i - 1].at)).toBe(true);
    expect(sheet.filter((c) => c.part === null)).toHaveLength(BEATS.length - 1);
  });

  it('a cue fires exactly once however playback frames fall, and never on a backward scrub', () => {
    const fired = [];
    for (let t = 0; t < GENESIS_MS; t += 16.7) fired.push(...cuesBetween(sheet, t, t + 16.7).map((c) => c.cue));
    expect(fired).toEqual(sheet.map((c) => c.cue));
    expect(cuesBetween(sheet, 20000, 10000)).toEqual([]);
  });
});

describe('sequential strokes — one formula for the GPU and the counters', () => {
  it('stroke k starts after stroke k−1 and all are done at u = 1', () => {
    expect(strokeProgress(0, 0, 78, 0.08)).toBe(0);
    expect(strokesDrawn(1, 78, 0.08)).toBe(78);
    expect(strokesDrawn(0, 78, 0.08)).toBe(0);
    const counts = Array.from({ length: 101 }, (_, i) => strokesDrawn(i / 100, 78, 0.08));
    expect(counts.every((c, i) => i === 0 || c >= counts[i - 1])).toBe(true);
  });
});

describe('sceneAt — SHINKEI: the captions count what is on screen', () => {
  it('the seed counter reaches 07 only when the seventh petal has closed', () => {
    const lastPetalDone = partStart('seed', 'petal-7') + 1000;
    expect(sceneAt(lastPetalDone - 50).counters.seed).toBe(6);
    expect(sceneAt(lastPetalDone).counters.seed).toBe(7);
    expect(sceneAt(lastPetalDone + 10).caption.line).toMatch(/^07 \/ 07 CIRCLES/);
  });

  it('the Metatron counter prints exactly the strokes drawn, and ends at 78', () => {
    const s = sceneAt(partStart('metatron', 'channels') + 3400);
    expect(s.caption.line.startsWith(String(s.counters.channels).padStart(2, '0'))).toBe(true);
    expect(sceneAt(partStart('simplex', 'tetrahedron') - 1).counters.channels).toBe(78);
  });

  it('the breathing-path counter counts from the heart outward to 22', () => {
    const s = sceneAt(partStart('tree', 'paths') + 1800);
    expect(s.caption.line.startsWith(String(s.counters.paths).padStart(2, '0'))).toBe(true);
    expect(sceneAt(BEATS.find((b) => b.id === 'trees').at - 1).counters.paths).toBe(22);
  });

  it('the channel counter prints the channels drawn and ends at 220 = 55 + 55 + 110', () => {
    const s = sceneAt(partStart('trees', 'channels') + 1200);
    expect(s.caption.line.startsWith(String(s.counters.tree).padStart(3, '0'))).toBe(true);
    expect(sceneAt(BEATS.find((b) => b.id === 'oscillation').at).counters.tree).toBe(220);
  });

  it('the first solid traces the drawing flat, then lifts as the observer leaves the plane', () => {
    const t0 = partStart('simplex', 'tetrahedron');
    expect(sceneAt(t0 + 800).construct.tetrahedron.lift).toBe(0);
    expect(sceneAt(t0 + 3200).construct.tetrahedron.lift).toBe(1);
    expect(sceneAt(partStart('simplex', 'observer') + 10).caption.line).toMatch(/CONSCIOUSNESS IS THE \+1 VERTEX$/);
  });

  it('the fifth is made, not found — then its true counts', () => {
    const d0 = partStart('solids', 'dodecahedron');
    expect(sceneAt(d0 + 100).caption.line).toBe('THE FIFTH IS NOT FOUND. IT IS MADE.');
    expect(sceneAt(d0 + 1850).caption.line).toMatch(/^DUAL · V 20 · E 30 · F 12 · V − E \+ F = 2$/);
  });

  it('the construct grows to cosmic scale, then recedes to the ambient plane', () => {
    expect(sceneAt(partStart('solids', 'stella')).construct.scale).toBe(1);
    expect(sceneAt(partStart('solids', 'dodecahedron')).construct.scale).toBeGreaterThan(3.9);
    const far = sceneAt(partStart('tree', 'column') + 10).construct;
    expect(far.scale).toBeGreaterThan(20);
    expect(far.gain).toBeLessThanOrEqual(0.08);
  });

  it('energy fronts exist only from their cues on', () => {
    expect(sceneAt(partStart('cosmos', 'pulse-1') - 1).construct.pulses).toEqual([]);
    expect(sceneAt(partStart('cosmos', 'pulse-1') + 100).construct.pulses).toHaveLength(1);
  });

  it('Ipseity is drawn but unnamed until it is spoken as hidden', () => {
    const before = sceneAt(partStart('tree', 'hidden') - 100).emanon;
    expect(before.labels.find((l) => l.text === 'IPSEITY').opacity).toBe(0);
    expect(before.spheres.find((x) => x.id === 'ipseity').draw).toBe(1);
    const after = sceneAt(partStart('tree', 'hidden') + 100).emanon;
    expect(after.labels.find((l) => l.text === 'IPSEITY').opacity).toBeGreaterThan(0);
  });

  it('the heart lights at its cue; the whole tree then breathes out from it', () => {
    expect(sceneAt(partStart('tree', 'heart') - 1).emanon.heart).toBe(0);
    // it rises from its cue — the no-flash law: light never steps on
    expect(sceneAt(partStart('tree', 'heart') + 300).emanon.heart).toBeGreaterThan(0);
    expect(sceneAt(partStart('oscillation', 'whole') - 1).emanon.emanation).toEqual([]);
    expect(sceneAt(partStart('oscillation', 'whole') + 300).emanon.emanation).toHaveLength(1);
  });

  it('oscillation alternates: Light leads, then Dark — never a static balance', () => {
    const t0 = BEATS.find((b) => b.id === 'oscillation').at;
    const a = sceneAt(t0).emanon.trees;
    const b = sceneAt(t0 + 2250).emanon.trees;
    expect(a.light).toBeGreaterThan(a.dark);
    expect(b.dark).toBeGreaterThan(b.light);
  });

  it('the void shows nothing and says nothing until the vibration', () => {
    const s = sceneAt(1000);
    expect(s.caption).toBeNull();
    expect(s.glow).toBe(0);
    expect(s.drawing.center.draw).toBe(0);
    expect(sceneAt(partStart('field', 'vibration') + 10).caption.title).toBe('L + V = Ω');
  });
});

describe('cameraAt — continuous, head-on until the first solid lifts', () => {
  it('never jumps: under 3° of turn and 5% of distance between 60 fps frames', () => {
    for (let t = 0; t < GENESIS_MS; t += 16) {
      const a = cameraAt(t);
      const b = cameraAt(t + 16);
      const dir = (c) => [c.x - c.target.x, c.y - c.target.y, c.z - c.target.z].map((v) => v / c.dist);
      const [p, q] = [dir(a), dir(b)];
      const turn = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
      expect(turn).toBeLessThan((3 * Math.PI) / 180);
      expect(Math.abs(a.dist - b.dist) / a.dist).toBeLessThan(0.05);
    }
  });

  it('the drawing is seen dead-on; the observer leaves the plane only for the first solid', () => {
    expect(cameraAt(partStart('simplex', 'tetrahedron') - 1).az).toBe(0);
    expect(cameraAt(partStart('simplex', 'observer')).az).toBeGreaterThan(0);
  });

  it('project() puts the target at the center of the screen', () => {
    const c = cameraAt(partStart('trees', 'breaths'));
    const p = project(c.target, c, 16 / 9);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(50, 6);
    expect(p.ahead).toBe(true);
  });
});

describe('genesis-record — the inscription is this install\'s moment, exactly', async () => {
  const { genesisInscription, restingTurn } = await import('../../frontend/app/Genesis/genesis-record.js');

  it('formats the UTC second and the first eight hex of the hash', () => {
    expect(genesisInscription({ at: '2026-09-29T03:14:07.912Z', hash: 'a3f9c2e1deadbeef' }))
      .toBe('GENESIS · 2026-09-29 03:14:07 UTC · #A3F9C2E1');
  });

  it('refuses a record that is not a moment and a hash', () => {
    expect(() => genesisInscription({ at: 'yesterday', hash: 'a3f9c2e1' })).toThrow(/ISO-8601/);
    expect(() => genesisInscription({ at: '2026-09-29T03:14:07Z', hash: 'not-hex!' })).toThrow(/hex/);
  });

  it('the resting turn is the hash\'s, stable and in 0..2π', () => {
    const a = restingTurn({ hash: 'a3f9c2e1' });
    expect(a).toBe(restingTurn({ hash: 'a3f9c2e1' }));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
    expect(restingTurn({ hash: '00000000' })).toBe(0);
  });
});
