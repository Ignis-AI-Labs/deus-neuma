// portal-send.js — wallet-scoped frame routing: sendToWallet, the desk
// notification kill switch, and the notification-bus / forge-activity wiring.
// Extracted from portal-routes.js (P8 decomposition, SIZE-033 plan) — bodies
// byte-identical.
import { createLogger } from '../services/logger.js';
import { setNotificationSender, notifyOperator } from '../services/notification-bus.js';
import { setActivityNotifier } from '../services/image-forge/forge-activity.js';
import { setRunFrameSender } from '../services/team-run-live.js';
import { readOwnerStrict } from '../middleware/require-neuma-owner.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';
import { portalConnections } from './portal-connections.js';
import { connectionState, frameState, reachesState, OPERATOR_STATE } from '../../core/runtime/operator-state.js';

const log = createLogger('Portal');

/**
 * THE NOTIFICATION KILL SWITCH — read ONCE, at module load.
 *
 * Env doors in this repo are boot-only by law, and this one is deliberately
 * read from the ambient environment rather than pinned in the Electron spawn
 * env (`electron/backend-spawn.cjs`): pinning there is for what a packaged app
 * must never be talked out of; this is the opposite, a capability the
 * operator must be able to switch OFF.
 *
 * It is the only rollback fast enough for a published build: the shell spawns
 * the backend with `...process.env`, so `NEUMA_DESK_NOTIFICATIONS=0` stops the
 * whole fan-out on any lane — dev, Electron, or a community AppImage — with no
 * rebuild, no revert, and no release.
 */
const notificationsEnabled = String(process.env.NEUMA_DESK_NOTIFICATIONS ?? '1') !== '0';

/**
 * Send a frame to every open desk belonging to ONE operator.
 *
 * ── WHY THIS IS NOT ANOTHER broadcast* ──────────────────────────────────────
 *
 * The three broadcasters above write to every socket unconditionally, and that
 * is correct for them: they carry bare counts and a disk level, deliberately
 * shaped so […] (see the comment above `broadcastSubstrateActivity`).
 *
 * A notification carries a being's NAME and a task's TITLE. Fanning that out
 * the same way would break the law those frames were shaped around. Every
 * connection already carries the `walletAddress` its session token was verified
 * against, so the filter costs one comparison — but it has to actually be here,
 * because the copy-paste source has no filter at all.
 *
 * ── WHY THE COMPARE IS CASE-INSENSITIVE ─────────────────────────────────────
 *
 * `walletAddress` arrives from `verifySessionToken().address` and an Ethereum
 * address is the same address whether or not it carries EIP-55 checksum casing.
 * A strict `===` between a checksummed address and a lowercased one matches
 * NOTHING — and it fails SILENTLY: every test that uses one wallet still passes,
 * while the feature is inert on the operator's machine. The house precedent is
 * `ownedBy` in `team-run-store.js`, which lowercases both sides for exactly this
 * reason.
 *
 * ── WHY IT CANNOT THROW ─────────────────────────────────────────────────────
 *
 * The per-socket `try` in the loops above guards `send` only; shaping happens
 * before it. This function is called from the notification bus, which is called
 * from — among other places — the heartbeat's interval callback. An uncaught
 * throw in a Node timer is not a missing card, it is the backend process dying
 * and every desk losing its portal mid-turn. So the whole body is guarded, and a
 * failure is logged rather than swallowed.
 *
 * impure — walks the live connections map and writes to sockets.
 *
 * @param {string} wallet - the operator's address, any casing
 * @param {object} frame - a JSON-serialisable frame, already shaped by the caller
 * @returns {number} how many sockets it reached
 */
export const sendToWallet = (wallet, frame) => (notificationsEnabled ? deliverToWallet(wallet, frame) : 0);

/**
 * The fan-out itself, ungated: a live team run's board is the run, not a
 * notification about it — the notification kill switch must not blind the
 * operator to a team that is working. Same wallet law as sendToWallet.
 *
 * impure — walks the live connections map and writes to sockets.
 *
 * @param {string} wallet - the operator's address, any casing
 * @param {object} frame
 * @param {{quiet?: boolean, state?: ('harness'|'full'|null)}} [opts] - quiet: no
 *   desk open is ordinary (a team run's frames, several a second, while the
 *   operator's desk is closed); state: which operator state the frame belongs
 *   to — absent, read from the frame (core/runtime/operator-state.js). The
 *   harness and the full platform never hear each other's frames.
 * @returns {number} how many sockets it reached
 */
export const deliverToWallet = (wallet, frame, { quiet = false, state } = {}) => {
  try {
    if (typeof wallet !== 'string' || wallet === '') {
      log.warn('Notification dropped — no wallet to address it to', { type: frame?.type });
      return 0;
    }
    const target = wallet.toLowerCase();
    const belongs = state === undefined ? frameState(frame) : state;
    const payload = JSON.stringify(frame);
    let delivered = 0;
    for (const c of portalConnections.values()) {
      if (typeof c.walletAddress !== 'string') continue;
      if (c.walletAddress.toLowerCase() !== target) continue;
      if (!reachesState(belongs, connectionState(c))) continue; // the other state's desk
      if (!c.ws || c.ws.readyState !== 1 /* OPEN */) continue;
      try {
        c.ws.send(payload);
        delivered += 1;
      } catch { /* a dying socket must not break the loop */ }
    }
    // Zero delivered is not always wrong — the operator may simply have no desk
    // open. But it is also exactly what a broken address comparison looks like,
    // and that failure is otherwise invisible, so it is never silent.
    if (delivered === 0 && !quiet) {
      log.warn('Notification reached no desk', { type: frame?.type, openConnections: portalConnections.size });
    }
    return delivered;
  } catch (error) {
    log.error('Notification fan-out failed', { error: error.message, type: frame?.type });
    return 0;
  }
};

// The bus lives in services/ and must not import routes/ — the same cycle the
// heartbeat's storage notifier avoids. Wiring the transport HERE, at load,
// rather than in server.js keeps this feature out of a file three other
// workstreams are currently editing.
setNotificationSender(sendToWallet);
// A live team run's frames reach every desk of its operator (team-run-live.js)
// — quietly: a run working while no desk is open is the background working.
// Teams are the full platform's (beings lead them) — never a harness desk's.
setRunFrameSender((wallet, frame) => deliverToWallet(wallet, frame, { quiet: true, state: OPERATOR_STATE.full }));

// A RENDER FINISHED. The forge's activity feed knows the lane but not the
// operator — nothing in that path carries a wallet — so the owner is resolved
// from the lane's own owner.json, the same record every ownership check reads.
// A lane with no readable owner raises nothing rather than broadcasting
// unscoped: an unaddressed notification must reach nobody, never everybody.
setActivityNotifier(async (record) => {
  if (!record?.laneId) return;
  const owner = await readOwnerStrict(record.laneId);
  if (owner.status !== 'ok') return;

  const failed = record.phase === 'error';
  const stopped = record.phase === 'stopped';
  const imageId = Array.isArray(record.images) && record.images.length > 0
    ? record.images[0].imageId ?? null
    : null;

  await notifyOperator({
    wallet: owner.owner.wallet,
    kind: KIND.renderDone,
    standing: STANDING.neuma,
    title: failed
      ? `${record.beingName || 'A being'} could not finish a render`
      : (stopped
        ? `${record.beingName || 'A being'} stopped a render`
        : `${record.beingName || 'A being'} finished a render`),
    detail: record.pipelineLabel || record.detail || null,
    actor: { id: record.laneId, name: record.beingName || record.laneId },
    ref: { jobId: record.jobId, imageId, phase: record.phase },
  });
});
