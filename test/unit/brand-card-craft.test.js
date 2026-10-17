// THE CARDS AS THE STANDARD — the craft decisions, pinned.
//
// Design note, 2026-08-31: […]
//
// The six cards were tuned over a long session of visual review, one correction
// at a time, until the geometry read as deliberate. `brand-card-frame-fit.test.js`
// proves nothing OVERFLOWS. Nothing proved the decisions themselves — so every
// rhythm below could have drifted card by card, silently, exactly the way the
// corner brackets had already drifted into three different frames before
// anybody noticed.
//
// What is pinned here is what the six cards genuinely SHARE. It is deliberately
// not a freeze on the whole design: each card's HERO size is tuned against its
// own character budget and must stay tunable. What must not move is the
// scaffolding a reader's eye uses to recognise these as one family — the
// footer, the eyebrow, the signature, and which cards are allowed to carry a
// timestamp.
//
// Rule 0: no mocks. Every assertion reads the real template SVGs on disk.

import { describe, expect, test } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { listTemplates, loadTemplate, templatesDir } from '../../backend/services/branding/brand-tokens.js';

const svgOf = async (name) => readFile(path.join(templatesDir(), `${name}.svg`), 'utf8');

/** Every <text> on a card, with the size it is actually drawn at. Pure.
 *  ⚠️ font-size is often set on the wrapping <g>, not the <text> — the eyebrow
 *  on all six cards is. A scan that only reads <text> attributes misses it and
 *  concludes the card has no eyebrow at all. */
const textRuns = (svg) => {
  const runs = [];
  for (const g of svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
    const inherited = (g[1].match(/font-size="(\d+)"/) || [])[1];
    for (const t of g[2].matchAll(/<text\b([\s\S]*?)>([\s\S]*?)<\/text>/g)) {
      const own = (t[1].match(/font-size="(\d+)"/) || [])[1];
      if (own || inherited) runs.push({ size: Number(own || inherited), body: t[2].trim() });
    }
  }
  for (const t of svg.matchAll(/<text\b([\s\S]*?)>([\s\S]*?)<\/text>/g)) {
    const own = (t[1].match(/font-size="(\d+)"/) || [])[1];
    if (own && !runs.some((r) => r.body === t[2].trim() && r.size === Number(own))) {
      runs.push({ size: Number(own), body: t[2].trim() });
    }
  }
  return runs;
};

// Eleven cards, including changelog and platform-listing. The `quote`, `statement` and `explainer` cards
// joined here deliberately — this list failing is exactly how a new card is
// forced to face every law below rather than quietly shipping beside them.

/** The attributes that actually reach the eyebrow, from wherever they are set.
 *
 * ⚠️ THIS USED TO REQUIRE A WRAPPING <g>, WHICH IS THE WRONG QUESTION. The six
 * original cards happen to set the tier on a group — milestone because its
 * group also holds two flanking rules — so a check written against those six
 * mistook the construct for the law. `quote` and `explainer` set the same three
 * values directly on the <text>, draw an identical eyebrow, and failed.
 *
 * The law is what the reader sees: 46px, the brand's label tracking, in trimHot.
 * Where the SVG puts those is a detail of how the card was written. So this
 * gathers both, and separately refuses a <text> that OVERRIDES a group's size —
 * which the old check could not have caught at all. */
const eyebrowAttrs = (svg) => {
  const own = svg.match(/<text\b([^>]*)>\s*\{\{data\.eyebrow\}\}/);
  const inherited = [...svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)]
    .filter((g) => g[2].includes('{{data.eyebrow}}'))
    .map((g) => g[1]);
  const ownSize = own && own[1].match(/font-size="(\d+)"/);
  // A text that sets its own size wins over the group, so if it disagrees the
  // card does not draw the tier the group claims.
  if (ownSize && ownSize[1] !== '46') return `font-size="${ownSize[1]}" OVERRIDDEN`;
  return [own ? own[1] : '', ...inherited].join(' ');
};

const ALL = [
  'announcement', 'explainer', 'launch', 'listing', 'milestone',
  'partnership', 'quote', 'statement', 'stat', 'changelog', 'platform-listing',
].sort();

