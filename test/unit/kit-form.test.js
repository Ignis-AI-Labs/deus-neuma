// The form and the gate must describe the same kit.
//
// kit-form.js decides how a brand kit is EDITED; kit-readiness.js decides how
// it is JUDGED. They are deliberately separate files — the form's sections are
// not the gate's sections, and a field's `kind` does not imply its control. The
// price of that separation is that they can drift, and this file is what makes
// drift impossible to ship.
//
// The failure it prevents already happened. The old panel hand-wrote its
// sections, so the twenty fields nobody hand-wrote a control for were reachable
// only through a raw JSON textarea — POSITIONING, MESSAGE, VOICE, CLAIMS,
// LEGAL, ASSET RULES, ACCESSIBILITY and CHANNELS, eight whole sections of the
// thing the panel exists to edit. It failed SILENTLY, which is why it lasted.
// Now adding a field to the gate without giving it a control fails HERE.

import { describe, expect, test } from 'vitest';
import { KIT_SECTIONS } from '../../backend/services/branding/kit-readiness.js';
import {
  kitForm, gateFields, formSectionOf, FORM_SECTIONS, FORM_CONTROLS, FORM_LAYOUTS,
} from '../../backend/services/branding/kit-form.js';

const gatePaths = () => KIT_SECTIONS.flatMap((s) => s.fields.map((f) => f.path));
const formPaths = () => FORM_SECTIONS.flatMap((s) => s.owns);

describe('every gated field is editable', () => {
  test('each one appears in exactly one form section', () => {
    const seen = new Map();
    for (const section of FORM_SECTIONS) {
      for (const path of section.owns) {
        seen.set(path, [...(seen.get(path) || []), section.id]);
      }
    }
    const unreachable = gatePaths().filter((p) => !seen.has(p));
    expect(
      unreachable,
      'a gated field with no form section is a field an operator can only reach '
      + 'by hand-editing JSON — which is the bug this whole layer exists to end',
    ).toEqual([]);
    const twice = [...seen].filter(([, sections]) => sections.length > 1);
    expect(twice, 'a field edited in two places gets two answers').toEqual([]);
  });

  test('each one gets exactly one control, and it is a real one', () => {
    const controls = new Set(Object.values(FORM_CONTROLS));
    for (const section of kitForm().sections) {
      for (const field of section.fields) {
        expect(controls, `${field.path} has no known control`).toContain(field.control);
      }
    }
  });

  test('no form field names a path the gate does not have', () => {
    const known = new Set(gatePaths());
    const invented = formPaths().filter((p) => !known.has(p));
    expect(
      invented,
      'a form field with no gate field behind it shows an operator a box whose '
      + 'answer nothing ever reads',
    ).toEqual([]);
  });
});

describe('the arithmetic adds up to the gate, not to a second count of our own', () => {
  test('the form claims every gate field exactly once, and no more', () => {
    expect(formPaths().sort()).toEqual(gatePaths().sort());
  });

  test("IDENTITY's fields split four ways and still sum to IDENTITY", () => {
    // This is the whole reason the two layers are separate. IDENTITY is the
    // largest gate section by a wide margin — a name, a handle, five colours,
    // eleven type slots, two marks and an owner. As one screen it is the wall
    // Founder was looking at; as a form it has to be four.
    const identity = KIT_SECTIONS.find((s) => s.id === 'identity');
    const derived = ['identity', 'colour', 'type', 'marks']
      .flatMap((id) => FORM_SECTIONS.find((s) => s.id === id).owns);
    expect(derived.sort()).toEqual(identity.fields.map((f) => f.path).sort());
  });

  test('every other gate section passes through to one form section unchanged', () => {
    for (const gate of KIT_SECTIONS) {
      if (gate.id === 'identity') continue;
      const form = FORM_SECTIONS.find((s) => s.id === gate.id);
      expect(form, `gate section ${gate.id} has no form section`).toBeTruthy();
      expect(form.owns.slice().sort()).toEqual(gate.fields.map((f) => f.path).sort());
    }
  });
});

describe('the form carries the brand\'s own words, not a second wording', () => {
  test('every field brings the gate\'s `why` with it', () => {
    const why = new Map([...gateFields()].map(([path, f]) => [path, f.why]));
    for (const section of kitForm().sections) {
      for (const field of section.fields) {
        expect(field.why, `${field.path} lost its reason`).toBe(why.get(field.path));
        expect(field.kind, `${field.path} lost its kind`).toBeTruthy();
      }
    }
  });

  test('a list field carries whether an empty list is a real answer', () => {
    // `disclosures` is LIST — [] passes and MEANS somebody decided there are
    // none. `pillars` is LIST1 — [] correctly fails. The control needs to know,
    // or it offers a one-click way to look decided while failing the gate.
    const byPath = new Map(
      kitForm().sections.flatMap((s) => s.fields.map((f) => [f.path, f])),
    );
    expect(byPath.get('disclosures').kind).toBe('list');
    expect(byPath.get('competitors.neverName').kind).toBe('list');
    expect(byPath.get('imagery.avoid').kind).toBe('list');
    expect(byPath.get('pillars').kind).toBe('list1');
    expect(byPath.get('claims.approved').kind).toBe('list1');
    expect(byPath.get('claims.forbidden').kind).toBe('list1');
  });
});

describe('the layout says which editor to mount', () => {
  test('the three bespoke sections are marked, and the rest are generic', () => {
    const layouts = Object.fromEntries(FORM_SECTIONS.map((s) => [s.id, s.layout]));
    expect(layouts.colour).toBe(FORM_LAYOUTS.PALETTE);
    expect(layouts.type).toBe(FORM_LAYOUTS.TYPE);
    expect(layouts.marks).toBe(FORM_LAYOUTS.MARKS);
    for (const id of ['identity', 'positioning', 'message', 'voice', 'claims', 'legal', 'assetRules', 'access', 'channels']) {
      expect(layouts[id], `${id} should render from the spec`).toBe(FORM_LAYOUTS.FIELDS);
    }
  });

  test('a refusal can point at the control that answers it', () => {
    expect(formSectionOf('claims.forbidden')).toBe('claims');
    expect(formSectionOf('type.numeralTrack')).toBe('type');
    expect(formSectionOf('colors.halo')).toBe('colour');
    expect(formSectionOf('marks.mask')).toBe('marks');
    expect(formSectionOf('nothing.real')).toBeNull();
  });
});
