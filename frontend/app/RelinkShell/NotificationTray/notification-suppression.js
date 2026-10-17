/**
 * SUPPRESSION — the difference between a tray that gets read and one that gets ignored.
 *
 * Founder asked for this because work finishes […] The corollary matters just as much: when he IS looking at it,
 * a card telling him what he just watched happen is noise. Enough noise and the
 * bell is permanently red, at which point the one notification that mattered is
 * buried by the ones he was already watching — and the feature has failed while
 * appearing to work.
 *
 * ── SUPPRESSED IS NOT DROPPED ───────────────────────────────────────────────
 *
 * A suppressed record is still recorded, and still marked read by the window
 * that watched it happen — which broadcasts that read, so every other desk
 * agrees. It simply does not RISE: no toast, no OS notification, no unread
 * badge. The history stays complete, because […]
 * is the question the tray exists to answer.
 *
 * ── WHY IT TAKES A CONTEXT OBJECT ───────────────────────────────────────────
 *
 * Every input is passed in — visibility, which app is frontmost, which session
 * this window is bound to. The impure assembly of that context (reading
 * `document.visibilityState`, the window-manager state, the desk's focus) lives
 * in the hook. Here it is a plain function over plain data, which is what makes
 * every case below provable with nothing faked.
 */

import { KIND, isBeingKind } from '../../../../core/runtime/notification-record.js';

/**
 * Kinds that always rise, whatever the operator is looking at.
 *
 * These are not […] — they are conditions of the
 * machine the operator needs regardless of where their attention is. Suppressing
 * a disk-critical warning because the right window happened to be focused would
 * be a safety failure, not a courtesy.
 */
const ALWAYS_RAISE = Object.freeze([
  KIND.storageWarning,
  KIND.codeReload,
  KIND.turnRefused,
]);

/**
 * Should this record raise a card in THIS window?
 *
 * @param {object} record - a validated notification record
 * @param {object} viewer - this window's situation
 * @param {boolean} [viewer.documentVisible] - is this document actually on screen
 * @param {?string} [viewer.frontmostAppId] - the desk app in front, e.g. 'chat'
 * @param {?string} [viewer.activeSessionId] - the sitting this window is bound to
 * @param {?string} [viewer.activeNeumaId] - the being this window is bound to
 * @returns {boolean}
 */
export const shouldRaise = (record, viewer = {}) => {
  if (!record || typeof record.kind !== 'string') return false;
  if (ALWAYS_RAISE.includes(record.kind)) return true;
  if (!isBeingKind(record.kind)) return true;

  // The window is not on screen at all — hidden, minimised, another workspace,
  // or the operator is in a different application. Everything rises; this is the
  // case the whole feature was asked for.
  if (viewer.documentVisible !== true) return true;

  const sessionId = record.ref?.sessionId ?? null;
  const laneId = record.actor?.id ?? record.ref?.laneId ?? null;

  // Watching this exact sitting, with the stream in front: the operator saw it.
  if (sessionId && viewer.activeSessionId && sessionId === viewer.activeSessionId) {
    return viewer.frontmostAppId !== 'chat';
  }

  // No session on the record (a settle, a render) but this window is bound to
  // the being that did it, and its surface is in front — the operator is
  // already looking at the thing that changed.
  if (!sessionId && laneId && viewer.activeNeumaId && laneId === viewer.activeNeumaId) {
    return viewer.frontmostAppId !== 'chat';
  }

  return true;
};

/**
 * Pure — should this record ALSO leave the app as a native OS notification?
 *
 * Strictly narrower than `shouldRaise`. An in-app card is cheap; a desktop
 * popup interrupts whatever the operator is actually doing, and its body may be
 * persisted by the OS outside NEUMA's reach. So it fires only when the desk is
 * genuinely not on screen — never merely because another desk app is frontmost.
 */
export const shouldNotifyOS = (record, viewer = {}) => {
  if (!shouldRaise(record, viewer)) return false;
  return viewer.documentVisible !== true;
};