describe('the cards are one family', () => {
  test('explainer prose uses the stat column origins and dividers', async () => {
    const stat = (await svgOf('stat')).replace(/<!--[\s\S]*?-->/g, '');
    const explainer = (await svgOf('explainer')).replace(/<!--[\s\S]*?-->/g, '');
    const origin = (svg, field) => {
      const text = [...svg.matchAll(/<text\b([^>]*)>\s*\{\{data\.(\w+)\}\}/g)]
        .find((match) => match[2] === field);
      expect(text, `${field} must be drawn`).toBeTruthy();
      return Number(text[1].match(/\bx="(\d+)"/)[1]);
    };
    for (const [i, cell] of ['a', 'b', 'c'].entries()) {
      const x = origin(stat, `${cell}Value`);
      expect(x).toBe([128, 608, 1056][i]);
      for (const suffix of ['Label', 'One', 'Two']) {
        expect(origin(explainer, `${cell}${suffix}`)).toBe(x);
      }
    }
    for (const svg of [stat, explainer]) {
      for (const x of [576, 1024]) {
        expect(svg).toContain(`<line x1="${x}" y1="392" x2="${x}" y2="648"`);
      }
    }
  });

  test('the family is exactly this list, and nothing joins it by accident', async () => {
    // A new template must be added here deliberately — and every law below
    // then applies to it. A card that quietly skips the house rhythm is how a
    // family stops looking like one. This has already earned its keep once:
    // adding the voice cards failed here first, which is what forced their
    // footer, eyebrow and signature to be checked against the other six.
    expect((await listTemplates()).sort()).toEqual(ALL);
  });

  test('every card wears the identical footer', async () => {
    // Founder, on getting this right: […]
    //
    // ⚠️ This drifted once already. The launch card was built on an inset frame
    // (96/1504/804) and inherited the shared footer rhythm anyway, which put its
    // wordmark and timestamp OUTSIDE its own brackets.
    for (const name of ALL) {
      const svg = await svgOf(name);
      expect(svg, `${name}: footer rule is not at y=757`)
        .toMatch(/<line x1="128" y1="757" x2="1472" y2="757"/);
      expect(svg, `${name}: the wordmark is not in the house box`)
        .toContain('{{mark.wordmark}}" x="128" y="775" width="400" height="54"');
      expect(svg, `${name}: the right-hand footer line is not on the 814 baseline`)
        .toMatch(/<text x="1472" y="814"/);
    }
  });

  test('every card sets its eyebrow in the same tier', async () => {
    // The eyebrow is the line that says WHAT THE CARD IS, and it is the one
    // piece of type held to the mobile floor on every card: 46px, which clears
    // 11 CSS px at feed size. Mono, on the brand's own label tracking, in the
    // hot trim colour.
    for (const name of ALL) {
      const svg = await svgOf(name);
      const block = eyebrowAttrs(svg);
      expect(block, `${name} draws no eyebrow`).toBeTruthy();
      expect(block, `${name}: eyebrow is not 46px`).toContain('font-size="46"');
      expect(block, `${name}: eyebrow does not carry the brand's label tracking`)
        .toContain('letter-spacing="{{font.labelTrack}}"');
      expect(block, `${name}: eyebrow is not drawn in trimHot`).toContain('fill="{{token.trimHot}}"');
    }
  });

  test('the brand signs with its MARK, never its name in a font', async () => {
    // Design note, 2026-08-31: […]
    //
    // The launch card used to set the company name as <text>. A wordmark is
    // drawn artwork with its own spacing and weight; the same name typed in the
    // display face is a different mark, and putting one where the other belongs
    // is the plainest kind of brand violation.
    for (const name of ALL) {
      const svg = await svgOf(name);
      expect(svg, `${name} does not sign with the wordmark`).toContain('{{mark.wordmark}}');
      expect(svg, `${name} sets the brand NAME as type — use the wordmark`)
        .not.toMatch(/<text[\s\S]{0,300}?\{\{brand\.name\}\}/);
    }
  });
});

describe('a timestamp is the provenance of a MEASUREMENT', () => {
  test('only the two cards that draw a measured number carry asOf', async () => {
    // Design note, 2026-08-31: […]
    //
    // A stamp on a launch card answers a question nobody asked and reads as a
    // claim about when something was true. On a TVL figure it is the difference
    // between a fact and an assertion.
    const carries = [];
    for (const name of ALL) {
      const { spec } = await loadTemplate(name);
      if (spec.fields?.asOf) carries.push(name);
    }
    expect(carries.sort()).toEqual(['milestone', 'stat']);
  });

  test('and the cards that carry it draw it, rather than merely declaring it', async () => {
    for (const name of ['milestone', 'stat']) {
      expect(await svgOf(name), `${name} declares asOf but never draws it`)
        .toMatch(/AS OF \{\{data\.asOf\}\}/);
    }
  });
});

