/**
 * TABS MODEL — the pure state of a desk's parallel sittings.
 *
 * Session tabs, slice 2. Every function here is pure: ids and timestamps are
 * PASSED IN, never minted, so a tab set is fully reproducible from its inputs
 * and can be proven without a clock or a random source.
 *
 * ── WHAT A TAB IS ───────────────────────────────────────────────────────────
 *
 * One sitting. It knows its KIND — `local` (a neuma on this machine's GPU) or
 * `witness` (a sealed peer reached over the network) — because the two answer to
 * different budgets and a tab that cannot say which it is cannot be counted.
 *
 * `sessionId` is null until the server mints one on the first message. That is
 * the existing law (`use-consciousness-stream.newSession`), not a new one: a tab
 * is a place for a sitting before it is a sitting.
 *
 * ── THE HOUSE TAB ───────────────────────────────────────────────────────────
 *
 * Broadcast frames (substrate activity, storage warnings, the local turn count)
 * fan out per CONNECTION. With one socket per tab, N tabs would hear the house
 * N times and `localTurns` — which counts across ALL desks — would multiply.
 *
 * So exactly one tab is the HOUSE tab and owns those frames; the rest ignore
 * them. It is simply the eldest surviving tab, and when it closes the next
 * inherits — no election, no gap, and no window where nobody is listening.
 *
 * ── RESTART ─────────────────────────────────────────────────────────────────
 *
 * Design note, 2026-07-30: […]
 * Design note, 2026-08-02: […]
 *
 * These read as opposites and are not. The first law is about BINDING; the
 * second is about REMEMBERING, and a restored id does not bind anything.
 *
 * A restored tab comes back with its identity AND the sitting it held, and
 * still binds only when it is focused. So a restart costs exactly the one bind
 * it always did — the focused tab's — and the GPU budget is spent no earlier
 * than before. What changes is only WHICH sitting a tab returns to when its
 * moment comes: its own, instead of whichever happened to be newest.
 *
 * Dropping the id was not merely forgetful. `focusPlan` reads a null sessionId
 * as […], so ChatApp's focus effect called newSession()
 * — a restart did not fail to resume your chat, it MINTED A FRESH ONE OVER IT.
 * The old sitting survived on disk, but nothing on the desk pointed back at it.
 *
 * Resuming is disk-only: portal:resume reads the session's JSONL and hydrates
 * connection runtime, touching no substrate and loading no model. That is why
 * remembering is free and the 2026-07-30 law stands unamended.
 */

import { TAB_KIND } from './tab-budget.js';

/** The shape a restored session id may take. The CHARACTER CLASS is the one
 *  NeumaWorkspace enforces before a session id becomes a path segment
 *  (SEC-033); the length bound is ADDED here, because this value is read off
 *  localStorage, where anything can be written, and the workspace's own guard
 *  has no cap. Real ids are `session-<13-digit ms>` — 21 characters — so the
 *  bound cannot reject a genuine sitting. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A desk holds at most this many tabs regardless of budget — a strip past this
 *  is unreadable, and both budgets are enforced above it anyway. */
export const MAX_TABS_PER_WINDOW = 24;

export const emptyTabs = () => Object.freeze({ tabs: Object.freeze([]), focusedId: null });

/** Pure — the tab a lookup means, or null. */
export const tabById = (state, id) => state?.tabs?.find((t) => t.id === id) ?? null;

/** Pure — the focused tab, or null when the strip is empty. */
export const focusedTab = (state) => tabById(state, state?.focusedId);

/** Pure — a tab's age as a sortable number. An unstamped tab is treated as
 *  infinitely young, so it never displaces a tab that can prove its age. */
const bornAt = (t) => {
  const ms = Date.parse(t?.createdAt ?? '');
  return Number.isFinite(ms) ? ms : Infinity;
};

