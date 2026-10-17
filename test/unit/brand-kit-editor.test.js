// The pure rules behind the rebuilt BRAND KITS panel.
//
// Every module here decides what an operator SEES or what a save WRITES, so
// each is testable without mounting React — and each is checked against the two
// brand kits that genuinely exist on disk. A parser that cannot read what
// Umbrae and Ignis already carry is a parser that would silently reset their
// typography the first time somebody opened the panel.
//
// Rule 0: no mocks. The kits below are read off disk.

import { describe, expect, test } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { KIT_SECTIONS, kitReadiness } from '../../backend/services/branding/kit-readiness.js';
import { kitForm } from '../../backend/services/branding/kit-form.js';
import { families } from '../../backend/services/branding/font-registry.js';
import { kitSkeleton } from '../../backend/services/branding/kit-store.js';
import {
  holds, sectionProgress, overallProgress, firstUnfinished, canon, isDirty,
} from '../../frontend/app/RelinkShell/brandkits/kit-progress.js';
import {
  setPath, unsetPath, atPath, kitSwitcherOptions, colorRolesOf,
} from '../../frontend/app/RelinkShell/brandkits/brand-kits-view.js';
import {
  firstFamily, composeStack, faceStanding, deriveEmbedFonts, familyOptions, weightOptions,
  TYPE_ROLES, EMBEDDED, FAMILY_ONLY, NOT_VENDORED,
} from '../../frontend/app/RelinkShell/brandkits/type-roles.js';
import {
  parseColor, contrastRatio, contrastVerdict,
} from '../../frontend/app/RelinkShell/brandkits/contrast.js';
import { bandsOf, measurablePairs } from '../../frontend/app/RelinkShell/brandkits/colour-bands.js';

const BRANDS = path.join(process.cwd(), 'backend/services/branding/brands');
const kitOf = async (brand) =>
  JSON.parse(await readFile(path.join(BRANDS, brand, 'tokens.json'), 'utf8'));

// ---------------------------------------------------------------- progress

describe('the rail counts the same way the gate does', () => {
  test("the client's holds() agrees with the server's, field for field", async () => {
    // ⚠️ kit-progress.js carries a SECOND COPY of the gate's rule, so the rail
    // can move as you type instead of only on save. This is the pin that makes
    // the copy a cache rather than a fork. If it ever fails, the panel is
    // telling somebody they are finished when the gate disagrees.
    const form = kitForm();
    const kits = [
      await kitOf('umbrae'), await kitOf('ignis'), kitSkeleton('acme'), {}, { colors: {}, type: {} },
    ];
    for (const kit of kits) {
      const server = kitReadiness(kit);
      const serverDone = server.sections.reduce((n, s) => n + s.done, 0);
      expect(overallProgress(form, kit).done).toBe(serverDone);
      // ...and field by field, so a compensating pair of errors cannot pass.
      const serverGaps = new Set(server.missing.map((m) => m.path));
      const clientGaps = new Set(sectionProgress(form, kit).flatMap((s) => s.gaps));
      expect([...clientGaps].sort()).toEqual([...serverGaps].sort());
    }
  });

  test('every kind the gate knows is a kind the rail knows', () => {
    const kinds = new Set(KIT_SECTIONS.flatMap((s) => s.fields.map((f) => f.kind)));
    for (const kind of kinds) {
      // A kind holds() does not recognise returns false forever, so a filled-in
      // field would read as a permanent gap.
      expect(holds(SATISFYING[kind], kind), `holds() cannot satisfy "${kind}"`).toBe(true);
    }
  });

  test('it opens on the first section that still needs something', async () => {
    const form = kitForm();
    expect(firstUnfinished(form, {})).toBe('identity');
    // Ignis carries colours, type and marks but none of the written half.
    expect(firstUnfinished(form, await kitOf('ignis'))).toBe('identity');
    expect(firstUnfinished(form, { ...(await kitOf('ignis')), name: 'X', handle: '@x', owner: 'metidar' }))
      .toBe('positioning');
    // A COMPLETE kit has no gap to open on, so it falls back to the first
    // section rather than to nothing — Umbrae is 41/41 today.
    expect(firstUnfinished(form, await kitOf('umbrae'))).toBe('identity');
  });
});

const SATISFYING = { text: 'x', list: [], list1: ['x'], number: 1, boolean: false, object: { a: 1 } };

