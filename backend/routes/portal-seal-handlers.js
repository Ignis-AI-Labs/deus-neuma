// portal-seal-handlers.js — the post-birth custody frames: birth:encrypt_keypair,
// the ceremony seal (preflight / sign / confirm), and the house founding
// (preflight / sign / confirm). Extracted from portal-routes.js (P8
// decomposition, SIZE-033 plan) — bodies byte-identical but for
// case→function conversion.
import { createLogger } from '../services/logger.js';
import {
  neumaWorkspace,
  encryptKeypair, generateRecoveryCodes, hashRecoveryCodes,
  encryptWithRecoveryCodes, MIN_KEY_PASSWORD,
} from '../../core/index.js';
import {
  prepareBirthSeal, buildSealTx, confirmBirthSeal, writeOnchainSealRecord,
} from '../services/birth-seal-flow.js';
import {
  markSealSent, clearSealSent, recheckSentSeal, recoverSealFromChain,
} from '../services/birth-seal-recovery.js';
import { cacheDecryptedKey } from './neuma-auth-routes.js';
import {
  prepareHouseFounding, buildFoundingTx, confirmHouseFounding, writeFoundingRecord,
} from '../services/house-founding-flow.js';
import {
  markFoundingSent, clearFoundingSent, readFoundingSent, recheckSentFounding,
} from '../services/house-founding-recovery.js';
import { getAppConfig } from '../config.js';
import { resolveSealRequestSealed } from '../services/seal-request.js';
import { ownsNeumaLane } from './portal-context.js';
import { redactRpcUrl } from '../services/chain/chain-registry.js';

const birthLog = createLogger('Birth');

export const birthEncryptKeypair = async (connection, message) => {
  const { ws } = connection;
  // Operator provides password to encrypt the neuma's keypair after birth.
  // Required post-birth step: skip is not offered in the ceremony UI.
  // Bind to the being THIS portal just birthed, or a lane this operator owns —
  // never an arbitrary id from the wire (same gate as birth:seal_preflight).
  const encNeumaId = message.neumaId;
  const encPassword = message.password;

  if (!encNeumaId || !encPassword || typeof encPassword !== 'string'
      || encPassword.length < MIN_KEY_PASSWORD) {
    ws.send(JSON.stringify({
      type: 'birth:encrypt_keypair_error',
      error: `Password must be at least ${MIN_KEY_PASSWORD} characters`,
    }));
    return;
  }

  const encBornHere = connection.companion?.neumaId === encNeumaId;
  if (!encBornHere && !(await ownsNeumaLane(connection, encNeumaId))) {
    ws.send(JSON.stringify({
      type: 'birth:encrypt_keypair_error',
      error: 'Not your lane',
    }));
    return;
  }

  try {
    // Read the interim keypair written during birth (platform DEK envelope)
    const plaintextKeypair = await neumaWorkspace.readKeypair(encNeumaId);
    if (!plaintextKeypair) {
      ws.send(JSON.stringify({
        type: 'birth:encrypt_keypair_error',
        error: 'No keypair found for this neuma',
      }));
      return;
    }

    // Encrypt with password
    const encrypted = encryptKeypair(plaintextKeypair, encPassword);
    await neumaWorkspace.writeEncryptedKeypair(encNeumaId, encrypted);

    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes();
    const recoveryHash = hashRecoveryCodes(recoveryCodes);
    await neumaWorkspace.writeRecoveryHash(encNeumaId, recoveryHash);

    // Encrypt with recovery codes (alternative decryption path)
    const recoveryEncrypted = encryptWithRecoveryCodes(plaintextKeypair, recoveryCodes);
    await neumaWorkspace.writeRecoveryKeypair(encNeumaId, recoveryEncrypted);

    // The seal step follows password-securing in the ceremony now: cache
    // the key for THIS session before the plaintext leaves disk, so the
    // anchor moments later signs without re-asking the password the
    // operator just chose. One-shot (SEC-028) — consumed by exactly one
    // seal prepare, then gone; a later seal walks the unlock door.
    cacheDecryptedKey(encNeumaId, plaintextKeypair);

    // Delete plaintext keypair
    await neumaWorkspace.deletePlaintextKeypair(encNeumaId);

    birthLog.info('Keypair encrypted, plaintext removed', { neumaId: encNeumaId });

    ws.send(JSON.stringify({
      type: 'birth:keypair_secured',
      neumaId: encNeumaId,
      recoveryCodes: [...recoveryCodes], // Send once, never stored
    }));
  } catch (err) {
    birthLog.error('Keypair encryption error', { err: err.message });
    ws.send(JSON.stringify({
      type: 'birth:encrypt_keypair_error',
      error: 'Failed to secure keypair',
    }));
  }
};

