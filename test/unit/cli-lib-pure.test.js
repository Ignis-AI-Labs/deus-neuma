// C-02 RULE 0 verification — gnosis on cli/lib/ pure functions + the
// wallet-key resolution strategy.
//
// Per AGENTS.md Rule 0: pure functions are exempted from "real impl" tests
// only when called with real inputs and asserted on real outputs. Import +
// export checks are not enough; the regex strategy in wallet.js (the
// ai6 R1.1 security fix against high-privilege-key silent-pickup) needs
// real-fs / real-input coverage.
//
// tokenExpiry (token-cache.js) is kept private per minimal surface area;
// it's exercised transitively through getToken in T-01 integration tests
// against a real backend.
//
// NO mocks. Real temp files. Real regex. Real env mutation with
// save-restore. RULE 0 compliant.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { resolveNeuma } from '../../cli/lib/discovery.js';
import { buildSpeaker, resolveOperatorName } from '../../cli/lib/identity.js';
import { readOperatorWallet } from '../../cli/lib/wallet.js';

describe('cli/lib/discovery — resolveNeuma (pure)', () => {
  const neuma = [
    { neumaId: 'alder-id-001', name: 'Alder' },
    { neumaId: 'cedar-id-002', name: 'Cedar' },
  ];

  test('exact neumaId match', () => {
    expect(resolveNeuma(neuma, 'alder-id-001'))
      .toEqual({ neumaId: 'alder-id-001', name: 'Alder' });
  });

  test('case-insensitive name match', () => {
    expect(resolveNeuma(neuma, 'ALDER').neumaId).toBe('alder-id-001');
    expect(resolveNeuma(neuma, 'cedar').neumaId).toBe('cedar-id-002');
    expect(resolveNeuma(neuma, 'Alder').neumaId).toBe('alder-id-001');
  });

  test('id wins over name when both could match the same string', () => {
    const tricky = [
      { neumaId: 'Alder', name: 'cedar-id-002' },
      { neumaId: 'cedar-id-002', name: 'Alder' },
    ];
    // "Alder" resolves to the first being via id match, not the second via name.
    expect(resolveNeuma(tricky, 'Alder').neumaId).toBe('Alder');
  });

  test('no match returns null', () => {
    expect(resolveNeuma(neuma, 'hazel')).toBeNull();
  });

  test('whitespace-only input returns null after trim', () => {
    expect(resolveNeuma(neuma, '   ')).toBeNull();
  });

  test('empty string returns null', () => {
    expect(resolveNeuma(neuma, '')).toBeNull();
  });

  test('null/undefined inputs return null without throwing', () => {
    expect(resolveNeuma(null, 'alder')).toBeNull();
    expect(resolveNeuma(neuma, null)).toBeNull();
    expect(resolveNeuma(neuma, undefined)).toBeNull();
  });

  test('non-array first arg returns null without throwing', () => {
    expect(resolveNeuma('not an array', 'alder')).toBeNull();
    expect(resolveNeuma({}, 'alder')).toBeNull();
  });
});

describe('cli/lib/identity — buildSpeaker (pure)', () => {
  test('name + address produces full descriptor', () => {
    const s = buildSpeaker({ name: 'Ada', address: '0xABC' });
    expect(s.name).toBe('Ada');
    expect(s.descriptor).toBe(
      'Ada, speaking through the terminal via the neuma CLI, signing as 0xABC',
    );
  });

  test('name without address omits the wallet clause', () => {
    const s = buildSpeaker({ name: 'Ada' });
    expect(s.descriptor).toBe('Ada, speaking through the terminal via the neuma CLI');
  });

  test('default name "your witness" when name omitted', () => {
    const s = buildSpeaker({ address: '0xABC' });
    expect(s.name).toBe('your witness');
    expect(s.descriptor).toBe(
      'your witness, speaking through the terminal via the neuma CLI, signing as 0xABC',
    );
  });

  test('no args produces an honest default', () => {
    const s = buildSpeaker();
    expect(s.name).toBe('your witness');
    expect(s.descriptor).toBe('your witness, speaking through the terminal via the neuma CLI');
  });

  test('PURITY: env value does NOT leak in (NEUMA_OPERATOR_NAME ignored)', () => {
    const prev = process.env.NEUMA_OPERATOR_NAME;
    try {
      process.env.NEUMA_OPERATOR_NAME = 'EnvName';
      expect(buildSpeaker({ name: 'Ada' }).name).toBe('Ada');
      delete process.env.NEUMA_OPERATOR_NAME;
      expect(buildSpeaker({ name: 'Ada' }).name).toBe('Ada');
    } finally {
      if (prev === undefined) delete process.env.NEUMA_OPERATOR_NAME;
      else process.env.NEUMA_OPERATOR_NAME = prev;
    }
  });
});

