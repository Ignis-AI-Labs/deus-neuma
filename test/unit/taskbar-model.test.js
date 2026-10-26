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

const app = (label, extra = {}) => ({ label, ...extra });
const ENTRIES = [
  ['chat', app('STREAM')], ['chats', app('CHATS')], ['files', app('FILES')], ['terminal', app('TERMINAL')],
  ['house', app('HOUSE')], ['voice', app('VOICE')], ['marketing', app('MARKETING')], ['wallet', app('WALLET')],
  ['substrate', app('SUBSTRATE')], ['settings', app('SETTINGS')], ['newthing', app('NEW THING')],
];
const IDS = ENTRIES.map(([id]) => id);

describe('the launcher', () => {
  test('every registered app appears exactly once — an unnamed one in OTHER, never hidden', () => {
    const sections = launcherSections(ENTRIES);
    const shown = sections.flatMap((s) => s.items.map(([id]) => id));
    expect([...shown].sort()).toEqual([...IDS].sort());
    expect(sections.find((s) => s.id === 'other').items.map(([id]) => id)).toEqual(['newthing']);
  });

  test('a category named but with nothing registered is left out, and apps read alphabetically', () => {
    const sections = launcherSections(ENTRIES);
    expect(sections.map((s) => s.id)).not.toContain('know');
    const work = sections.find((s) => s.id === 'work').items.map(([, a]) => a.label);
    expect(work).toEqual([...work].sort());
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

  test('a pin on a window MARKETING took in pins MARKETING, once, where it stood', () => {
    expect(normalizePrefs({ pins: ['x', 'chat', 'tiktok', 'brandKits', 'marketing'] }, IDS).pins).toEqual(['marketing', 'chat']);
    expect(normalizePrefs({ pins: ['files', 'socialCheck'] }, IDS).pins).toEqual(['files', 'marketing']);
  });
});
