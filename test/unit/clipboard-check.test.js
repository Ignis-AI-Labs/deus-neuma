/**
 * The clipboard swap check: the address law (core/wallet/address-family.js),
 * the shell's verdict (electron/clipboard-check.cjs) and the desk's guard
 * (frontend/services/clipboard-guard.js), driven together.
 *
 * What CANNOT be proven here, stated plainly: Electron's `clipboard.readText()`
 * reading the real OS clipboard, and the IPC hop between page and shell. The
 * handler in ipc-handlers.cjs is one logic-free line over `clipboardVerdict`;
 * everything that DECIDES anything is below, run for real. In these tests the
 * clipboard is a variable, and the guard's `check` is the shell's real verdict
 * function reading it — the same call the handler makes.
 */
import { describe, expect, test } from 'vitest';
import { createRequire } from 'module';
import { addressFamily, isSwappedAddress } from '../../core/wallet/address-family.js';
import { guardCopiedAddress } from '../../frontend/services/clipboard-guard.js';

const require = createRequire(import.meta.url);
const { clipboardVerdict } = require('../../electron/clipboard-check.cjs');

const EVM = `0x${'ab'.repeat(20)}`;
const EVM_THIEF = `0x${'cd'.repeat(20)}`;
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TRON = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';

describe('address family', () => {
  test('each chain by its shape', () => {
    expect(addressFamily(EVM)).toBe('evm');
    expect(addressFamily(BTC)).toBe('bitcoin');
    expect(addressFamily(BTC_LEGACY)).toBe('bitcoin');
    expect(addressFamily(TRON)).toBe('tron');
    expect(addressFamily(SOL)).toBe('solana');
    expect(addressFamily('ltc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('litecoin');
  });

  test('what is not an address', () => {
    expect(addressFamily(`0x${'ab'.repeat(32)}`)).toBeNull(); // a transaction hash
    expect(addressFamily('hunter2')).toBeNull();
    expect(addressFamily(`${EVM} `)).toBeNull();
    expect(addressFamily(`pay ${EVM}`)).toBeNull();
    expect(addressFamily(undefined)).toBeNull();
  });

  test('a swap is a different address of the same chain', () => {
    expect(isSwappedAddress(EVM, EVM_THIEF)).toBe(true);
    expect(isSwappedAddress(EVM, EVM.toUpperCase().replace('0X', '0x'))).toBe(false);
    expect(isSwappedAddress(EVM, BTC)).toBe(false);
    expect(isSwappedAddress(BTC, BTC_LEGACY)).toBe(true);
    expect(isSwappedAddress('not an address', EVM_THIEF)).toBe(false);
  });
});

describe('the shell\'s verdict', () => {
  test('same, swapped, and everything else a person may have copied', async () => {
    expect(await clipboardVerdict(EVM, EVM)).toEqual({ same: true, found: null });
    expect(await clipboardVerdict(EVM, ` ${EVM}\n`)).toEqual({ same: true, found: null });
    expect(await clipboardVerdict(EVM, EVM_THIEF)).toEqual({ same: false, found: EVM_THIEF });
    // Whatever else is on the clipboard is never handed to the page.
    expect(await clipboardVerdict(EVM, 'my password is hunter2')).toEqual({ same: true, found: null });
    expect(await clipboardVerdict(EVM, SOL)).toEqual({ same: true, found: null });
    expect(await clipboardVerdict(EVM, undefined)).toEqual({ same: true, found: null });
    // The page cannot use the check to read an address it did not copy.
    expect(await clipboardVerdict('anything', EVM_THIEF)).toEqual({ same: true, found: null });
  });
});

describe('the desk\'s guard', () => {
  const run = async (clipboardAt) => {
    let looks = 0;
    const reports = [];
    const found = await guardCopiedAddress(EVM, {
      check: (expected) => { looks += 1; return clipboardVerdict(expected, clipboardAt(looks)); },
      report: async (swap) => { reports.push(swap); },
      lookAfterMs: [5, 15],
    });
    return { found, looks, reports };
  };

  test('an untouched clipboard: two looks, nothing reported', async () => {
    expect(await run(() => EVM)).toEqual({ found: null, looks: 2, reports: [] });
  });

  test('a hijacker that answers at once is reported on the first look', async () => {
    expect(await run(() => EVM_THIEF)).toEqual({ found: EVM_THIEF, looks: 1, reports: [{ copied: EVM, found: EVM_THIEF }] });
  });

  test('a slow one is caught on the second look', async () => {
    expect(await run((look) => (look === 1 ? EVM : EVM_THIEF))).toEqual({
      found: EVM_THIEF, looks: 2, reports: [{ copied: EVM, found: EVM_THIEF }],
    });
  });

  test('copying something else next is not a swap', async () => {
    expect(await run(() => 'a note to self')).toEqual({ found: null, looks: 2, reports: [] });
  });

  test('no shell, no check', async () => {
    expect(await guardCopiedAddress(EVM, { check: undefined, report: async () => { throw new Error('never'); } })).toBeNull();
  });
});
