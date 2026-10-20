/**
 * queue_get BY THE POST (ruling, 2026-10-13): a being holding an X post's id or link reads
 * the house's record of it in one call — its own sent post, or the house's answer to
 * someone else's — instead of hunting the queue for an internal id.
 */
import { formatQueueEntryForBeing } from '../../backend/services/social/queue-render.js';

const entries = [
  { id: 'own-1', channelId: 'x', kind: 'post', status: 'sent', text: 'the house speaks', postId: '5001', sentAt: '2026-10-12T10:00:00Z', createdAt: '2026-10-12T09:00:00Z' },
  { id: 'old-ans', channelId: 'x', kind: 'reply', status: 'withdrawn', text: 'placeholder', createdAt: '2026-10-12T11:00:00Z', reply: { toPostId: '7001', toUsername: 'someone', toTextPreview: 'hello?' } },
  { id: 'live-ans', channelId: 'x', kind: 'reply', status: 'draft', text: 'Entendido. Un plan está en proceso.', createdAt: '2026-10-12T10:30:00Z', reply: { toPostId: '7001', toUsername: 'someone', toTextPreview: 'hello?' } },
];

describe('queue_get resolves an X post to its queue entry', () => {
  test('the house\'s own post resolves to the entry it went out as', () => {
    const found = formatQueueEntryForBeing(entries, '5001', { postId: '5001' });
    expect(found.ok).toBe(true);
    expect(found.entry.id).toBe('own-1');
  });

  test('someone else\'s post resolves to the LIVE answer, and the earlier ones are named', () => {
    const found = formatQueueEntryForBeing(entries, 'https://x.com/someone/status/7001', { postId: '7001' });
    expect(found.ok).toBe(true);
    expect(found.entry.id).toBe('live-ans');
    expect(found.text).toContain('"Entendido. Un plan está en proceso."');
    expect(found.text).toContain('EARLIER ANSWERS TO THE SAME POST (1):');
    expect(found.text).toContain('[old-ans] withdrawn — "placeholder"');
    expect(found.text).toContain('the post this answers, on X by @someone');
  });

  test('a digit prefix naming two entries refuses — it is never guessed at as a post', () => {
    const twins = [...entries, { id: '91aa', status: 'draft', text: 'a' }, { id: '91bb', status: 'draft', text: 'b' }];
    expect(formatQueueEntryForBeing(twins, '91', { postId: '91' })).toMatchObject({ ok: false, error: expect.stringContaining('use more of it') });
  });

  test('a queue id still resolves first, and an unknown post says so plainly', () => {
    expect(formatQueueEntryForBeing(entries, 'live', { postId: '' }).entry.id).toBe('live-ans');
    const none = formatQueueEntryForBeing(entries, '9999', { postId: '9999' });
    expect(none).toEqual({ ok: false, error: 'no queue entry is X post 9999 or answers it' });
  });
});
