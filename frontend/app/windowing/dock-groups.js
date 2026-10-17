// dock-groups.js — how the dock's launchers are organized into sections.
//
// The dock groups apps by what they're FOR, in a fixed order, rather than the
// registry's insertion order. Membership is keyed by registry id (the same id
// the window manager opens). Two honesty rules:
//   • An app listed here but ABSENT from the registry is skipped — so a reserved
//     slot (e.g. 'db', the being's data surface, not built yet) can wait for it.
//   • An app PRESENT in the registry but not named here still renders, appended
//     to a trailing group — so a newly-registered app is never silently hidden.
//
// ── THE ORDERING LAW (Design note, 2026-08-25 ──────────────────────────────────────
// […]
//
// WORKSPACE had grown to 13 rows — more than double every other section — and a
// hand-picked order that only its author could predict. So, decided with him
// against the alternatives:
//
//   1. Every section is ALPHABETICAL. Nothing is ordered by anyone's sense of
//      importance any more, because that sense is invisible to everyone else.
//   2. A section too big to scan is broken into small labelled BANDS, and the
//      alphabet runs inside each band. Sorting alone would have left WORKSPACE
//      one unbroken wall of 13 — it fixes FINDING, not STACKING. Bands fix both.
//   3. Bands are declared, never inferred from a size threshold: a magic number
//      that silently regroups the dock when an app is registered is worse than
//      the disorder it replaces.
//
// Sorting is by the app's LABEL, not its id — the operator reads 'REPO MAP',
// never 'map'. That is why the sort happens in groupDockApps, which has the
// registry entries, and not in this table, which holds only ids.
//
// Pure — no React/DOM — so the partition is unit-testable. The one leaf it
// reads is the active locale (active-locale.js — the documented pattern for
// pure-adjacent modules): the caller hands in labels in the operator's
// language, and the alphabetical law sorts them with that language's rules.

import { currentLocale } from '../../i18n/active-locale.js';

/** One band inside a section. A null label means "no header" (a lone band). */
const band = (label, apps) => Object.freeze({ label, apps: Object.freeze(apps) });

// `apps` is DERIVED from the bands, never hand-maintained beside them — two
// lists of the same membership is one list that goes stale.
const group = (id, label, bands) => Object.freeze({
  id,
  label,
  bands: Object.freeze(bands),
  apps: Object.freeze(bands.flatMap((b) => b.apps)),
});

/** A section small enough to scan whole: one band, no header. */
const plain = (id, label, apps) => group(id, label, [band(null, apps)]);

export const DOCK_GROUPS = Object.freeze([
  // NEUMA holds the being-facing surfaces — what a neuma IS and how it sounds,
  // looks, refines and stands. The working surfaces (STREAM, TEAMS, WORKFLOW)
  // moved to WORKSPACE (Design note, 2026-08-15: […]).
  // 'refinement' is the registry id of the window the operator reads as NITE
  // (Design note, 2026-08-25: […]). The id
  // stays — it keys persisted window geometry — and RefinementApp.jsx's header
  // explains the mismatch in full.
  plain('neuma', 'NEUMA', ['avatar', 'house', 'innerlife', 'refinement', 'sovereignty', 'vessel', 'voice']),

  // WORKSPACE is the one section big enough to need bands. They answer […] before […]:
  //   TALK  — the conversation and its record
  //   WORK  — what is being done, and by whom; the CHIEF OF STAFF office
  //           ('staff') leads it — command, not watch: the Optio directs the
  //           house's work, so it stands with the work, not the guards;
  //           the HOUSE CLOCK ('houseclock') stands beside it — the house
  //           waking itself for its own work, under the operator's charter
  //   CRAFT — the tools you do it with
  //   WATCH — who is standing guard
  //   MEASURE — the rig's own yardstick: benchmarking is measurement, not
  //           work or watch — it says what the house IS, not what it does
  // 'comfyui' is THE IMAGE FORGE workbench (FR-37) — the witness went looking
  // for it under WORKSPACE, so that is where it lives (CHANGE-2); the GALLERY is
  // its OWN window, not a pane inside COMFY (Design note, 2026-08-01: renders are only
  // one source — it reads ComfyUI's output by default plus any folder the
  // operator adds, images and video alike.
  // CHATS lives here, not in KNOWLEDGE (Design note, 2026-07-27: […]). KNOWLEDGE is what you CONSULT
  // about the work; a conversation history is not consulted about the work —
  // it IS the work, which is why it shares the TALK band with the live stream.
  group('workspace', 'WORKSPACE', [
    band('TALK', ['chat', 'chats']),
    band('WORK', ['staff', 'houseclock', 'projects', 'teams', 'todo', 'workflow']),
    band('CRAFT', ['comfyui', 'files', 'gallery', 'terminal']),
    band('WATCH', ['security', 'legal', 'witnesses']),
    band('MEASURE', ['bench']),
  ]),

  // TWO LAYERS (Design note, 2026-07-28: […]). MARKETING is the open-platform layer — X first, the other
  // public platforms in the same format — beside the CMO seat (house-wide
  // campaigns) and LEADS (the funnel). A new public platform's window joins
  // here when its posting lane lands.
  // `brandKits` rides here rather than in a platform window: a kit is not a
  // channel. One kit governs every channel a company speaks through, and the
  // work that reads it — campaigns, cards, pressed documents — starts in this
  // section (Design note, 2026-08-31: […]).
  plain('marketing', 'MARKETING', ['bluesky', 'brandKits', 'facebook', 'leads', 'linkedin', 'marketing', 'mastodon', 'x']),

  // COMMUNITY is the private-circles layer: Telegram and Discord are
  // community management — member care, announcements, moderation — never
  // ad-channels, and they are not marketed through. Their windows carry the
  // connection management today; the community tooling is its own track.
  plain('community', 'COMMUNITY', ['discord', 'telegram']),

  // 'db' is the being's data surface — reserved here, invisible until registered.
  plain('knowledge', 'KNOWLEDGE', ['contextmap', 'db', 'map', 'sheet', 'skills', 'stats']),

  // The engine-room HUD — a rig-level lens, owned by no neuma. Solo direct
  // launcher (like WALLET): one click opens the single pane of glass.
  plain('engine', null, ['substrate']),
  plain('vault', null, ['wallet']), // solo launcher — no section label
]);

