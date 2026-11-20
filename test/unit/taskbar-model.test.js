/**
 * THE TASKBAR + LAUNCHER rules (frontend/app/windowing/taskbar-model.js).
 * Design note, 2026-10-05: the desk navigates like an operating system — pinned icons
 * on a bar, every app in a launcher with search, the bar the person's own.
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PREFS, LAUNCHER_CATEGORIES, TRAY_APPS, barItems, launcherSections, movePin,
  normalizePrefs, searchApps, togglePin,
} from '../../frontend/app/windowing/taskbar-model.js';
import { POSITION_TILES, FOLDED_INTO_POSITIONS, officeOfTile } from '../../frontend/app/windowing/position-tiles.js';
import { POSITIONS } from '../../backend/services/positions/position-map.js';

const app = (label, extra = {}) => ({ label, ...extra });
const ENTRIES = [
  ['chat', app('STREAM')], ['chats', app('CHATS')], ['files', app('FILES')], ['terminal', app('TERMINAL')],
  ['house', app('HOUSE')], ['voice', app('VOICE')], ['marketing', app('MARKETING')], ['wallet', app('WALLET')],
  ['substrate', app('SUBSTRATE')], ['settings', app('SETTINGS')], ['newthing', app('NEW THING')],
];
const IDS = ENTRIES.map(([id]) => id);

describe('the launcher', () => {
  test('every registered app appears exactly once — an unnamed one in OTHER, never hidden; a window a position took in moved there', () => {
    const sections = launcherSections(ENTRIES);
    const shown = sections.flatMap((s) => s.items.map(([id]) => id));
    expect([...shown].sort()).toEqual(IDS.filter((id) => !FOLDED_INTO_POSITIONS.includes(id)).sort());
    expect(sections.find((s) => s.id === 'other').items.map(([id]) => id)).toEqual(['newthing']);
  });

  test('a category named but with nothing registered is left out, and apps read alphabetically', () => {
    const sections = launcherSections(ENTRIES);
    expect(sections.map((s) => s.id)).not.toContain('know');
    const work = sections.find((s) => s.id === 'work').items.map(([, a]) => a.label);
    expect(work).toEqual([...work].sort());
  });

  test('REACH lists every public platform beside MARKETING, so none is ever out of reach', () => {
    const reach = LAUNCHER_CATEGORIES.find((c) => c.id === 'reach').apps;
    for (const id of ['marketing', 'x', 'facebook', 'mastodon', 'bluesky', 'linkedin', 'youtube', 'tiktok', 'discord', 'telegram']) expect(reach).toContain(id);
  });

  test('COMPANY holds one tile per position, in seat order, twinned to the backend\'s position map', () => {
    expect(POSITION_TILES.map(([office, seat]) => [office, seat])).toEqual(POSITIONS.map((p) => [p.office, p.seat]));
    const company = LAUNCHER_CATEGORIES.find((c) => c.id === 'company');
    expect(company.apps).toEqual([...POSITIONS.map((p) => `position-${p.office}`), 'companyline', 'houseclock']);
    expect(officeOfTile('position-cro')).toBe('cro');
    expect(officeOfTile('position-nope')).toBe(null);
    expect(officeOfTile('security')).toBe(null);
    // Seat order is kept (never alphabetical), and the section reads on a real set of entries.
    const entries = [...POSITION_TILES.map(([office, label]) => [`position-${office}`, app(label)]), ['companyline', app('COMPANY LINE')], ['houseclock', app('HOUSE CLOCK')]];
    expect(launcherSections(entries).find((s) => s.id === 'company').items.map(([, a]) => a.label))
      .toEqual(['CHIEF OF STAFF', 'CHIEF REVENUE OFFICER', 'CHIEF MARKETING OFFICER', 'CHIEF LEGAL OFFICER', 'CHIEF SECURITY OFFICER', 'CHIEF FINANCIAL OFFICER', 'CHIEF ACCOUNTING OFFICER', 'COMPANY LINE', 'HOUSE CLOCK']);
  });

  test('a window a position took in takes no tile and is not OTHER, yet search still finds it', () => {
    const entries = [...FOLDED_INTO_POSITIONS.map((id) => [id, app(id.toUpperCase())]), ['position-clo', app('LAW', { keywords: ['legal'] })], ['newthing', app('NEW THING')]];
    const shown = launcherSections(entries).flatMap((s) => s.items.map(([id]) => id));
    expect(shown).toEqual(['position-clo', 'newthing']);
    expect(searchApps(entries, 'legal').map(([id]) => id)).toEqual(['legal', 'position-clo']);
    expect(searchApps(entries, 'treasury').map(([id]) => id)).toEqual(['treasury']);
  });

  test('no app is claimed by two categories', () => {
    const all = LAUNCHER_CATEGORIES.flatMap((c) => c.apps);
    expect(new Set(all).size).toBe(all.length);
  });

  test('search: a label that starts with the words ranks first; ids and keywords count', () => {
    expect(searchApps(ENTRIES, 'ter').map(([id]) => id)).toEqual(['terminal']);
    expect(searchApps(ENTRIES, 'chat').map(([id]) => id)).toEqual(['chat', 'chats']); // the id finds STREAM
    expect(searchApps([['voice', app('VOICE', { keywords: ['speech'] })]], 'spee').map(([id]) => id)).toEqual(['voice']);
    expect(searchApps(ENTRIES, '   ')).toEqual([]);
  });
});

describe('the bar', () => {
  test('pins first, in order; then open apps that are not pinned; the tray never repeats', () => {
    const prefs = normalizePrefs({ pins: ['files', 'chat'] }, IDS);
    const { pinned, running } = barItems(prefs, ['x', 'chat', 'wallet', 'x', 'voice']);
    expect(pinned).toEqual(['files', 'chat']);
    expect(running).toEqual(['x', 'voice']);
    expect(TRAY_APPS.some((id) => running.includes(id))).toBe(false);
  });

  test('pin, unpin and reorder', () => {
    let p = normalizePrefs({ pins: ['chat', 'files'] }, IDS);
    p = togglePin(p, 'voice');
    expect(p.pins).toEqual(['chat', 'files', 'voice']);
    p = movePin(p, 'voice', 0);
    expect(p.pins).toEqual(['voice', 'chat', 'files']);
    p = togglePin(p, 'chat');
    expect(p.pins).toEqual(['voice', 'files']);
    expect(movePin(p, 'house', 0)).toBe(p); // not pinned: nothing moves
  });

  test('saved prefs are a boundary — unknown or duplicate pins drop, bad values fall back', () => {
    const p = normalizePrefs({ pins: ['chat', 'gone', 'chat', 7], labels: 'yes', edge: 'diagonal' }, IDS);
    expect(p.pins).toEqual(['chat']);
    expect(p.labels).toBe(false);
    expect(p.edge).toBe(DEFAULT_PREFS.edge);
    expect(normalizePrefs(null, IDS).pins).toEqual(DEFAULT_PREFS.pins.filter((id) => IDS.includes(id)));
    expect(normalizePrefs({ pins: [], labels: true, edge: 'left' }, IDS)).toMatchObject({ pins: [], labels: true, edge: 'left' });
  });

  test('a pin on a window MARKETING took in pins MARKETING, once, where it stood — a platform\'s pin stays its own tile', () => {
    expect(normalizePrefs({ pins: ['x', 'chat', 'tiktok', 'brandKits', 'marketing'] }, [...IDS, 'x', 'tiktok']).pins).toEqual(['x', 'chat', 'tiktok', 'marketing']);
    expect(normalizePrefs({ pins: ['files', 'socialCheck'] }, IDS).pins).toEqual(['files', 'marketing']);
  });
});
