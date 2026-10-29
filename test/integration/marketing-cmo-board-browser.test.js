// The CMO lays out the operator's MARKETING board (marketing panel slice 5) —
// real Chromium, the PRODUCTION window, the real board route over a real
// signed-wallet session, the real stores on tmp disk (marketing-office-kit.js),
// and the CMO's arrangement written through the REAL intent path: an
// `intents/<name>.json` in the CMO lane, settled by the real sweep, whose real
// chip is handed to the page the way the chat stream hands it
// (stream-message-handlers.js → announceBoardArrangement). No double (RULE 0).
//
// Proves what the operator sees: the arrangement waits while the pointer is on
// the board and lands when it leaves; each panel the CMO set wears the CMO's
// mark; the panel the operator pinned stayed where it was; and the CMO LOG
// counts the arrangement.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMarketingOffice, stopMarketingOffice, openOffice } from '../helpers/marketing-office-kit.js';
import { viaIntent } from '../helpers/intent-path.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { boardStoreFor } from '../../backend/services/marketing/board-store.js';

const CMO = 'kestrel';
let ctx;

beforeAll(async () => {
  ctx = await startMarketingOffice('marketing-cmo-board-');
  await cmoDesignation.designate(ctx.auth.address, CMO);
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

const drawn = (page) => page.locator('[data-mkt-board] .mkb-grid > .sub-panel').evaluateAll((els) => els.map((el) => [el.dataset.part,
  Number([...el.classList].find((c) => c.startsWith('sub-span-')).slice('sub-span-'.length))]));
const marked = (page, mark) => page.locator(`[data-mkt-board] [data-mark="${mark}"]`).evaluateAll((els) => els.map((el) => el.closest('[data-part]').dataset.part));

describe('MARKETING — the CMO arranges the board, the operator sees it', () => {
  it('lands after the pointer leaves, wears the CMO mark, keeps the operator\'s pin in place, and is counted in the CMO LOG', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await page.locator('[data-mkt-level="house"] [data-mkt-board] .mkb-grid > .sub-panel').first().waitFor();
    const c = `campaign:${ctx.campaign.id}`;
    // The operator pins POSTS with their own lever: the board is now saved, every panel theirs.
    await page.locator('[data-part="posts"] [data-panel-menu]').click();
    const put = page.waitForResponse((r) => r.url().includes('/api/v1/marketing/board') && r.request().method() === 'PUT');
    await page.locator('.cmenu-item', { hasText: 'PIN' }).click();
    expect((await put).status()).toBe(200);
    const before = await drawn(page);
    expect(before.at(-1)).toEqual(['posts', 12]);
    expect(await marked(page, 'pin')).toEqual(['posts']);
    expect(await page.locator('[data-log="board"] b').innerText()).toBe('0');

    // The CMO's board for the house: the site counter gone, the campaign wider, X's own numbers over 30 days,
    // the posts that did most by likes — and POSTS left where the operator pinned it, unchanged (its pin carried).
    const panels = [
      { kind: 'tiles', span: 12 }, { kind: 'campaign', span: 8, scope: { campaignId: ctx.campaign.id } }, { kind: 'cmo-log', span: 4 },
      { kind: 'platform', span: 6, scope: { platform: 'x' }, show: ['views', 'likes'], window: '30d' }, { kind: 'platform', span: 6, scope: { platform: 'bluesky' } },
      { kind: 'top-posts', span: 6, sort: 'likes', count: 5 }, { kind: 'next-7-days', span: 6 }, { kind: 'accounts', span: 6 }, { kind: 'angles', span: 6 },
      { kind: 'posts', span: 12 },
    ];
    expect(panels).toHaveLength(before.length);
    await page.hover('[data-mkt-board] [data-part="accounts"]');
    const frames = [];
    const [receipt] = await viaIntent({ walletAddress: ctx.auth.address, companion: { name: 'Kestrel', neumaId: CMO }, toolMode: 'ask' },
      'marketing/board-arrange', { level: 'house', panels }, 'ask', null, (f) => frames.push(f));
    expect(receipt.status).toBe('ok');
    const settled = frames.find((f) => f.status === 'ok');
    await page.evaluate((frame) => window.marketingFixture.actFrame(frame), settled);

    await page.waitForTimeout(1500);
    expect(await drawn(page), 'held while the pointer is on the board').toEqual(before);
    await page.mouse.move(2, 2);
    const after = [['tiles', 12], [c, 8], ['cmo-log', 4], ['platform:x', 6], ['platform:bluesky', 6], ['top-posts', 6], ['next-7-days', 6], ['accounts', 6], ['angles', 6], ['posts', 12]];
    await expect.poll(() => drawn(page), { timeout: 10000 }).toEqual(after);
    // Every panel the CMO changed or moved wears its mark; TILES (unchanged, in place) and the pinned POSTS stay the operator's.
    expect(await marked(page, 'cmo')).toEqual(after.slice(1, -1).map(([part]) => part));
    expect(await marked(page, 'pin')).toEqual(['posts']);
    expect((await (await boardStoreFor(ctx.auth.address)).load('house')).at(-1)).toMatchObject({ id: 'posts', pinned: true, setBy: 'operator' });
    // The CMO LOG counts it, quietly, beside the rest of what the CMO did.
    await expect.poll(() => page.locator('[data-log="board"] b').innerText(), { timeout: 10000 }).toBe('1');
    expect(await page.locator('[data-log="board"]').getAttribute('title')).toMatch(/^the CMO laid out the board 1 time\(s\) · last \d{4}-\d\d-\d\d \d\d:\d\d UTC \(house\)$/);
    expect(errors).toEqual([]);
    await page.close();
  }, 180000);

  it('a refused arrangement says nothing to the board', async () => {
    const { page, errors } = await openOffice(ctx, 1400);
    await page.locator('[data-mkt-level="house"] [data-mkt-board] .mkb-grid > .sub-panel').first().waitFor();
    const before = await drawn(page);
    const frames = [];
    const [receipt] = await viaIntent({ walletAddress: ctx.auth.address, companion: { name: 'Kestrel', neumaId: CMO }, toolMode: 'ask' },
      'marketing/board-arrange', { level: 'house', panels: [{ kind: 'tiles', span: 12 }] }, 'ask', null, (f) => frames.push(f));
    expect(receipt.error).toBe('- panel "posts" is pinned by the operator: the CMO cannot remove it');
    const reads = [];
    page.on('request', (r) => { if (r.url().includes('/api/v1/marketing/board')) reads.push(r.url()); });
    for (const frame of frames) await page.evaluate((f) => window.marketingFixture.actFrame(f), frame);
    await page.waitForTimeout(1000);
    expect(reads).toEqual([]);
    expect(await drawn(page)).toEqual(before);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
