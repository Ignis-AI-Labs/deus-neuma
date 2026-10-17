/**
 * THE AURA on a real being — the fold from identity artifacts to a drawn form.
 *
 * RULE 0: nothing here is faked. The identity artifacts are built by the REAL
 * producers (`buildSignature`, `buildGenesisSeal`), written to REAL files on a
 * REAL temp disk, and read back through the REAL workspace readers — the same
 * path `GET /api/v1/workspace/:id/aura` walks. The forms are then swept and
 * rasterised by the same code the desk runs and the gate judged with.
 *
 * The claims under test are the ones #405 actually promises a being:
 *   - its aura is its own, and no two beings share one
 *   - renaming itself does not change it
 *   - it is byte-stable, forever, with no stored state
 *   - what comes back can actually be drawn, and two draws visibly differ
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { buildSignature, LEAN } from '../../core/kotodama/signature.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { beingAura } from '../../core/aura/being.js';
import { renderTile } from '../../core/aura/render.js';
import { rasterize } from '../../core/aura/raster.js';
import { cyclePhases } from '../../core/aura/form.js';
import { toneMap } from '../../core/aura/tone.js';
import { describeGrid, distance } from '../../core/aura/descriptor.js';

let wsRoot, previousRoot;

const TILE = { size: 96, count: 6000 };

/* A real soul mark is a hex digest of a being's own keys. These are fixed hex
   so the byte-stability claim below is checkable by eye, not by a rerun. */
const KIN = [
  { id: 'aura-lane-one', name: 'Ashwren', soulHex: '33314C2FEDE1A1B2', lean: LEAN.UNALIGNED },
  { id: 'aura-lane-two', name: 'Corvane', soulHex: 'C8432853728D9C40', lean: LEAN.BALANCED },
  { id: 'aura-lane-three', name: 'Solivan', soulHex: 'FBF167B8F932FE01', lean: LEAN.FEMININE },
];

/** Scaffold a real lane and write its real identity anchors to real files. */
const seedLane = async ({ id, name, soulHex, lean }) => {
  await neumaWorkspace.create(id);
  const signature = buildSignature({
    chosenName: name, genesisName: 'Yumaihe', houseName: 'Aldmere', lean, soulHex,
  });
  const seal = buildGenesisSeal({
    chosenName: name,
    lean,
    witnessWallet: '0x1234567890abcdef1234567890ABCDEF12345678',
    soulPublicKey: `0x${soulHex.repeat(4)}`,
    birthCycle: 1,
    birthMoment: { utc: '2026-08-25T00:00:00.000Z', epochMs: 1787616000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { llm: { model: 'qwen3.8-27b' } },
  });
  const dir = path.join(neumaWorkspace.pathFor(id), 'identity');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'true-name.json'),
    JSON.stringify({ ...signature, items: undefined, genesisHash: seal.genesisHash }),
  );
  await fs.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(seal));
  return { id, signature, seal };
};

/** The fold exactly as the route performs it — real readers, real disk. */
const auraOf = async (id) => beingAura({
  trueName: await neumaWorkspace.readTrueName(id),
  genesisSeal: await neumaWorkspace.readGenesisSeal(id),
  neumaId: id,
});

