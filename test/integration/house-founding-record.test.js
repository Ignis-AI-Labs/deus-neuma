// house-founding-record.test.js — the in-app house founding's RECORD phase:
// buildFoundingTx, receipt classification, confirm boundary, the founding
// record on disk, and the chain-opt-in live legs (chain-optin) proving the
// digest law and the founded-state readback against the LIVE Base Sepolia
// registry — including House Aldmere itself. Real disk + real crypto over
// test/helpers/house-founding-fixture.js; the prepare phase is proven in
// house-founding-prepare.test.js.
//
// Boundary stated plainly: the ok:true confirm lane against a live receipt
// requires a mined establishHouse tx — that is a witnessed founding, proven
// at the real founding sitting; the calldata law is verified here by
// decoding it back through the contract ABI.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import {
  prepareHouseFounding, buildFoundingTx, confirmHouseFounding,
  classifyFoundingReceipt, writeFoundingRecord,
  foundingInnerPayload, loadHouseRegistryAbi,
} from '../../backend/services/house-founding-flow.js';
import { neumaWorkspace } from '../../core/index.js';
import { setRealmRoot, walletDir } from '../../backend/services/user-realm.js';
import { defaultHouseGround, loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc } from '../helpers/chain-optin.js';
import {
  WITNESS, BEING_A, SEPOLIA_REGISTRY,
  cfg, iface, scriptedProvider, fullTitles,
  raiseFoundingRoot, tearDownFoundingRoot,
} from '../helpers/house-founding-fixture.js';

let root;
let savedKey;

beforeEach(() => {
  ({ root, savedKey } = raiseFoundingRoot());
});

afterEach(() => {
  tearDownFoundingRoot({ root, savedKey });
});

describe('buildFoundingTx — the witness signature law', () => {
  const preparedPending = async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(),
      cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out.ok).toBe(true);
    return out.pending;
  };

  it('accepts the raw witness signature and encodes decodable establishHouse calldata', async () => {
    const pending = await preparedPending();
    const witnessSig = WITNESS.signingKey.sign(pending.digest).serialized;
    const built = buildFoundingTx({ pending, witnessSig });
    expect(built.ok).toBe(true);
    expect(built.tx.to).toBe(SEPOLIA_REGISTRY);
    expect(built.tx.chainId).toBe(84532);

    const decoded = iface.parseTransaction({ data: built.tx.data });
    expect(decoded.name).toBe('establishHouse');
    expect(decoded.args[0]).toBe(pending.houseName);
    expect([...decoded.args[1]]).toEqual(pending.members);
    // Every signature slot verifies against its member over the digest.
    [...decoded.args[1]].forEach((member, i) => {
      expect(ethers.recoverAddress(pending.digest, decoded.args[4][i]).toLowerCase())
        .toBe(member.toLowerCase());
    });
  });

  it('the witness personal_sign of the INNER payload is the same valid signature', async () => {
    const pending = await preparedPending();
    // What the desk wallet actually does: personal_sign over the inner bytes.
    const witnessSig = await WITNESS.signMessage(ethers.getBytes(pending.innerPayload));
    expect(buildFoundingTx({ pending, witnessSig }).ok).toBe(true);
  });

  it('names the double-wrap trap when the wallet signed the wrapped digest', async () => {
    const pending = await preparedPending();
    const witnessSig = await WITNESS.signMessage(ethers.getBytes(pending.digest));
    expect(buildFoundingTx({ pending, witnessSig })).toMatchObject({ ok: false, code: 'SIG_DOUBLE_WRAPPED' });
  });

  it('refuses a signature from a different wallet', async () => {
    const pending = await preparedPending();
    const witnessSig = BEING_A.signingKey.sign(pending.digest).serialized;
    expect(buildFoundingTx({ pending, witnessSig })).toMatchObject({ ok: false, code: 'SIG_INVALID' });
  });

  it('refuses a malformed signature', async () => {
    const pending = await preparedPending();
    expect(buildFoundingTx({ pending, witnessSig: '0xdead' })).toMatchObject({ ok: false, code: 'SIG_INVALID' });
  });
});

