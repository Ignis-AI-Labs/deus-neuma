// The thread law — backend (queue-thread.js) and the desk's read of it
// (queue-thread-view.js) give the same root, members and drafts. Pure.
import { describe, expect, test } from 'vitest';
import { approveThreadIn, threadMembers, threadRootOf } from '../../backend/services/social/queue-thread.js';
import { threadOf } from '../../frontend/app/RelinkShell/queue-thread-view.js';

const T = (id, over = {}) => ({ id, channelId: 'x', status: 'draft', text: `post ${id}`, createdAt: `2026-10-21T00:00:0${id.length}Z`, ...over });
const QUEUE = [
  T('a'), T('b', { kind: 'self-reply', thread: { parentId: 'a' } }), T('c', { kind: 'self-reply', thread: { parentId: 'b' } }),
  T('d', { kind: 'self-reply', thread: { parentId: 'a' }, status: 'approved', createdAt: '2026-10-21T00:00:09Z' }),
  T('lone'), T('r', { kind: 'reply' }),
];

describe('the thread law', () => {
  test('any post of a thread leads to its root; its members run root first', () => {
    expect(threadRootOf(QUEUE, 'c').id).toBe('a');
    expect(threadMembers(QUEUE, 'a').map((e) => e.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  test('the desk reads the same thread the backend decides', () => {
    const byId = new Map(QUEUE.map((e) => [e.id, e]));
    for (const id of ['a', 'b', 'c', 'd', 'lone']) {
      const desk = threadOf(byId, id);
      expect(desk.root.id).toBe(threadRootOf(QUEUE, id).id);
      expect(desk.members.map((e) => e.id)).toEqual(threadMembers(QUEUE, desk.root.id).map((e) => e.id));
    }
    expect(threadOf(byId, 'a').drafts.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  test('approval is all or nothing, and a dead root can never be armed', () => {
    const store = QUEUE.map((e) => ({ ...e }));
    const seen = Object.fromEntries(store.map((e) => [e.id, e.text]));
    expect(approveThreadIn(store, 'b', { decidedBy: '0xw', textsSeen: { ...seen, c: 'stale' }, now: new Date() }).error).toMatch(/post 4 of the thread changed/);
    expect(store.filter((e) => e.status === 'approved').map((e) => e.id)).toEqual(['d']);
    expect(approveThreadIn(store, 'b', { decidedBy: '0xw', textsSeen: seen, now: new Date() }).approved.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    const dead = [T('x', { status: 'withdrawn' }), T('y', { kind: 'self-reply', thread: { parentId: 'x' } })];
    expect(approveThreadIn(dead, 'y', { decidedBy: '0xw', textsSeen: { x: 'post x', y: 'post y' }, now: new Date() }).error).toMatch(/withdrawn/);
    expect(approveThreadIn(QUEUE.map((e) => ({ ...e })), 'r', { decidedBy: '0xw', textsSeen: {}, now: new Date() }).error).toMatch(/reply is no thread/);
  });
});
