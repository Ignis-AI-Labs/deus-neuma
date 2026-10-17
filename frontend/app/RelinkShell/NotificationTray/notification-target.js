/**
 * CLICK TARGET — where a notification takes the operator.
 *
 * […] A card that
 * names what happened but leaves the operator to go hunt for it has done half
 * the job; the click is the other half.
 *
 * ── WHY AN APP ID AND NOT A WINDOW ID ───────────────────────────────────────
 *
 * A card outlives its window. Stream windows are torn out, dragged, and closed
 * routinely, so a card holding a window id would frequently point at something
 * that no longer exists.
 *
 * An APP id degrades gracefully instead: the window manager's `open` already
 * raises and focuses an existing instance and creates one otherwise, so the
 * same dispatch does the right thing whether or not the window survived.
 *
 * ── WHY THE BACKEND DOES NOT DECIDE THIS ────────────────────────────────────
 *
 * The mapping from "what happened" to […] is the desk's
 * knowledge, and it changes when the desk changes. Putting it on the record
 * would mean the backend had to learn the app registry, and every stored record
 * would freeze one moment's routing table onto the operator's disk forever.
 *
 * So the record carries `ref` — the identity of the thing — and this pure
 * function maps it. Pure: no window manager, no React, no DOM.
 */

import { KIND } from '../../../../core/runtime/notification-record.js';

/**
 * Where a record points.
 *
 * @param {object} record
 * @returns {?{appId: string, payload: (object|null)}} null when a card is not
 *   navigable — its click does nothing rather than guessing at a destination.
 */
export const notificationTarget = (record) => {
  if (!record || typeof record.kind !== 'string') return null;
  const ref = record.ref && typeof record.ref === 'object' ? record.ref : {};

  switch (record.kind) {
    // The sitting where it happened. `sessionId` may be absent on a refusal —
    // the stream is still the right place to land, just without a specific
    // sitting to restore.
    case KIND.turnDone:
    case KIND.turnInterrupted:
    case KIND.turnRefused:
      return {
        appId: 'chat',
        payload: ref.sessionId
          ? { sessionId: ref.sessionId, neumaId: record.actor?.id ?? ref.neumaId ?? null }
          : null,
      };

    case KIND.taskClosed:
    case KIND.assignmentClosed:
      return { appId: 'todo', payload: ref.taskId ? { taskId: ref.taskId } : null };

    case KIND.runDone:
      return { appId: 'teams', payload: ref.runId ? { runId: ref.runId } : null };

    // A WORKING run's check-in or alert opens where it is watched, live.
    case KIND.runCheckIn:
    case KIND.runAlert:
      return { appId: 'workflow', payload: ref.runId ? { runId: ref.runId } : null };

    // The render itself, not the forge that made it — the operator wants to SEE
    // the image, which is what the gallery is for.
    case KIND.renderDone:
      return { appId: 'gallery', payload: ref.imageId ? { imageId: ref.imageId } : null };

    // Disk headroom is a machine fact, and the machine's own surface is where an
    // operator can act on it.
    case KIND.storageWarning:
      return { appId: 'substrate', payload: null };

    // The watch's finding lands in the SECURITY window — the office's own
    // first-class surface (the seat, the watch, the ledger, the reports).
    case KIND.securityAlert:
      return { appId: 'security', payload: null };

    // A house wake sent something back to the operator: the HOUSE CLOCK,
    // where the ask stands beside the wake that filed it and its sitting.
    case KIND.houseWake:
      return { appId: 'houseclock', payload: ref.wakeId ? { wakeId: ref.wakeId, sessionId: ref.sessionId ?? null } : null };

    // The legal watch's matters land in the LEGAL window — the Praetor's
    // office (the seat, the watch, the matters ledger).
    case KIND.legalAlert:
      return { appId: 'legal', payload: null };

    // A benchmark settled, or the bench watch saw it stuck: the BENCH window,
    // where its arms, receipts and failure report stand.
    case KIND.benchDone:
    case KIND.benchAlert:
      return { appId: 'bench', payload: null };

    // The sitting where the ask or plan card stands open — answering it is
    // the click's whole purpose.
    case KIND.awaitingAnswer:
      return {
        appId: 'chat',
        payload: ref.sessionId
          ? { sessionId: ref.sessionId, neumaId: record.actor?.id ?? null }
          : null,
      };

    // Nothing to open — the reload card's click IS its action, and routing it
    // somewhere would be a lie about what the click does.
    case KIND.codeReload:
      return null;

    default:
      return null;
  }
};
