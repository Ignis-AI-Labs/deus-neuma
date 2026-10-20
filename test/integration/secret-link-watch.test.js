/**
 * A SECRET WITH A SECOND NAME IS SEEN (security re-check 2026-10-20). A hard
 * link to a known secret is refused everywhere (secret-inodes.js), but it is
 * also a sign someone staged it — nothing the platform makes links a secret
 * twice. The CSO watch's house probe raises it for the house it belongs to,
 * names the other link in the remedy, never records a byte of the secret,
 * and the watch closes the row once the link is gone.
 *
 * The REAL scheduler pass (runSecurityScan: host, self-check and house legs),
 * the real per-house ledger, two real houses on temp disk, a real hard link.
 * The planted secret is a marker built at runtime. No mock (RULE 0).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { plant, hardlink, marker } from '../helpers/secret-hardlink-kit.js';
import { createWatchStore } from '../../backend/services/security/watch-store.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { runSecurityScan } from '../../backend/services/security/security-scheduler.js';
import { __resetCoalesce } from '../../backend/services/notification-bus.js';

describe('the watch raises a hard-linked secret for its own house and closes it when the link is gone', () => {
  let houses, watchStore, secret, twin, mark;
  const scan = async (wallet) => runSecurityScan({ wallet, trigger: 'manual', watchStore, ledger: await threatLedgerFor(wallet) });
  const linkRow = async (wallet) => (await (await threatLedgerFor(wallet)).load())
    .find((e) => e.externalId === `house:secret-link:${secret}`);

  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'secret-link-watch' });
    __resetCoalesce();
    watchStore = createWatchStore({ path: path.join(houses.tmp, 'watch.json'), seedRepos: [] });
    mark = marker('watched');
    secret = await plant(path.join(houses.rootA, 'keir', 'keys', 'signer.json'), `{"seed":"${mark}"}\n`);
    twin = await hardlink(secret, path.join(houses.rootA, 'keir', 'files', 'notes.txt'));
  });
  afterEach(() => houses.restore());

  test('raised high on the house layer, the other link named, no content recorded; closed by the watch once removed', async () => {
    const first = await scan(HOUSE_A);
    expect(first.house.errors).toEqual([]);
    const row = await linkRow(HOUSE_A);
    expect(row).toMatchObject({ layer: 'house', source: 'house-probe', severity: 'high', status: 'new' });
    expect(row.remedy).toContain(`remove the extra link ${twin}`);
    expect(row.remedy).toContain(`find / -xdev -samefile ${secret}`);
    expect(JSON.stringify(await (await threatLedgerFor(HOUSE_A)).load())).not.toContain(mark);

    // Another house on the same ground is never told of a lane it does not own.
    const other = await scan(HOUSE_B);
    expect(other.house.errors).toEqual([]);
    expect(await linkRow(HOUSE_B)).toBeUndefined();

    await fs.rm(twin);
    const second = await scan(HOUSE_A);
    expect(second.house.errors).toEqual([]);
    expect(await linkRow(HOUSE_A)).toMatchObject({ status: 'mitigated', assessedBy: 'watch' });
  }, 120_000);
});
