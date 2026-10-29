// taskbar-model.js — the desk's taskbar and launcher, as pure data + functions.
//
// THE DESK NAVIGATES LIKE AN OPERATING SYSTEM (Design note, 2026-10-05: […]).
// Ledger: docs/work/os-taskbar-launcher.md.
//
//   the LAUNCHER  every app as an icon tile, grouped by what it is FOR, with a
//                 search box — search, not longer menus, as apps keep arriving
//   the BAR       the person's PINNED apps, then whatever else is OPEN, then the
//                 tray; pins, their order, names on/off and the bar's edge are
//                 the person's own (prefs, per wallet)
//
// Two honesty rules carried from dock-groups.js: an app named here but absent
// from the registry is skipped; an app registered but named nowhere still
// shows, in OTHER — a new app is never silently hidden.
//
// Pure — no React/DOM — so every decision is unit-provable.

import { migrateAppIds, MARKETING_PLATFORMS } from './retired-windows.js';

/** The launcher's categories, in order. Membership by registry id. */
export const LAUNCHER_CATEGORIES = Object.freeze([
  { id: 'beings', apps: ['avatar', 'house', 'innerlife', 'refinement', 'sovereignty', 'vessel', 'voice'] },
  { id: 'work', apps: ['chat', 'chats', 'staff', 'houseclock', 'companyline', 'projects', 'teams', 'todo', 'workflow'] },
  { id: 'create', apps: ['files', 'terminal', 'comfyui', 'gallery'] },
  // MARKETING holds every public platform, the brand kits and the leads (retired-windows.js); each platform
  // still has its own tile, opening MARKETING on it (Dock.jsx platform entries).
  { id: 'reach', apps: ['marketing', ...MARKETING_PLATFORMS, 'discord', 'telegram'] },
  { id: 'know', apps: ['sheet', 'skills', 'contextmap', 'map', 'db', 'stats'] },
  { id: 'system', apps: ['settings', 'substrate', 'wallet', 'security', 'legal', 'treasury', 'witnesses', 'bench'] },
].map((c) => Object.freeze({ ...c, apps: Object.freeze(c.apps) })));

/** The tray's fixed launchers — the rig and the wallet, always one click away. */
export const TRAY_APPS = Object.freeze(['substrate', 'wallet']);

/** What a first desk pins: the conversation, its record, and the everyday tools. */
export const DEFAULT_PINS = Object.freeze(['chat', 'chats', 'projects', 'files', 'terminal', 'house']);

export const BAR_EDGES = Object.freeze(['bottom', 'left', 'top']);

export const DEFAULT_PREFS = Object.freeze({ pins: DEFAULT_PINS, labels: false, edge: 'bottom' });

/**
 * Saved prefs made safe: localStorage is a boundary. Pins keep only known,
 * unique ids (an app since unregistered drops away); anything malformed falls
 * back to the default. Pure.
 * @param {unknown} raw
 * @param {string[]} knownIds the registry's launchable ids
 */
export const normalizePrefs = (raw, knownIds) => {
  const known = new Set(knownIds);
  const r = raw && typeof raw === 'object' ? raw : {};
  // A pin on a window MARKETING took in pins MARKETING (retired-windows.js), never vanishes.
  const pins = Array.isArray(r.pins) ? migrateAppIds(r.pins) : DEFAULT_PREFS.pins;
  return Object.freeze({
    pins: Object.freeze([...new Set(pins.filter((id) => typeof id === 'string' && known.has(id)))]),
    labels: r.labels === true,
    edge: BAR_EDGES.includes(r.edge) ? r.edge : DEFAULT_PREFS.edge,
  });
};

/** Pin an unpinned app (to the end) or unpin a pinned one. Pure. */
export const togglePin = (prefs, id) => Object.freeze({
  ...prefs,
  pins: Object.freeze(prefs.pins.includes(id) ? prefs.pins.filter((p) => p !== id) : [...prefs.pins, id]),
});

/** Move a pinned app to `to` (an index into the pins without it). Pure. */
export const movePin = (prefs, id, to) => {
  if (!prefs.pins.includes(id)) return prefs;
  const rest = prefs.pins.filter((p) => p !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return Object.freeze({ ...prefs, pins: Object.freeze([...rest.slice(0, at), id, ...rest.slice(at)]) });
};

/**
 * What the bar shows between the launcher and the tray: the pins, in the
 * person's order, then every OTHER app with an open window, in the order its
 * first window opened. Tray apps never repeat in the middle. Pure.
 * @param {{pins:string[]}} prefs
 * @param {string[]} openAppIds base app ids of the open windows, in open order
 */
export const barItems = (prefs, openAppIds) => {
  const pinned = prefs.pins.filter((id) => !TRAY_APPS.includes(id));
  const running = [...new Set(openAppIds)].filter((id) => !pinned.includes(id) && !TRAY_APPS.includes(id));
  return Object.freeze({ pinned: Object.freeze(pinned), running: Object.freeze(running) });
};

/**
 * The launcher's sections: each category's registered apps, alphabetical by
 * what the person reads, then OTHER for every registered app no category
 * names. `entries` are [id, app] with `app.label` already in the person's
 * language. Pure.
 */
export const launcherSections = (entries, locale = undefined) => {
  const byId = new Map(entries);
  const named = new Set(LAUNCHER_CATEGORIES.flatMap((c) => c.apps));
  const sort = (list) => [...list].sort(([, a], [, b]) => String(a.label).localeCompare(String(b.label), locale));
  const sections = LAUNCHER_CATEGORIES
    .map((c) => ({ id: c.id, items: sort(c.apps.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)])) }));
  const other = sort(entries.filter(([id]) => !named.has(id)));
  return [...sections, { id: 'other', items: other }].filter((s) => s.items.length > 0);
};

/**
 * Search the launcher: a label that STARTS with the query ranks before one
 * that merely contains it; the id and any `keywords` on the app count too, so
 * "stream" finds the conversation window whatever its label says. Pure.
 * @param {Array<[string, object]>} entries
 * @param {string} query
 */
export const searchApps = (entries, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const words = ([id, app]) => [app.label, id, ...(app.keywords || [])].map((w) => String(w || '').toLowerCase());
  const starts = entries.filter((e) => words(e).some((w) => w.startsWith(q)));
  const contains = entries.filter((e) => !starts.includes(e) && words(e).some((w) => w.includes(q)));
  return [...starts, ...contains];
};
