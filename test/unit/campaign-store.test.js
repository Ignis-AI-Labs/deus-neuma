/**
 * validateCampaign — the bench's shape gate. Pure: real inputs, real error
 * strings. Written 2026-07-28 for the self-explaining cadence error — a being
 * dumped its research into the schedule field and […]
 * taught it nothing (no limit, no redirect).
 */
import { describe, it, expect } from 'vitest';
import { validateCampaign } from '../../backend/services/marketing/campaign-store.js';

const GOOD = Object.freeze({ name: 'Umbrae Launch', brand: 'Umbrae' });

describe('validateCampaign — the cadence error explains itself', () => {
  it('cadence over 200 chars names the limit AND where the long-form belongs', () => {
    const err = validateCampaign({ ...GOOD, cadence: 'x'.repeat(201) });
    expect(err).toContain('max 200 chars');
    expect(err).toContain('marketingPlan/notes');
    expect(err).toContain('schedule in one line');
  });

  it('a one-line cadence passes — the field is for schedules, not summaries', () => {
    expect(validateCampaign({ ...GOOD, cadence: '2 posts/day, 9 AM + 6 PM ET' })).toBeNull();
    expect(validateCampaign(GOOD)).toBeNull();
  });

  it('the long-form fields name their own (much larger) limits', () => {
    expect(validateCampaign({ ...GOOD, marketingPlan: 'x'.repeat(20001) }))
      .toBe('marketingPlan is too long (max 20000 chars)');
    expect(validateCampaign({ ...GOOD, notes: 'x'.repeat(20001) }))
      .toBe('notes is too long (max 20000 chars)');
    // …and they happily carry what cadence refused.
    expect(validateCampaign({ ...GOOD, marketingPlan: 'research: '.concat('x'.repeat(5000)) })).toBeNull();
  });
});
