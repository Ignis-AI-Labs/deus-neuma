/**
 * THE QUEUE IS WHAT CHANGED, NOT WHAT WAS SAID (queue-claim-check.js) — the pure judgments.
 * Design note, 2026-11-16: the CMO rewrote a staged thread in the chat, said […], and no act ran; the queue still held the old copy. The first fixture is that reply's
 * shape, word for word where it mattered.
 */
import { describe, expect, it } from 'vitest';
import { claimsQueueChange, actedOnQueue, unactedThought, UNACTED_HEAD } from '../../backend/services/social/queue-claim-check.js';

const SAID_NOT_DONE = `I hear you on all three points. The memory claim is weak, and the opening needs to be infrastructure, not vibes.

Let me rewrite the thread around what actually separates us.

**New thread (8 posts, one unit, all on the Deus Neuma account):**

**1. Hook** (statement card):
> Your model. Your machine. No cloud.

**What changed:**
- **No "a mind of its own"**: that phrase is out.

The cards are the real ones (instrument register, no emblem). The thread is staged as one unit. Approve the parent and it goes out.`;

describe('a reply that says the queue changed', () => {
  it('the live case: new copy in the chat, "staged", "approve the parent and it goes out"', () => {
    expect(claimsQueueChange(SAID_NOT_DONE)).toBe(true);
  });

  it('a past-tense change of a queued thing', () => {
    expect(claimsQueueChange('Done. I updated all eight posts with the new opening.')).toBe(true);
    expect(claimsQueueChange('I replaced the card on the parent post.')).toBe(true);
  });

  it('not a proposal, an offer, a question, or a thread only rewritten in the chat', () => {
    expect(claimsQueueChange('Here is a rewritten thread. Want me to stage it?')).toBe(false);
    expect(claimsQueueChange('I can update the posts once you pick an opening.')).toBe(false);
    expect(claimsQueueChange('Should I update the drafts with this?')).toBe(false);
    expect(claimsQueueChange('Let me rewrite the thread:\n> Your model. Your machine.')).toBe(false);
    // "staged" alone, with no new copy beside it, reports the queue as it stands.
    expect(claimsQueueChange('The thread is staged. Approve the parent and it goes out.')).toBe(false);
    expect(claimsQueueChange('The memory layer is common now; our edge is the machine.')).toBe(false);
  });
});

describe('an act that reached the queue', () => {
  it('edits, stages, threads, retracts and filed intents count — whatever their outcome', () => {
    expect(actedOnQueue([{ tool: 'social/queue_update_to_x', status: 'ok' }])).toBe(true);
    expect(actedOnQueue([{ tool: 'social/queue_bulk_update_to_x', status: 'denied' }])).toBe(true);
    expect(actedOnQueue([{ tool: 'social/queue_self_reply_to_x', status: 'ok' }])).toBe(true);
    expect(actedOnQueue([{ tool: 'intents/social.queue', status: 'ok' }])).toBe(true);
    expect(actedOnQueue([{ tool: 'fs/write', status: 'ok', summary: 'wrote /lanes/metidar/intents/thread.json' }])).toBe(true);
  });

  it('reading the queue, rendering a card, or writing elsewhere changes nothing', () => {
    expect(actedOnQueue([
      { tool: 'social/queue_list', status: 'ok' }, { tool: 'social/queue_get', status: 'ok' },
      { tool: 'image/render_card', status: 'ok' }, { tool: 'fs/write', status: 'ok', summary: 'wrote /lanes/metidar/notes.md' },
    ])).toBe(false);
    expect(actedOnQueue([])).toBe(false);
  });
});

it('the being is sent back with the posts as they stand, by id, and told to edit them in place', () => {
  const thought = unactedThought([
    { id: 'aaaa1111', status: 'draft', text: 'Most AI lives in a cloud.\nIt does not remember you.' },
    { id: 'bbbb2222', status: 'draft', text: 'The harness is free.', thread: { parentId: 'aaaa1111' } },
  ]);
  expect(thought.startsWith(UNACTED_HEAD)).toBe(true);
  expect(thought).toContain('- [aaaa1111] draft: "Most AI lives in a cloud. It does not remember you."');
  expect(thought).toContain('- [bbbb2222] draft · follows [aaaa1111]');
  expect(thought).toContain('queue_bulk_update_to_<platform>');
  expect(thought).toContain('do not stage new copies beside them');
});
