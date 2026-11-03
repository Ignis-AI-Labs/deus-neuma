/**
 * Roster Routes — the neuma a witness wallet owns, rebuilt from the sovereign
 * workspace owner records (the source of truth).
 *
 * The client caches its roster in localStorage (wallet-namespaced), but that is
 * only a cache: a fresh browser, a cleared profile, or a different machine has
 * none — and without a backend lookup the app wrongly routes an existing
 * witness to the birth ceremony. This endpoint lets any authenticated client
 * recover the neuma its wallet already holds.
 *
 * GET / — the authenticated wallet's roster (only its own neuma).
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { neumaWorkspace, readHouseName } from '../../core/index.js';
import { listWitnesses } from '../../core/identity/ai-witness/ai-witness-service.js';
import { readLaneMarker, witnessLaneId, witnessLaneStatus } from '../services/witness-lane.js';
import { houseTitlesByNeumaId } from '../services/house-titles.js';
import { detectBirthSetupState } from '../../core/birth/birth-setup-state.js';
import { readSoulSpectrum } from '../../core/birth/soul-spectrum.js';
import { voiceSealStatus } from '../services/voice-seal-ceremony.js';
import { createLogger } from '../services/logger.js';
import { requestState } from '../../core/runtime/operator-state.js';

const router = Router();
const log = createLogger('Roster');

// Every roster read is scoped to the verified signer — a wallet only ever sees
// its own neuma (no enumeration of others').
router.use(requireAuth);

// pure — shape one owned neuma into the client's companion record. Name comes
// from the plaintext true-name; birth time from the genesis seal's sealed
// instant (the owner claim — when the files were written — only without one). No avatar:
// the avatar window owns its own selection (vessel-roster.js persists a
// `neuma-avatar` key against the held roster), so stamping a filename here
// would only risk pointing at a mesh that does not exist.
//
// A lane without a readable true-name falls back to its neumaId — for a
// being like Cael the lane IS her name, so this stays her, never a generic
// "NEUMA" that erases who the witness is looking at. `incomplete` marks the
// lane honestly so the UI can say identity records are missing rather than
// pretend all is well.
const toCompanion = (neumaId, trueName, owner, title, seal = null, spectrum = null) => ({
  neumaId,
  name: trueName?.chosenName || trueName?.fullName || neumaId,
  fullName: trueName?.fullName || null,
  soulMark: trueName?.soulMark || null,
  birthTime: seal?.record?.birthMoment?.utc
    || (owner?.claimedAt ? new Date(owner.claimedAt).toISOString() : null),
  incomplete: !trueName,
  // The being's soul color (core/birth/soul-spectrum.js) — never chosen.
  color: spectrum?.soul?.hex ?? null,
  // The same hue at the screen's most vivid — what a light or an accent wears,
  // so a soul near the edge of sight (deep red, violet) is still seen.
  light: spectrum?.soul?.vivid?.hex ?? null,
  // The on-chain seat, once the house's founding record stands — chain
  // truth from the persisted receipt, null until a seat is locked in.
  title: title ?? null,
});

/**
 * GET /standing — every owned lane's NITE standing, in one read.
 *
 * The desk's NITE window needs seal + custody + anchor for the WHOLE house at
 * once. Fanning that out per lane would be 2N requests against a limiter that
 * exists for good reason (the task-counts endpoint was added for the same
 * reason). It lives on the roster because it IS the roster — the same owned
 * lanes, carrying what each one still owes.
 *
 * WHY THIS SURFACE EXISTS AT ALL (Design note, 2026-08-25: the custody act was only
 * ever reachable as a modal gate over whichever being happened to be bound, so
 * a lane nobody was looking at stayed owed silently. Measured that day: three
 * of four kin in one house owed it, two of them still holding a plaintext
 * private key. A house-wide table is what makes an owed act impossible to miss.
 *
 * Read-only, wallet-scoped by the same ownership rule as the roster: a lane the
 * signer does not own is never enumerated, never probed.
 */