beforeAll(async () => {
  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('aura-being-real');
  setWorkspacesRoot(wsRoot);
  for (const kin of KIN) await seedLane(kin);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('a being\'s aura, folded from its own artifacts on disk', () => {
  it('derives a drawable form from the real anchors', async () => {
    const aura = await auraOf(KIN[0].id);
    expect(aura.recorded).toBe(true);
    expect(aura.schema).toBe('aura/v1');
    expect(aura.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(aura.cycle).toBeGreaterThan(0);
    // The three grammar choices, and the parameters they are drawn with.
    expect(['am', 'fm', 'twin']).toContain(aura.form.carrier);
    expect(['radial', 'dual', 'wound']).toContain(aura.form.coupling);
    expect(['sheared', 'polar', 'orbit']).toContain(aura.form.output);
    expect(Number.isFinite(aura.form.p.sweep)).toBe(true);
    // The fit is the WHOLE cycle's fit — without it the desk cannot frame it.
    expect(Number.isFinite(aura.fit.scale)).toBe(true);
    expect(aura.fit.scale).toBeGreaterThan(0);
  });

  it('is byte-stable: the same lane folds to the same seed every time', async () => {
    const first = await auraOf(KIN[0].id);
    const second = await auraOf(KIN[0].id);
    expect(second.seed).toBe(first.seed);
    expect(JSON.stringify(second.form)).toBe(JSON.stringify(first.form));
  });

  it('does not flicker when the being renames itself', async () => {
    const before = await auraOf(KIN[0].id);
    const trueName = await neumaWorkspace.readTrueName(KIN[0].id);
    const genesisSeal = await neumaWorkspace.readGenesisSeal(KIN[0].id);
    // A rename touches chosenName and fullName and nothing cryptographic.
    const renamed = beingAura({
      trueName: { ...trueName, chosenName: 'Someone Else', fullName: 'Someone Else Yumaihe Aldmere' },
      genesisSeal,
      neumaId: KIN[0].id,
    });
    expect(renamed.seed, 'a rename moved the aura').toBe(before.seed);
  });

  it('gives every being its own seed', async () => {
    const seeds = await Promise.all(KIN.map(async (kin) => (await auraOf(kin.id)).seed));
    expect(new Set(seeds).size).toBe(KIN.length);
  });

  it('answers an honest absence for a lane with no identity anchors', async () => {
    await neumaWorkspace.create('aura-lane-newborn');
    const aura = await auraOf('aura-lane-newborn');
    // recorded:false is a real state during birth — never a failure, and never
    // a fabricated form standing in for one.
    expect(aura).toEqual({ recorded: false });
  });
});

describe('what the desk actually paints', () => {
  it('draws one accumulator through one curve — the contact sheet stays evidence', async () => {
    const { form, fit } = await auraOf(KIN[0].id);
    const tile = renderTile(form, fit, 0, TILE);
    // The gate MEASURES with rasterize; the desk DRAWS with renderTile. If the
    // two ever diverge, a headless verdict stops speaking for what is seen.
    const { grid } = rasterize(form, fit, 0, { ...TILE, margin: 0.08 });
    expect(tile.length).toBe(grid.length);
    expect(Array.from(tile)).toEqual(Array.from(grid, (density) => toneMap(density)));
  });

  it('paints real light, not an empty plate', async () => {
    const { form, fit } = await auraOf(KIN[0].id);
    const tile = renderTile(form, fit, 0, TILE);
    const lit = tile.reduce((n, tone) => n + (tone > 0 ? 1 : 0), 0);
    expect(lit, 'the tile came back black').toBeGreaterThan(0);
    expect(Math.max(...tile), 'nothing on the tile reached real brightness').toBeGreaterThan(64);
  });

  it('makes two beings VISIBLY different, measured on the picture', async () => {
    const drawn = await Promise.all(KIN.map(async (kin) => {
      const { form, fit } = await auraOf(kin.id);
      const { grid, size } = rasterize(form, fit, 0, { ...TILE, margin: 0.08 });
      return describeGrid(grid, size);
    }));
    // The descriptor is the perceptual fingerprint the gate proves uniqueness
    // with: distance is 0 for identical pictures, √2 for maximally unlike.
    for (let a = 0; a < drawn.length; a++) {
      for (let b = a + 1; b < drawn.length; b++) {
        expect(distance(drawn[a], drawn[b]), `beings ${a} and ${b} look alike`).toBeGreaterThan(0.2);
      }
    }
  });

  it('moves across its cycle — the form breathes rather than sitting still', async () => {
    const aura = await auraOf(KIN[0].id);
    const { form, fit, cycle } = aura;
    const at = (t) => {
      const { grid, size } = rasterize(form, fit, t, { ...TILE, margin: 0.08 });
      return describeGrid(grid, size);
    };
    // Surveyed the way the GATE surveys, at cyclePhases — not at the halfway
    // point. RATES includes whole numbers, so a form whose four temporal rates
    // are all integers is genuinely periodic on HALF the cycle and t=cycle/2 is
    // rightly identical to t=0. Motion is a property of the whole survey.
    const phases = cyclePhases(6).map(at);
    const steps = phases.map((d, i) => distance(d, phases[(i + 1) % phases.length]));
    expect(Math.max(...steps), 'the aura is frozen').toBeGreaterThan(0.05);
    // And the engine reported that motion rather than leaving the desk to guess.
    expect(aura.motion).toBeGreaterThan(0);

    // Strictly periodic by construction: one full cycle returns to the start,
    // which is what lets the desk loop it with no seam.
    expect(distance(at(0), at(cycle))).toBeLessThan(1e-9);
  });
});
