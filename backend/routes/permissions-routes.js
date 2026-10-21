/**
 * Permissions Routes — what the operator has PERMANENTLY granted, read back.
 *
 * Design note, 2026-08-30: […]
 *
 * Every ALWAYS decision is one click in a card that then disappears. The grant
 * is permanent and per-being, and until now no surface showed it: the only way
 * to know what a being may do today was to read `config/tool-policy.json` in
 * its lane by hand. This is the read side of that.
 *
 * ONE VERB, ADDED ON THE OPERATOR'S WORD. Design note, 2026-08-30: […] Revocation is an act
 * on a being's standing, so it did not arrive as a side effect of the audit
 * view — it is a separate POST, behind the same signer gate, re-checking
 * ownership on every call, and it can only ever take a grant AWAY. There is
 * still no endpoint here that widens anything.
 *
 * GET  /                  — every lane this wallet owns (its witness and harness lanes too), with its standing grants
 * GET  /:neumaId          — one lane's
 * POST /:neumaId/revoke   — take back ONE named grant
 *
 * Scoped to the verified signer exactly as the roster is: a wallet sees only
 * the beings it owns, and can never enumerate another operator's house.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { neumaWorkspace } from '../../core/index.js';
import { readLaneMarker } from '../services/witness-lane.js';
import { harnessLaneId } from '../services/harness-lane.js';
import { beingPermissions, housePermissions } from '../services/permissions-ledger.js';
import { revokeGrant, revokeRefusal } from '../services/permissions-revoke.js';
import { createLogger } from '../services/logger.js';
import { shellNetworkSessionHeld, revokeShellNetworkPermission } from '../services/shell-network-grants.js';
import { revokeRuntimePermission } from '../services/permission-runtime-revoke.js';

const router = Router();
const log = createLogger('Permissions');

router.use(requireAuth);

/**
 * One lane's standing grants. impure — reads the lane's config.
 *
 * A read that THROWS is reported as unreadable rather than as empty: an audit
 * surface that renders "no permissions" for a lane it could not open is a
 * reassuring blank where the honest answer is […].
 *
 * Policy IO returns null only for an absent file; unreadable authority is
 * surfaced here, never represented as an empty grant list.
 */
const laneRecord = async (being) => {
  try {
    const [policy, allowlist] = await Promise.all([
      neumaWorkspace.readToolPolicy(being.neumaId),
      neumaWorkspace.readSpendAllowlist(being.neumaId).catch(() => null),
    ]);
    return beingPermissions(being, policy, allowlist, { networkSession: shellNetworkSessionHeld(being.neumaId) });
  } catch (error) {
    log.warn('lane permissions unreadable', { neumaId: being.neumaId, error: error.message });
    return beingPermissions(being, null, null, { unreadable: true });
  }
};

// impure — a lane's display name: its own chosen name, else its id.
const laneName = async (neumaId) => {
  const trueName = await neumaWorkspace.readTrueName(neumaId).catch(() => null);
  return [trueName?.chosenName, trueName?.fullName]
    .find((value) => typeof value === 'string' && value.trim()) || neumaId;
};

const sameWallet = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** Every being (and sealed witness lane, and its harness lane) this wallet owns. impure. */
const ownedBeings = async (wallet) => {
  const owned = await neumaWorkspace.listNeumaByOwner(wallet);
  const beings = [];
  for (const { neumaId } of owned) {
    // Witness lanes carry standing grants too — a sealed peer is exactly the
    // kind of seat an operator most wants to audit — so unlike the roster this
    // does NOT filter them out. It records which kind each one is instead.
    const marker = await readLaneMarker(neumaId).catch(() => null);
    beings.push({ neumaId, name: await laneName(neumaId), kind: marker ? 'witness' : 'neuma' });
  }
  // Sealed witnesses' lanes stand on their own ground beside the house, where
  // the house listing above never reaches. owner.json decides, as for any
  // lane: only those claimed by this wallet are listed, as witnesses.
  for (const laneId of await neumaWorkspace.listWitnessLanes()) {
    if (beings.some((b) => b.neumaId === laneId)) continue;
    const owner = await neumaWorkspace.readOwner(laneId);
    if (sameWallet(owner?.wallet, wallet)) {
      beings.push({ neumaId: laneId, name: await laneName(laneId), kind: 'witness' });
    }
  }
  // The wallet's harness lane stands on its own ground, where no house
  // listing reaches — yet its ALWAYS grants are as standing as a being's.
  // Named as what it is, never as a being; owner.json decides, as for any lane.
  const harness = harnessLaneId(wallet);
  const harnessOwner = await neumaWorkspace.readOwner(harness);
  if (sameWallet(harnessOwner?.wallet, wallet)) {
    beings.push({ neumaId: harness, name: 'HARNESS', kind: 'harness' });
  }
  return beings;
};

