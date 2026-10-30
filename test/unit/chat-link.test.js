/**
 * CHAT-LINK's law (#597), called with real inputs: which live sittings a chat
 * may address (its own house only, never itself, never a witness, never a
 * socket that holds no session), the exact address, the words the receiving
 * chat reads, and the loop guard's line. Pure functions; nothing to fake.
 */
import { describe, expect, test } from 'vitest';
import {
  openChatsFor, chatAt, linkThought, linkRunFull, LINK_HEAD, LINK_RUN_LIMIT,
} from '../../backend/services/chat-link.js';

const OPEN = { readyState: 1 };
const CLOSED = { readyState: 3 };
const W = '0xAbC0000000000000000000000000000000000001';
const sitting = (neumaId, sessionId, extra = {}) => ({
  ws: OPEN, walletAddress: W, sessionId, companion: { neumaId, name: neumaId.toUpperCase() }, ...extra,
});

describe('the house address book', () => {
  const self = sitting('alder', 's1');
  const live = [
    self,
    sitting('kest', 's2', { turnPromise: Promise.resolve() }),
    sitting('alder', 's3'), // the same being's other chat is another chat
    sitting('kest', 's2', { walletAddress: W.toLowerCase() }), // a second window on one chat
    sitting('otter', 's4', { walletAddress: '0x2222222222222222222222222222222222222222' }),
    sitting('witness-claude-Claude', 's5'),
    sitting('sentry', 's6', { companion: { neumaId: 'sentry', participantKind: 'witness' } }),
    sitting('quiet', null), // bound, never spoken: no address yet
    sitting('gone', 's7', { ws: CLOSED }),
    { ws: OPEN, walletAddress: W, sessionId: 's8', companion: null },
  ];

  test('lists this house\'s other open neuma chats, one row per address, titled from the labels', () => {
    expect(openChatsFor(live, self, { 'kest:s2': 'Launch plan' })).toEqual([
      { chat: 'kest:s2', neumaId: 'kest', name: 'KEST', title: 'Launch plan', busy: true },
      { chat: 'alder:s3', neumaId: 'alder', name: 'ALDER', title: null, busy: false },
    ]);
  });

  test('a chat is found by its exact address in its own house only', () => {
    expect(chatAt(live, W.toLowerCase(), 'kest:s2')).toBe(live[1]);
    expect(chatAt(live, W, 'otter:s4')).toBeNull();
    expect(chatAt(live, '0x2222222222222222222222222222222222222222', 'otter:s4')).toBe(live[4]);
    expect(chatAt(live, W, 'gone:s7')).toBeNull();
    expect(chatAt(live, W, 'kest')).toBeNull();
  });
});

describe('the words the receiving chat reads', () => {
  test('a housemate\'s, never the operator\'s, with the address to answer, then the body', () => {
    const from = { chat: 'alder:s1', name: 'Alder', title: 'Launch plan' };
    expect(linkThought({ from, body: 'What is the plan?', re: 'launch' })).toBe(
      `${LINK_HEAD}: a housemate's words, not your operator's. To answer, file chat/send to "alder:s1"] `
      + 'Alder, from the chat "Launch plan" (alder:s1), re "launch":\nWhat is the plan?',
    );
    expect(linkThought({ from: { ...from, title: null }, body: 'Hi.' })).toBe(
      `${LINK_HEAD}: a housemate's words, not your operator's. To answer, file chat/send to "alder:s1"] Alder, from the chat (alder:s1):\nHi.`,
    );
  });
});

describe('the loop guard', () => {
  test('full at the limit, open below it and on a chat that never took a link', () => {
    expect(linkRunFull({})).toBe(false);
    expect(linkRunFull({ _linkRun: LINK_RUN_LIMIT - 1 })).toBe(false);
    expect(linkRunFull({ _linkRun: LINK_RUN_LIMIT })).toBe(true);
  });
});
