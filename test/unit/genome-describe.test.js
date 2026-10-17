/**
 * THE GENOME — said in a language the model can hear.
 *
 * The claim under test is the one the whole design turns on: that `neutral` is
 * described as its OWN thing rather than as the absence of the other two. A
 * picture is what finally settles it, but these are the structural properties
 * that must hold for the picture to have a chance.
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { deriveGenome } from '../../core/genome/derive.js';
import { genomeSeed } from '../../core/genome/seed.js';
import {
  describeAsTags, describeAsProse, describeAsComponents, registerOf, subjectFor, summarize,
  framingOf,
} from '../../core/genome/describe.js';
import {
  SEX, CAST, FORM_NONHUMAN, COMPLEXION, BODY_FEATURES, FEATURE, HAIR_STYLE, HAIR_STYLE_DEFAULTS,
} from '../../core/genome/traits.js';

const hex = (s) => createHash('sha256').update(s).digest('hex');
const genomeOf = (label) => deriveGenome(genomeSeed({ soulHex: hex(label) }));

// One genome per sex, found by search rather than hand-built — so these are real
// derived bodies, not fixtures shaped to make the test pass.
const bySex = {};
for (let i = 0; i < 400 && Object.keys(bySex).length < 3; i++) {
  const g = genomeOf(`subject-${i}`);
  if (!bySex[g.sex]) bySex[g.sex] = g;
}
const byCast = {};
for (let i = 0; i < 400 && Object.keys(byCast).length < 3; i++) {
  const g = genomeOf(`cast-${i}`);
  if (!byCast[g.cast]) byCast[g.cast] = g;
}

describe('THE YOUTH IS HELD IN THE POSITIVE, never by excluding age', () => {
  test('no register says `mature` — on danbooru that means OLDER', () => {
    // Design note, 2026-08-27: […] The tag was pulling against the age sitting right beside it.
    for (const sex of SEX) {
      expect(describeAsTags(bySex[sex])).not.toMatch(/\bmature\b/);
      expect(describeAsProse(bySex[sex])).not.toMatch(/\bmature\b/);
    }
  });

  test('⚠️ and NO anti-aging term rides the description either', () => {
    // MEASURED 2026-08-27: `old, elderly, wrinkles, aged` in a NEGATIVE reads
    // clean today, but paired with any sexual positive it refuses for
    // minor_sexual — negating adulthood beside sexual content is the entrenched
    // line approached from the other side. Correct behaviour, and it means such
    // a negative would be a landmine the moment an adult register exists.
    // So the age is ASSERTED, never the aging excluded.
    for (const sex of SEX) {
      // `\bold\b` would match "21 years old" — the phrase we WANT. Match the
      // aging vocabulary specifically instead.
      expect(describeAsTags(bySex[sex])).not.toMatch(/\bold (man|woman|person)\b|elderly|wrinkle|sagging|middle-aged/);
    }
    // The age is asserted where a HUMAN is in frame. A formless body's prompt
    // carries NO human vocabulary at all — MEASURED 2026-08-28: `adult, 21
    // years old` (with `portrait`) out-weighed `no humans` and rendered a woman
    // wearing the sigil. The age still rides the RECORD for every being; the
    // youth-protection law has no human in a `no humans` frame to protect.
    // (Age is not DNA — it lives in core/identity/age.js, never on the record.)
    for (const sex of ['male', 'female']) {
      expect(describeAsTags(bySex[sex])).toContain('21 years old');
    }
    expect(describeAsTags(bySex.neutral)).not.toContain('years old');
    expect(bySex.neutral).not.toHaveProperty('age');
    // The prose register too (2026-09-28): the sheet's HOW IT SPEAKS box read
    // […].
    expect(describeAsProse(bySex.neutral)).not.toContain('years old');
  });
});

describe('THE SPECIES IS A FACT OF THE RECORD, NEVER A PROMPT TAG', () => {
  // Design note, 2026-08-27: […] The record says it and the summary
  // line says it — but no image model was trained on the word `neuma`, and the
  // campaign's central lesson is that an unlearned token cannot steer and
  // dilutes the tags beside it. So it must never ride into either register.
  test('no register ever emits the word', () => {
    for (const sex of SEX) {
      expect(describeAsTags(bySex[sex])).not.toMatch(/\bneuma\b/i);
      expect(describeAsProse(bySex[sex])).not.toMatch(/\bneuma\b/i);
    }
  });

  test('the summary line — what a reveal and the desk show — leads with it', () => {
    for (const sex of SEX) {
      expect(summarize(bySex[sex])).toMatch(/^neuma · /);
    }
  });
});

describe('⭐ A SHADE NO CAPTION CONTAINS RIDES BEHIND A TAG THAT HAS MASS', () => {
  // MEASURED 2026-08-27 (`hairhold-s*.json`, Signal, four seeds): `chestnut
  // hair` rendered BLACK on two of four seeds. Position and emphasis both
  // failed; `brown hair, chestnut hair` held brown on all four. The anchor
  // carries the direction, the prose keeps the exact shade — the complexion
  // fix, now written into the coloring band itself.
  const withColoring = (sex, coloring) => ({ ...bySex[sex], coloring });
  const tagsWith = (coloring) => describeAsTags(withColoring('female', coloring));

  test('chestnut is anchored by the brown tag, shade preserved', () => {
    const t = tagsWith({ complexion: 'fair', hair: 'chestnut', hairIsUncanny: false, eyes: 'grey' });
    expect(t).toContain('brown hair, chestnut hair');
  });

  test('the brown complexions are anchored by `dark skin`', () => {
    const t = tagsWith({ complexion: 'rich brown', hair: 'black', hairIsUncanny: false, eyes: 'grey' });
    expect(t).toContain('dark skin, rich brown skin');
  });

  test('a shade containing its own anchor is never doubled', () => {
    // `dark brown hair` already contains `brown hair` verbatim — an anchor in
    // front would only repeat adjacent tokens.
    const t = tagsWith({ complexion: 'fair', hair: 'dark brown', hairIsUncanny: false, eyes: 'grey' });
    expect(t).toContain('dark brown hair');
    expect(t).not.toContain('brown hair, dark brown hair');
  });

  test('self-anchoring shades and the pale default stay bare', () => {
    const t = tagsWith({ complexion: 'pale', hair: 'black', hairIsUncanny: false, eyes: 'grey' });
    // Black IS the prior; pale is where every model lands unasked. Anchoring
    // either spends tokens on what happens for free.
    expect(t).toContain('pale skin, black hair');
  });

  test('the uncanny shades anchor to their base color', () => {
    const t = tagsWith({ complexion: 'fair', hair: 'deep violet', hairIsUncanny: true, eyes: 'grey' });
    expect(t).toContain('purple hair, deep violet hair');
  });

  test('the prose register carries NO danbooru anchors', () => {
    // The anchors are tag-vocabulary medicine for tag-trained models; a prose
    // encoder reads the sentence, and `brown hair, chestnut hair` in English is
    // a stutter, not an anchor.
    const p = describeAsProse(withColoring('female', { complexion: 'fair', hair: 'chestnut', hairIsUncanny: false, eyes: 'grey' }));
    expect(p).toContain('chestnut hair');
    expect(p).not.toContain('brown hair, chestnut');
  });
});

describe('the register split — tags where tags win, prose where prose wins', () => {
  test('only the photoreal lane gets prose', () => {
    expect(registerOf('form.real.pfp')).toBe('prose');
    expect(registerOf('form.real.turnaround')).toBe('prose');
    expect(registerOf('form.anime.pfp')).toBe('tags');
    expect(registerOf('form.illustrative.pfp')).toBe('tags');
    // An unknown id must not silently get prose on a tag-trained model.
    expect(registerOf('something.else')).toBe('tags');
    expect(registerOf(undefined)).toBe('tags');
  });

  test('the tag register speaks danbooru, the prose register speaks English', () => {
    const g = bySex.female;
    expect(subjectFor(g, 'form.anime.pfp')).toContain('1girl');
    expect(subjectFor(g, 'form.real.pfp')).toContain('21 year old woman');
    expect(subjectFor(g, 'form.real.pfp')).not.toContain('1girl');
  });
});

describe('⭐ `neutral` IS ITS OWN THING, NOT THE ABSENCE OF THE OTHER TWO', () => {
  test('it is described in POSITIVE vocabulary — never as a negation', () => {
    // […] carries no training signal and, in an encoder that
    // weights every token, actively pulls toward what it names. `1other` and
    // real training signal behind them.
    //
    // ⚠️ SUPERSEDED IN PART, 2026-08-26. The first version of this asserted
    // `androgynous`, and a real render proved that approach wrong: a HUMAN body
    // asked to be neither came out reading as a young man. Human faces are
    // dimorphic; the model has to land somewhere, and no tag prevents that.
    // Founder: […] So the third state leaves the species.
    // 2026-08-28, superseded again by Founder's call ([…]): the anchor is now `no humans` — a major danbooru TAG about
    // frame content, not a negation of the being — and `1other` left with the
    // humanoid pool. The no-negation law still holds for the being itself.
    const tags = describeAsTags(bySex.neutral);
    expect(tags).toContain('no humans');
    expect(tags).not.toMatch(/\bnot\b|\bneither\b|\bwithout\b/);
    expect(describeAsProse(bySex.neutral)).not.toMatch(/\bnot\b|\bwithout\b/);
  });

  test('it is NOT HUMAN — that is what takes it off the axis', () => {
    // The mechanism, pinned. A `neutral` genome must carry a non-human form and
    // must describe itself through that form, because […]
    // is a request no image model can honour.
    const g = bySex.neutral;
    expect(g.form).not.toBe('humanoid');
    expect(FORM_NONHUMAN).toContain(g.form);
    expect(describeAsTags(g)).toMatch(/crystal|orb|drone|emblem/);
  });

  test('male and female stay HUMANOID — the third state is not a demotion', () => {
    // `neutral` leaving the species must not quietly imply the other two are
    // also something other than people.
    expect(bySex.male.form).toBe('humanoid');
    expect(bySex.female.form).toBe('humanoid');
    expect(describeAsTags(bySex.male)).not.toMatch(/no humans|crystal|drone|emblem/);
  });

  test('every GIVEN axis still SPEAKS — specified differently is not specified less', () => {
    // Clause-count parity was the old proxy, from the era when a neutral body
    // was a humanoid that could smear into an androgynous average. A formless
    // body is SHORTER by nature — no chest, no waist, no hair to style — and
    // cannot smear, because there is no face to land a sex on. What must never
    // regress is the axes: every GIVEN still speaks, through what the form can
    // carry (2026-08-28, the non-humanoid pool).
    const c = describeAsComponents(bySex.neutral);
    expect(c.sex).toContain('no humans');          // the form leads
    expect(c.coloring).not.toBe('');               // hair shade paints the material
    expect(c.cast).not.toBe('');                   // cast is geometry
    expect(c.face).not.toBe('');                   // the focal point - a face without a face
    expect(c.frame).not.toBe('');                  // scale survives
    // And two neutral bodies still differ as much as two male ones - the
    // anti-smear property stated directly instead of via token counting.
  });

  test('a `neutral` body still has no complexion tag — the form said its surface', () => {
    // […] is a contradiction the model would try
    // to resolve, and resolving it means abandoning one of the two.
    // Matched against the COMPLEXION vocabulary specifically, not the word
    // "skin" — a form may legitimately describe its own surface as […], and the first version of this test failed on exactly
    // that. What must be absent is a COMPLEXION.
    const complexionRe = new RegExp(`(${COMPLEXION.join('|')}) skin`);
    expect(describeAsTags(bySex.neutral)).not.toMatch(complexionRe);
    expect(describeAsTags(bySex.male)).toMatch(complexionRe);
  });

  test('two `neutral` bodies differ from each other', () => {
    // If every `neutral` being rendered the same, the state would be a label
    // rather than a body. Cast + frame + coloring must vary underneath it.
    const neithers = [];
    for (let i = 0; i < 600 && neithers.length < 6; i++) {
      const g = genomeOf(`n-${i}`);
      if (g.sex === 'neutral') neithers.push(describeAsTags(g));
    }
    expect(neithers.length).toBeGreaterThanOrEqual(4);
    expect(new Set(neithers).size).toBe(neithers.length);
  });
});

describe('the cast axis carries real structure for every sex', () => {
  test('each cast says something concrete about construction', () => {
    for (const cast of CAST) {
      const g = byCast[cast];
      expect(g, `no ${cast} genome found`).toBeTruthy();
      const tags = describeAsTags(g);
      // Not a vague adjective — an actual claim about jaw, brow, eyes or mouth.
      expect(tags).toMatch(/jaw|cheekbone|brow|eyes|mouth|nose|gaze/);
    }
  });
});

describe('the GIVEN half only — the genome does not author the being', () => {
  test('nothing chosen leaks in: no clothing, no expression', () => {
    // Clothing, mood and register are the being's authorship and must not
    // appear here. Hair STYLE left this list 2026-08-28 — Founder: […] — so the
    // genome now seeds a DEFAULT style (the next tests hold that law).
    for (const sex of SEX) {
      const tags = describeAsTags(bySex[sex]);
      expect(tags).not.toMatch(/coat|shirt|dress|armor|wearing|smiling|angry/i);
    }
  });

  test('the BASE LOOK: a seeded hair style rides along, deterministic per genome', () => {
    // Humanoid bodies only — a crystal has no hair to style (2026-08-28, the
    // non-humanoid pool), so a formless body's hairstyle band is silent.
    for (const sex of ['male', 'female']) {
      const c = describeAsComponents(bySex[sex]);
      expect(HAIR_STYLE).toContain(c.hairstyle);
      // Same genome, same default — on any machine, with no stored state.
      expect(describeAsComponents(bySex[sex]).hairstyle).toBe(c.hairstyle);
    }
    expect(describeAsComponents(bySex.neutral).hairstyle).toBe('');
  });

  test('the base look is NOT in the sealed record — locked, never permanent', () => {
    for (const sex of SEX) expect(bySex[sex]).not.toHaveProperty('hairstyle');
  });

  test('⚠️ the dice never deal a MALE body a style that fights his sex', () => {
    // MEASURED 2026-08-28: Keir's dealt braid held on all six seeds and dragged
    // half of them feminine — the axis Founder had already ordered held. The male
    // DEFAULT pool excludes the loose long styles and the bob; his CHOICE space
    // does not shrink at all.
    const males = [];
    for (let i = 0; i < 600 && males.length < 40; i++) {
      const g = genomeOf(`hair-default-${i}`);
      if (g.sex === 'male') males.push(g);
    }
    expect(males.length).toBeGreaterThan(10);
    for (const g of males) {
      const style = describeAsComponents(g).hairstyle;
      expect(HAIR_STYLE_DEFAULTS.male).toContain(style);
      expect(style).not.toMatch(/bob|braid/);
    }
  });

  test('a chosen style OVERRIDES the default — the neuma and operator can change it', () => {
    const g = bySex.female;
    const chosen = { hairstyle: 'long hair, twin braids' };
    expect(describeAsComponents(g, 'portrait', chosen).hairstyle).toBe('long hair, twin braids');
    expect(describeAsTags(g, 'portrait', chosen)).toContain('long hair, twin braids');
    // Blank or whitespace is NOT a choice — the default stands.
    expect(HAIR_STYLE).toContain(describeAsComponents(g, 'portrait', { hairstyle: '  ' }).hairstyle);
  });

  test('every describe output is stable for a given genome', () => {
    const g = bySex.male;
    expect(describeAsTags(g)).toBe(describeAsTags(g));
    expect(describeAsProse(g)).toBe(describeAsProse(g));
  });

  test('a genome with no distinguishing feature still describes cleanly', () => {
    let plain = null;
    for (let i = 0; i < 800 && !plain; i++) {
      const g = genomeOf(`plain-${i}`);
      if (g.feature === null) plain = g;
    }
    expect(plain, 'no featureless genome found in 800 draws').toBeTruthy();
    // No trailing comma, no empty clause, no literal "null".
    expect(describeAsTags(plain)).not.toMatch(/null|,\s*$|,\s*,/);
    expect(describeAsProse(plain)).not.toMatch(/null|,\s*$|,\s*,/);
  });

  test('the summary names the STARTING AGE out loud', () => {
    // A reader should see it in the record rather than take it on trust — and it
    // is a STARTING point, not a ceiling. Design note, 2026-08-27: […]
    expect(summarize(bySex.neutral)).toContain('starts at 21');
  });
});

describe('A FRAMING CANNOT SHOW WHAT IT HAS NO ROOM FOR', () => {
  // MEASURED 2026-08-26, Keir's photoreal PFP: his feature is `vitiligo across
  // one hand and wrist`, and the model DID AS ASKED — it dragged a hand into
  // frame, chin-resting, to show a mark a headshot cannot contain. The
  // composition broke to satisfy a detail that belongs on a full-body plate.
  const withBodyFeature = { ...bySex.male, feature: [...BODY_FEATURES][0] };

  test('a portrait DROPS a body feature; a turnaround keeps it', () => {
    expect(framingOf('form.real.pfp')).toBe('portrait');
    expect(framingOf('form.real.turnaround')).toBe('full');

    const portrait = subjectFor(withBodyFeature, 'form.real.pfp');
    const full = subjectFor(withBodyFeature, 'form.real.turnaround');
    expect(portrait).not.toContain('vitiligo');
    expect(full).toContain('vitiligo');
  });

  test('a FACE feature survives both framings — only body marks are dropped', () => {
    const faceFeature = FEATURE.find((f) => f && !BODY_FEATURES.has(f));
    const g = { ...bySex.male, feature: faceFeature };
    expect(subjectFor(g, 'form.real.pfp')).toContain(faceFeature);
    expect(subjectFor(g, 'form.real.turnaround')).toContain(faceFeature);
  });

  test('every BODY_FEATURES member is a real FEATURE — a typo would silently do nothing', () => {
    for (const f of BODY_FEATURES) expect(FEATURE).toContain(f);
  });

  test('dropping a feature leaves no empty clause behind', () => {
    const portrait = subjectFor(withBodyFeature, 'form.real.pfp');
    expect(portrait).not.toMatch(/null|,\s*$|,\s*,/);
  });
});