describe('the type scale is a scale, not a pile of sizes', () => {
  // ⚠️ THE HONEST VERSION. An earlier draft of rule 9 claimed […] were all held to the 46px mobile floor. Reading the shipped
  // cards, only the EYEBROW is. What the six actually hold is a six-tier scale,
  // and pretending otherwise would make the standard describe a card nobody
  // drew. The doc now says what these tests check.
  const SECONDARY = [30, 34, 36, 38, 42, 46];

  test('every readable size belongs to the declared scale', async () => {
    for (const name of ALL) {
      for (const run of textRuns(await svgOf(name))) {
        if (run.size >= 76) continue; // the hero tier, tuned per card
        expect(
          SECONDARY,
          `${name} draws "${run.body.slice(0, 32)}" at ${run.size}px — not a tier this family uses`,
        ).toContain(run.size);
      }
    }
  });

  test('the footer line is 34 everywhere, and nothing is smaller', async () => {
    // 34px is 8.3 CSS px in a phone feed — the quietest thing a reader is still
    // expected to be able to read, and it is the same on all six.
    for (const name of ALL) {
      const runs = textRuns(await svgOf(name));
      const smallest = Math.min(...runs.map((r) => r.size));
      expect(smallest, `${name} draws something at ${smallest}px`).toBeGreaterThanOrEqual(30);
      const footer = runs.filter((r) => /brand\.handle|AS OF/.test(r.body));
      expect(footer.length, `${name} has no footer line`).toBeGreaterThan(0);
      for (const line of footer) expect(line.size, `${name}: footer is ${line.size}px`).toBe(34);
    }
  });

  test('the hero of each card is unmistakably the hero', async () => {
    // Whatever the card is ABOUT is at least 76px — 18.5 CSS px on a phone,
    // where the next tier down is 11.2. The gap is what makes a card readable
    // at a glance in a feed rather than a paragraph you have to enter.
    for (const name of ALL) {
      const sizes = textRuns(await svgOf(name)).map((r) => r.size);
      expect(Math.max(...sizes), `${name} has no hero`).toBeGreaterThanOrEqual(76);
    }
  });

  // ⚠️ THE ONE BELOW THE LINE, kept visible rather than quietly excused.
  // stat's three column captions are 30px = 7.3 CSS px in a feed. Every other
  // readable thing on any card is 34 or above. They are captions under figures
  // that are themselves 76px, so the number carries the meaning and the caption
  // names it — but this is the single place these cards ask the most of a small
  // screen. Pinned so a decision to lift it is a decision, not a drift.
  test('the smallest type on any card is stat\'s column captions, and nothing else', async () => {
    const below34 = [];
    for (const name of ALL) {
      for (const run of textRuns(await svgOf(name))) {
        if (run.size < 34) below34.push(`${name}:${run.body.slice(0, 20)}@${run.size}`);
      }
    }
    expect(below34.sort()).toEqual([
      'stat:{{data.aLabel}}@30', 'stat:{{data.bLabel}}@30', 'stat:{{data.cLabel}}@30',
    ]);
  });
});

describe('the mask is composition, not decoration', () => {
  test('every card that cuts the mark cuts it in the SAME place', async () => {
    // Design note, 2026-08-31: […]
    //
    // The SVG root clips to the viewBox, so a 1180px mark placed at x=1010 on a
    // 1600px card is cut exactly in half by the frame itself. That is why the
    // numbers are worth pinning: they are not a position, they are a CUT.
    // ⚠️ THREE now, not two — `quote` joined on 2026-09-01. Founder: […] The numbers are not a position, they are a CUT: a 1180px mark at
    // x=1010 on a 1600px card is halved by the frame itself, and it only reads
    // as deliberate if every card that does it uses the identical geometry.
    for (const name of ['announcement', 'launch', 'quote']) {
      expect(await svgOf(name), `${name}'s mask has moved off the bleed`)
        .toContain('{{mark.mask}}" x="1010" y="-140" width="1180" height="1180"');
    }
  });

  test('a mask used as a WATERMARK is faint; used as a LOCKUP it is not', async () => {
    // ⚠️ The mask plays two different parts and the difference is opacity.
    //
    // On four cards it sits BEHIND the copy as ornament, and must stay faint or
    // it fights the figure in front of it. On `partnership` the same artwork is
    // the HOST BRAND'S MARK in the lockup — a foreground element standing
    // beside the partner's logo at full strength. Asserting one rule over both
    // would either wash out the lockup or licence a watermark loud enough to
    // make a card unreadable.
    const lockup = [];
    for (const name of ALL) {
      const svg = await svgOf(name);
      if (!svg.includes('{{mark.mask}}')) continue;
      const mask = svg.match(/<image href="\{\{mark\.mask\}\}"[\s\S]{0,260}?\/>/)[0];
      const declared = mask.match(/opacity="([\d.]+)"/);
      if (!declared) { lockup.push(name); continue; }
      expect(
        Number(declared[1]),
        `${name}'s watermark is at ${declared[1]} — it will fight the copy`,
      ).toBeLessThanOrEqual(0.2);
    }
    // Exactly one card uses it at full strength, and it is the one whose whole
    // composition is two marks facing each other across a reticle.
    expect(lockup).toEqual(['partnership']);
  });
});

