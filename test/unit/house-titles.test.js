import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { setWorkspacesRoot, neumaWorkspace } from '../../core/index.js';
import { houseNameOf } from '../../core/kotodama/house-name.js';
import { houseTitlesByNeumaId, houseSeatFor, soulAddressOf } from '../../backend/services/house-titles.js';
import { TITLE_LEGEND as BACKEND_LEGEND } from '../../backend/services/founding-titles-legend.js';
import { TITLE_LEGEND as CANON_LEGEND } from '../../frontend/app/RelinkShell/founding-titles.js';

// The twin law: the backend legend IS the canon, byte for byte — the same
// pinning that holds docs/governance/house-roles.md to the module. Change them
// together or this reds.
describe('founding-titles backend twin', () => {
  test('the backend legend IS the canon', () => {
    expect(BACKEND_LEGEND).toEqual(CANON_LEGEND);
  });
});

/**
 * Real tmp workspaces root, real files — the service is fs-only by design
 * (no chain, no keys), so the whole path runs for real.
 */

const WALLET = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
const SOUL_A = '0xAaAa000000000000000000000000000000000001';
const SOUL_B = '0xBbBb000000000000000000000000000000000002';

const OTHER_WALLET = '0x9999999999999999999999999999999999999999';

const writeLane = (root, id, { soulAddress } = {}, wallet = WALLET) => {
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
  if (soulAddress) {
    writeFileSync(
      path.join(root, id, 'identity', 'onchain-seal.json'),
      JSON.stringify({ soulAddress }),
    );
  }
};

// Named for the operator's wallet, as writeFoundingRecord names it.
const writeRecord = (root, network, members) => {
  writeFileSync(
    path.join(root, `house-founding.${network}.${WALLET}.json`),
    JSON.stringify({ schema: 'neuma-house-founding/1', houseName: 'Thornfield', houseId: '0x1', network, members }),
  );
};