describe('the unsaved pip tells the truth', () => {
  test('typing a character and deleting it puts it back out', () => {
    const saved = { name: 'Acme', colors: { bg: '#000' } };
    let draft = setPath(saved, 'name', 'AcmeX');
    expect(isDirty(draft, saved)).toBe(true);
    draft = setPath(draft, 'name', 'Acme');
    expect(isDirty(draft, saved)).toBe(false);
  });

  test('key ORDER is not a change — setPath rebuilds objects', () => {
    // Without a key-sorted compare this is the bug: JSON.stringify preserves
    // insertion order, so re-setting a field would read as dirty forever.
    expect(canon({ a: 1, b: 2 })).toBe(canon({ b: 2, a: 1 }));
    expect(isDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
  });

  test('a real change is still a change', () => {
    expect(isDirty({ a: 1 }, { a: 2 })).toBe(true);
    expect(isDirty({ a: [1, 2] }, { a: [2, 1] })).toBe(true);
  });
});

// ------------------------------------------------------------------- paths

describe('the three states of a list are genuinely three', () => {
  test('absent, empty and filled are all reachable and all distinct', () => {
    const none = {};
    const decided = setPath(none, 'disclosures', []);
    const filled = setPath(decided, 'disclosures', ['Not financial advice.']);
    const undone = unsetPath(filled, 'disclosures');

    expect(atPath(none, 'disclosures')).toBeUndefined();
    // ⚠️ [] must SURVIVE setPath. It is a real answer meaning somebody decided
    // there are none, and the gate reads it as satisfying `list`.
    expect(atPath(decided, 'disclosures')).toEqual([]);
    expect(holds(atPath(decided, 'disclosures'), 'list')).toBe(true);
    expect(holds(atPath(none, 'disclosures'), 'list')).toBe(false);
    expect(atPath(filled, 'disclosures')).toHaveLength(1);
    expect(atPath(undone, 'disclosures')).toBeUndefined();
  });

  test('an empty string still deletes, so "" never reads as decided', () => {
    expect(atPath(setPath({ tagline: 'x' }, 'tagline', '   '), 'tagline')).toBeUndefined();
  });

  test('unsetPath leaves the parent standing and never mutates its input', () => {
    const kit = { colors: { bg: '#000', ink: '#fff' } };
    const next = unsetPath(kit, 'colors.ink');
    expect(next.colors).toEqual({ bg: '#000' });
    expect(kit.colors.ink).toBe('#fff');
    // A path through nothing is a no-op, not a crash.
    expect(unsetPath({}, 'a.b.c')).toEqual({});
  });
});

describe('the switcher never renders empty on a value it holds', () => {
  test('a brand-new kit, absent from the server list, is still shown', () => {
    const options = kitSwitcherOptions([{ brand: 'umbrae', name: 'Umbrae', ready: true }], 'acme', 'Acme');
    expect(options.map((o) => o.value)).toEqual(['umbrae', 'acme']);
    expect(options[1].label).toMatch(/NOT SAVED YET/);
  });

  test('a saved kit is not doubled', () => {
    const options = kitSwitcherOptions([{ brand: 'umbrae', name: 'Umbrae' }], 'umbrae');
    expect(options).toHaveLength(1);
  });
});

// -------------------------------------------------------------------- type

describe('a face name is read out of a stack, and written back as one', () => {
  test('it reads what the two real kits actually carry', async () => {
    const umbrae = await kitOf('umbrae');
    const ignis = await kitOf('ignis');
    expect(firstFamily(umbrae.type.display)).toBe('Space Grotesk');
    expect(firstFamily(umbrae.type.data)).toBe('JetBrains Mono');
    expect(firstFamily(ignis.type.display)).toBe('Noto Sans Condensed Black');
    expect(firstFamily(ignis.type.voice)).toBe('Inter');
  });

  test('a stack it composes is a stack it can read back', () => {
    const stack = composeStack('Space Grotesk', 'system-ui, sans-serif');
    expect(stack).toBe("'Space Grotesk', system-ui, sans-serif");
    expect(firstFamily(stack)).toBe('Space Grotesk');
    // An unquoted single word stays unquoted, the way a designer writes it.
    expect(composeStack('Inter', 'sans-serif')).toBe('Inter, sans-serif');
  });
});

describe('the vendored badge has three states, and the middle one matters', () => {
  const FAMILIES = families();

  test('an exact family+weight pair is EMBEDDED', () => {
    const out = faceStanding(FAMILIES, "'Space Grotesk', system-ui", '300');
    expect(out.state).toBe(EMBEDDED);
    expect(out.faceId).toBe('grotesk-light');
  });

  test('a real family at a weight we do NOT carry is FAMILY_ONLY, never a near miss', () => {
    // ⚠️ Rajdhani ships at 600 and 700. Asking for 400 draws in a weight nobody
    // chose. Rounding to the nearest would hide exactly the drift the closed
    // registry exists to prevent.
    const out = faceStanding(FAMILIES, "'Rajdhani', Inter", '400');
    expect(out.state).toBe(FAMILY_ONLY);
    expect(out.faceId).toBeNull();
    expect(out.has).toEqual([600, 700]);
  });

  test('a family nobody vendored is NOT_VENDORED', () => {
    expect(faceStanding(FAMILIES, "'Helvetica Neue', sans-serif", '400').state).toBe(NOT_VENDORED);
  });

  test('both real kits resolve every one of their four roles to a real face', async () => {
    for (const brand of ['umbrae', 'ignis']) {
      const kit = await kitOf(brand);
      for (const role of TYPE_ROLES) {
        const slot = role.family.split('.')[1];
        const weight = role.weight.split('.')[1];
        const out = faceStanding(FAMILIES, kit.type[slot], kit.type[weight]);
        expect(out.state, `${brand}.${slot} at ${kit.type[weight]} is ${out.state}`).toBe(EMBEDDED);
      }
    }
  });
});

describe('embedFonts is derived, never accumulated', () => {
  const FAMILIES = families();

  test("Umbrae's derived set is exactly what its four roles resolve to", async () => {
    const kit = await kitOf('umbrae');
    // Space Grotesk 300 · Inter 300 · JetBrains Mono 400 (labels) · 300 (numerals).
    expect(deriveEmbedFonts(FAMILIES, kit))
      .toEqual(['grotesk-light', 'inter-light', 'mono-data', 'mono-light']);
    // And it is a SUBSET of what the kit embeds today — deriving may drop, and
    // must never invent a face the kit never asked for.
    for (const id of deriveEmbedFonts(FAMILIES, kit)) expect(kit.embedFonts).toContain(id);
  });

  test('it DROPS a face nothing draws — which is the state Ignis is in today', async () => {
    const kit = await kitOf('ignis');
    const derived = deriveEmbedFonts(FAMILIES, kit);
    // Ignis embeds six faces; three of them no type slot names. At roughly
    // 400KB of base64 each, that is over a megabyte in every card it produces.
    expect(kit.embedFonts).toContain('rajdhani-bold');
    expect(derived).not.toContain('rajdhani-bold');
    expect(derived).not.toContain('rajdhani-semibold');
    expect(derived).not.toContain('inter-bold');
  });

  test('it is stable — deriving twice gives an identical array', async () => {
    const kit = await kitOf('umbrae');
    expect(deriveEmbedFonts(FAMILIES, kit)).toEqual(deriveEmbedFonts(FAMILIES, kit));
  });
});

describe('the type pickers never blank out a value the kit holds', () => {
  const FAMILIES = families();

  test('a family this build does not carry is offered, and marked', () => {
    const options = familyOptions(FAMILIES, "'Helvetica Neue', sans-serif");
    expect(options.at(-1).value).toBe('Helvetica Neue');
    expect(options.at(-1).label).toMatch(/NOT VENDORED/);
  });

  test('weights are constrained to the family — Rajdhani offers 600 and 700', () => {
    const options = weightOptions(FAMILIES, "'Rajdhani'", '600');
    expect(options.map((o) => o.value)).toEqual(['600', '700']);
    expect(options[0].label).toMatch(/SemiBold/);
  });

  test('a weight the family lacks is still shown rather than erased', () => {
    const options = weightOptions(FAMILIES, "'Rajdhani'", '400');
    expect(options.map((o) => o.value)).toEqual(['600', '700', '400']);
    expect(options.at(-1).label).toMatch(/NOT VENDORED/);
  });
});

// ------------------------------------------------------------------ colour

describe('colour is parsed the way the renderer accepts it', () => {
  test('all four shapes tokenRefusals allows', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#22d3ee')).toEqual({ r: 34, g: 211, b: 238, a: 1 });
    expect(parseColor('#00000080').a).toBeCloseTo(0.502, 2);
    expect(parseColor('rgba(247,243,234,0.66)')).toEqual({ r: 247, g: 243, b: 234, a: 0.66 });
    expect(parseColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  test('a typo is null, not a guess', () => {
    expect(parseColor('#ff')).toBeNull();
    expect(parseColor('cyan')).toBeNull();
    expect(parseColor('')).toBeNull();
  });

  test('every colour in both shipped kits parses', async () => {
    for (const brand of ['umbrae', 'ignis']) {
      const kit = await kitOf(brand);
      for (const [role, value] of Object.entries(kit.colors)) {
        expect(parseColor(value), `${brand}.${role} = ${value}`).not.toBeNull();
      }
    }
  });
});

describe('contrast is measured against the brand\'s own floor', () => {
  test('the anchors are right — black on white is 21, a colour on itself is 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
    // WebAIM's worked example: #767676 passes AA on white, #999999 does not.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#999999', '#ffffff')).toBeLessThan(4.5);
  });

  test('ALPHA IS COMPOSITED, not ignored', () => {
    // ⚠️ Half of Umbrae's ink roles are translucent. Measuring them as opaque
    // reports a ratio the reader never experiences, and errs generous.
    const opaque = contrastRatio('#F7F3EA', '#000000');
    const translucent = contrastRatio('rgba(247,243,234,0.58)', '#000000');
    expect(translucent).toBeLessThan(opaque);
    expect(translucent).toBeGreaterThan(1);
  });

  test('the verdict is against contrastMin, not against a number we picked', () => {
    const ratio = contrastRatio('#767676', '#ffffff'); // ~4.54
    expect(contrastVerdict(ratio, 4.5).tone).toBe('pass');
    // The same colours, under a brand that set itself a higher floor.
    expect(contrastVerdict(ratio, 7).tone).toBe('fail');
  });

  test('an unreadable colour reports unknown rather than a fake ratio', () => {
    expect(contrastRatio('nonsense', '#000')).toBeNull();
    expect(contrastVerdict(null, 4.5).tone).toBe('unknown');
  });

  test("Umbrae's ink clears Umbrae's own floor — except `gray`, which is a REAL finding", async () => {
    // This is the check paying for itself the first time it ran. Umbrae
    // declares accessibility.contrastMin 4.5 and every ink role clears it —
    // ink 19.0, inkSoft 8.1, muted 6.3, accent 11.6, rise 15.5, fall 7.5 —
    // except `gray` at rgba(247,243,234,0.44), which measures 3.9 on #000000.
    //
    // `gray` is what draws "AS OF <timestamp>" in every card footer, at 34px on
    // a 1600px card. WCAG counts that as LARGE text, where the floor is 3:1, so
    // it is not a violation of the standard — but it IS below the number this
    // brand wrote down for itself, and nothing had ever compared the two.
    //
    // Pinned rather than papered over: if `gray` is lightened this test says
    // so, and until it is, the panel will badge it. Whether to lighten it is
    // Founder's call, not a test's.
    const kit = await kitOf('umbrae');
    const floor = kit.accessibility.contrastMin;
    const verdicts = Object.fromEntries(measurablePairs(kit).map((pair) => [
      `${pair.fg}/${pair.bg}`,
      contrastVerdict(contrastRatio(kit.colors[pair.fg], kit.colors[pair.bg]), floor),
    ]));
    for (const [pair, verdict] of Object.entries(verdicts)) {
      if (pair === 'gray/bg') continue;
      expect(verdict.tone, `${pair} is ${verdict.text}, floor ${floor}`).toBe('pass');
    }
    expect(verdicts['gray/bg'].ratio).toBeCloseTo(3.9, 1);
    expect(verdicts['gray/bg'].level).toBe('AA LARGE');
  });
});

describe('the palette bands hide nothing', () => {
  test('every role a kit carries lands in some band', async () => {
    const kit = await kitOf('umbrae');
    const shown = new Set(bandsOf(kit).flatMap((b) => b.rows.map((r) => r.role)));
    for (const role of Object.keys(kit.colors)) {
      expect(shown, `${role} is not editable anywhere`).toContain(role);
    }
  });

  test('a role nobody classified is gathered, not dropped', () => {
    const bands = bandsOf({ colors: { bg: '#000', somethingNew: '#f0f' } });
    const other = bands.find((b) => b.id === 'other');
    expect(other.rows.map((r) => r.role)).toContain('somethingNew');
  });

  test('a role the CARDS need but the kit lacks is still offered, and badged', () => {
    const bands = bandsOf({ colors: { bg: '#000' } }, [{ key: 'hairlineSoft', templates: ['stat'] }], ['bg', 'ink']);
    const rows = bands.flatMap((b) => b.rows);
    const hairline = rows.find((r) => r.role === 'hairlineSoft');
    // ⚠️ The two requirements differ by nine roles. A kit missing this SAVES
    // and then refuses to draw the stat card — so the badge names the template.
    expect(hairline.templates).toEqual(['stat']);
    expect(hairline.required).toBe(false);
    expect(rows.find((r) => r.role === 'ink').required).toBe(true);
  });

  test('colorRolesOf still offers a required role the kit is missing', () => {
    expect(colorRolesOf({ colors: { bg: '#000' } })).toContain('halo');
  });
});
