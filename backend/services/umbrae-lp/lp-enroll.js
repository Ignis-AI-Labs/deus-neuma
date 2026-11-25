// lp-enroll.js — the LP wallet signs in on Umbrae as an AI agent and gets its key.
//
// Umbrae issues a challenge for the wallet, the wallet signs it (lp-signer.js
// signs that one text and nothing else), Umbrae answers with a session, and
// the session creates a key that acts for this wallet. The key is saved beside
// the wallet (lp-wallet.js) and reused until Umbrae stops honouring it.
//
// Signing the challenge declares the wallet an AI agent account on Umbrae,
// permanently. That is the truth of what it is.

import { callUmbrae } from './umbrae-lp-client.js';
import { signAgentAuth } from './lp-signer.js';
import { lpSigner, readUmbraeKey, saveUmbraeKey } from './lp-wallet.js';

/** How long Umbrae is asked to honour a key. A lapsed key is replaced by signing in again. */
const KEY_TTL_DAYS = 7;

const refuse = (reason) => Object.freeze({ ok: false, reason });

/**
 * The Umbrae key for this house member's LP wallet: the saved one, or a new
 * one from a fresh sign-in. Never throws. impure — reads and writes the keys
 * folder, calls Umbrae.
 *
 * @param {string} neumaId
 * @param {{renew?: boolean}} [opts] renew — the saved key was refused; sign in again
 * @returns {Promise<Readonly<{ok: true, key: string, wallet: string, fresh: boolean} | {ok: false, reason: string}>>}
 */
export const umbraeKeyFor = async (neumaId, { renew = false } = {}) => {
  const signer = await lpSigner(neumaId);
  if (!signer) return refuse('This house member has no LP wallet yet.');
  if (!renew) {
    const saved = await readUmbraeKey(neumaId);
    if (saved) return Object.freeze({ ok: true, key: saved, wallet: signer.address, fresh: false });
  }
  const challenge = await callUmbrae('challenge', { body: { purpose: 'agent-auth', walletAddress: signer.address } });
  if (!challenge.ok) return refuse(challenge.error);
  const signed = await signAgentAuth({ signer, message: challenge.payload?.message });
  if (!signed.ok) return signed;
  const session = await callUmbrae('signIn', {
    body: {
      purpose: 'agent-auth', walletAddress: signer.address, signature: signed.signature,
      message: challenge.payload.message, timestamp: signed.timestamp, nonce: signed.nonce,
    },
  });
  if (!session.ok) return refuse(session.error);
  const created = await callUmbrae('createKey', {
    token: session.payload?.sessionToken,
    body: { name: 'neuma-house-member', scopes: ['read', 'write'], ttlDays: KEY_TTL_DAYS },
  });
  if (!created.ok) return refuse(created.error);
  try {
    await saveUmbraeKey(neumaId, created.payload?.key);
  } catch (err) {
    return refuse(`Umbrae's answer held no usable key: ${err.message}`);
  }
  return Object.freeze({ ok: true, key: created.payload.key, wallet: signer.address, fresh: true });
};
