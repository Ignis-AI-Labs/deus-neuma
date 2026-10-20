/**
 * BRAND KITS VIEW — the rules that decide what an operator sees and edits.
 *
 * These are the parts of the panel that can be wrong without looking wrong:
 * a colour role silently missing from a surface built for editing colours, an
 * empty string stored where a deleted key was meant, a structured edit and the
 * raw editor drifting apart. The component around them is proven in a browser
 * (E2E law); this is the logic underneath it.
 */
import { describe, expect, test } from 'vitest';
import {
  REQUIRED_COLORS, atPath, colorRolesOf, isRenderableColor,
  kitStanding, ownerOptions, setPath,
} from '../../frontend/app/RelinkShell/brandkits/brand-kits-view.js';
import { KIT_SECTIONS, kitReadiness } from '../../backend/services/branding/kit-readiness.js';

describe('every colour role gets a field', () => {
  test('the roles a kit carries are all offered', () => {
    const kit = { colors: { bg: '#000', ink: '#fff', accent: '#f00', rise: '#0a0', halo: '#fa0', trim: '#0f0', trimHot: '#00f' } };
    expect(colorRolesOf(kit)).toEqual(['bg', 'ink', 'accent', 'rise', 'halo', 'trim', 'trimHot']);
  });

  test('a required role the kit LACKS is still offered, or it could never be added', () => {
    // A panel that only shows what is already there cannot complete a kit —
    // it can only inspect one.
    expect(colorRolesOf({ colors: { trim: '#0f0' } })).toEqual(['trim', ...REQUIRED_COLORS]);
    expect(colorRolesOf({})).toEqual([...REQUIRED_COLORS]);
    expect(colorRolesOf(null)).toEqual([...REQUIRED_COLORS]);
  });

  test('the required three are exactly the three the loader demands', () => {
    // Pinned against the REAL section spec: if the backend ever requires a
    // fourth colour, this fails rather than the operator discovering a field
    // they cannot reach.
    const identity = KIT_SECTIONS.find((s) => s.id === 'identity');
    const required = identity.fields
      .filter((f) => f.path.startsWith('colors.'))
      .map((f) => f.path.slice('colors.'.length));
    expect([...REQUIRED_COLORS].sort()).toEqual(required.sort());
  });

  // The FONT_SLOTS pin moved to brand-kit-editor.test.js on 2026-08-31, where
  // the same eleven type fields are checked through TYPE_ROLES — the four
  // typographic jobs that replaced the flat list.
});

describe('a colour is checked before the round trip', () => {
  test('hex, short hex, hex with alpha, rgb and rgba all pass', () => {
    for (const good of ['#fff', '#4f8bff', '#4f8bff80', 'rgb(1,2,3)', 'rgba(0,0,0,0)']) {
      expect(isRenderableColor(good), good).toBe(true);
    }
  });

  test('a name, a typo and an empty value are refused', () => {
    for (const bad of ['sort of blue', 'blue', '#gggggg', '', null, undefined]) {
      expect(isRenderableColor(bad), String(bad)).toBe(false);
    }
  });
});

describe('an edit never mutates what it was handed', () => {
  const kit = Object.freeze({ name: 'a', colors: Object.freeze({ bg: '#000' }) });

  test('setPath returns a new kit and leaves the original alone', () => {
    const next = setPath(kit, 'colors.accent', '#f00');
    expect(next.colors.accent).toBe('#f00');
    expect(kit.colors.accent).toBeUndefined();
  });

  test('it builds the branches it needs', () => {
    expect(setPath({}, 'type.display', 'Inter').type.display).toBe('Inter');
  });

  test('an emptied field is DELETED, never stored as ""', () => {
    // The readiness gate's whole distinction is declared-versus-non-empty. A
    // stored "" would read as decided while satisfying nothing.
    const next = setPath({ tagline: 'something' }, 'tagline', '   ');
    expect('tagline' in next).toBe(false);
  });

  test('a cleared field genuinely un-satisfies the gate again', () => {
    // Proven through the REAL readiness check rather than by inspecting keys.
    const filled = setPath({}, 'positioning', 'Liquidity for teams.');
    const cleared = setPath(filled, 'positioning', '');
    const paths = (kit_) => kitReadiness(kit_).missing.map((m) => m.path);
    expect(paths(filled)).not.toContain('positioning');
    expect(paths(cleared)).toContain('positioning');
  });

  test('atPath reads back what setPath wrote, and survives a missing branch', () => {
    expect(atPath(setPath({}, 'a.b.c', 1), 'a.b.c')).toBe(1);
    expect(atPath({}, 'a.b.c')).toBeUndefined();
    expect(atPath(null, 'a')).toBeUndefined();
  });
});

