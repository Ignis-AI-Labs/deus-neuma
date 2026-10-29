/**
 * NOTIFICATION COALESCE — the reason the bell is worth looking at.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ──────────────────────────────────────
 *
 * A busy multi-window sitting fires a completion on every take, plus interrupts,
 * plus refusals, plus task settles, plus forge phases. Dozens an hour is the
 * ORDINARY case, not the pathological one. If every one of them becomes its own
 * card, the bell is permanently red, the operator stops reading it, and the one
 * notification that mattered — the parallel-window finish that motivated the
 * whole surface — is buried by the ones they were already watching.
 *
 * A tray nobody reads is indistinguishable from no tray. So collapsing is not
 * polish here; it is the feature working.
 *
 * ── WHAT COLLAPSES, AND WHAT NEVER DOES ─────────────────────────────────────
 *
 * Repetition of the SAME thing from the SAME source inside a short window is
 * noise: eight takes from one lane are one piece of news, "Fenna is working."
 * Two different beings finishing are two pieces of news, however close together.
 *
 * So the grouping key is (kind + lane), never time alone, and a collapse
 * REPLACES the card rather than stacking beside it — carrying a count so the
 * operator can see it was eight and not one.
 *
 * Nothing is ever dropped. A collapsed record still goes to the store; only the
 * *card* is merged. The history stays complete because […] is the question the tray answers, and an answer that silently
 * discarded seven of eight events would be a lie.
 *
 * ── WHY IT HOLDS NO TIMER ───────────────────────────────────────────────────
 *
 * `nowMs` is a parameter. A module that reads the clock cannot be tested without
 * faking the clock, and RULE 0 forbids a fake anywhere in the path being
 * claimed. Passing the instant in means every window-boundary case here is an
 * ordinary function call with an ordinary expected value — and the caller, which
 * is impure anyway, owns the one thing that genuinely varies.
 *
 * Pure. The state is data in, data out; the caller holds it.
 */

import { KIND } from './notification-record.js';

/**
 * How long two same-source events count as one piece of news.
 *
 * Long enough to swallow a burst of takes inside one turn, short enough that
 * work finishing minutes apart still reads as two events. This is a judgement,
 * not a measurement, and it is the first number to revisit if the operator says
 * the tray is noisy.
 */
export const COALESCE_WINDOW_MS = 30_000;

/**
 * Kinds that must NEVER be collapsed, whatever their rate.
 *
 * A refusal is not a quieter completion — it is different news, and merging two
 * refusals from one lane would hide that a being declined twice. A disk warning
 * is a safety path: the second one is not redundant with the first, it means the
 * disk got worse. And the reload offer is a singleton by its own logic.
 */
const NEVER_COALESCE = Object.freeze([
  KIND.turnRefused,
  KIND.storageWarning,
  KIND.codeReload,
  // Each company-line card is a different move owed (or a company standing):
  // one being moving two companies' lines seconds apart is two decisions, and
  // a merge would replace the first card with the second.
  KIND.companyLine,
]);

/** The empty state a caller starts from. Pure. */
export const initialCoalesceState = () => Object.freeze({ groups: Object.freeze({}) });

/**
 * The grouping key: what makes two events "the same news".
 *
 * Lane before session deliberately. A being that finishes four takes across two
 * sessions is still one being working, and the operator's question is […], not […]. Falls back to the record id when
 * there is no lane, which makes the record its own group — i.e. never collapses.
 *
 * Pure.
 */
export const coalesceKey = (record) => {
  const lane = record?.actor?.id
    || record?.ref?.laneId
    || record?.ref?.neumaId
    || record?.id
    || '';
  return `${record?.kind ?? ''}::${lane}`;
};

/**
 * Fold one record into the coalesce state.
 *
 * Returns the next state and the CARD ACTION the caller should take. The action
 * is deliberately explicit rather than inferred from a diff, because the two
 * outcomes drive different UI: `raise` means a new card rises (and, when the
 * desk is unfocused, an OS notification fires); `replace` means an existing card
 * updates in place and must NOT fire a second OS notification.
 *
 * Getting that distinction wrong is what turns a burst into a popup storm.
 *
 * @param {{groups: object}} state - previous state; treated as immutable
 * @param {object} record - a validated notification record
 * @param {number} nowMs - the caller's clock
 * @returns {{state: {groups: object},
 *            action: 'raise'|'replace',
 *            key: string,
 *            count: number,
 *            supersedes: (string|null)}}
 *   `supersedes` is the id of the card this one replaces, or null when it is new.
 */
export const coalesce = (state, record, nowMs) => {
  const groups = state?.groups && typeof state.groups === 'object' ? state.groups : {};
  const key = coalesceKey(record);
  const ts = Number.isFinite(nowMs) ? nowMs : 0;

  if (NEVER_COALESCE.includes(record?.kind)) {
    return {
      state: Object.freeze({ groups }),
      action: 'raise',
      key,
      count: 1,
      supersedes: null,
    };
  }

  const prior = groups[key];
  const withinWindow = prior
    && Number.isFinite(prior.lastMs)
    && (ts - prior.lastMs) < COALESCE_WINDOW_MS;

  const next = Object.freeze({
    ...groups,
    [key]: Object.freeze({
      lastMs: ts,
      count: withinWindow ? prior.count + 1 : 1,
      cardId: withinWindow ? prior.cardId : (record?.id ?? null),
    }),
  });

  return {
    state: Object.freeze({ groups: next }),
    action: withinWindow ? 'replace' : 'raise',
    key,
    count: withinWindow ? prior.count + 1 : 1,
    // The card being replaced is the one that OPENED the group, not the previous
    // record — the operator is looking at that card, and it is the DOM node the
    // tray must update.
    supersedes: withinWindow ? prior.cardId : null,
  };
};

/**
 * Drop groups whose window has closed. Pure.
 *
 * Without this the state grows one entry per (kind, lane) forever on a long-
 * lived backend. Called by the same impure caller that owns the clock; there is
 * no timer here, by design.
 */
export const pruneCoalesceState = (state, nowMs) => {
  const groups = state?.groups && typeof state.groups === 'object' ? state.groups : {};
  const ts = Number.isFinite(nowMs) ? nowMs : 0;
  const kept = {};
  for (const [key, group] of Object.entries(groups)) {
    if (Number.isFinite(group?.lastMs) && (ts - group.lastMs) < COALESCE_WINDOW_MS) {
      kept[key] = group;
    }
  }
  return Object.freeze({ groups: Object.freeze(kept) });
};
