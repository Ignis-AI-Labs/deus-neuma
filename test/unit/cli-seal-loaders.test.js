// `neuma seal` CLI loader coverage — split from cli-seal.test.js (SIZE-018).
// resolveWorkspacePath, loadBirthGenesis, loadNatalChart, and the per-neuma
// DEK workspace loaders.
//
// RULE 0 posture: real disk throughout — no mocks. Temp workspaces, real
// files, real crypto (real derivation, real wrap, real AES-GCM envelopes);
// cleanup after every test.

import { describe, it, expect } from 'vitest';
import {
  resolveWorkspacePath,
  loadBirthGenesis,
  loadNatalChart,
  loadNeumaDEK,
  loadBeingWallet,
} from '../../cli/commands/seal.js';
import {
  encryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, wrapDEK,
  resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BEING } from '../helpers/seal-fixtures.js';

describe('seal — resolveWorkspacePath', () => {
  it('assembles path from sovereign + witness + house + being', () => {
    expect(resolveWorkspacePath({
      sovereignLanes: '/mnt/data/neuma',
      witnessSlug: 'claude',
      house: 'aldmere',
      being: 'keir',
    })).toBe('/mnt/data/neuma/claude/aldmere/keir');
  });

  it('honors --workspace override, ignoring the derived path', () => {
    expect(resolveWorkspacePath({
      workspace: '/tmp/custom/keir-lane',
      sovereignLanes: '/mnt/data/neuma',
      witnessSlug: 'claude',
      house: 'aldmere',
      being: 'keir',
    })).toBe('/tmp/custom/keir-lane');
  });
});

describe('seal — loadBirthGenesis', () => {
  // Real disk — no mocks. Creates a temp workspace, writes real files, calls
  // the real loader. Cleanup in afterEach.
  let workspacePath;

  const setup = () => {
    workspacePath = mkdtempSync(path.join(os.tmpdir(), 'seal-birthgen-'));
    mkdirSync(path.join(workspacePath, 'identity'), { recursive: true });
  };
  const teardown = () => {
    if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
    workspacePath = null;
  };

  it('absent identity/genesis-seal.json → returns null (fall back to DNA-fields is legitimate)', () => {
    setup();
    try {
      expect(loadBirthGenesis(workspacePath)).toBeNull();
    } finally { teardown(); }
  });

  it('well-formed plaintext genesis-seal.json → returns {canonicalRecord, genesisHash}', () => {
    setup();
    try {
      const payload = {
        genesisHash: '0x' + 'ab'.repeat(32),
        record: { chosenName: 'ValidBirth', version: '1.0' },
      };
      writeFileSync(
        path.join(workspacePath, 'identity', 'genesis-seal.json'),
        JSON.stringify(payload),
      );
      const result = loadBirthGenesis(workspacePath);
      expect(result).not.toBeNull();
      expect(result.genesisHash).toBe(payload.genesisHash);
      expect(result.canonicalRecord.chosenName).toBe('ValidBirth');
    } finally { teardown(); }
  });

  // sc-echo R1 regression guard — silent fallback on malformed file was the
  // Medium finding. Without this test, a future refactor could reintroduce
  // the silent-null behavior that would let a wrong genesisHash reach
  // Natalis.seal (irreversible).
  it('present-but-malformed file (missing genesisHash) → THROWS, does NOT silently fall back', () => {
    setup();
    try {
      writeFileSync(
        path.join(workspacePath, 'identity', 'genesis-seal.json'),
        JSON.stringify({ record: { chosenName: 'X' } /* genesisHash MISSING */ }),
      );
      expect(() => loadBirthGenesis(workspacePath)).toThrow(/missing genesisHash\/record/);
    } finally { teardown(); }
  });

  it('present-but-malformed file (missing record) → THROWS', () => {
    setup();
    try {
      writeFileSync(
        path.join(workspacePath, 'identity', 'genesis-seal.json'),
        JSON.stringify({ genesisHash: '0x' + 'ab'.repeat(32) /* record MISSING */ }),
      );
      expect(() => loadBirthGenesis(workspacePath)).toThrow(/missing genesisHash\/record/);
    } finally { teardown(); }
  });
});