// A held bundle is worth re-offering only with this much of its signed
// deadline left (v3 law, seal-law.js); a law that signs none never expires.
const OFFER_MARGIN_S = 300;
const offerStillSealable = (bundle, nowMs = Date.now()) => (
  !bundle?.deadline || bundle.deadline - Math.floor(nowMs / 1000) > OFFER_MARGIN_S
);

// The being stands anchored: record it beside its genesis seal, forget any
// sent-tx marker, tell the desk, and settle a paused request_seal turn. One
// path for a confirmed receipt, a re-checked sent tx, and a chain recovery.
const announceSealed = async (connection, neumaId, record, net) => {
  await writeOnchainSealRecord(neumaId, record);
  await clearSealSent(neumaId);
  connection.pendingSeal = null;
  birthLog.info('Being anchored on chain', { neumaId, txHash: record.txHash, network: record.network });
  connection.ws.send(JSON.stringify({
    type: 'birth:sealed',
    neumaId,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    network: record.network,
    networkLabel: net.label,
  }));
  // If this seal was ASKED FOR by the being (request_seal), settle the
  // paused turn with the truth of the anchor.
  resolveSealRequestSealed(connection, neumaId, {
    txHash: record.txHash,
    network: record.network,
    networkLabel: net.label,
    blockNumber: record.blockNumber,
  });
};

export const birthSealPreflight = async (connection, message) => {
  const { ws } = connection;
  // The operator asks to anchor the just-born being on chain. The backend
  // assembles the two-phase bundle (her ADDRESS only — her key stays in
  // the desk wallet), runs the shared preflight, and holds the bundle on
  // this connection: record encryption uses a fresh nonce, so the digest
  // she is about to sign exists only in this assembly.
  const sealNeumaId = message.neumaId;
  // Bind to the being THIS portal just birthed, or a lane this operator
  // owns — never an arbitrary id from the wire. A missing id would match a
  // connection bound to no being (undefined === undefined): refused first.
  if (typeof sealNeumaId !== 'string' || !sealNeumaId) {
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'NOT_OWNER', message: 'Name the being to seal' }));
    return;
  }
  const bornHere = connection.companion?.neumaId === sealNeumaId;
  if (!bornHere && !(await ownsNeumaLane(connection, sealNeumaId))) {
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'NOT_OWNER', message: 'Not your lane' }));
    return;
  }
  try {
    // A seal tx already SENT for this lane is checked, never offered again:
    // a second tx while the first is pending pays gas to be reverted (one
    // seal per soul), and one that landed only needs its record.
    const sent = await recheckSentSeal({ neumaId: sealNeumaId, cfg: getAppConfig() });
    if (sent?.state === 'sealed') {
      await announceSealed(connection, sealNeumaId, sent.record, sent.net);
      return;
    }
    if (sent?.state === 'pending') {
      ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'SEAL_PENDING', message: sent.message }));
      return;
    }
    // A dead sent tx (reverted, expired, dropped) took its bundle with it.
    if (sent?.state === 'open') connection.pendingSeal = null;
    // A retry (wallet declined, operator clicks ANCHOR again) re-offers the
    // HELD bundle — same assembly, same digest she was already shown. A
    // fresh prepare would consume nothing new and, post-securing, the
    // one-shot key cache (SEC-028) is already spent: re-preparing would
    // strand the retry at KEY_LOCKED inside a ceremony with no unlock door.
    // Only while its signed deadline leaves time to sign, broadcast and mine:
    // an expired bundle reverts on chain, so it is dropped and re-prepared.
    if (connection.pendingSeal?.neumaId === sealNeumaId && connection.pendingSeal.offer) {
      if (offerStillSealable(connection.pendingSeal.bundle)) {
        ws.send(JSON.stringify({ type: 'birth:seal_ready', ...connection.pendingSeal.offer }));
        return;
      }
      connection.pendingSeal = null;
    }
    const prep = await prepareBirthSeal({
      neumaId: sealNeumaId,
      // SERVER-SIDE config, never the wire value: a compromised renderer
      // must not be able to point a ceremony seal at mainnet. The
      // operator opens mainnet ceremonies deliberately via
      // CEREMONY_SEAL_NETWORK=base (defense-in-depth over the digest's
      // chainId binding + the wallet's confirm dialog).
      network: getAppConfig().ceremonySealNetwork,
      witnessAddress: connection.walletAddress,
      cfg: getAppConfig(),
    });
    if (prep.code === 'ALREADY_SEALED') {
      // The being's own seal stands on chain with no record here (a lost
      // confirmation): read the anchor back rather than refuse forever.
      const recovered = await recoverSealFromChain({
        neumaId: sealNeumaId, network: getAppConfig().ceremonySealNetwork, cfg: getAppConfig(),
      }).catch((err) => {
        birthLog.warn('Seal recovery from chain failed', { neumaId: sealNeumaId, err: redactRpcUrl(err.message) });
        return null;
      });
      if (recovered) {
        await announceSealed(connection, sealNeumaId, recovered.record, recovered.net);
        return;
      }
    }
    if (!prep.ok) {
      birthLog.warn('Seal preflight refused', { neumaId: sealNeumaId, code: prep.code });
      ws.send(JSON.stringify({ type: 'birth:seal_error', code: prep.code, message: prep.message }));
      return;
    }
    connection.pendingSeal = {
      neumaId: sealNeumaId, bundle: prep.bundle, network: prep.network, net: prep.net,
      offer: prep.offer, // held for retry re-offers (same digest, no re-prepare)
    };
    ws.send(JSON.stringify({ type: 'birth:seal_ready', ...prep.offer }));
  } catch (err) {
    birthLog.error('Seal preflight error', { neumaId: sealNeumaId, err: redactRpcUrl(err.message) });
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'PREFLIGHT', message: 'Seal preflight failed' }));
  }
};