/**
 * Pure — the HOUSE tab: the eldest surviving one. Identity, not a role that has
 * to be granted, so it can never be vacant while any tab is open.
 *
 * ELDEST, NOT LEFTMOST. Until the strip could be reordered these were the same
 * thing and this read `tabs[0]`. They are not the same any more: binding the
 * house to a POSITION would let a drag hand the house's broadcast frames to a
 * different sitting — `localTurns` would jump, and the substrate light would
 * start answering for the wrong tab. Dragging a tab must reorder the strip and
 * nothing else.
 *
 * Ties (same stamp, or none) fall back to position, which is insertion order.
 */
export const houseTab = (state) => {
  const tabs = state?.tabs ?? [];
  if (!tabs.length) return null;
  return tabs.reduce((eldest, t) => (bornAt(t) < bornAt(eldest) ? t : eldest), tabs[0]);
};

/** Pure — does this tab own the house's broadcast frames? */
export const isHouseTab = (state, id) => houseTab(state)?.id === id;

/** Pure — live counts by kind, for the budget. A window's own slice of them. */
export const countsByKind = (state) => {
  const tabs = state?.tabs ?? [];
  return {
    local: tabs.filter((t) => t.kind === TAB_KIND.local).length,
    witness: tabs.filter((t) => t.kind === TAB_KIND.witness).length,
  };
};

/**
 * Pure — a new tab set with `tab` appended and focused.
 *
 * The BUDGET is not consulted here and must not be — for two reasons now.
 *
 * It is machine-wide, and this model only ever sees one window: keeping the
 * two apart is what stops a window from quietly authorising itself. And since
 * 2026-10-15 no budget governs a tab at all — opening, focusing or connecting
 * (Founder: […]): the measured width caps
 * generation, in the house's line (substrate-lease.js).
 *
 * @param {object} state
 * @param {{id: string, kind: 'local'|'witness', neumaId: string, name?: string,
 *          sessionId?: (string|null), createdAt: string}} tab
 * @returns {object} the new state — unchanged if the tab is invalid or the
 *   strip is full
 */
export const openTab = (state, tab, { focus = true } = {}) => {
  const current = state?.tabs ?? [];
  if (!tab?.id || !tab?.neumaId) return state ?? emptyTabs();
  if (tab.kind !== TAB_KIND.local && tab.kind !== TAB_KIND.witness) return state ?? emptyTabs();
  if (current.length >= MAX_TABS_PER_WINDOW) return state ?? emptyTabs();
  if (current.some((t) => t.id === tab.id)) return state ?? emptyTabs(); // ids are identity
  const next = Object.freeze({
    id: tab.id,
    kind: tab.kind,
    neumaId: tab.neumaId,
    name: tab.name || tab.neumaId,
    sessionId: tab.sessionId ?? null,
    createdAt: tab.createdAt ?? null,
    // THE SITTING'S OWN WORKING GROUND (Design note, 2026-08-29: […]). null means this tab has
    // chosen nothing and rides the window's lens — the behaviour every desk
    // had before, so a strip nobody has focused per-tab is untouched.
    //
    // Opaque HERE on purpose: what a valid focus IS belongs to the focus
    // module (desk-focus.js — kind/id/path, absolute paths, no control
    // characters), and the model must not carry a second opinion about it.
    // The storage boundary validates on the way in (normalizeTabs).
    focus: tab.focus ?? null,
  });
  return Object.freeze({
    tabs: Object.freeze([...current, next]),
    // A tab you opened is a tab you meant to look at — unless the machine has
    // no slot to run it in. Looking at a dormant tab is what STARTS it, so
    // focusing one the rig cannot hold would either seize a slot the budget
    // just refused, or leave the frame showing some other sitting under this
    // tab's name. It waits on the strip instead, and the caller says why.
    focusedId: focus ? next.id : (state?.focusedId ?? next.id),
  });
};

/**
 * Pure — close a tab. Focus moves to the NEIGHBOUR, preferring the one to the
 * left, which is where the eye already is.
 */
export const closeTab = (state, id) => {
  const current = state?.tabs ?? [];
  const at = current.findIndex((t) => t.id === id);
  if (at === -1) return state ?? emptyTabs();
  const tabs = current.filter((t) => t.id !== id);
  if (!tabs.length) return emptyTabs();
  const focusedId = state.focusedId === id
    ? (tabs[Math.max(0, at - 1)]?.id ?? tabs[0].id)
    : state.focusedId;
  return Object.freeze({ tabs: Object.freeze(tabs), focusedId });
};