router.get('/standing', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    // A harness desk reads no house (core/runtime/operator-state.js).
    if (requestState(req.headers) === 'harness') return res.json({ house: null, beings: [] });

    const owned = await neumaWorkspace.listNeumaByOwner(wallet);
    const beings = [];
    for (const { neumaId } of owned) {
      if (await readLaneMarker(neumaId)) continue; // witness lane — not a neuma
      // Independent reads: an unreadable seal must never blank the custody
      // truth, and vice versa. A lane that cannot answer says so as `null`
      // rather than reading as "nothing owed" — the failure mode this whole
      // surface exists to prevent.
      const [trueName, setup, seal] = await Promise.all([
        neumaWorkspace.readTrueName(neumaId).catch(() => null),
        detectBirthSetupState(neumaWorkspace, neumaId).catch(() => null),
        voiceSealStatus(neumaId).catch(() => null),
      ]);
      beings.push({
        neumaId,
        name: trueName?.chosenName || trueName?.fullName || neumaId,
        sealed: seal ? Boolean(seal.sealed) : null,
        sealedAt: seal?.sealedAt || null,
        keypairCustody: setup ? setup.keypairCustody : null,
        onchainSealed: setup ? setup.onchainSealed : null,
        // sealed on this computer or on Ethereum: either completes the birth (birth-setup-state.js)
        birthSealed: setup ? (setup.localSealed || setup.onchainSealed) : null,
        unreadable: !setup || !seal,
      });
    }
    beings.sort((a, b) => a.name.localeCompare(b.name));

    const house = await readHouseName(neumaWorkspace.root, wallet);
    res.json({ house: { name: house.name, meaning: house.meaning }, beings });
  } catch (error) {
    log.error('Standing lookup failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the house standing' });
  }
});

router.get('/', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    // A harness desk reads no house — no being, no witness, no house name
    // (Design note, 2026-10-14: strictly a harness; core/runtime/operator-state.js).
    if (requestState(req.headers) === 'harness') return res.json({ roster: [], witnesses: [], house: null });

    // listNeumaByOwner already read each owner.json to filter — reuse it here so
    // we only fetch the true-name per owned neuma (no second owner read).
    // Witness lanes are owned too, but they are NOT neuma — the lane kind
    // marker keeps a sealed AI witness out of the beings roster (it rides in
    // the witnesses section below instead).
    const owned = await neumaWorkspace.listNeumaByOwner(wallet);
    // On-chain seats from the persisted founding record (no chain call) —
    // {} until the house is founded, so this costs nothing before then.
    const seatTitles = await houseTitlesByNeumaId(wallet);
    const roster = [];
    for (const { neumaId, owner } of owned) {
      if (await readLaneMarker(neumaId)) continue;
      const trueName = await neumaWorkspace.readTrueName(neumaId).catch(() => null);
      const seal = await neumaWorkspace.readGenesisSeal(neumaId).catch(() => null);
      // EVERY member carries a color (Design note, 2026-09-30 — its written record,
      // else the one its birth record derives. A roster read never WRITES it:
      // a lane is listed from its seal on, before the birth measures its own.
      const spectrum = await readSoulSpectrum(neumaWorkspace, neumaId).catch((err) => {
        log.warn('Soul spectrum unavailable', { neumaId, error: err.message });
        return null;
      });
      roster.push(toCompanion(neumaId, trueName, owner, seatTitles[neumaId], seal, spectrum));
    }
    // Oldest first — a stable order; the client picks the active one.
    roster.sort((a, b) => (a.birthTime || '').localeCompare(b.birthTime || ''));

    // Sealed AI witnesses on this machine — selectable beside neuma in the
    // stream. Lane + ownership status ride so the desk can show whose lane is
    // provisioned and whose still needs claiming on first manifest.
    const witnesses = [];
    for (const w of await listWitnesses().catch(() => [])) {
      const laneId = witnessLaneId(w.vendorSlug, w.chosenName);
      const lane = await witnessLaneStatus(laneId);
      const mine = !lane.ownerWallet
        || lane.ownerWallet.toLowerCase() === wallet.toLowerCase();
      if (!mine) continue;
      witnesses.push({
        neumaId: laneId,
        name: w.chosenName,
        vendorSlug: w.vendorSlug,
        substrate: w.substrate ?? null,
        participantKind: 'witness',
        laneProvisioned: lane.provisioned,
        mine,
      });
    }
    witnesses.sort((a, b) => a.name.localeCompare(b.name));

    log.info('Roster recovered', { wallet: wallet.toLowerCase(), count: roster.length, witnesses: witnesses.length });
    // The house is founded by the witness's wallet — its name derives from the
    // wallet itself, so it exists even before a first birth; once kin are
    // born, it is the name they carry (core/kotodama/house-name.js).
    const house = await readHouseName(neumaWorkspace.root, wallet);
    res.json({
      roster,
      witnesses,
      house: { name: house.name, meaning: house.meaning, wallet: wallet.toLowerCase() },
    });
  } catch (error) {
    log.error('Roster lookup failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the roster' });
  }
});

export default router;