router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    const beings = await ownedBeings(wallet);
    const records = await Promise.all(beings.map(laneRecord));
    res.json(housePermissions(records));
  } catch (error) {
    log.error('house permissions read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the house permissions' });
  }
});

router.get('/:neumaId', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    const { neumaId } = req.params;
    // OWNERSHIP IS RE-CHECKED HERE, not inherited from the list above: a
    // caller can name any lane it likes, and a permissions read is exactly the
    // shape of request an enumeration attempt would take.
    const beings = await ownedBeings(wallet);
    const being = beings.find((b) => b.neumaId === neumaId);
    if (!being) return res.status(404).json({ error: 'Not your being' });
    res.json(await laneRecord(being));
  } catch (error) {
    log.error('lane permissions read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the permissions' });
  }
});

/**
 * Take ONE named standing grant back.
 *
 * THE OWNERSHIP CHECK IS REPEATED HERE, not inherited from the read side. This
 * is the only endpoint in this file that writes, so it is the one that would be
 * worth attacking, and a revoke aimed at a lane the caller does not own must
 * die before it reaches a workspace.
 *
 * A grant that was ALREADY GONE answers 200 with `held: false` and writes
 * nothing. That is not leniency: the operator's intent is […], and it holds either way. Erroring would only punish two people
 * pressing the same row, and would make the panel's optimistic toggle lie.
 */
router.post('/:neumaId/revoke', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    const { neumaId } = req.params;
    const beings = await ownedBeings(wallet);
    const being = beings.find((b) => b.neumaId === neumaId);
    if (!being) return res.status(404).json({ error: 'Not your being' });

    if (req.body?.kind === 'act' && req.body?.server === 'coding' && req.body?.tool === 'shell_network') {
      const out = await revokeShellNetworkPermission(neumaId);
      log.warn('shell network revoked', { neumaId, by: wallet, held: out.held });
      return res.json({ ok: true, held: out.held, record: await laneRecord(being) });
    }
    const descriptor = req.body || {};
    const refusal = revokeRefusal(descriptor);
    if (refusal) return res.status(400).json({ error: refusal });
    let out;
    if (descriptor.kind === 'spend') {
      const allowlist = await neumaWorkspace.readSpendAllowlist(neumaId).catch(() => null);
      out = revokeGrant(descriptor, { allowlist });
      revokeRuntimePermission(neumaId, descriptor, out);
      if (out.held) await neumaWorkspace.writeSpendAllowlist(neumaId, out.allowlist);
    } else {
      // Read CURRENT authority under the same lock as every grant writer.
      // New-turn reads wait until disk removal and runtime invalidation finish.
      await neumaWorkspace.updateToolPolicy(neumaId, (policy) => {
        out = revokeGrant(descriptor, { policy });
        const sessionHeld = revokeRuntimePermission(neumaId, descriptor, out);
        const next = out.held ? out.policy : undefined;
        out.held ||= sessionHeld;
        return next;
      }, { afterCommit: () => {
        const sessionHeld = revokeRuntimePermission(neumaId, descriptor, out);
        out.held ||= sessionHeld;
      } });
    }
    if (out.held) {
      log.warn('standing grant revoked', {
        neumaId, kind: req.body?.kind, by: wallet,
        // The path/tool is recorded so the journal can answer […] — the question an audit surface exists to serve.
        target: req.body?.tool || req.body?.path || req.body?.address || null,
      });
    }
    res.json({ ok: true, held: out.held, record: await laneRecord(being) });
  } catch (error) {
    log.error('revoke failed', { error: error.message });
    res.status(500).json({ error: 'Could not revoke that grant' });
  }
});

export default router;