/** Alphabetical by what the operator READS, in the operator's language. Pure. */
const byLabel = ([idA, a], [idB, b]) =>
  String(a?.label ?? idA).localeCompare(String(b?.label ?? idB), currentLocale());

/**
 * Partition the registry's dock apps into ordered, present-only sections, each
 * carrying its bands. Any registry app not named in a group is appended to a
 * trailing 'more' section (label null) so nothing is ever hidden.
 *
 * `items` is the section's whole membership flattened in band order — kept so a
 * caller that only needs […] (the activity mark) never
 * has to walk the bands.
 * @param {Array<[string, object]>} dockApps [id, app] entries (app.dock !== false)
 * @param {Array<{id,label,bands,apps}>} groups
 * @returns {Array<{id: string, label: (string|null),
 *   bands: Array<{label: (string|null), items: Array<[string, object]>}>,
 *   items: Array<[string, object]>}>}
 */
export const groupDockApps = (dockApps, groups = DOCK_GROUPS) => {
  const byId = new Map(dockApps);
  const claimed = new Set();
  const out = groups
    .map((g) => {
      const bands = g.bands
        .map((b) => ({
          label: b.label,
          items: b.apps
            .filter((id) => byId.has(id))
            .map((id) => { claimed.add(id); return [id, byId.get(id)]; })
            .sort(byLabel),
        }))
        // An empty band must not leave its header hanging over nothing.
        .filter((b) => b.items.length > 0);
      return { id: g.id, label: g.label, bands, items: bands.flatMap((b) => b.items) };
    })
    .filter((g) => g.items.length > 0);

  const leftover = dockApps.filter(([id]) => !claimed.has(id)).sort(byLabel);
  if (leftover.length) {
    out.push({ id: 'more', label: null, bands: [{ label: null, items: leftover }], items: leftover });
  }
  return out;
};

/**
 * A section's aggregate window state, for the label's activity mark: 'focused'
 * if the focused window is one of its apps, else 'open' if any is open, else
 * 'closed'. Pure — decoupled from the reducer so it is unit-testable.
 * @param {string[]} itemIds registry ids of the section's apps
 * @param {string[]} openIds ids of currently-open windows
 * @param {string|null} focusedId id of the focused window
 * @returns {'focused'|'open'|'closed'}
 */
export const sectionActivity = (itemIds, openIds, focusedId) => {
  if (focusedId != null && itemIds.includes(focusedId)) return 'focused';
  if (itemIds.some((id) => openIds.includes(id))) return 'open';
  return 'closed';
};
