/**
 * THE CMO CLEANS UP AND SEES EVERYTHING (Design note, 2026-11-12: […]; a fixed ~3,900-char window held back four
 * of ten replies on a 262K context and the CMO missed the one it needed).
 * RULE 0: the real reply-lane house — real temp realm, the real candidate
 * record and queue, the real handlers, the real approval broker over a real
 * WebSocket pair. No mock anywhere.
 *
 * Proven: setting a reply aside pulls the unsent answer to it with it; the
 * reply inbox is sized to the room the conversation has left — a roomy chat
 * reads every reply whole and carries the cap that admits it, a crowded one
 * still holds back its oldest honestly.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { getChannel } from '../../backend/services/social/channel-registry.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { listingRoom, LISTING_CHARS_MAX } from '../../backend/services/read-room.js';
import { TOOL_RESULT_MAX_CHARS } from '../../backend/services/tool-exchange.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { buildReplyLaneHouse, teardownReplyLaneHouse, freshConnection, NEUMA_ID } from '../helpers/reply-lane-house.js';

const { _handleNeumaReplyDismiss, _handleSocialTool } = __test;

let h;
beforeAll(async () => {
  h = await buildReplyLaneHouse();
  // Twelve more replies, each long enough that ten never fit the old window.
  for (let i = 0; i < 12; i += 1) {
    await h.candidates.add({
      postId: String(3100 + i), conversationId: String(9100 + i), authorId: String(500 + i), username: `voice${i}`,
      verified: false, verifiedType: null, postCreatedAt: `2026-11-12T03:${String(10 + i).padStart(2, '0')}:00Z`,
      text: `reply number ${i}: ${'how does the pool route a swap when the depth sits in two bins at once and the fee tier differs '.repeat(3)}`,
    });
  }
}, 30000);
afterAll(async () => { await teardownReplyLaneHouse(h); });
beforeEach(async () => {
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  h.clientLog.length = 0;
  h.decide = null;
});

const connect = (extra = {}) => {
  const connection = { ...freshConnection(h), ...extra };
  h.serverWs.__connection = connection;
  return connection;
};

describe('set aside = not engaged', () => {
  test('setting a reply aside pulls the unsent answer to it; another reply\'s answer stands', async () => {
    const connection = connect();
    const answer = { channelId: 'x', kind: 'reply', authorNeumaId: NEUMA_ID, queuedBy: NEUMA_ID };
    const bad = await postQueue.add({ ...answer, text: 'The window is open — send it now.', reply: { toPostId: '2001', toUserId: '42', conversationId: '900' } });
    const other = await postQueue.add({ ...answer, text: 'Count you in.', reply: { toPostId: '2005', toUserId: '42', conversationId: '905' } });
    h.decide = () => 'allow';

    const out = await _handleNeumaReplyDismiss(h.serverWs, connection, null, 'ask', { toPostId: '2001', reason: 'window closed' }, getChannel('x'));
    expect(out.status).toBe('ok');
    expect(out.content).toContain(`Its unsent answer ${bad.id} was pulled with it and will never publish.`);
    const queue = await postQueue.load();
    expect(queue.find((e) => e.id === bad.id)).toMatchObject({ status: 'withdrawn' });
    expect(queue.find((e) => e.id === other.id)).toMatchObject({ status: 'draft' });
    expect((await h.candidates.byPostId('2001')).dismissed).toBe(true);
  });
});

describe('the reply inbox reads the room it has', () => {
  const read = (room) => _handleSocialTool(h.serverWs, connect({ _turnRoom: room }), null, 'ask', { toolName: 'replies_list', tool: 'social/replies_list' }, { limit: 20 });

  test('a roomy chat (262K window, 29K used) reads every reply whole, with the cap that admits it', async () => {
    const out = await read({ window: 262144, promptTokens: 29000 });
    expect(out.status).toBe('ok');
    for (let i = 0; i < 12; i += 1) expect(out.content).toContain(`reply number ${i}:`);
    expect(out.content).toContain('That is all 14.');
    expect(out.content.length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    expect(out.cap).toBeGreaterThanOrEqual(out.content.length);
  });

  test('a crowded chat still fits itself in whole replies and says what it held back', async () => {
    const out = await read({ window: 32768, promptTokens: 30000 });
    expect(out.content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(out.content).toMatch(/…\d+ more\. Next: /);
  });

  test('the window: the standing cap at least, a quarter of the room, never past the ceiling', () => {
    expect(listingRoom({ window: 32768, promptTokens: 32000 })).toBe(TOOL_RESULT_MAX_CHARS - 120);
    expect(listingRoom({ window: 262144, promptTokens: 29000 })).toBe(LISTING_CHARS_MAX);
    expect(listingRoom(null)).toBe(Math.floor((32768 - 8192) * 3 * 0.25));
  });
});
