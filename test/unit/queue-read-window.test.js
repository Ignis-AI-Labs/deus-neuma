/**
 * THE QUEUE READ WINDOW — a queue read is whole entries, or it is nothing.
 *
 * Pure functions over real entry shapes, no mock anywhere (RULE 0).
 *
 * Until 2026-08-28 `queue_list` rendered far past the portal's tool-result cap
 * and the exchange's compressor folded the MIDDLE out of it — measured on the
 * live store that day: the default full view 17,396 chars, the index view
 * 25,167, against a cap of 4,000. So a being's ordinary queue read arrived as
 * a head, a sampled middle, a tail, and `[… N chars omitted @ offset M]` where
 * entries used to be, with copy severed mid-sentence.
 *
 * Three laws are proven here, and the third is the one that made this more
 * than a copy of the X read's fix:
 * 1. Given a budget, the render fits it — in WHOLE entries, one always
 *    surviving, no compressor fold ever reached.
 * 2. Without a budget nothing changes, because the same renderer feeds the CMO
 *    briefing section, which answers to a prompt budget and not the tool cap.
 * 3. THE PAGING CONTRACT: the "next call" hint counts what was RENDERED. If it
 *    counted the selection's page instead, a being walking the month would
 *    step straight over everything the window held back — silently.
 */
import { describe, test, expect } from 'vitest';
import {
  selectQueueForBeing, renderQueueSelection, drawQueueSelection,
} from '../../backend/services/social/queue-view.js';

const STATUSES = ['draft', 'approved', 'sending', 'sent', 'failed', 'withdrawn', 'rejected'];

// Entries shaped exactly as the store writes them — the copy is what makes a
// full-view entry expensive, so it is real copy, not filler.
const COPY = 'The house builds in the open, and the record is the proof. '
  + 'Every line staged here publishes verbatim, breaks and all.';

const entries = (n, at = '2026-09-01T09:00:00Z') => Array.from({ length: n }, (_, i) => ({
  id: `entry${String(i).padStart(4, '0')}`,
  channelId: 'x',
  status: 'draft',
  kind: 'post',
  text: `${COPY} (${i})`,
  scheduledFor: at,
  createdAt: at,
  queuedBy: '0xW',
}));

const select = (all, query = {}) => selectQueueForBeing(all, query, { statuses: STATUSES });

describe('the queue read window', () => {
  test('a budget is fitted in WHOLE entries — never a cut one, never a fold', () => {
    const all = entries(40);
    const sel = select(all);
    const budget = 3880;

    const unbounded = renderQueueSelection(sel);
    expect(unbounded.length).toBeGreaterThan(budget); // the fold this prevents

    const drawn = drawQueueSelection(sel, { budget });
    expect(drawn.text.length).toBeLessThanOrEqual(budget);
    expect(drawn.shown).toBeGreaterThan(0);
    expect(drawn.shown).toBeLessThan(sel.page.length);

    // Every entry that IS here is here whole: its id, and its copy in full.
    const shownEntries = sel.page.slice(0, drawn.shown);
    for (const e of shownEntries) {
      expect(drawn.text).toContain(`[${e.id}]`);
      expect(drawn.text).toContain(e.text);
    }
    // And the first one held back is nowhere in it — not even partly.
    const heldBack = sel.page[drawn.shown];
    expect(drawn.text).not.toContain(`[${heldBack.id}]`);
    expect(drawn.text).not.toContain(heldBack.text);
  });

  test('the short page says WHY, so a window is never read as a shorter record', () => {
    const drawn = drawQueueSelection(select(entries(40)), { budget: 3880 });
    expect(drawn.text).toContain(`your context window held ${drawn.shown} of this page's 30`);
    expect(drawn.text).toContain('whole entries only, never a cut one');
    // The record's own count is still stated plainly at the top.
    expect(drawn.text).toContain('40 post(s) in the campaign queue');
  });

  test('one entry always survives, however small the window', () => {
    const drawn = drawQueueSelection(select(entries(40)), { budget: 200 });
    expect(drawn.shown).toBe(1);
    expect(drawn.text).toContain('[entry0000]');
  });

  test('no budget, no change — the prompt sections that share this renderer are untouched', () => {
    const sel = select(entries(40));
    const bare = renderQueueSelection(sel);
    expect(renderQueueSelection(sel, {})).toBe(bare);
    expect(drawQueueSelection(sel).text).toBe(bare);
    expect(drawQueueSelection(sel).shown).toBe(sel.page.length);
    expect(bare).toContain('showing 1–30 of 40');
    expect(bare).not.toContain('your context window held');
  });

  test('THE PAGING CONTRACT — walking by the hint skips nothing and repeats nothing', () => {
    // The whole risk of fitting a paged read. The hint used to be counted from
    // the SELECTION's page, so a window that fit 4 of 30 would still say
    // "offset: 30" and the being would lose 26 entries without a trace.
    const all = entries(97);
    const budget = 3880;
    const seen = [];
    let offset = 0;

    for (let read = 0; read < 200; read += 1) {
      const drawn = drawQueueSelection(select(all, { offset }), { budget });
      const page = select(all, { offset }).page.slice(0, drawn.shown);
      seen.push(...page.map((e) => e.id));
      const next = drawn.text.match(/next: queue_list \{offset: (\d+)/);
      if (!next) break;
      // The hint must move by exactly what was rendered, never by the page.
      expect(Number(next[1])).toBe(offset + drawn.shown);
      offset = Number(next[1]);
    }

    expect(seen).toHaveLength(97);
    expect(new Set(seen).size).toBe(97);
    expect(seen).toEqual(all.map((e) => e.id));
  });

  test('the index view is fitted too, and keeps its own next call', () => {
    const drawn = drawQueueSelection(select(entries(200), { view: 'index' }), { budget: 3880 });
    expect(drawn.text.length).toBeLessThanOrEqual(3880);
    expect(drawn.shown).toBeLessThan(200);
    expect(drawn.text).toContain(`next: queue_list {offset: ${drawn.shown}, view: 'index'}`);
    // The promise this stopped making: the index has not fitted "one read"
    // since the month outgrew the cap.
    expect(drawn.text).not.toContain('in one read');
  });

  test('a page that fits keeps every word it always had', () => {
    const sel = select(entries(3));
    const drawn = drawQueueSelection(sel, { budget: 3880 });
    expect(drawn.shown).toBe(3);
    expect(drawn.text).toBe(renderQueueSelection(sel));
    expect(drawn.text).not.toContain('next: queue_list');
  });

  test('an empty or refused read answers as it always did, and counts nothing', () => {
    expect(drawQueueSelection(select([]), { budget: 3880 }))
      .toEqual({ text: 'The campaign queue is empty — no posts are staged yet.', shown: 0 });
    const refused = drawQueueSelection(select(entries(3), { view: 'sideways' }), { budget: 3880 });
    expect(refused.shown).toBe(0);
    expect(refused.text).toContain('unknown view sideways');
  });
});