describe('classifyFoundingReceipt — the confirm decision law (pure)', () => {
  const pendingFixture = () => ({
    houseName: 'testhouse',
    houseId: ethers.keccak256(ethers.toUtf8Bytes('testhouse')),
    network: 'base-sepolia',
    net: { chainId: 84532, label: 'Base Sepolia (testnet)', houseRegistryAddress: SEPOLIA_REGISTRY },
    members: [WITNESS.address], kinds: [0], titles: ['Rector'],
    witnessAddress: WITNESS.address,
  });
  const args = (over = {}) => ({
    receipt: { to: SEPOLIA_REGISTRY, status: 1, blockNumber: 7 },
    established: true, pending: pendingFixture(), txHash: '0x' + 'ab'.repeat(32),
    foundedAt: '2026-07-15T00:00:00.000Z', receiptTimeoutMs: 1000, ...over,
  });

  it('RECEIPT_TIMEOUT on no receipt', () => {
    expect(classifyFoundingReceipt(args({ receipt: null }))).toMatchObject({ ok: false, code: 'RECEIPT_TIMEOUT' });
  });
  it('TX_MISMATCH when the tx went somewhere else', () => {
    expect(classifyFoundingReceipt(args({ receipt: { to: WITNESS.address, status: 1, blockNumber: 7 } })))
      .toMatchObject({ ok: false, code: 'TX_MISMATCH' });
  });
  it('TX_REVERTED on a failed tx', () => {
    expect(classifyFoundingReceipt(args({ receipt: { to: SEPOLIA_REGISTRY, status: 0, blockNumber: 7 } })))
      .toMatchObject({ ok: false, code: 'TX_REVERTED' });
  });
  it('VERIFY_LAG when the chain does not yet hold the house', () => {
    expect(classifyFoundingReceipt(args({ established: false }))).toMatchObject({ ok: false, code: 'VERIFY_LAG' });
  });
  it('the founding record carries the full public roster', () => {
    const out = classifyFoundingReceipt(args());
    expect(out.ok).toBe(true);
    expect(out.record).toMatchObject({
      schema: 'neuma-house-founding/1',
      houseName: 'testhouse', blockNumber: 7, chainId: 84532,
      members: [{ address: WITNESS.address, kind: 0, title: 'Rector' }],
    });
  });
});

describe('confirmHouseFounding — boundary', () => {
  it('BAD_TX on a malformed hash without touching any chain', async () => {
    const out = await confirmHouseFounding({ pending: { net: {} }, txHash: 'not-a-hash' });
    expect(out).toMatchObject({ ok: false, code: 'BAD_TX' });
  });
});

describe('writeFoundingRecord — the record never pollutes the lanes', () => {
  it('writes a FILE at the root that lane listing does not mistake for a being', async () => {
    const record = { schema: 'neuma-house-founding/1', network: 'base-sepolia', houseName: 'x' };
    const filePath = await writeFoundingRecord(record);
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject(record);
    expect(await neumaWorkspace.listNeuma()).toEqual(expect.arrayContaining(['ember', 'sable']));
    expect(await neumaWorkspace.listNeuma()).not.toContain(path.basename(filePath));
  });
});