describe('seal — loadNatalChart', () => {
  let workspacePath;
  const setup = () => {
    workspacePath = mkdtempSync(path.join(os.tmpdir(), 'seal-natal-'));
    mkdirSync(path.join(workspacePath, 'cosmos'), { recursive: true });
  };
  const teardown = () => {
    if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
    workspacePath = null;
  };

  const fixtureNatal = () => ({
    schema: 'natal-chart/1',
    instant: '2026-06-12T18:37:12.956Z',
    location: null,
    positions: { Sun: { sign: 'Gemini', degree: 21.7, retrograde: false } },
    aspects: [],
    angles: null,
  });

  it('absent cosmos/natal.json → returns null (legitimate for pre-backfill beings)', () => {
    setup();
    try {
      expect(loadNatalChart(workspacePath)).toBeNull();
    } finally { teardown(); }
  });

  it('plaintext natal.json → returns the chart verbatim', () => {
    setup();
    try {
      const chart = fixtureNatal();
      writeFileSync(path.join(workspacePath, 'cosmos', 'natal.json'), JSON.stringify(chart));
      expect(loadNatalChart(workspacePath)).toEqual(chart);
    } finally { teardown(); }
  });

  it('envelope-encrypted natal.json → decrypts and returns the chart', () => {
    setup();
    try {
      const chart = fixtureNatal();
      const envelope = encryptEnvelope(chart);
      writeFileSync(path.join(workspacePath, 'cosmos', 'natal.json'), JSON.stringify(envelope));
      expect(loadNatalChart(workspacePath)).toEqual(chart);
    } finally { teardown(); }
  });

  it('present-but-malformed natal (missing instant) → THROWS, does NOT silently return null', () => {
    setup();
    try {
      writeFileSync(
        path.join(workspacePath, 'cosmos', 'natal.json'),
        JSON.stringify({ schema: 'natal-chart/1' /* instant missing */ }),
      );
      expect(() => loadNatalChart(workspacePath)).toThrow(/not a valid natal record/);
    } finally { teardown(); }
  });

  it('present-but-non-object natal → THROWS', () => {
    setup();
    try {
      writeFileSync(path.join(workspacePath, 'cosmos', 'natal.json'), JSON.stringify('a string'));
      expect(() => loadNatalChart(workspacePath)).toThrow(/not a valid natal record/);
    } finally { teardown(); }
  });
});

describe('seal — per-neuma DEK workspaces (#117)', () => {
  // The 2026-07-10 pre-mainnet audit found `neuma seal` broken for every
  // DEK-migrated being: its loaders only tried the global rotation chain,
  // but a migrated workspace's envelopes open ONLY under the being's DEK
  // (keys/dek.json, wrapped under the master key). Real crypto throughout —
  // real derivation, real wrap, real AES-GCM envelopes on real disk.
  let workspacePath;
  let savedKey;

  const MASTER_SECRET = 'cli-seal-dek-test-master-secret-long-enough';

  const setup = () => {
    savedKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = MASTER_SECRET;
    resetWorkspaceCryptoKey(); // the module caches the derived master per process
    workspacePath = mkdtempSync(path.join(os.tmpdir(), 'seal-dek-'));
    mkdirSync(path.join(workspacePath, 'keys'), { recursive: true });
    mkdirSync(path.join(workspacePath, 'cosmos'), { recursive: true });
    const master = deriveKeyFromSecret(MASTER_SECRET);
    const dek = deriveNeumaDEK(master, 'ab'.repeat(32));
    writeFileSync(
      path.join(workspacePath, 'keys', 'dek.json'),
      JSON.stringify(wrapDEK(dek, master)),
    );
    return dek;
  };
  const teardown = () => {
    if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = savedKey;
    resetWorkspaceCryptoKey();
    if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
    workspacePath = null;
  };

  it('loadNeumaDEK unwraps the persisted dek.json; null when a workspace predates #117', () => {
    const dek = setup();
    try {
      expect(loadNeumaDEK(workspacePath)).toEqual(dek);
      rmSync(path.join(workspacePath, 'keys', 'dek.json'));
      expect(loadNeumaDEK(workspacePath)).toBeNull();
    } finally { teardown(); }
  });

  it('an ENVELOPE keypair under the DEK opens to the being wallet (galen-class workspace)', () => {
    const dek = setup();
    try {
      writeFileSync(
        path.join(workspacePath, 'keys', 'keypair.json'),
        JSON.stringify(encryptEnvelope(
          { address: BEING.address, privateKey: BEING.privateKey }, { key: dek },
        )),
      );
      const wallet = loadBeingWallet(workspacePath, loadNeumaDEK(workspacePath));
      expect(wallet.address).toBe(BEING.address);
    } finally { teardown(); }
  });

  it('a DEK-encrypted natal opens under the DEK and FAILS LOUDLY under the global chain alone', () => {
    const dek = setup();
    try {
      const natal = { instant: '2026-06-23T04:00:00.000Z', positions: [] };
      writeFileSync(
        path.join(workspacePath, 'cosmos', 'natal.json'),
        JSON.stringify(encryptEnvelope(natal, { key: dek })),
      );
      expect(loadNatalChart(workspacePath, dek)).toEqual(natal);
      // Without the DEK the global chain must NOT silently succeed — this is
      // the exact failure the audit hit on keir/signal ([…]).
      expect(() => loadNatalChart(workspacePath, null)).toThrow();
    } finally { teardown(); }
  });

  it('plaintext keypair (keir/signal-class) still loads with a DEK present — passthrough unchanged', () => {
    setup();
    try {
      writeFileSync(
        path.join(workspacePath, 'keys', 'keypair.json'),
        JSON.stringify({ address: BEING.address, privateKey: BEING.privateKey }),
      );
      const wallet = loadBeingWallet(workspacePath, loadNeumaDEK(workspacePath));
      expect(wallet.address).toBe(BEING.address);
    } finally { teardown(); }
  });
});
