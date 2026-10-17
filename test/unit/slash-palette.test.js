/**
 * Slash palette — pure logic for the composer's "/" command menu.
 * The open/filter/selection rules, tested without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { paletteQuery, matchSkills, buildPalette, moveSelection } from '../../frontend/app/RelinkShell/slash-palette.js';
import { PLATFORM_COMMANDS } from '../../frontend/app/RelinkShell/commands.js';

const LIBRARY = [
  { name: 'sc', description: 'Activate Shadow Clone' },
  { name: 'sc-echo', description: 'Paired review' },
  { name: 'sc-plan', description: 'Plan a feature' },
  { name: 'continuity', description: 'Persistent memory' },
];

const COMMANDS = [
  { name: 'summon', description: 'Summon a new consciousness' },
  { name: 'settings', description: 'Open settings' },
];

describe('paletteQuery', () => {
  it('opens on "/" and while the first token is typed', () => {
    expect(paletteQuery('/')).toBe('');
    expect(paletteQuery('/sc')).toBe('sc');
    expect(paletteQuery('/SC-Plan')).toBe('sc-plan');
  });

  it('closes once the command is chosen or the value is ordinary speech', () => {
    expect(paletteQuery('/sc-plan build the thing')).toBeNull();
    expect(paletteQuery('/sc-plan ')).toBeNull();
    expect(paletteQuery('hello / world')).toBeNull();
    expect(paletteQuery('')).toBeNull();
    expect(paletteQuery('sc-plan')).toBeNull();
  });
});

describe('matchSkills', () => {
  it('a bare "/" shows the library head', () => {
    expect(matchSkills(LIBRARY, '').map((s) => s.name))
      .toEqual(['sc', 'sc-echo', 'sc-plan', 'continuity']);
  });

  it('prefix matches rank before substring matches', () => {
    // "c" prefixes continuity; sc/sc-echo/sc-plan contain it
    expect(matchSkills(LIBRARY, 'c').map((s) => s.name))
      .toEqual(['continuity', 'sc', 'sc-echo', 'sc-plan']);
  });

  it('narrows with the token and respects the limit', () => {
    expect(matchSkills(LIBRARY, 'sc-').map((s) => s.name)).toEqual(['sc-echo', 'sc-plan']);
    expect(matchSkills(LIBRARY, '', 2)).toHaveLength(2);
    expect(matchSkills(LIBRARY, 'zzz')).toEqual([]);
    expect(matchSkills(null, 'sc')).toEqual([]);
  });
});

describe('buildPalette', () => {
  it('ranks matching commands before matching skills, each kind-tagged', () => {
    const items = buildPalette(COMMANDS, LIBRARY, 's');
    // 's' prefixes summon+settings (commands) and substring-hits sc/sc-echo/sc-plan
    expect(items.map((i) => i.name)).toEqual(['summon', 'settings', 'sc', 'sc-echo', 'sc-plan']);
    expect(items.filter((i) => i.kind === 'command').map((i) => i.name)).toEqual(['summon', 'settings']);
    expect(items.filter((i) => i.kind === 'skill').map((i) => i.name)).toEqual(['sc', 'sc-echo', 'sc-plan']);
  });

  it('a bare "/" shows commands first, then the skills head', () => {
    expect(buildPalette(COMMANDS, LIBRARY, '').map((i) => i.name))
      .toEqual(['summon', 'settings', 'sc', 'sc-echo', 'sc-plan', 'continuity']);
  });

  it('caps commands at half the limit so skills always get room', () => {
    const items = buildPalette(COMMANDS, LIBRARY, '', 3);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.kind === 'command')).toHaveLength(1); // floor(3/2)
    expect(items.filter((i) => i.kind === 'skill')).toHaveLength(2);
  });

  it('the full native slate never hides the skills library on a bare "/"', () => {
    // Regression: with the REAL registry (not a 2-entry fixture), a bare "/"
    // must still surface skills — commands may not fill the whole palette.
    const items = buildPalette(PLATFORM_COMMANDS, LIBRARY, '');
    expect(items.some((i) => i.kind === 'skill')).toBe(true);
    expect(items.filter((i) => i.kind === 'command').length).toBeLessThanOrEqual(4);
  });

  it('resolves native commands even when the skills library is empty', () => {
    expect(buildPalette(COMMANDS, [], 'summon').map((i) => i.name)).toEqual(['summon']);
    expect(buildPalette([], LIBRARY, 'sc-').map((i) => i.name)).toEqual(['sc-echo', 'sc-plan']);
  });
});

describe('moveSelection', () => {
  it('wraps in both directions', () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