/** Pure — focus a tab. An unknown id changes nothing rather than blanking. */
export const focusTab = (state, id) => {
  if (!tabById(state, id)) return state ?? emptyTabs();
  return Object.freeze({ tabs: state.tabs, focusedId: id });
};

/** Pure — rename a tab. An empty name falls back to the being's own id, so a
 *  tab can never become a nameless strip entry. */
export const renameTab = (state, id, name) => {
  if (!tabById(state, id)) return state ?? emptyTabs();
  return Object.freeze({
    tabs: Object.freeze(state.tabs.map((t) => (t.id === id
      ? Object.freeze({ ...t, name: String(name ?? '').trim() || t.neumaId })
      : t))),
    focusedId: state.focusedId,
  });
};

/**
 * Pure — move a tab to another position in the strip.
 *
 * Design note, 2026-07-31: […]
 *
 * ORDER IS PRESENTATION AND NOTHING ELSE. Focus does not move (you reorganised
 * the strip, you did not change what you are looking at), and neither does the
 * house — see `houseTab`, which reads age rather than position precisely so
 * this function cannot hand the house's frames to a different sitting.
 *
 * @param {object} state
 * @param {string} id - the tab being dragged
 * @param {number} toIndex - destination index, clamped into the strip
 */
export const moveTab = (state, id, toIndex) => {
  const tabs = state?.tabs ?? [];
  const from = tabs.findIndex((t) => t.id === id);
  if (from === -1) return state ?? emptyTabs();
  const n = Math.trunc(Number(toIndex));
  if (!Number.isFinite(n)) return state; // a junk destination moves nothing
  const to = Math.min(tabs.length - 1, Math.max(0, n));
  if (to === from) return state;
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return Object.freeze({ tabs: Object.freeze(next), focusedId: state.focusedId });
};

/**
 * Pure — point a tab at a different being.
 *
 * Design note, 2026-07-30: […]
 *
 * The tab KEEPS its id — it is the same place in the strip, now holding someone
 * else — so focus, order, and the house tab are all undisturbed by a switch.
 *
 * The sessionId is DROPPED, always. A session belongs to the being it was
 * minted for; carrying one across a switch would resume one being's chat under
 * another's name, which is the worst kind of memory error this desk can make.
 * The tab rebinds from the window's own session state once the switch settles.
 *
 * The KIND moves with the being, because the budgets are per kind: switching a
 * tab from a witness to a neuma moves that sitting from the witness count onto
 * the GPU's.
 */
export const retargetTab = (state, id, { neumaId, name, kind } = {}) => {
  const current = tabById(state, id);
  if (!current) return state ?? emptyTabs();
  if (typeof neumaId !== 'string' || !neumaId) return state;
  if (kind !== TAB_KIND.local && kind !== TAB_KIND.witness) return state;
  // Same being, same kind — nothing moved, and dropping the session for a mere
  // rename would cost the operator the chat they are looking at.
  if (current.neumaId === neumaId && current.kind === kind) return state;
  return Object.freeze({
    tabs: Object.freeze(state.tabs.map((t) => (t.id === id
      ? Object.freeze({
        ...t, neumaId, kind, name: String(name ?? '').trim() || neumaId, sessionId: null,
      })
      : t))),
    focusedId: state.focusedId,
  });
};

/**
 * Pure — point this sitting at its own working ground.
 *
 * Design note, 2026-08-29: […]
 *
 * A SWITCH OF BEING KEEPS THE GROUND (see retargetTab, which spreads the tab).
 * The folder is where the OPERATOR is working, not something the being brought
 * with it — swapping who sits in a tab must not silently move the Explorer out
 * from under the work.
 *
 * `null` returns the tab to the window's lens. The value is opaque here: what
 * a valid focus is belongs to the focus module, and the storage boundary is
 * where an untrusted one is refused.
 *
 * @param {object} state
 * @param {string} id
 * @param {object|null} focus
 */
