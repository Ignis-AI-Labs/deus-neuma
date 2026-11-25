import { expect } from 'vitest';
import { addProspects, listScreened, readProspects, setSegmentState } from '../../backend/services/sales/sales-store.js';
import { readOutbox, setReview } from '../../backend/services/sales/email-outbox.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { formula } from './sales-formula-kit.js';

export const proveSecondRecipientRefusal = async ({ stage, house }) => {
  const secondStranger = await stage({ ...formula(), to: ['otto@outbox.example', 'stranger@elsewhere.example'] });
  expect(secondStranger.receipt.error).toMatch(/stranger@elsewhere\.example is not on the lead list/);
  expect((await readOutbox(house)).drafts).toEqual([]);
};

export const proveReviewFirstListing = async ({ segment, lane, house }) => {
  await setSegmentState(house, segment.id, 'approved', 'operator');
  const now = new Date().toISOString();
  const [prospect] = (await addProspects(house, [makeProspect({
    segment, domain: 'review-gate.example', name: 'Review Gate', country: 'US', source: 'https://review-gate.example/',
    scores: segment.positiveCriteria.map((criterion) => ({ criterion, score: 5, reasoning: 'its own site says so' })), by: lane, now,
  })])).added;
  await setReview(house, false);
  expect(await listScreened(house, segment.id, [prospect.id], `lead-run:${lane}`)).toBe(0);
  expect((await readProspects(house)).find((p) => p.id === prospect.id).listedAt).toBeFalsy();
  expect(await listScreened(house, segment.id, [prospect.id], 'operator')).toBe(1);
  await setReview(house, true);
};
