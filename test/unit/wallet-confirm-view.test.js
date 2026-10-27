// Real tests for the trusted-confirm view layer — no mocks (RULE 0). The
// builders are pure and use real ethers; isTrustedResolve is proven with real
// object identity, the exact check the security boundary rests on.
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  buildSignConfirmView,
  buildGateView,
  isTrustedResolve,
  isSignInMessage,
  DEFAULT_CHAIN_ID,
} from '../../electron/wallet/confirm-view.cjs';

describe('buildSignConfirmView', () => {
  it('shapes a transaction with to / value / chain and a send label', () => {
    const v = buildSignConfirmView({ type: 'transaction', to: '0xabc', value: 10n ** 18n });
    expect(v.heading).toBe('CONFIRM TRANSACTION');
    expect(v.confirmLabel).toBe('CONFIRM & SEND');
    const byLabel = Object.fromEntries(v.fields.map((f) => [f.label, f.value]));
    expect(byLabel.TO).toBe('0xabc');
    expect(byLabel.VALUE).toBe('1.0 ETH');
    expect(byLabel.CHAIN).toBe(String(DEFAULT_CHAIN_ID));
    expect(v.fields.every((f) => f.mono)).toBe(true);
  });

  it('omits the DATA field for a plain 0x transfer but shows it for calldata', () => {
    const plain = buildSignConfirmView({ type: 'transaction', to: '0x1', value: 0n, data: '0x' });
    expect(plain.fields.find((f) => f.label === 'DATA')).toBeUndefined();
    const call = buildSignConfirmView({ type: 'transaction', to: '0x1', value: 0n, data: '0xdeadbeef' });
    expect(call.fields.find((f) => f.label === 'DATA').value).toContain('0xdeadbeef');
  });

  it('shapes typed data with domain, contract, chain and the JSON value body', () => {
    const v = buildSignConfirmView({
      type: 'signTypedData',
      domain: { name: 'Neuma', verifyingContract: '0xdead', chainId: 8453 },
      value: { hello: 'world' },
    });
    expect(v.heading).toBe('SIGN TYPED DATA');
    const labels = v.fields.map((f) => f.label);
    expect(labels).toEqual(['DOMAIN', 'CONTRACT', 'CHAIN']);
    expect(v.body).toContain('"hello": "world"');
  });

  it('decodes a readable personal_sign message into the body (no warning)', () => {
    const msg = 'neuma.local wants you to sign in with your Ethereum account';
    const hex = ethers.hexlify(ethers.toUtf8Bytes(msg));
    const v = buildSignConfirmView({ type: 'signMessage', message: hex });
    expect(v.heading).toBe('SIGN MESSAGE');
    expect(v.tone).toBe('normal');
    expect(v.warning).toBeUndefined();
    expect(v.body).toBe(msg);
    expect(v.confirmLabel).toBe('SIGN');
  });

  it('flags an opaque (non-UTF8) digest with the alert tone and a warning', () => {
    // 0x-prefixed bytes that are not valid UTF-8 → opaque digest.
    const v = buildSignConfirmView({ type: 'signMessage', message: '0xff01 fe02'.replace(' ', '') });
    expect(v.tone).toBe('alert');
    expect(v.warning).toMatch(/unreadable/i);
  });

  it('truncates a very long readable message (never dumps unbounded text)', () => {
    const long = 'A'.repeat(1000);
    const hex = ethers.hexlify(ethers.toUtf8Bytes(long));
    const v = buildSignConfirmView({ type: 'signMessage', message: hex });
    expect(v.body.length).toBeLessThan(long.length);
    expect(v.body.endsWith('…')).toBe(true);
  });
});

describe('buildGateView', () => {
  it('carries an alert tone + warning for destructive gates and uppercases labels', () => {
    const v = buildGateView({
      heading: 'reveal phrase',
      intro: 'Reveal your recovery phrase?',
      detail: 'Anyone who sees these 24 words controls this wallet.',
      confirmLabel: 'Reveal',
      tone: 'alert',
    });
    expect(v.kind).toBe('gate');
    expect(v.heading).toBe('REVEAL PHRASE');
    expect(v.confirmLabel).toBe('REVEAL');
    expect(v.rejectLabel).toBe('CANCEL');
    expect(v.tone).toBe('alert');
    expect(v.warning).toContain('24 words');
  });

  it('stays in the normal register for a non-destructive gate', () => {
    const v = buildGateView({ heading: 'custom rpc', intro: 'Route through a custom RPC?', detail: '…', confirmLabel: 'Set RPC' });
    expect(v.tone).toBe('normal');
    expect(v.warning).toBeNull();
  });
});

describe('isTrustedResolve — the sender-identity hinge', () => {
  it('accepts a resolve ONLY from the confirm window own contents', () => {
    const confirmWc = { id: 7, isDestroyed: () => false };
    expect(isTrustedResolve({ sender: confirmWc }, confirmWc)).toBe(true);
  });

  it('rejects a resolve forged from any other webContents', () => {
    const confirmWc = { id: 7, isDestroyed: () => false };
    const attackerWc = { id: 42, isDestroyed: () => false };
    expect(isTrustedResolve({ sender: attackerWc }, confirmWc)).toBe(false);
  });

  it('rejects once the confirm window is destroyed, and on missing args', () => {
    const dead = { id: 7, isDestroyed: () => true };
    expect(isTrustedResolve({ sender: dead }, dead)).toBe(false);
    expect(isTrustedResolve(null, dead)).toBe(false);
    expect(isTrustedResolve({ sender: dead }, null)).toBe(false);
  });
});

// The sign-in signature says "Sign in" — proven on the backend's own challenge.
describe('the sign-in challenge', () => {
  it('a real sign-in challenge shows SIGN IN; any other message still shows SIGN', async () => {
    const { generateChallenge } = await import('../../backend/services/auth.js');
    const challenge = generateChallenge(ethers.Wallet.createRandom().address);
    const view = buildSignConfirmView({ message: challenge });
    expect(view.heading).toBe('SIGN IN');
    expect(view.confirmLabel).toBe('SIGN IN');
    expect(view.rejectLabel).toBe('CANCEL');
    expect(view.body).toContain('wants you to sign in with your Ethereum account:');
    const other = buildSignConfirmView({ message: 'I agree to the terms' });
    expect(other.heading).toBe('SIGN MESSAGE');
    expect(other.confirmLabel).toBe('SIGN');
  });
  it('only the first line counts — the phrase quoted later in a message is not a sign-in', () => {
    expect(isSignInMessage('hello\nexample.com wants you to sign in with your Ethereum account:')).toBe(false);
    expect(isSignInMessage('example.com wants you to sign in with your Ethereum account:\n0xabc')).toBe(true);
    expect(isSignInMessage(undefined)).toBe(false);
  });
});
