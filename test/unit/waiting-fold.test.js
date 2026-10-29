/**
 * WAITING ON YOU — the pure fold (backend/services/waiting/waiting-fold.js):
 * each source's record becomes one item shape (what, who asks, where it
 * lives, since when), and the lot folds into the true count and the order the
 * desk shows — the longest wait first. Pure functions over real inputs; no
 * mock anywhere (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import {
  liveCardItem, houseAskItem, charterItem, queueItem, queueOneTap, isQueueDecision, proposalItem, foldWaiting,
} from '../../backend/services/waiting/waiting-fold.js';

const names = new Map([['lane-a', 'Kestrel']]);
const iso = (minsAgo) => new Date(Date.UTC(2026, 9, 24, 12, 0) - minsAgo * 60000).toISOString();

describe('each source becomes one item: what, who asks, where it lives, since when', () => {
  test('a chat card lives in the sitting that raised it; a council card in the council room', () => {
    const card = { id: 'c1', kind: 'approval', title: 'web/web_search', sessionId: 's-1', laneId: 'lane-a', name: 'Kestrel', beingKind: 'local', surface: null, at: iso(3) };
    expect(liveCardItem(card)).toEqual({
      id: 'card:c1', kind: 'approval', title: 'web/web_search', who: { laneId: 'lane-a', name: 'Kestrel' },
      where: { app: 'chat', cardId: 'c1', sessionId: 's-1', neumaId: 'lane-a', name: 'Kestrel', beingKind: 'local' },
      at: iso(3),
    });
    expect(liveCardItem({ ...card, surface: 'council' }).where).toEqual({ app: 'council', cardId: 'c1' });
  });

  test('a house ask names its seat by name and lands on its row in the ASKS tab', () => {
    const item = houseAskItem({ id: 'a1', kind: 'act', tool: 'social/post', why: 'the launch post', seat: 'lane-a', at: iso(9) }, names);
    expect(item).toMatchObject({
      id: 'house-ask:a1', kind: 'house-ask', title: 'social/post — the launch post',
      who: { laneId: 'lane-a', name: 'Kestrel' }, where: { app: 'houseclock', tab: 'asks', askId: 'a1' }, at: iso(9),
    });
    expect(houseAskItem({ id: 'a2', kind: 'decision', question: 'Which banner?', seat: 'lane-x', at: iso(1) }, names))
      .toMatchObject({ title: 'Which banner?', who: { laneId: 'lane-x', name: null } });
  });

  test('an unapproved charter is the house\'s own decision, on the CHARTER tab', () => {
    expect(charterItem({ version: 3, goal: 'Run the launch week', updatedAt: iso(30) })).toEqual({
      id: 'charter:3', kind: 'charter', title: 'the house charter, version 3 — Run the launch week',
      who: null, where: { app: 'houseclock', tab: 'charter' }, at: iso(30),
    });
  });

  test('a queue draft carries its whole copy and lands on its card in its platform\'s window', () => {
    const post = { id: 'e1', channelId: 'x', text: 'The house speaks.', authorNeumaId: 'lane-a', createdAt: iso(5), status: 'draft' };
    expect(queueItem(post, [post], names)).toEqual({
      id: 'queue:e1', kind: 'post', title: 'The house speaks.', who: { laneId: 'lane-a', name: 'Kestrel' },
      where: { app: 'x', channelId: 'x', entryId: 'e1', section: 'posts' }, at: iso(5), text: 'The house speaks.', oneTap: true,
    });
    const reply = { ...post, id: 'e2', kind: 'reply', reply: { toUsername: 'knocker1' }, text: 'Answer.' };
    expect(queueItem(reply, [reply], names)).toMatchObject({ kind: 'reply', title: 'answer to @knocker1', where: { section: 'replies' } });
  });

  test('a proposal lands on its card in its being\'s SOVEREIGNTY record', () => {
    expect(proposalItem({ id: 'p1', title: 'Plain speech', submittedAt: iso(60) }, 'lane-a', names)).toEqual({
      id: 'proposal:lane-a:p1', kind: 'proposal', title: 'Plain speech', who: { laneId: 'lane-a', name: 'Kestrel' },
      where: { app: 'sovereignty', neumaId: 'lane-a', proposalId: 'p1' }, at: iso(60),
    });
  });
});

describe('one press only where nothing hides behind the yes', () => {
  const base = { id: 'e1', channelId: 'x', text: 'Hello', status: 'draft' };
  test('a plain post or reply is one press', () => {
    expect(queueOneTap(base, [base])).toBe(true);
    expect(queueOneTap({ ...base, kind: 'reply' }, [base])).toBe(true);
  });
  test('a TikTok post (its card of choices), an image, a thread member or a thread head are not', () => {
    expect(queueOneTap({ ...base, channelId: 'tiktok' }, [])).toBe(false);
    expect(queueOneTap({ ...base, media: [{ path: 'card.png' }] }, [])).toBe(false);
    expect(queueOneTap({ ...base, kind: 'self-reply', thread: { parentId: 'e0' } }, [])).toBe(false);
    expect(queueOneTap(base, [base, { id: 'e9', thread: { parentId: 'e1' } }])).toBe(false);
  });
  test('only a real draft waits — a placeholder or a decided entry does not', () => {
    expect(isQueueDecision(base)).toBe(true);
    expect(isQueueDecision({ ...base, placeholder: true })).toBe(false);
    for (const status of ['approved', 'sending', 'sent', 'failed', 'rejected', 'withdrawn']) {
      expect(isQueueDecision({ ...base, status })).toBe(false);
    }
  });
});

describe('the fold: the true count, the oldest wait, the longest wait first', () => {
  test('ordered by how long each has waited, ties by id so the order never shuffles', () => {
    const items = [
      { id: 'b', at: iso(1) }, { id: 'c', at: iso(40) }, { id: 'a', at: iso(1) }, { id: 'd', at: iso(12) },
    ];
    const fold = foldWaiting(items);
    expect(fold.count).toBe(4);
    expect(fold.oldestAt).toBe(iso(40));
    expect(fold.items.map((i) => i.id)).toEqual(['c', 'd', 'a', 'b']);
  });
  test('nothing waits: zero, and no oldest', () => {
    expect(foldWaiting([])).toEqual({ count: 0, oldestAt: null, items: [] });
  });
});
