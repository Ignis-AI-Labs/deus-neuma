/**
 * A POST IS WRITTEN AND EDITED AS IT WILL READ (2026-10-30).
 *
 * The queue composer was a one-line <input>, and a browser strips every line break from one: pressing
 * EDIT on a two-paragraph post and saving ran it into one block ("everyone.Anyone"), and a new draft
 * could never hold a break at all. Real Chromium over the production MARKETING window, on the real routes
 * and the real queue store (marketing-office-kit.js): a two-paragraph draft is opened with EDIT, its
 * paragraphs are on the editor as they are on the card, a third is typed in with Enter, SAVE EDIT, and
 * the store holds all three paragraphs exactly; the card shows them on their own lines. No mocks (RULE 0).
 */
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMarketingOffice, stopMarketingOffice, openOffice } from '../helpers/marketing-office-kit.js';
import { postQueue } from '../../backend/services/social/post-queue.js';

const ACCOUNT = `?landing=${encodeURIComponent(JSON.stringify({ account: { channelId: 'x', accountId: 'x-1' } }))}`;
const LEVEL = '[data-mkt-level="account"]';
const FIRST = 'Pool creation is open to everyone.';
const BEFORE = `${FIRST}\n\nOur contracts were built for this from the start.`;
const ADDED = 'What does not change is what the house stands behind.';
let ctx;
let id;

beforeAll(async () => {
  ctx = await startMarketingOffice('queue-edit-format-');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  ({ id } = await postQueue.add({ channelId: 'x', accountId: 'x-1', text: BEFORE, queuedBy: ctx.auth.address, scheduledFor: today.toISOString() }));
}, 180000);

afterAll(async () => { await stopMarketingOffice(ctx); }, 30000);

describe('editing a queued post', () => {
  it('keeps its paragraphs: the editor shows them, Enter adds one, SAVE EDIT stores every line break', async () => {
    const { page, errors } = await openOffice(ctx, 1400, { height: 1100, query: ACCOUNT, ready: `${LEVEL} .pc-head` });
    await page.locator(`${LEVEL} .pc-strip-day.is-today`).click();
    const words = page.locator(`${LEVEL} .queue-preview-text`, { hasText: FIRST });
    await words.waitFor({ timeout: 20000 });
    await words.locator('xpath=ancestor::*[.//button[normalize-space()="EDIT"]][1]').getByRole('button', { name: 'EDIT', exact: true }).click();

    const editor = page.locator(`${LEVEL} textarea[placeholder="What should go out?"]`);
    await expect.poll(() => editor.inputValue(), { timeout: 10000 }).toBe(BEFORE);
    // as tall as the post: its lines are on screen, not scrolled out of a one-line strip
    expect(await editor.evaluate((el) => el.clientHeight > 3 * parseFloat(getComputedStyle(el).lineHeight))).toBe(true);
    await editor.click();
    await editor.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type(ADDED);
    await page.getByRole('button', { name: 'SAVE EDIT' }).click();

    const after = `${BEFORE}\n\n${ADDED}`;
    await expect.poll(async () => (await postQueue.load()).find((e) => e.id === id)?.text, { timeout: 15000 }).toBe(after);
    // the card reads it back on its own lines
    const card = page.locator(`${LEVEL} .queue-preview-text`, { hasText: ADDED });
    await card.waitFor({ timeout: 15000 });
    expect((await card.innerText()).split('\n').filter(Boolean)).toEqual([FIRST, 'Our contracts were built for this from the start.', ADDED]);
    expect(await page.evaluate(() => document.querySelectorAll('input[placeholder="What should go out?"]').length)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);
});
