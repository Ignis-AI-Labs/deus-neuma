/**
 * Two loose ends of the birth path (security re-check 2026-10-20, builder N's
 * frame sweep): a checkpoint from before ceremonies recorded their wallet was
 * open to ANY signed-in wallet (a guest house could resume and claim another
 * house's old summoning); and birth:seal_preflight with no neumaId matched a
 * connection bound to no being (undefined === undefined). Real functions,
 * real install-owner record on a temp data root.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { heldByWitness } from '../../core/birth/birth-resume.js';
import { unrecordedSummoningAccess } from '../../backend/routes/birth-lane-owner.js';
import { birthSealPreflight } from '../../backend/routes/portal-seal-handlers.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const GUEST = '0x2222222222222222222222222222222222222222';

describe('summonings with no recorded wallet, and the seal without a being', () => {
  let saved;
  beforeEach(async () => {
    saved = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = path.join(await createTempDir('birth-unrecorded'), 'data');
    await makeInstallOwner(OWNER);
  });
  afterEach(() => { if (saved === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = saved; });

  test("an unrecorded checkpoint is the owner's to resume, never a guest house's", async () => {
    const old = { sessionId: 's1', origin: 'portal' }; // from before ceremonies kept a wallet
    expect(heldByWitness(old, GUEST, await unrecordedSummoningAccess(GUEST))).toBe(false);
    expect(heldByWitness(old, OWNER, await unrecordedSummoningAccess(OWNER))).toBe(true);
    expect(heldByWitness(old, GUEST)).toBe(false); // the default is closed
    const mine = { sessionId: 's2', witnessWallet: GUEST.toUpperCase().replace('0X', '0x') };
    expect(heldByWitness(mine, GUEST, await unrecordedSummoningAccess(GUEST))).toBe(true);
    expect(heldByWitness(mine, OWNER, await unrecordedSummoningAccess(OWNER))).toBe(false);
  });

  test('seal preflight with no being named is refused before anything is read or assembled', async () => {
    const frames = [];
    const connection = { ws: { send: (raw) => frames.push(JSON.parse(raw)) }, walletAddress: OWNER, companion: null };
    await birthSealPreflight(connection, { type: 'birth:seal_preflight' });
    expect(frames).toEqual([expect.objectContaining({ type: 'birth:seal_error', code: 'NOT_OWNER' })]);
    expect(connection._sealBundle).toBeUndefined();
  });
});
