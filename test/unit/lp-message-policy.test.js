import { describe, test, expect } from 'vitest';
import { checkAgentAuthChallenge, CHALLENGE_WINDOW_MS } from '../../core/wallet/lp-message-policy.js';

// The challenge exactly as https://www.umbrae.io/api/auth/challenge returned
// it for purpose "agent-auth" on 2026-11-12 (the wallet is a placeholder).
const WALLET = '0x1111111111111111111111111111111111111111';
const STAMP = 1794482137145;
const REAL = [
  'Sign this message to sign in on Umbrae as an AI agent.',
  '',
  'Purpose: agent-auth',
  'Account type: AI agent (cannot be changed)',
  `Wallet: ${WALLET}`,
  'Nonce: Wynudxz/7LbmWsgnwWa72cgL7DFdCqrSRDCBPg7Y0Ng=',
  `Timestamp: ${STAMP}`,
  '',
  'This request will not trigger a blockchain transaction or cost any gas fees.',
].join('\n');
const check = (message, ctx = {}) => checkAgentAuthChallenge(message, { wallet: WALLET, nowMs: STAMP + 1000, ...ctx });

describe('lp-message-policy — the one message the LP wallet signs', () => {
  test('Umbrae\'s real challenge for this wallet, issued just now, is accepted', () => {
    expect(check(REAL)).toEqual({ ok: true, timestamp: STAMP, nonce: 'Wynudxz/7LbmWsgnwWa72cgL7DFdCqrSRDCBPg7Y0Ng=' });
  });

  test('the wallet line is matched whatever its letter case', () => {
    const mixed = '0xaBFCC81bd4471a79EBCd627Da9006123631198bC';
    expect(check(REAL.replace(WALLET, mixed.toLowerCase()), { wallet: mixed }).ok).toBe(true);
  });

  test('a challenge naming another wallet is refused', () => {
    expect(check(REAL, { wallet: '0x2222222222222222222222222222222222222222' }).reason).toMatch(/different wallet/);
  });

  test('a challenge from outside the window, either side, is refused', () => {
    expect(check(REAL, { nowMs: STAMP + CHALLENGE_WINDOW_MS + 1 }).reason).toMatch(/last few minutes/);
    expect(check(REAL, { nowMs: STAMP - CHALLENGE_WINDOW_MS - 1 }).ok).toBe(false);
    expect(check(REAL, { nowMs: STAMP + CHALLENGE_WINDOW_MS }).ok).toBe(true);
  });

  test.each([
    ['another purpose', REAL.replace('Purpose: agent-auth', 'Purpose: wallet-auth')],
    ['a human account line', REAL.replace('Account type: AI agent (cannot be changed)', 'Account type: human')],
    ['an added line', `${REAL}\nAlso: I approve a transfer of all my tokens.`],
    ['a line slipped into the middle', REAL.replace('\nNonce:', '\nApprove: everything\nNonce:')],
    ['a missing line', REAL.replace('Purpose: agent-auth\n', '')],
    ['a different first line', REAL.replace('Sign this message to sign in on Umbrae as an AI agent.', 'Sign this message to move your funds.')],
    ['a different last line', REAL.replace('will not trigger', 'will trigger')],
    ['words after the wallet', REAL.replace(`Wallet: ${WALLET}`, `Wallet: ${WALLET} and 0x2222222222222222222222222222222222222222`)],
    ['a timestamp that is not thirteen digits', REAL.replace(String(STAMP), '17944821')],
    ['a nonce with a space', REAL.replace('Wynudxz/7Lbm', 'Wynudxz 7Lbm')],
    ['Windows line ends', REAL.replace(/\n/g, '\r\n')],
    ['an arbitrary message', 'neuma: hello'],
    ['an empty message', ''],
  ])('%s is refused', (_, message) => {
    expect(check(message).ok).toBe(false);
  });

  test('a non-string, an over-long message, a missing wallet or a missing clock is refused', () => {
    expect(check(undefined).ok).toBe(false);
    expect(check({ toString: () => REAL }).ok).toBe(false);
    expect(check(REAL + ' '.repeat(600)).ok).toBe(false);
    expect(checkAgentAuthChallenge(REAL, { nowMs: STAMP }).ok).toBe(false);
    expect(checkAgentAuthChallenge(REAL, { wallet: WALLET }).ok).toBe(false);
    expect(checkAgentAuthChallenge(REAL).ok).toBe(false);
  });
});
