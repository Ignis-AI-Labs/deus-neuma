/**
 * THE MARKETING BOARD STORE — real tmp realm, the real house office path, the
 * real lock and atomic write; no double anywhere (RULE 0).
 *
 * Proven: a house's boards land in its own office
 * (`<realm>/<wallet>/offices/marketing/marketing-board.json`, 0600 in a 0700
 * dir) and another house never sees them; one board per level, keyed `house`
 * and `<companyId>`; a refused board writes nothing and names every reason;
 * the pin rule holds in the store (a CMO write that moves or removes a pinned
 * panel is refused, the file unchanged); reset is the operator's alone; a
 * corrupt file surfaces; parallel saves of two levels both land.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { boardStoreFor, BOARD_FILE } from '../../backend/services/marketing/board-store.js';

const COMPANIES = [{ id: 'northwind', parentId: null }, { id: 'northwind-labs', parentId: 'northwind' }];
const CAMPAIGNS = [{ id: 'c-launch', companyId: 'northwind-labs' }];
const ctx = (setBy = 'operator') => ({ setBy, companies: COMPANIES, campaigns: CAMPAIGNS });
const p = (id, kind, companyId, extra = {}) => ({ id, kind, span: 6, scope: { companyId }, ...extra });
const HOUSE_BOARD = [p('tiles', 'tiles', null, { span: 12 }), p('accounts', 'accounts', null, { pinned: true }), p('posts', 'posts', null, { span: 12 })];

describe('the marketing board store — one per house (real tmp realm)', () => {
  let houses;
  beforeEach(async () => { houses = await standTwoHouses({ label: 'marketing-board' }); });
  afterEach(() => houses.restore());

  test('a house\'s boards live in its own office, per level, and another house never sees them', async () => {
    const a = await boardStoreFor(HOUSE_A);
    expect(await a.load('house')).toBeNull();
    const saved = await a.save('house', HOUSE_BOARD, ctx());
    expect(saved.ok).toBe(true);
    expect(saved.panels.map((x) => [x.id, x.setBy, x.pinned])).toEqual([['tiles', 'operator', false], ['accounts', 'operator', true], ['posts', 'operator', false]]);
    expect((await a.save('northwind', [p('posts', 'posts', 'northwind')], ctx())).ok).toBe(true);

    const file = houses.houseFile(HOUSE_A, 'offices', 'marketing', BOARD_FILE);
    const record = await houses.readJson(file);
    expect(Object.keys(record.boards)).toEqual(['house', 'northwind']);
    expect(record.v).toBe(1);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);

    const b = await boardStoreFor(HOUSE_B);
    expect(await b.load('house')).toBeNull();
    expect(await b.load('northwind')).toBeNull();
    await expect(fs.stat(houses.houseFile(HOUSE_B, 'offices', 'marketing', BOARD_FILE))).rejects.toThrow(/ENOENT/);
    await expect(boardStoreFor('not-a-wallet')).rejects.toThrow(/needs the house's wallet/);
  });

  test('a refused board writes nothing and names every reason', async () => {
    const a = await boardStoreFor(HOUSE_A);
    await a.save('house', HOUSE_BOARD, ctx());
    const file = houses.houseFile(HOUSE_A, 'offices', 'marketing', BOARD_FILE);
    const bytes = await fs.readFile(file, 'utf8');
    const refused = await a.save('house', [p('x', 'chart', null), p('y', 'posts', null, { span: 7 })], ctx());
    expect(refused).toEqual({ ok: false, reasons: [
      'panel 1 (chart): "chart" is not a panel kind (one of: tiles, campaign, accounts, angles, posts, links, platform, top-posts, funnel, next-7-days, company-watch, cmo-log)',
      'panel 2 (posts): its width is one of 3, 4, 6, 8, 12 columns',
    ] });
    expect((await a.save('northwind-labs', [p('links', 'links', 'northwind-labs')], ctx())).reasons).toEqual(['panel 1 (links): a links panel stands on the house\'s board only']);
    expect((await a.save('house', HOUSE_BOARD, { ...ctx(), setBy: 'someone' })).reasons).toEqual(['a board is set by operator or cmo']);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  });

  test('the pin rule holds in the store: the CMO cannot move or remove a pinned panel, and the file is unchanged', async () => {
    const a = await boardStoreFor(HOUSE_A);
    await a.save('house', HOUSE_BOARD, ctx());
    const file = houses.houseFile(HOUSE_A, 'offices', 'marketing', BOARD_FILE);
    const bytes = await fs.readFile(file, 'utf8');
    expect((await a.save('house', [HOUSE_BOARD[1], HOUSE_BOARD[0], HOUSE_BOARD[2]], ctx('cmo'))).reasons)
      .toEqual(['panel "accounts" is pinned by the operator: the CMO cannot move it']);
    expect((await a.save('house', [HOUSE_BOARD[0], HOUSE_BOARD[2]], ctx('cmo'))).reasons)
      .toEqual(['panel "accounts" is pinned by the operator: the CMO cannot remove it']);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);

    // Around the pin, the CMO's arrangement stands, stamped as the CMO's.
    const cmo = await a.save('house', [p('posts', 'posts', null, { span: 12 }), HOUSE_BOARD[1], p('angles', 'angles', null)], ctx('cmo'));
    expect(cmo.ok).toBe(true);
    expect(cmo.panels.map((x) => [x.id, x.setBy])).toEqual([['posts', 'cmo'], ['accounts', 'operator'], ['angles', 'cmo']]);
    expect(await a.reset('house', 'cmo')).toEqual({ ok: false, reasons: ['only the operator resets a board to its default'] });
    expect(await a.load('house')).toHaveLength(3);
    expect(await a.reset('house', 'operator')).toEqual({ ok: true });
    expect(await a.load('house')).toBeNull();
  });

  test('parallel saves of two levels both land; a corrupt file surfaces, never reads as empty', async () => {
    const a = await boardStoreFor(HOUSE_A);
    const [one, two] = await Promise.all([a.save('house', HOUSE_BOARD, ctx()), a.save('northwind', [p('posts', 'posts', 'northwind')], ctx())]);
    expect([one.ok, two.ok]).toEqual([true, true]);
    expect(await a.load('house')).toHaveLength(3);
    expect(await a.load('northwind')).toHaveLength(1);
    const file = houses.houseFile(HOUSE_A, 'offices', 'marketing', BOARD_FILE);
    await fs.writeFile(file, '{"v":1,"boards":[');
    await expect(a.load('house')).rejects.toThrow();
    await fs.writeFile(file, '{"v":9,"boards":{}}');
    await expect(a.load('house')).rejects.toThrow(/is not a v1 board record/);
  });
});