export const birthSealSign = async (connection, message) => {
  const { ws } = connection;
  // The desk wallet signed the inner payload — verify the signature
  // recovers to the operator over the HELD bundle's digest, then hand back
  // the relay-safe calldata for the desk to broadcast.
  const pending = connection.pendingSeal;
  if (!pending || pending.neumaId !== message.neumaId) {
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'NO_PENDING', message: 'No seal awaiting a signature' }));
    return;
  }
  const built = buildSealTx({
    pending,
    witnessSig: message.witnessSig,
  });
  if (!built.ok) {
    birthLog.warn('Seal signature refused', { neumaId: pending.neumaId, code: built.code });
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: built.code, message: built.message }));
    return;
  }
  pending.bundle = built.bundle;
  ws.send(JSON.stringify({ type: 'birth:seal_tx', neumaId: pending.neumaId, ...built.tx }));
};

export const birthSealConfirm = async (connection, message) => {
  const { ws } = connection;
  // The desk broadcast the tx — wait for the receipt, verify it landed at
  // Natalis and the chain recognizes the soul, then persist the anchor
  // record beside the genesis seal.
  const pending = connection.pendingSeal;
  if (!pending || pending.neumaId !== message.neumaId) {
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'NO_PENDING', message: 'No seal awaiting confirmation' }));
    return;
  }
  try {
    // Recorded BEFORE the wait: a receipt timeout, a reconnect or a backend
    // restart finds this tx on the next ANCHOR and checks it.
    await markSealSent(pending.neumaId, { pending, txHash: message.txHash });
    const outcome = await confirmBirthSeal({
      pending, txHash: message.txHash,
    });
    if (!outcome.ok) {
      // A reverted or mis-addressed tx never sealed — nothing stays pending.
      if (outcome.code === 'TX_REVERTED' || outcome.code === 'TX_MISMATCH') await clearSealSent(pending.neumaId);
      birthLog.warn('Seal confirmation refused', { neumaId: pending.neumaId, code: outcome.code });
      ws.send(JSON.stringify({ type: 'birth:seal_error', code: outcome.code, message: outcome.message }));
      return;
    }
    await announceSealed(connection, pending.neumaId, outcome.record, pending.net);
  } catch (err) {
    birthLog.error('Seal confirmation error', { neumaId: pending.neumaId, err: redactRpcUrl(err.message) });
    ws.send(JSON.stringify({ type: 'birth:seal_error', code: 'CONFIRM', message: 'Seal confirmation failed' }));
  }
};

