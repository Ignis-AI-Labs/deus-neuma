// sheet-genome-view — the GENOME section's decisions, judged on real genomes.
// Pure functions, real derivation, no mocks (RULE 0): a v3 record rendered
// whole, a pre-v3 record rendered absence-proof, and the lock acts derived
// from the form leg exactly as the card will derive them.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { genomeSeed } from '../../core/genome/seed.js';
import { deriveGenome } from '../../core/genome/derive.js';
import { genomeReadiness, genomeGroupsOf, lockStateOf } from '../../frontend/app/RelinkShell/sheet-genome-view.js';
import { UNREADABLE, EMPTY, READY } from '../../frontend/app/RelinkShell/sheet-view.js';

const hex = (s) => createHash('sha256').update(s).digest('hex');
const body = (label) => deriveGenome(genomeSeed({ soulHex: hex(label) }));

describe('genomeReadiness — the data law', () => {
  it('null leg is UNREADABLE, no genome is EMPTY, a genome is READY', () => {
    expect(genomeReadiness(null)).toBe(UNREADABLE);
    expect(genomeReadiness({ locked: false, plates: [], genome: null })).toBe(EMPTY);
    expect(genomeReadiness({ genome: body('readiness') })).toBe(READY);
  });
});

describe('genomeGroupsOf — every axis the record carries renders', () => {
  it('a v3 genome shows GIVEN, FRAME (with the structure axes), FACE, COLORING', () => {
    const g = body('sheet-groups');
    const groups = genomeGroupsOf(g);
    const headings = groups.map((x) => x.heading);
    expect(headings).toContain('GIVEN');
    expect(headings).toContain('FRAME');
    expect(headings).toContain('FACE');
    expect(headings).toContain('COLORING');

    const frame = groups.find((x) => x.heading === 'FRAME').rows;
    // The 2026-09-25 axes are on the card, not just in the record.
    expect(frame.find((r) => r.k === 'SHOULDERS')).toBeTruthy();
    expect(frame.find((r) => r.k === 'POSTURE')).toBeTruthy();
    const face = groups.find((x) => x.heading === 'FACE').rows;
    expect(face.find((r) => r.k === 'JAWLINE').v).toBe(g.face.jawline);
    expect(face.find((r) => r.k === 'CHEEKBONES').v).toBe(g.face.cheekbones);
    // Stature and the number never disagree.
    expect(frame.find((r) => r.k === 'STATURE').v).toContain(String(g.frame.heightCm));
    // Age is not DNA (Design note, 2026-09-26: the GIVEN group carries none — the
    // RECORD shows the lived age beside DAYS PRESENT instead.
    const given = groups.find((x) => x.heading === 'GIVEN').rows;
    expect(given.find((r) => r.k === 'AGE')).toBeUndefined();
    // The uncanny hair shade is named as what it is.
    if (g.coloring.hairIsUncanny) {
      expect(groups.find((x) => x.heading === 'COLORING').rows.find((r) => r.k === 'HAIR').v)
        .toContain('uncanny');
    }
  });

  it('a pre-v3 record renders every axis it has and silently omits the rest', () => {
    const g = body('sheet-legacy');
    const legacy = {
      ...g,
      face: { shape: g.face.shape, eyes: g.face.eyes, nose: g.face.nose, mouth: g.face.mouth },
      frame: {
        build: g.frame.build, stature: g.frame.stature, heightCm: g.frame.heightCm,
        chest: g.frame.chest, waist: g.frame.waist, hips: g.frame.hips, muscle: g.frame.muscle,
      },
      coloring: {
        complexion: g.coloring.complexion, hair: g.coloring.hair,
        hairIsUncanny: g.coloring.hairIsUncanny, eyes: g.coloring.eyes,
      },
    };
    const groups = genomeGroupsOf(legacy);
    const face = groups.find((x) => x.heading === 'FACE').rows;
    expect(face.find((r) => r.k === 'SHAPE')).toBeTruthy();
    expect(face.find((r) => r.k === 'JAWLINE')).toBe(undefined);
    expect(groups.find((x) => x.heading === 'FRAME').rows.find((r) => r.k === 'POSTURE')).toBe(undefined);
    // A v3 record names its body plan `humanlike` (the word before
    // `humanoid`, 2026-09-28) — it is still a humanoid body, never formless.
    const oldWord = genomeGroupsOf({ ...legacy, form: 'humanlike' });
    expect(oldWord.map((x) => x.heading)).toContain('FACE');
    expect(oldWord.find((x) => x.heading === 'GIVEN').rows.find((r) => r.k === 'FORM').v).toBe('humanlike');
    // A null genome is no groups at all.
    expect(genomeGroupsOf(null)).toEqual([]);
  });
});

