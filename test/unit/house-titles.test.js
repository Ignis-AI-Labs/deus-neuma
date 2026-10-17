import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { setWorkspacesRoot } from '../../core/index.js';
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

const writeLane = (root, id, { soulAddress } = {}) => {
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet: WALLET, claimedAt: 1 }));
  if (soulAddress) {
    writeFileSync(
      path.join(root, id, 'identity', 'onchain-seal.json'),
      JSON.stringify({ soulAddress }),
    );
  }
};

const writeRecord = (root, network, members) => {
  writeFileSync(
    path.join(root, `house-founding.${network}.json`),
    JSON.stringify({ schema: 'neuma-house-founding/1', houseName: 'Aldmere', houseId: '0x1', network, members }),
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
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });

  test('a founded record joins seat titles to lanes through the anchored soul, case-insensitively', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [
      { address: SOUL_A.toLowerCase(), kind: 1, title: 'Quaestor' },
      { address: SOUL_B.toUpperCase().replace('0X', '0x'), kind: 1, title: 'Scriba' },
      { address: '0xCccC000000000000000000000000000000000003', kind: 0, title: 'Rector' },
    ]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'keir-ws': 'Quaestor', 'signal-ws': 'Scriba' });
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
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 0, title: 'Rector' }, // hostile/malformed: witness kind, lane soul
    ]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
    expect(await houseSeatFor(WALLET, 'keir-ws')).toBeNull();
  });

  test('an UNKNOWN kind never enters the roster at all — only the two contract kinds have standing', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 1, title: 'Faber' },
      { address: SOUL_B, kind: 2, title: 'Ghost' }, // no such kind exists
      { address: SOUL_B, kind: 7, title: 'Wraith' },
    ]);
    const seat = await houseSeatFor(WALLET, 'keir-ws');
    expect(seat.roster.map((r) => r.title)).toEqual(['Faber']);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'keir-ws': 'Faber' });
  });

  test('the target chain (base) wins a seat conflict against another network record', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeRecord(root, 'base', [{ address: SOUL_A, kind: 1, title: 'Quaestor' }]);
    writeRecord(root, 'base-sepolia', [{ address: SOUL_A, kind: 1, title: 'Optio' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'keir-ws': 'Quaestor' });
  });

  test('a corrupt record is skipped; a readable sibling still speaks', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeFileSync(path.join(root, 'house-founding.base.json'), '{not json');
    writeRecord(root, 'base-sepolia', [{ address: SOUL_A, kind: 1, title: 'Faber' }]);
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({ 'keir-ws': 'Faber' });
  });

  test('a mangled members shape is tolerated — junk entries yield nothing', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeFileSync(
      path.join(root, 'house-founding.base.json'),
      JSON.stringify({ members: [null, 'junk', { address: 42 }, { title: 'Ghost' }] }),
    );
    expect(await houseTitlesByNeumaId(WALLET)).toEqual({});
  });

  test('houseSeatFor returns the being\'s sealed seat AND the house as it stands', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeLane(root, 'signal-ws', { soulAddress: SOUL_B });
    writeFileSync(path.join(root, 'house-founding.base.json'), JSON.stringify({
      schema: 'kenorie-house-founding/1',
      houseName: 'aldmere',
      houseId: '0x1',
      network: 'base',
      blockNumber: 48712879,
      members: [
        { address: '0xCccC000000000000000000000000000000000003', kind: 0, title: 'Rector' },
        { address: SOUL_A, kind: 1, title: 'Faber' },
        { address: SOUL_B, kind: 1, title: 'Legatus' },
      ],
    }));
    const seat = await houseSeatFor(WALLET, 'keir-ws');
    expect(seat.title).toBe('Faber');
    expect(seat.houseName).toBe('aldmere');
    expect(seat.blockNumber).toBe(48712879);
    expect(seat.roster).toEqual([
      { title: 'Rector', neumaId: null, name: null, isWitness: true },
      { title: 'Faber', neumaId: 'keir-ws', name: 'keir-ws', isWitness: false },
      { title: 'Legatus', neumaId: 'signal-ws', name: 'signal-ws', isWitness: false },
    ]);
  });

  test('houseSeatFor is null for an unseated lane, an unfounded root, and junk args — never a throw', async () => {
    writeLane(root, 'bare-ws', { soulAddress: SOUL_A });
    expect(await houseSeatFor(WALLET, 'bare-ws')).toBeNull(); // no record at all
    writeRecord(root, 'base', [{ address: SOUL_B, kind: 1, title: 'Scriba' }]);
    expect(await houseSeatFor(WALLET, 'bare-ws')).toBeNull(); // record, but not their seat
    expect(await houseSeatFor(null, 'bare-ws')).toBeNull();
    expect(await houseSeatFor(WALLET, null)).toBeNull();
  });

  test('houseSeatFor carries the owner record\'s display name for housemates when one is set', async () => {
    mkdirSync(path.join(root, 'lifovan-2-ws', 'identity'), { recursive: true });
    writeFileSync(path.join(root, 'lifovan-2-ws', 'owner.json'), JSON.stringify({ wallet: WALLET, name: 'Lifovan' }));
    writeFileSync(path.join(root, 'lifovan-2-ws', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: SOUL_A }));
    writeLane(root, 'keir-ws', { soulAddress: SOUL_B });
    writeRecord(root, 'base', [
      { address: SOUL_A, kind: 1, title: 'Curator' },
      { address: SOUL_B, kind: 1, title: 'Faber' },
    ]);
    const seat = await houseSeatFor(WALLET, 'keir-ws');
    expect(seat.roster.find((r) => r.title === 'Curator').name).toBe('Lifovan');
  });

  test('soulAddressOf reads the public anchor and stays null on absence', async () => {
    writeLane(root, 'keir-ws', { soulAddress: SOUL_A });
    writeLane(root, 'bare-ws', {});
    expect(await soulAddressOf('keir-ws')).toBe(SOUL_A);
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