describe('one ground under every card', () => {
  // Design note, 2026-09-01: […]
  //
  // An audit for that request found the family was running THREE different
  // ground treatments, and — the part worth saying plainly — the six approved
  // cards were already inconsistent among themselves before the voice cards
  // landed. This was never […]. It was a
  // spread nobody had counted.
  //
  // These pin what the family now shares and NAME what it does not, the same
  // way the sub-34 type tier is pinned by name. A list of exceptions that can
  // only shrink is a plan; one that can silently grow is how this happened.

  test('the ground is a 26px DOT grid — the one card without it is named', async () => {
    // Dots read as texture you feel; a 40px ruled grid reads as graph paper you
    // are being asked to look at. Founder picked the dot cards as the strong ones.
    const without = [];
    for (const name of ALL) {
      if (!(await svgOf(name)).includes('<pattern id="grid" width="26"')) without.push(name);
    }
    // TWO holdouts, both approved artwork:
    //   launch     draws no grid at all — the one card built around a single
    //              full-bleed statement with a half-cut mark and nothing else.
    //   milestone  still draws the 40px RULED grid, the last card that does.
    // Both are Founder's to change, not a test's. The list may shrink; it may not
    // grow, which is the whole point of writing it down.
    expect(without.sort()).toEqual(['launch', 'milestone']);
  });

  test('only ONE card draws an inner frame, and it is the one that earned it', async () => {
    // Four corner marks read as an instrument sighting on something; a closed
    // box reads as a border and shrinks the card it holds. `announcement` — the
    // card Founder pointed at — draws corners only.
    const boxed = [];
    for (const name of ALL) {
      if ((await svgOf(name)).includes('rect x="24" y="24" width="1552"')) boxed.push(name);
    }
    // milestone's double frame is deliberate and Founder approved the composition
    // it belongs to ([…]). Nothing else may join it.
    expect(boxed).toEqual(['milestone']);
  });

  test('the diagonal corner wash is spreading, and the holdouts are listed', async () => {
    // ⚠️ THE ONE STILL IN MOTION. accentGlow rising from the bottom-left corner,
    // against the older vertical top-and-bottom edge. Five cards carry it. The
    // remaining four are approved artwork and changing them is Founder's call, not
    // a test's — so this records the state rather than forcing it.
    const missing = [];
    for (const name of ALL) {
      if (!(await svgOf(name)).includes('x1="0" y1="1" x2="1" y2="0"')) missing.push(name);
    }
    expect(missing.sort()).toEqual(['launch', 'milestone', 'partnership', 'stat']);
  });

  test('every card that lets type cross its mark glows that type', async () => {
    // The lesson both voice cards taught, an hour apart: a large mark and a
    // glowed hero are ONE decision. Type over artwork without a blurred
    // underlay is a collision, not a layer — measured on `explainer`, where a
    // full-length headline tangled in the mark's face while every other guard
    // read green. The frame test measures whether type fits the FRAME; nothing
    // measures whether it fits the ARTWORK.
    for (const name of ['announcement', 'quote', 'statement', 'explainer']) {
      const svg = await svgOf(name);
      expect(svg, `${name} has no softGlow filter`).toContain('filter id="softGlow"');
      expect(svg, `${name} declares the filter but never uses it`).toContain('filter="url(#softGlow)"');
    }
  });
});
