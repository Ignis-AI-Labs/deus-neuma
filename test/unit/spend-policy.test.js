import { describe, test, expect } from 'vitest';
import {
  emptyAllowlist, toAllowlist, isRecipientAllowed, addEntry, removeEntry,
  requiresApproval, buildApprovalMessage, classifySpend,
} from '../../core/wallet/spend-policy.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

describe('spend-policy (pure)', () => {
  describe('isRecipientAllowed — DEFAULT-DENY', () => {
    test('denies when allowlist is null', () => {
      expect(isRecipientAllowed(null, A)).toBe(false);
    });

    test('denies when allowlist is empty', () => {
      expect(isRecipientAllowed(emptyAllowlist(), A)).toBe(false);
    });

    test('denies a recipient that is not listed', () => {
      const list = addEntry(null, A, 'savings', 't0');
      expect(isRecipientAllowed(list, B)).toBe(false);
    });

    test('allows a listed recipient', () => {
      const list = addEntry(null, A, 'savings', 't0');
      expect(isRecipientAllowed(list, A)).toBe(true);
    });

    test('is case-insensitive on the address', () => {
      const list = addEntry(null, A.toLowerCase(), '', 't0');
      expect(isRecipientAllowed(list, A.toUpperCase())).toBe(true);
    });

    test('denies malformed / empty recipient', () => {
      const list = addEntry(null, A, '', 't0');
      expect(isRecipientAllowed(list, '')).toBe(false);
      expect(isRecipientAllowed(list, null)).toBe(false);
    });
  });

  describe('addEntry', () => {
    test('adds a normalized entry', () => {
      const list = addEntry(null, A.toUpperCase(), 'savings', 't1');
      expect(list.entries).toHaveLength(1);
      expect(list.entries[0]).toMatchObject({ address: A.toLowerCase(), label: 'savings', addedAt: 't1' });
    });

    test('is idempotent by address', () => {
      const once = addEntry(null, A, 'a', 't1');
      const twice = addEntry(once, A.toUpperCase(), 'b', 't2');
      expect(twice.entries).toHaveLength(1);
    });

    test('rejects an empty address', () => {
      expect(() => addEntry(null, '', 'x', 't1')).toThrow(/invalid address/i);
    });

    test('does not mutate the input', () => {
      const before = addEntry(null, A, '', 't1');
      const len = before.entries.length;
      addEntry(before, B, '', 't2');
      expect(before.entries).toHaveLength(len);
    });
  });

  describe('removeEntry', () => {
    test('removes a listed address (case-insensitive)', () => {
      const list = addEntry(addEntry(null, A, '', 't1'), B, '', 't2');
      const after = removeEntry(list, A.toUpperCase());
      expect(after.entries).toHaveLength(1);
      expect(after.entries[0].address).toBe(B.toLowerCase());
    });

    test('is a no-op for an unlisted address', () => {
      const list = addEntry(null, A, '', 't1');
      expect(removeEntry(list, B).entries).toHaveLength(1);
    });
  });

  describe('toAllowlist', () => {
    test('coerces junk to the empty shape', () => {
      expect(toAllowlist(undefined)).toEqual({ version: 1, entries: [] });
      expect(toAllowlist({ nope: true })).toEqual({ version: 1, entries: [] });
    });
  });

  describe('requiresApproval — DEFAULT-DENY threshold', () => {
    test('requires approval when threshold is unset/invalid', () => {
      expect(requiresApproval(undefined, 0.01)).toBe(true);
      expect(requiresApproval(null, 0.01)).toBe(true);
      expect(requiresApproval(-1, 0.01)).toBe(true);
    });

    test('allows autonomous sends at or under the threshold', () => {
      expect(requiresApproval(0.1, 0.05)).toBe(false);
      expect(requiresApproval(0.1, 0.1)).toBe(false);
    });

    test('requires approval above the threshold', () => {
      expect(requiresApproval(0.1, 0.11)).toBe(true);
    });

    test('a zero threshold makes every non-zero send need approval', () => {
      expect(requiresApproval(0, 0)).toBe(false);
      expect(requiresApproval(0, 0.0001)).toBe(true);
    });

    // The send moves parseEther(value) wei; a float compare rounded one wei
    // over the threshold down to it and sent it autonomously (audit 3 D1).
    test('decides in wei, exactly as the send will move it', () => {
      const allowlist = addEntry(null, A, '', 't');
      expect(classifySpend(allowlist, 0.05, { to: A, value: '0.050000000000000001' })).toBe('pending');
      expect(classifySpend(allowlist, 0.1, { to: A, value: '0.100000000000000001' })).toBe('pending');
      expect(classifySpend(allowlist, 0.05, { to: A, value: '0.05' })).toBe('autonomous');
    });

    test('a value the send could not parse never passes as autonomous', () => {
      for (const value of ['abc', '', '0.1.2']) expect(requiresApproval(1, value)).toBe(true);
    });
  });

  describe('buildApprovalMessage', () => {
    test('is deterministic and binds neuma, recipient, value, expiry, nonce', () => {
      const m = buildApprovalMessage({ neumaId: 'n1', to: A.toUpperCase(), value: '0.5', expiry: 123, nonce: 'abc' });
      expect(m).toBe(
        ['Neuma spend approval', 'neuma: n1', `to: ${A.toLowerCase()}`, 'value: 0.5 ETH', 'expires: 123', 'nonce: abc'].join('\n'),
      );
    });

    test('changes when any bound field changes', () => {
      const base = { neumaId: 'n1', to: A, value: '0.5', expiry: 1, nonce: 'x' };
      const m = buildApprovalMessage(base);
      expect(buildApprovalMessage({ ...base, value: '0.6' })).not.toBe(m);
      expect(buildApprovalMessage({ ...base, to: B })).not.toBe(m);
      expect(buildApprovalMessage({ ...base, nonce: 'y' })).not.toBe(m);
    });
  });
});