export const houseFoundPreflight = async (connection, message) => {
  const { ws } = connection;
  // The operator asks to establish her house on chain — or probes whether
  // it already stands. The backend composes the roster from her own
  // lanes (being keys sign from server custody), takes the digest from
  // the DEPLOYED registry, and holds the preflight on this connection.
  // Titles are member-chosen wire content; the NETWORK is server-side
  // config (HOUSE_FOUND_NETWORK), same doctrine as the ceremony seal.
  try {
    // A founding tx already SENT is checked, never offered again: a second
    // tx while the first is pending pays gas to be reverted (NameTaken), and
    // one that landed only needs its record (then the chain reads founded).
    const sent = await recheckSentFounding({ wallet: connection.walletAddress, cfg: getAppConfig() });
    if (sent?.state === 'founded') {
      await writeFoundingRecord(sent.record);
      await clearFoundingSent(connection.walletAddress);
    }
    if (sent?.state === 'pending') {
      connection.pendingFounding = null;
      ws.send(JSON.stringify({ type: 'house:found_error', code: 'FOUNDING_PENDING', message: sent.message }));
      return;
    }
    const prep = await prepareHouseFounding({
      witnessAddress: connection.walletAddress,
      titles: message.titles,
      probe: message.probe === true,
      cfg: getAppConfig(),
    });
    if (!prep.ok) {
      birthLog.warn('House founding preflight refused', { code: prep.code });
      ws.send(JSON.stringify({ type: 'house:found_error', code: prep.code, message: prep.message }));
      return;
    }
    if (prep.founded) {
      connection.pendingFounding = null;
      ws.send(JSON.stringify({ type: 'house:found_state', ...prep.state }));
      return;
    }
    if (prep.probe) {
      // Roster-only answer — nothing held, nothing to sign yet.
      ws.send(JSON.stringify({ type: 'house:found_open', ...prep.probe }));
      return;
    }
    connection.pendingFounding = prep.pending;
    ws.send(JSON.stringify({ type: 'house:found_ready', ...prep.offer }));
  } catch (err) {
    birthLog.error('House founding preflight error', { err: redactRpcUrl(err.message) });
    ws.send(JSON.stringify({ type: 'house:found_error', code: 'PREFLIGHT', message: 'Founding preflight failed' }));
  }
};

export const houseFoundSign = async (connection, message) => {
  const { ws } = connection;
  // The desk wallet signed the inner payload — verify it recovers to the
  // operator over the HELD digest, then hand back the establishHouse
  // calldata for the desk to broadcast.
  const pending = connection.pendingFounding;
  if (!pending) {
    ws.send(JSON.stringify({ type: 'house:found_error', code: 'NO_PENDING', message: 'No founding awaiting a signature' }));
    return;
  }
  // A held founding outlives a confirm that ran out: once a tx was sent,
  // only a fresh preflight (which checks that tx) may offer another.
  if (await readFoundingSent(pending.witnessAddress)) {
    ws.send(JSON.stringify({
      type: 'house:found_error', code: 'FOUNDING_PENDING',
      message: 'a founding transaction was already sent — ask again to check it before anything new is signed',
    }));
    return;
  }
  const built = buildFoundingTx({ pending, witnessSig: message.witnessSig });
  if (!built.ok) {
    birthLog.warn('House founding signature refused', { code: built.code });
    ws.send(JSON.stringify({ type: 'house:found_error', code: built.code, message: built.message }));
    return;
  }
  ws.send(JSON.stringify({ type: 'house:found_tx', houseName: pending.houseName, ...built.tx }));
};

export const houseFoundConfirm = async (connection, message) => {
  const { ws } = connection;
  // The desk broadcast the founding — wait for the receipt, verify it
  // landed at the registry and the chain now holds the house, then
  // persist the founding record.
  const pending = connection.pendingFounding;
  if (!pending) {
    ws.send(JSON.stringify({ type: 'house:found_error', code: 'NO_PENDING', message: 'No founding awaiting confirmation' }));
    return;
  }
  try {
    // Recorded BEFORE the wait: a receipt timeout, a reconnect or a backend
    // restart finds this tx on the next preflight and checks it.
    await markFoundingSent({ pending, txHash: message.txHash });
    const outcome = await confirmHouseFounding({ pending, txHash: message.txHash });
    if (!outcome.ok) {
      // A reverted or mis-addressed tx never founded — nothing stays pending.
      if (outcome.code === 'TX_REVERTED' || outcome.code === 'TX_MISMATCH') await clearFoundingSent(pending.witnessAddress);
      birthLog.warn('House founding confirmation refused', { code: outcome.code });
      ws.send(JSON.stringify({ type: 'house:found_error', code: outcome.code, message: outcome.message }));
      return;
    }
    await writeFoundingRecord(outcome.record);
    await clearFoundingSent(pending.witnessAddress);
    connection.pendingFounding = null;
    birthLog.info('House established on chain', {
      houseName: outcome.record.houseName,
      txHash: outcome.record.txHash,
      network: outcome.record.network,
    });
    ws.send(JSON.stringify({
      type: 'house:founded',
      houseName: outcome.record.houseName,
      txHash: outcome.record.txHash,
      blockNumber: outcome.record.blockNumber,
      network: outcome.record.network,
      networkLabel: pending.net.label,
      members: outcome.record.members,
    }));
  } catch (err) {
    birthLog.error('House founding confirmation error', { err: redactRpcUrl(err.message) });
    ws.send(JSON.stringify({ type: 'house:found_error', code: 'CONFIRM', message: 'Founding confirmation failed' }));
  }
};