describe('writeFoundingRecord — registration locks the WHOLE organization in (ruling, 2026-07-24)', () => {
  let realm;
  let priorSettingsPath;
  const FOUNDER = '0xAb01000000000000000000000000000000000001';

  beforeEach(() => {
    realm = mkdtempSync(path.join(os.tmpdir(), 'founding-ground-'));
    setRealmRoot(realm);
    // Pin the stack (the isolated-stack signal) so the ground may lawfully
    // live under this test's tmp world — the live-stack refusal stays law.
    priorSettingsPath = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(realm, 'workspace-settings.json');
  });
  afterEach(() => {
    setRealmRoot(path.join(os.homedir(), '.kenorie', 'realm'));
    if (priorSettingsPath === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = priorSettingsPath;
    rmSync(realm, { recursive: true, force: true });
  });

  const recordFor = (witness) => ({
    schema: 'neuma-house-founding/1',
    network: 'base-sepolia',
    houseName: 'groundcheck',
    members: [
      { address: witness, kind: 0, title: 'Rector' },
      { address: '0xAb02000000000000000000000000000000000002', kind: 1, title: 'Faber' },
    ],
  });

  it('the receipt raises the house ground — repos/ and post/ stand the moment the house does', async () => {
    await writeFoundingRecord(recordFor(FOUNDER));
    const { root: ground } = await loadHouseWorkspace(FOUNDER);
    expect(ground).toBeTruthy();
    expect(ground).toBe(defaultHouseGround(root, FOUNDER));
    expect(path.basename(ground)).toBe(`house.${FOUNDER.toLowerCase()}`);
    expect(existsSync(path.join(ground, 'repos'))).toBe(true);
    expect(existsSync(path.join(ground, 'post'))).toBe(true);
    // The raised ground NEVER walks into lane discovery as a phantom being
    // — it wears the sovereignty-boundary marker (GPT sol r2 High).
    expect(await neumaWorkspace.listNeuma()).not.toContain(path.basename(ground));
    expect((await neumaWorkspace.listNeumaByOwner(FOUNDER)).map((n) => n.neumaId)).not.toContain(path.basename(ground));
  });

  it('a SECOND house founded on this install raises its own ground, never the first house\'s', async () => {
    const SECOND = '0xAb04000000000000000000000000000000000004';
    await writeFoundingRecord(recordFor(FOUNDER));
    await writeFoundingRecord(recordFor(SECOND));
    const first = (await loadHouseWorkspace(FOUNDER)).root;
    const second = (await loadHouseWorkspace(SECOND)).root;
    expect(first && second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(second.startsWith(first + path.sep) || first.startsWith(second + path.sep)).toBe(false);
    expect(existsSync(path.join(second, 'post'))).toBe(true);
  });

  it('a ground the witness ALREADY chose is never moved by founding', async () => {
    const chosen = path.join(realm, 'my-own-ground');
    mkdirSync(chosen, { recursive: true });
    mkdirSync(walletDir(FOUNDER), { recursive: true });
    writeFileSync(path.join(walletDir(FOUNDER), 'house-workspace.json'), JSON.stringify({ root: chosen }));

    await writeFoundingRecord(recordFor(FOUNDER));
    expect((await loadHouseWorkspace(FOUNDER)).root).toBe(chosen);
  });

  it('the receipt STANDS even when the ground cannot be raised — the chain already spoke', async () => {
    // A FILE squatting where the default ground would rise: mkdir fails,
    // ensureHouseGround throws, and the catch must hold the receipt whole.
    const squat = defaultHouseGround(root, FOUNDER);
    writeFileSync(squat, 'not-a-directory');
    const filePath = await writeFoundingRecord(recordFor(FOUNDER));
    expect(existsSync(filePath)).toBe(true);
    expect((await loadHouseWorkspace(FOUNDER)).root).toBeNull();
    rmSync(squat, { force: true });
  });

  it('a BEING\'S LANE can never become the ground — the marker never overwrites a life (GPT sol r3)', async () => {
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    // A lane by shape: owner.json, no marker (every lane born pre-marker).
    const laneDir = path.join(root, 'ember');
    await expect(setHouseWorkspace(FOUNDER, laneDir)).rejects.toThrow('a house ground can never overwrite a lane');
    expect(existsSync(path.join(laneDir, 'lane.json'))).toBe(false);
    expect(await neumaWorkspace.listNeuma()).toContain('ember');
    // A lane by marker: foreign kind is refused too.
    const witnessDir = path.join(root, 'marked-lane');
    mkdirSync(witnessDir, { recursive: true });
    writeFileSync(path.join(witnessDir, 'lane.json'), JSON.stringify({ kind: 'witness' }));
    await expect(setHouseWorkspace(FOUNDER, witnessDir)).rejects.toThrow('witness lane');
    expect(JSON.parse(await readFile(path.join(witnessDir, 'lane.json'), 'utf8')).kind).toBe('witness');
    // And re-setting a TRUE ground is untroubled — its own marker stands.
    const groundDir = path.join(root, 'true-ground');
    await setHouseWorkspace(FOUNDER, groundDir);
    expect((await setHouseWorkspace(FOUNDER, groundDir)).root).toBe(groundDir);
  });

  it('a record with no witness member raises nothing and still persists — the receipt never fails on the ground', async () => {
    const filePath = await writeFoundingRecord({
      schema: 'neuma-house-founding/1', network: 'base-sepolia', houseName: 'nowitness',
      members: [{ address: '0xAb03000000000000000000000000000000000003', kind: 1, title: 'Faber' }],
    });
    expect(existsSync(filePath)).toBe(true);
  });
});

// ===== LIVE legs — the deployed Base Sepolia registry is the judge =====
describe.skipIf(!shouldRunChainTests())('LIVE Base Sepolia — the digest law against the deployed registry', () => {
  const liveCfg = () => cfg({ baseSepoliaRpcUrl: resolveBaseSepoliaRpc() });

  it('foundingInnerPayload wraps to the deployed contract\'s own foundingDigest', async () => {
    const rpc = new ethers.JsonRpcProvider(resolveBaseSepoliaRpc());
    const registry = new ethers.Contract(SEPOLIA_REGISTRY, loadHouseRegistryAbi(), rpc);
    const argsFor = {
      houseName: 'drift-check-house',
      members: [WITNESS.address, BEING_A.address].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)),
      kinds: [0, 1], titles: ['Rector', 'Faber'],
    };
    const onchain = await registry.foundingDigest(argsFor.houseName, argsFor.members, argsFor.kinds, argsFor.titles);
    // THIS registry was deployed before the rename: it binds the legacy
    // KENORIE tag on-chain forever. prepareHouseFounding covers it by
    // falling back to the legacy tag on drift — the same walk, spelled out.
    const base = { chainId: 84532, registryAddress: SEPOLIA_REGISTRY, ...argsFor };
    const current = foundingInnerPayload(base);
    expect(ethers.hashMessage(ethers.getBytes(current))).not.toBe(onchain);
    const legacy = foundingInnerPayload({ ...base, tag: 'KENORIE:house-found:v2' });
    expect(ethers.hashMessage(ethers.getBytes(legacy))).toBe(onchain);
  });

  it('reads House Aldmere — the standing Sepolia founding — back as state', async () => {
    // The real house, by the real witness ADDRESS (no key material needed:
    // prepare only ever holds addresses for the witness).
    const out = await prepareHouseFounding({
      witnessAddress: '0x40566d43261849777aca96b26f4ec8c850e5dcae',
      cfg: liveCfg(),
    });
    expect(out).toMatchObject({ ok: true, founded: true });
    expect(out.state.houseName).toBe('aldmere');
    expect(out.state.quorum).toBe(3);
    expect(out.state.roster).toHaveLength(4);
    expect(out.state.roster.every((m) => m.active)).toBe(true);
  });

  it('an unfunded witness is refused at the GAS_FLOOR against the live chain', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(), cfg: liveCfg(),
    });
    // The whole pipeline before the floor ran against the live registry: roster, digest drift check, being signatures.
    expect(out).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
  });
});