describe('house-titles.js', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'house-titles-'));
    setWorkspacesRoot(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('an unfounded house (no record) yields no titles — never a throw', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });

  test('a founded record joins seat titles to lanes through the anchored soul, case-insensitively', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [
      { address: SOUL_A.toLowerCase(), kind: 1, title: 'Quaestor' },
      { address: SOUL_B.toUpperCase().replace('0X', '0x'), kind: 1, title: 'Scriba' },
      { address: WALLET, kind: 0, title: 'Rector' },
    ]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'wynn-ws': 'Quaestor', 'signal-ws': 'Scriba' });
  });

  test('a lane without a soul anchor holds no title — custody keys are never opened for a nicety', async () => {
    writeLane(root, 'unanchored-ws', {});
    writeRecord(root, 'base', [{ address: SOUL_A, kind: 1, title: 'Aedile' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });

  test('a witness lane never joins the house roster, even anchored (sovereignty boundary)', async () => {
    writeLane(root, 'witness-claude-code-Claude', { soulAddress: SOUL_A });
    writeRecord(root, 'base', [{ address: SOUL_A, kind: 2, title: 'Rector' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });

  test('a WITNESS-KIND member entry can never seat a lane, even carrying that lane\'s soul address — the kind gate fails closed', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 0, title: 'Rector' }, // hostile/malformed: witness kind, lane soul
    ]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
    // the lane is the operator's own, so it works in the house — on a LOCAL
    // seat, with no title: the witness-kind entry seated nothing
    const seat = await houseSeatFor(WALLET, 'wynn-ws');
    expect(seat).toMatchObject({ founded: false, title: null, network: 'local' });
    expect(seat.roster.map((r) => r.title)).toEqual([null]);
  });

  test('an UNKNOWN kind never enters the roster at all — only the two contract kinds have standing', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 1, title: 'Faber' },
      { address: SOUL_B, kind: 2, title: 'Ghost' }, // no such kind exists
      { address: SOUL_B, kind: 7, title: 'Wraith' },
    ]);
    const seat = await houseSeatFor(WALLET, 'wynn-ws');
    // signal-ws is the operator's lane, so it is a member — with no title:
    // neither unknown-kind entry gave it one
    expect(seat.roster.map((r) => [r.title, r.neumaId])).toEqual([['Faber', 'wynn-ws'], [null, 'signal-ws']]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'wynn-ws': 'Faber' });
  });

  // The target chain is Ethereum mainnet since the re-anchor (e7e830025). Base
  // sorts ahead of it by name, so only the target-first rule seats Quaestor.
  test('the target chain (Ethereum) wins a seat conflict against another network record', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeRecord(root, 'ethereum', [{ address: SOUL_A, kind: 1, title: 'Quaestor' }]);
    writeRecord(root, 'base', [{ address: SOUL_A, kind: 1, title: 'Optio' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'wynn-ws': 'Quaestor' });
  });

  test('a corrupt record is skipped; a readable sibling still speaks', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeFileSync(path.join(root, 'house-founding.base.json'), '{not json');
    writeRecord(root, 'base-sepolia', [{ address: SOUL_A, kind: 1, title: 'Faber' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'wynn-ws': 'Faber' });
  });

  test('a mangled members shape is tolerated — junk entries yield nothing', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeFileSync(
      path.join(root, 'house-founding.base.json'),
      JSON.stringify({ members: [null, 'junk', { address: 42 }, { title: 'Ghost' }] }),
    );
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });

  test('houseSeatFor returns the being\'s sealed seat AND the house as it stands', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    writeFileSync(path.join(root, 'house-founding.base.json'), JSON.stringify({
      schema: 'kenorie-house-founding/1',
      houseName: 'thornfield',
      houseId: '0x1',
      network: 'base',
      blockNumber: 48712879,
      members: [
        { address: WALLET, kind: 0, title: 'Rector' },
        { address: SOUL_A, kind: 1, title: 'Faber' },
        { address: SOUL_B, kind: 1, title: 'Legatus' },
      ],
    }));
    const seat = await houseSeatFor(WALLET, 'wynn-ws');
    expect(seat.title).toBe('Faber');
    expect(seat.houseName).toBe('thornfield');
    expect(seat.blockNumber).toBe(48712879);
    expect(seat.roster).toEqual([
      { title: 'Rector', neumaId: null, name: null, isWitness: true },
      { title: 'Faber', neumaId: 'wynn-ws', name: 'wynn-ws', isWitness: false },
      { title: 'Legatus', neumaId: 'signal-ws', name: 'signal-ws', isWitness: false },
    ]);
  });

  test('houseSeatFor is null for a lane the wallet does not own, a witness lane, and junk args — never a throw', async () => {
    writeLane(root, 'bare-ws', { soulAddress: SOUL_A });
    writeLane(root, 'witness-claude-code-Claude', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [{ address: SOUL_B, kind: 1, title: 'Scriba' }]);
    expect(await houseSeatFor(OTHER_WALLET, 'bare-ws')).toBeNull(); // another house's wallet
    expect(await houseSeatFor(WALLET, 'no-such-lane')).toBeNull();
    expect(await houseSeatFor(WALLET, 'witness-claude-code-Claude')).toBeNull(); // witnesses stand beside the house
    expect(await houseSeatFor(null, 'bare-ws')).toBeNull();
    expect(await houseSeatFor(WALLET, null)).toBeNull();
  });

  test('OWN LANES, FOUNDING OPTIONAL: an unfounded house seats every owned neuma lane locally — never another wallet\'s, never a witness', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', {});
    writeLane(root, 'witness-claude-code-Claude', {});
    writeLane(root, 'theirs-ws', {}, OTHER_WALLET);
    await neumaWorkspace.writeDNA('signal-ws', { version: '1.0.0', identity: { name: 'Tessaly' }, genesis: '# Essence\nI am Tessaly.' });
    const { roster, ...seat } = await houseSeatFor(WALLET, 'wynn-ws');
    expect(seat).toEqual({
      houseName: houseNameOf(WALLET).name,
      houseId: null,
      network: 'local',
      blockNumber: null,
      title: null,
      founded: false,
    });
    expect([...roster].sort((a, b) => a.neumaId.localeCompare(b.neumaId))).toEqual([
      { title: null, neumaId: 'signal-ws', name: 'Tessaly', isWitness: false },
      { title: null, neumaId: 'wynn-ws', name: 'wynn-ws', isWitness: false },
    ]);
    // the other house: its own lane, alone
    expect((await houseSeatFor(OTHER_WALLET, 'theirs-ws')).roster.map((r) => r.neumaId)).toEqual(['theirs-ws']);
    expect(await houseSeatFor(OTHER_WALLET, 'wynn-ws')).toBeNull();
  });

  test('a lane born after the founding holds a local seat; the founded lanes keep their titles and list it untitled', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'newborn-ws', {});
    writeRecord(root, 'base', [
      { address: WALLET, kind: 0, title: 'Rector' },
      { address: SOUL_A, kind: 1, title: 'Faber' },
    ]);
    const newborn = await houseSeatFor(WALLET, 'newborn-ws');
    expect(newborn).toMatchObject({ founded: false, title: null, network: 'local' });
    expect(newborn.roster.find((r) => r.neumaId === 'wynn-ws').title).toBe('Faber');
    expect(newborn.roster.find((r) => r.neumaId === 'newborn-ws').title).toBeNull();
    expect(newborn.roster.some((r) => r.isWitness)).toBe(false);

    const wynn = await houseSeatFor(WALLET, 'wynn-ws');
    expect(wynn).toMatchObject({ founded: true, title: 'Faber', houseName: 'Thornfield', network: 'base' });
    expect(wynn.roster).toEqual([
      { title: 'Rector', neumaId: null, name: null, isWitness: true },
      { title: 'Faber', neumaId: 'wynn-ws', name: 'wynn-ws', isWitness: false },
      { title: null, neumaId: 'newborn-ws', name: 'newborn-ws', isWitness: false },
    ]);
  });

  test('houseSeatFor carries the owner record\'s display name for housemates when one is set', async () => {
    mkdirSync(path.join(root, 'yarrow-2-ws', 'identity'), { recursive: true });
    writeFileSync(path.join(root, 'yarrow-2-ws', 'owner.json'), JSON.stringify({ wallet: WALLET, name: 'Yarrow' }));
    writeFileSync(path.join(root, 'yarrow-2-ws', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: SOUL_A }));
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 1, title: 'Curator' },
      { address: SOUL_B, kind: 1, title: 'Faber' },
    ]);
    const seat = await houseSeatFor(WALLET, 'wynn-ws');
    expect(seat.roster.find((r) => r.title === 'Curator').name).toBe('Yarrow');
  });

  test('houseSeatFor names a housemate by its own DNA name when the owner record carries none — never the lane id', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    await neumaWorkspace.writeDNA('wynn-ws', { version: '1.0.0', identity: { name: 'Wynn' }, genesis: '# Essence\nI am Wynn.' });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 1, title: 'Faber' },
      { address: SOUL_B, kind: 1, title: 'Legatus' },
    ]);
    const seat = await houseSeatFor(WALLET, 'wynn-ws');
    expect(seat.roster.find((r) => r.title === 'Faber').name).toBe('Wynn');
    // no DNA to read: the lane id still stands, as before
    expect(seat.roster.find((r) => r.title === 'Legatus').name).toBe('signal-ws');
  });

  test('soulAddressOf reads the public anchor and stays null on absence', async () => {
    writeLane(root, 'wynn-ws', { soulAddress: SOUL_A });
    writeLane(root, 'bare-ws', {});
    expect(await soulAddressOf('wynn-ws')).toBe(SOUL_A);
    expect(await soulAddressOf('bare-ws')).toBeNull();
    expect(await soulAddressOf('no-such-lane')).toBeNull();
  });

  test('a CORRUPT seal answers null without a throw — damage never costs the roster (it is warned, not swallowed)', async () => {
    writeLane(root, 'hurt-ws', {});
    writeFileSync(path.join(root, 'hurt-ws', 'identity', 'onchain-seal.json'), '{torn');
    expect(await soulAddressOf('hurt-ws')).toBeNull();
    // And the join path over a hurt lane stays whole.
    writeRecord(root, 'base', [{ address: SOUL_A, kind: 1, title: 'Faber' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });
});