export const setTabFocus = (state, id, focus) => {
  const current = tabById(state, id);
  if (!current) return state ?? emptyTabs();
  const next = focus ?? null;
  if (current.focus === next) return state;
  return Object.freeze({
    tabs: Object.freeze(state.tabs.map((t) => (t.id === id ? Object.freeze({ ...t, focus: next }) : t))),
    focusedId: state.focusedId,
  });
};

/**
 * Pure — the window payload a TORN-OUT sitting opens with: who, which of
 * their conversations, and the ground they were working on. The ground is not
 * optional baggage — a tear-out that dropped it landed the sitting on
 * whatever lens the DESK's focused tab held, a different sitting's ground
 * (the 2026-09-01 leak).
 */
export const tearOutPayload = (tab) => Object.freeze({
  neumaId: tab?.neumaId ?? null,
  name: tab?.name ?? null,
  kind: tab?.kind ?? null,
  sessionId: tab?.sessionId ?? null,
  focus: tab?.focus ?? null,
});

/**
 * Pure — record the sessionId the server minted for this tab.
 *
 * The server owns session identity; this only remembers what it said. Called
 * from the `consciousness:complete` echo, which is where the id has always
 * arrived.
 */
export const bindSession = (state, id, sessionId) => {
  if (!tabById(state, id)) return state ?? emptyTabs();
  return Object.freeze({
    tabs: Object.freeze(state.tabs.map((t) => (t.id === id
      ? Object.freeze({ ...t, sessionId: sessionId ?? null })
      : t))),
    focusedId: state.focusedId,
  });
};

/**
 * Pure — what focusing this tab requires of the desk.
 *
 * A tab carries its own being, so arriving at one is up to two acts: SEAT that
 * being if they are not already in the chair, then bring this tab's sitting to
 * the front. The seat comes first and matters: minting a fresh session reads
 * whoever the window currently holds, so mint-before-seat would open the new
 * chat against the being of the tab you just LEFT.
 *
 * @returns {{seat: (string|null), resume: (string|null), mint: boolean}}
 */
export const focusPlan = (tab, seatedNeumaId) => {
  if (!tab?.neumaId) return Object.freeze({ seat: null, resume: null, mint: false });
  return Object.freeze({
    seat: tab.neumaId === seatedNeumaId ? null : tab.neumaId,
    resume: tab.sessionId ?? null,
    // A tab that has never spoken has no sitting to resume, so it opens one.
    mint: !tab.sessionId,
  });
};

/**
 * Pure — should this companion change move the focused tab?
 *
 * The whole difficulty: a companion change can mean two opposite things.
 *   - The OPERATOR switched beings → the focused tab follows them. (retarget)
 *   - Focusing a tab is SEATING that tab's own being → the change is the
 *     consequence, and following it would write the OUTGOING tab's being onto
 *     the incoming tab. The exact inversion of what a per-tab switch means.
 *
 * `rebindingTabId` is the tab whose seat is currently in flight, and telling
 * the two apart is its entire job. `landed` reports that an in-flight seat has
 * arrived, so the caller can retire the marker.
 *
 * @returns {{retarget: boolean, landed: boolean}}
 */
export const switchPlan = (tab, seatedNeumaId, rebindingTabId = null) => {
  if (!tab?.neumaId || !seatedNeumaId) return Object.freeze({ retarget: false, landed: false });
  if (seatedNeumaId === tab.neumaId) {
    return Object.freeze({ retarget: false, landed: rebindingTabId === tab.id });
  }
  if (rebindingTabId === tab.id) return Object.freeze({ retarget: false, landed: false });
  return Object.freeze({ retarget: true, landed: false });
};

