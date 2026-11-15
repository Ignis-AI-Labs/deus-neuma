/**
 * LP message policy — the one message a house member's LP wallet may sign:
 * Umbrae's sign-in challenge for an AI agent, for that wallet, issued just now.
 *
 * The text is matched whole, line for line. A message that says anything more,
 * anything less, or names another wallet is refused, so this wallet's
 * signature can never be collected for another purpose. If Umbrae rewords its
 * challenge, sign-in refuses until this file is updated on purpose.
 *
 * The identity wallet's `neuma:` prefix rule (neuma-wallet.js) is untouched.
 *
 * Pure: no IO; the clock is passed in.
 */

import { getAddress, isAddress } from 'ethers';

/** How far a challenge's own timestamp may sit from now. */
export const CHALLENGE_WINDOW_MS = 10 * 60 * 1000;

const FIXED = Object.freeze({
  0: 'Sign this message to sign in on Umbrae as an AI agent.',
  1: '',
  2: 'Purpose: agent-auth',
  3: 'Account type: AI agent (cannot be changed)',
  7: '',
  8: 'This request will not trigger a blockchain transaction or cost any gas fees.',
});

const refuse = (reason) => Object.freeze({ ok: false, reason });

/**
 * Is this Umbrae's agent sign-in challenge for this wallet, issued now? Pure.
 *
 * @param {string} message - the challenge text as Umbrae returned it
 * @param {{wallet: string, nowMs: number}} ctx
 * @returns {Readonly<{ok: true, timestamp: number, nonce: string} | {ok: false, reason: string}>}
 */
export const checkAgentAuthChallenge = (message, { wallet, nowMs } = {}) => {
  if (!isAddress(wallet) || !Number.isFinite(nowMs)) return refuse('No LP wallet or time was given.');
  if (typeof message !== 'string' || message.length > 600) return refuse('That is not Umbrae\'s sign-in challenge.');
  const lines = message.split('\n');
  if (lines.length !== 9 || Object.entries(FIXED).some(([at, text]) => lines[at] !== text)) {
    return refuse('That is not Umbrae\'s sign-in challenge.');
  }
  const named = /^Wallet: (0x[0-9a-fA-F]{40})$/.exec(lines[4])?.[1];
  const nonce = /^Nonce: ([A-Za-z0-9+/=_-]{16,128})$/.exec(lines[5])?.[1];
  const stamp = /^Timestamp: (\d{13})$/.exec(lines[6])?.[1];
  if (!named || !nonce || !stamp) return refuse('That is not Umbrae\'s sign-in challenge.');
  if (getAddress(named) !== getAddress(wallet)) return refuse('The challenge names a different wallet.');
  const timestamp = Number(stamp);
  if (Math.abs(nowMs - timestamp) > CHALLENGE_WINDOW_MS) return refuse('The challenge is not from the last few minutes.');
  return Object.freeze({ ok: true, timestamp, nonce });
};