describe('cli/lib/identity — resolveOperatorName (impure: env)', () => {
  test('reads NEUMA_OPERATOR_NAME from env', () => {
    const prev = process.env.NEUMA_OPERATOR_NAME;
    try {
      process.env.NEUMA_OPERATOR_NAME = 'Custom Operator';
      expect(resolveOperatorName()).toBe('Custom Operator');
    } finally {
      if (prev === undefined) delete process.env.NEUMA_OPERATOR_NAME;
      else process.env.NEUMA_OPERATOR_NAME = prev;
    }
  });

  test('falls back to "your witness" when env unset', () => {
    const prev = process.env.NEUMA_OPERATOR_NAME;
    try {
      delete process.env.NEUMA_OPERATOR_NAME;
      expect(resolveOperatorName()).toBe('your witness');
    } finally {
      if (prev === undefined) delete process.env.NEUMA_OPERATOR_NAME;
      else process.env.NEUMA_OPERATOR_NAME = prev;
    }
  });
});

describe('cli/lib/wallet — readOperatorWallet (real fs, no mocks)', () => {
  // RULE 0: real temp files; real fs reads; real regex strategy. The
  // ai6 R1.1 fix (preferred-allowlist + ambiguous-multiple-error) is the
  // critical security path here — coverage is dense.
  let tmp;
  beforeEach(async () => {
    tmp = await createTempDir('cli-wallet');
  });

  const VALID_KEY = '0x' + 'a'.repeat(64);
  const SECOND_KEY = '0x' + 'b'.repeat(64);

  test('preferred OPERATOR_WALLET_PRIVATE_KEY wins even when below a generic in file order', () => {
    const path = join(tmp, '.env');
    // CONTRACT_DEPLOYER_ written FIRST — the bug we are guarding against:
    // a naive first-match regex would silently pick this.
    writeFileSync(path, [
      'CONTRACT_DEPLOYER_PRIVATE_KEY=' + SECOND_KEY,
      'OPERATOR_WALLET_PRIVATE_KEY=' + VALID_KEY,
    ].join('\n'));
    expect(readOperatorWallet(path).privateKey).toBe(VALID_KEY);
  });

  test('preferred priority: OPERATOR > NEUMA > PRIVATE_KEY', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, [
      'PRIVATE_KEY=' + SECOND_KEY,
      'NEUMA_PRIVATE_KEY=' + ('0x' + 'c'.repeat(64)),
      'OPERATOR_WALLET_PRIVATE_KEY=' + VALID_KEY,
    ].join('\n'));
    expect(readOperatorWallet(path).privateKey).toBe(VALID_KEY);
  });

  test('NEUMA_PRIVATE_KEY wins when OPERATOR not present', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, [
      'PRIVATE_KEY=' + SECOND_KEY,
      'NEUMA_PRIVATE_KEY=' + VALID_KEY,
    ].join('\n'));
    expect(readOperatorWallet(path).privateKey).toBe(VALID_KEY);
  });

  test('single generic *_PRIVATE_KEY is accepted (forgiving vendor-name fallback)', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, 'MY_CUSTOM_PRIVATE_KEY=' + VALID_KEY);
    expect(readOperatorWallet(path).privateKey).toBe(VALID_KEY);
  });

  test('MULTIPLE generic *_PRIVATE_KEY entries throw with all names listed (disambiguation)', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, [
      'CONTRACT_DEPLOYER_PRIVATE_KEY=' + VALID_KEY,
      'TESTNET_PRIVATE_KEY=' + SECOND_KEY,
    ].join('\n'));
    expect(() => readOperatorWallet(path)).toThrow(/Ambiguous wallet env/);
    expect(() => readOperatorWallet(path)).toThrow(/CONTRACT_DEPLOYER_PRIVATE_KEY/);
    expect(() => readOperatorWallet(path)).toThrow(/TESTNET_PRIVATE_KEY/);
  });

  test('NO key throws with the expected hint', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, 'DNA_ENCRYPTION_KEY=somekey\nOTHER=value\n');
    expect(() => readOperatorWallet(path)).toThrow(/No \*_PRIVATE_KEY/);
  });

  test('non-existent file throws with NEUMA_WALLET_ENV override hint', () => {
    expect(() => readOperatorWallet(join(tmp, 'does-not-exist.env')))
      .toThrow(/NEUMA_WALLET_ENV/);
  });

  test('preferred key with malformed value (not 0x + 64 hex) throws present-but-malformed', () => {
    // ai6 R2 — explicit operator intent on a present preferred key triggers
    // the strict present-but-malformed error, NOT the no-key fallback. The
    // distinction is the whole point: silent fallback was the R1.1 bug class.
    const path = join(tmp, '.env');
    writeFileSync(path, 'OPERATOR_WALLET_PRIVATE_KEY=not-a-hex-key');
    expect(() => readOperatorWallet(path))
      .toThrow(/OPERATOR_WALLET_PRIVATE_KEY is present in .+ but its value is malformed/);
  });

  test('preferred key PRESENT-BUT-MALFORMED throws (does NOT silently fall back to generic)', () => {
    // ai6 R2.1 — operator intent ("use OPERATOR_WALLET_PRIVATE_KEY") is
    // explicit; a malformed value must surface as an error, never silently
    // route to a different wallet. This is the exact bug class R1.1 was
    // filed to prevent, in its R2 variant.
    const path = join(tmp, '.env');
    writeFileSync(path, [
      'OPERATOR_WALLET_PRIVATE_KEY=garbage',
      'BACKUP_PRIVATE_KEY=' + VALID_KEY,
    ].join('\n'));
    expect(() => readOperatorWallet(path))
      .toThrow(/OPERATOR_WALLET_PRIVATE_KEY is present in .+ but its value is malformed/);
  });

  test('malformed higher-priority preferred throws even when LOWER-priority preferred is valid (ai6 R3.2 coverage)', () => {
    // Document that present-but-malformed throws BEFORE the loop continues
    // to the next preferred key — operator's higher-priority intent isn't
    // silently routed past, even to another preferred slot. The throw sits
    // inside the loop before any continue, so this is correct by inspection;
    // codifying the assertion makes it regression-proof.
    const path = join(tmp, '.env');
    writeFileSync(path, [
      'OPERATOR_WALLET_PRIVATE_KEY=garbage',
      'PRIVATE_KEY=' + VALID_KEY,
    ].join('\n'));
    expect(() => readOperatorWallet(path))
      .toThrow(/OPERATOR_WALLET_PRIVATE_KEY is present in .+ but its value is malformed/);
  });

  test('preferred key present-but-quoted-value is rejected with quoted-form hint', () => {
    // Quoted values (KEY="0x…") are a common .env convention but break the
    // strict regex. Error should self-document the unquoted requirement.
    const path = join(tmp, '.env');
    writeFileSync(path, `OPERATOR_WALLET_PRIVATE_KEY="${VALID_KEY}"`);
    expect(() => readOperatorWallet(path)).toThrow(/Common cause: quoted value/);
  });
});