/**
 * Pure — WHOSE context anatomy does the frame read?
 *
 * Design note, 2026-08-30: […] The
 * gauge was subscribed once at desk level and provided to every pane at once,
 * so four open sittings all showed the anchor tab's numbers. Not stale numbers
 * — ANOTHER CHAT'S numbers, which is worse: a gauge that is merely behind at
 * least still describes the thing you are looking at.
 *
 * Each portal now reports its own anatomy on its own socket, and this decides
 * which one the frame shows.
 *
 * THE SUBTLE PART, and the reason this is a function and not an `||`:
 * a portal that has connected but seen no turn yet reports `null`, and that
 * null IS this tab's answer — […]. Falling through to
 * the anchor's numbers on a falsy value would reinstate the original bug in
 * miniature, one pane borrowing another's usage, precisely during the window
 * where a fresh chat looks most like it is showing something wrong. So the
 * question is whether the tab has REPORTED, not whether it reported a value.
 *
 * @param {string|null} focusedId
 * @param {Object<string, unknown>} byTab anatomy reported per portal tab
 * @param {unknown} anchor the enclosing host's anatomy — the anchor tab rides
 *   the window's own portal, so its answer comes from the provider above
 * @returns {unknown}
 */
export const focusedComposition = (focusedId, byTab, anchor = null) => {
  if (!focusedId) return anchor;
  const reported = byTab && typeof byTab === 'object' ? byTab : {};
  return Object.prototype.hasOwnProperty.call(reported, focusedId) ? reported[focusedId] : anchor;
};

/**
 * Pure — the shape that goes to disk, and the shape that comes back.
 *
 * `sessionId` is KEPT (ruling, 2026-08-02): a tab that forgets its sitting cannot
 * return the operator to it, and — because `focusPlan` reads a null id as
 * "never spoken" — would mint a fresh chat over it instead. Carrying the id
 * does not bind anything; see the RESTART note at the top of this file.
 */
export const serializeTabs = (state) => ({
  tabs: (state?.tabs ?? []).map((t) => ({
    id: t.id, kind: t.kind, neumaId: t.neumaId, name: t.name,
    sessionId: t.sessionId ?? null, createdAt: t.createdAt ?? null,
    // The ground survives a restart with its sitting — reopening the desk puts
    // each tab back on the folder it was working in.
    focus: t.focus ?? null,
  })),
  focusedId: state?.focusedId ?? null,
});

/**
 * Pure — validate a persisted tab set on the way in. Anything malformed is
 * dropped rather than trusted; a corrupt record must cost the tabs it broke,
 * never the desk.
 */
export const normalizeTabs = (raw, { normalizeFocus = () => null } = {}) => {
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.tabs)) return emptyTabs();
  const seen = new Set();
  const tabs = raw.tabs.filter((t) => {
    if (typeof t?.id !== 'string' || !t.id || seen.has(t.id)) return false;
    if (typeof t?.neumaId !== 'string' || !t.neumaId) return false;
    if (t.kind !== TAB_KIND.local && t.kind !== TAB_KIND.witness) return false;
    seen.add(t.id);
    return true;
  }).slice(0, MAX_TABS_PER_WINDOW).map((t) => Object.freeze({
    id: t.id,
    kind: t.kind,
    neumaId: t.neumaId,
    name: typeof t.name === 'string' && t.name.trim() ? t.name : t.neumaId,
    // The sitting this tab held, so focusing it RETURNS rather than mints.
    // Validated to the shape the workspace enforces on a session id: anything
    // malformed reads as "no sitting yet" — a corrupt record costs the place,
    // never the tab, and never an id that would resume nothing.
    sessionId: typeof t.sessionId === 'string' && SESSION_ID_RE.test(t.sessionId) ? t.sessionId : null,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : null,
    // THE GROUND IS UNTRUSTED ON THE WAY IN, and this module deliberately does
    // not hold a second opinion about what a valid focus is — desk-focus.js
    // owns that (kind/id/path, absolute paths only, no control characters),
    // and a duplicate copy here could drift from it, which for a value that
    // becomes a filesystem lens is the wrong thing to be casual about.
    //
    // So the validator is INJECTED, and the default FAILS CLOSED: a caller
    // that restores tabs without supplying one gets no ground restored rather
    // than an unchecked path off disk.
    focus: normalizeFocus(t.focus ?? null) ?? null,
  }));
  if (!tabs.length) return emptyTabs();
  const focusedId = tabs.some((t) => t.id === raw.focusedId) ? raw.focusedId : tabs[0].id;
  return Object.freeze({ tabs: Object.freeze(tabs), focusedId });
};
