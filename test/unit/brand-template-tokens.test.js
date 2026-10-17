// What the cards DRAW is what a kit must CARRY.
//
// This file is the guard for a bug that shipped: on 2026-08-31 the six
// templates drew fourteen colour roles and eleven type slots, while the
// scaffold seeded five and three. A brand kit made from `GET /:brand/new` saved
// cleanly and could not render one of the six cards, because `renderCardSvg`
// refuses an unresolved token rather than falling back.
//
// It broke because the requirement lived in three hand-kept places and nothing
// tied them together. These tests are the tie. They read the templates
// themselves, so a template author who adds {{token.somethingNew}} finds out
// here rather than from an operator whose brand-new kit refuses six times.
//
// Rule 0: no mocks. Every assertion below reads the real templates on disk.

import { describe, expect, test } from 'vitest';
import {
  scanTemplate, templateNeeds, acrossTemplates,
  requiredColors, requiredType, requiredMarks, requiredBrandFields,
} from '../../backend/services/branding/template-tokens.js';
import { kitSkeleton } from '../../backend/services/branding/kit-store.js';
import { KIT_SECTIONS } from '../../backend/services/branding/kit-readiness.js';

describe('the scan reads what the renderer resolves', () => {
  test('it finds each namespace, and ignores the two a kit does not answer for', () => {
    const found = scanTemplate(`
      <svg>{{fontface}}
        <rect fill="{{token.bg}}"/>
        <text font-family="{{font.display}}">{{data.headline}}</text>
        <image href="{{mark.wordmark}}"/>
        <text>{{brand.handle}}</text>
        <image href="{{guest.mark}}"/>
      </svg>`);
    expect(found.token).toEqual(['bg']);
    expect(found.font).toEqual(['display']);
    expect(found.mark).toEqual(['wordmark']);
    expect(found.brand).toEqual(['handle']);
    expect(found.guest).toEqual(['mark']);
    // `data` is the caller's copy and `fontface` is composed by the renderer.
    // Neither is something a brand kit can be held to.
    expect(found.data).toBeUndefined();
  });

  test('a repeated placeholder is counted once, and scanning twice gives the same answer', () => {
    const svg = '<svg>{{token.bg}}{{token.bg}}{{token.ink}}</svg>';
    // ⚠️ PLACEHOLDER carries /g. Sharing its lastIndex between calls would make
    // every second scan silently miss matches — the kind of bug that shows up
    // as a colour role that is required on Tuesday and not on Wednesday.
    expect(scanTemplate(svg).token).toEqual(['bg', 'ink']);
    expect(scanTemplate(svg).token).toEqual(['bg', 'ink']);
  });

  test('a role names WHICH templates want it, because that is what makes it actionable', () => {
    const named = acrossTemplates(
      { stat: { token: ['hairlineSoft'] }, milestone: { token: ['halo'] }, listing: { token: ['halo'] } },
      'token',
    );
    expect(named).toEqual([
      { key: 'hairlineSoft', templates: ['stat'] },
      { key: 'halo', templates: ['listing', 'milestone'] },
    ]);
  });
});

describe('a kit made from the scaffold can actually be drawn', () => {
  test('the scaffold carries every colour role the templates reference', async () => {
    const seeded = Object.keys(kitSkeleton('acme').colors);
    const drawn = await requiredColors();
    const absent = drawn.filter((c) => !seeded.includes(c.key));
    expect(
      absent.map((c) => `${c.key} (drawn by ${c.templates.join(', ')})`),
      'kitSkeleton must seed every colour the templates draw — a new kit that '
      + 'saves and then refuses every card is the bug this guards',
    ).toEqual([]);
  });

  test('the scaffold carries every type slot the templates reference', async () => {
    const seeded = Object.keys(kitSkeleton('acme').type);
    const drawn = await requiredType();
    const absent = drawn.filter((t) => !seeded.includes(t.key));
    expect(absent.map((t) => `${t.key} (drawn by ${t.templates.join(', ')})`)).toEqual([]);
  });

  test('the faces it embeds are the faces its type slots resolve to — no dead weight', async () => {
    const kit = kitSkeleton('acme');
    const { EMBEDDABLE } = await import('../../backend/services/branding/embeddable-faces.js');
    // Every embedded face must be a real registry key...
    for (const id of kit.embedFonts) expect(EMBEDDABLE, `${id} is not a vendored face`).toHaveProperty(id);
    // ...and every family the type block names must be covered by one of them.
    // ⚠️ An embedded face nothing draws is ~400KB of base64 in every card, for
    // nothing — the state brands/ignis/tokens.json is in today.
    const families = new Set(kit.embedFonts.map((id) => EMBEDDABLE[id].family));
    const firstFamily = (stack) => String(stack).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    for (const slot of ['display', 'voice', 'data', 'numeral']) {
      expect(families, `type.${slot} names a family no embedded face provides`)
        .toContain(firstFamily(kit.type[slot]));
    }
  });
});

describe('the gate asks for everything a card needs from the kit', () => {
  const gatePaths = () => KIT_SECTIONS.flatMap((s) => s.fields.map((f) => f.path));

  test('every mark the templates draw is a gated field', async () => {
    const drawn = await requiredMarks();
    const paths = gatePaths();
    const ungated = drawn.filter((m) => !paths.includes(`marks.${m.key}`));
    expect(
      ungated.map((m) => `marks.${m.key} (drawn by ${m.templates.join(', ')})`),
      'a kit can read READY and still refuse every card when a mark it draws '
      + 'was never asked for — this is how marks.mask was missed',
    ).toEqual([]);
  });

  test('every top-level brand field the templates draw is a gated field', async () => {
    const drawn = await requiredBrandFields();
    const paths = gatePaths();
    const ungated = drawn.filter((b) => !paths.includes(b.key));
    expect(ungated.map((b) => `${b.key} (drawn by ${b.templates.join(', ')})`)).toEqual([]);
  });
});

describe('the real templates, as they stand', () => {
  test('each one declares what it needs and nothing scans as empty', async () => {
    const needs = await templateNeeds();
    expect(Object.keys(needs).sort()).toEqual([
      // ⚠️ 'stat' sorts BEFORE 'statement' — it is a prefix of it.
      'announcement', 'changelog', 'explainer', 'launch', 'listing', 'milestone',
      'partnership', 'platform-listing', 'quote', 'stat', 'statement',
    ]);
    for (const [name, drawn] of Object.entries(needs)) {
      expect(drawn.token.length, `${name} draws no colour, which cannot be right`).toBeGreaterThan(0);
      expect(drawn.font.length, `${name} draws no type, which cannot be right`).toBeGreaterThan(0);
    }
  });
});