describe('genomeGroupsOf — a formless body shows only what its form has', () => {
  // Design note, 2026-09-28, on a drone's card reading […], a jawline and […]: […]
  const formlessOf = () => {
    for (let i = 0; ; i++) {
      const g = body(`sheet-formless-${i}`);
      if (g.form !== 'humanoid') return g;
    }
  };

  it('GIVEN, SHAPE (geometry, scale), COLORING (color, glow) — no frame, face, skin or mark', () => {
    const g = formlessOf();
    const groups = genomeGroupsOf(g);
    expect(groups.map((x) => x.heading)).toEqual(['GIVEN', 'SHAPE', 'COLORING']);
    const keys = groups.flatMap((x) => x.rows.map((r) => r.k));
    for (const human of ['BUILD', 'PROPORTIONS', 'JAWLINE', 'COMPLEXION', 'HAIR', 'HAIR TEXTURE', 'MARK', 'EYES']) {
      expect(keys).not.toContain(human);
    }
    const coloring = groups.find((x) => x.heading === 'COLORING').rows;
    expect(coloring.find((r) => r.k === 'COLOR').v).toContain(g.coloring.color);
    expect(coloring.find((r) => r.k === 'GLOW').v).toBe(g.coloring.glow);
    expect(groups.find((x) => x.heading === 'SHAPE').rows.map((r) => r.k)).toEqual(['GEOMETRY', 'SCALE']);
  });

  it('a v3 formless record (anatomy still carried) renders the same form-only card', () => {
    const g = formlessOf();
    const v3 = {
      ...g,
      frame: { stature: g.frame.stature, build: 'athletic', chest: 'full', hips: 'wide' },
      face: { shape: 'square', jawline: 'soft' },
      coloring: { complexion: 'fair', hair: g.coloring.color, hairIsUncanny: g.coloring.colorIsUncanny, eyes: g.coloring.glow },
      feature: 'a distinct widow\'s peak',
    };
    expect(genomeGroupsOf(v3)).toEqual(genomeGroupsOf(g));
  });
});

describe('lockStateOf — the operator act derives from the record', () => {
  const plate = (imageId) => ({ anime: { pfp: { imageId, sha256: null } } });
  it('no act before the being has spoken; no act with nothing to agree to', () => {
    expect(lockStateOf({ locked: false, agreed: { being: null, operator: null }, candidates: plate('x') }).awaitingYou)
      .toBe(false);
    expect(lockStateOf({ locked: false, agreed: { being: { at: 't' }, operator: null }, candidates: {} }).awaitingYou)
      .toBe(false);
  });
  it('awaitingYou when the being championed AND agreed', () => {
    const s = lockStateOf({ locked: false, agreed: { being: { at: 't' }, operator: null }, candidates: plate('img-1') });
    expect(s.awaitingYou).toBe(true);
    expect(s.candidates).toEqual([{ register: 'anime', plate: 'pfp', imageId: 'img-1' }]);
  });
  it('locked stands for withdraw; both agreed reads locked', () => {
    expect(lockStateOf({ locked: true }).locked).toBe(true);
  });
});