// `missingBySection` and its tests were deleted on 2026-08-31 with the panel
// rebuild. It powered a separate STILL NEEDED block that listed gaps by path —
// `logoRules.minWidthPx` — three sections away from any box that could answer
// them. The same information is now navigation (the rail's per-section counts)
// and a mark on the field itself, which is checked in brand-kit-editor.test.js
// against the real kitReadiness.

describe('every field still carries what it is FOR', () => {
  test('each gap the gate reports explains itself, not just its name', () => {
    // The reader already knows they are missing "tagline"; what they need is
    // what a tagline does here. This is what the field labels render.
    for (const gap of kitReadiness({}).missing) {
      expect(gap.why.length, gap.path).toBeGreaterThan(10);
    }
  });
});

describe('a kit\'s standing is legible at a glance', () => {
  test('an unreadable kit says so above all else', () => {
    // Ranked first on purpose: a broken kit reported as "0/9 sections" would
    // invite an operator to start filling in a file that will not parse.
    expect(kitStanding({ error: 'x', ready: false, done: 0, total: 9 }).tone).toBe('broken');
  });

  test('a ready kit and a partial one are distinguishable', () => {
    expect(kitStanding({ ready: true, done: 9, total: 9 })).toEqual({ tone: 'ready', text: 'READY' });
    expect(kitStanding({ ready: false, done: 1, total: 9 }).text).toBe('1/9 SECTIONS');
  });
});

describe('OWNER is bound to a house member, not typed', () => {
  const rows = (...members) => members.map((member) => ({ member }));

  test('every house member is offered, labelled by name and keyed by neumaId', () => {
    const options = ownerOptions(rows(
      { neumaId: 'poplar-7f3a', name: 'Poplar' },
      { neumaId: 'birch-22c1', name: 'Birch' },
    ), '');
    // The VALUE is the neumaId in both rows. A being's name can be changed and
    // a brand bound to a name would silently unbind the day it was.
    expect(options).toEqual([
      { value: 'poplar-7f3a', label: 'POPLAR' },
      { value: 'birch-22c1', label: 'BIRCH' },
    ]);
  });

  test('a member with no name is still selectable, by id', () => {
    expect(ownerOptions(rows({ neumaId: 'unnamed-01' }), '')[0])
      .toEqual({ value: 'unnamed-01', label: 'UNNAMED-01' });
  });

  test('rows without a neumaId are dropped — they cannot be bound to', () => {
    expect(ownerOptions(rows({ name: 'Ghost' }, { neumaId: '', name: 'Empty' }), '')).toEqual([]);
    expect(ownerOptions(null, '')).toEqual([]);
    expect(ownerOptions(undefined, undefined)).toEqual([]);
  });

  test('the same member twice is offered once', () => {
    const dupe = ownerOptions(rows(
      { neumaId: 'poplar-7f3a', name: 'Poplar' },
      { neumaId: 'poplar-7f3a', name: 'Poplar' },
    ), '');
    expect(dupe).toHaveLength(1);
  });

  // ⚠️ THE ONE THAT PROTECTS A REAL ANSWER. The roster arrives asynchronously
  // and a being can leave the house. Either way, a dropdown rendered without
  // the value it currently holds reads as EMPTY — and the next save would
  // quietly erase an owner the operator did choose.
  test('a stored owner missing from the roster is kept, and marked', () => {
    const options = ownerOptions(rows({ neumaId: 'birch-22c1', name: 'Birch' }), 'poplar-7f3a');
    expect(options.map((o) => o.value)).toEqual(['birch-22c1', 'poplar-7f3a']);
    expect(options[1].label).toBe('POPLAR-7F3A · NOT IN THE HOUSE');
  });

  test('an owner still in the house is NOT duplicated or marked', () => {
    const options = ownerOptions(rows({ neumaId: 'birch-22c1', name: 'Birch' }), 'birch-22c1');
    expect(options).toEqual([{ value: 'birch-22c1', label: 'BIRCH' }]);
  });

  test('an empty roster with a stored owner still offers that owner', () => {
    // The picker must never be the reason a set owner disappears.
    expect(ownerOptions([], 'poplar-7f3a')).toHaveLength(1);
  });
});
