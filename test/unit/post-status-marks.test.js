// The ONE status vocabulary (show-dont-tell audit, finding 9) — the pure
// table every surface reads. Real inputs, real outputs; no double (RULE 0).
import { describe, it, expect } from 'vitest';
import { STATUS_MARKS, STATUS_TONES, statusMark, statusKeyOf, feedKeyOf } from '../../frontend/app/RelinkShell/post-status-marks.js';
import { QUEUE_STATUSES } from '../../backend/services/social/post-queue.js';
import { feedRows } from '../../backend/services/marketing/mandate/mandate-feed.js';

const MANDATE_EVENTS = ['granted', 'withdrawn', 'resumed', 'renewed', 'tripped', 'held', 'cleared'];
const AT = '2026-10-24T09:00:00Z';

describe('the StatusMark table', () => {
  it('maps every status the queue can hold', () => {
    for (const s of QUEUE_STATUSES) expect(STATUS_MARKS[s], s).toBeDefined();
  });

  it('maps every row DONE FOR YOU can draw: an act in each post status, a vanished post, a made thing, every mandate event', () => {
    const journal = [
      ...QUEUE_STATUSES.map((s) => ({ at: AT, kind: 'act', act: 'post', queueId: `q-${s}`, channelId: 'x', accountId: 'x-1' })),
      { at: AT, kind: 'act', act: 'post', queueId: 'q-vanished' },
      { at: AT, kind: 'act', act: 'video' },
      ...MANDATE_EVENTS.map((kind) => ({ at: AT, kind, origin: 'a reply', cancelled: [], inFlight: [] })),
    ];
    const rows = feedRows(journal, QUEUE_STATUSES.map((s) => ({ id: `q-${s}`, channelId: 'x', status: s })));
    expect(rows).toHaveLength(QUEUE_STATUSES.length + 2 + MANDATE_EVENTS.length);
    for (const row of rows) expect(STATUS_MARKS[feedKeyOf(row)], `${row.kind} ${row.status}`).toBeDefined();
    expect(rows.map(feedKeyOf)).toEqual(expect.arrayContaining(['gone', 'done', ...MANDATE_EVENTS.map((k) => `mandate-${k}`)]));
  });

  it('covers every status each former vocabulary named (the card chip, DONE FOR YOU, the board filter, the platform doors)', () => {
    const former = {
      card: ['draft', 'approved', 'sending', 'sent', 'failed', 'rejected', 'withdrawn'],
      doneForYou: ['approved', 'sending', 'sent', 'failed', 'withdrawn', 'done', 'mandate-tripped', 'mandate-held'],
      filter: ['draft', 'failed', 'sent'],
      platformDoors: ['sent', 'approved', 'draft', 'failed'],
    };
    for (const [surface, keys] of Object.entries(former)) for (const k of keys) expect(STATUS_MARKS[k], `${surface}: ${k}`).toBeDefined();
  });

  it('no two statuses share a mark and colour, and no two share a name', () => {
    const marks = Object.values(STATUS_MARKS);
    expect(new Set(marks.map((m) => `${m.shape}/${m.tone}`)).size).toBe(marks.length);
    expect(new Set(marks.map((m) => m.name)).size).toBe(marks.length);
  });

  it('every name is at most two words, and every colour is one of the desk\'s own tokens', () => {
    for (const [key, m] of Object.entries(STATUS_MARKS)) {
      expect(m.name.split(/\s+/).length, key).toBeLessThanOrEqual(2);
      expect(Object.keys(STATUS_TONES), key).toContain(m.tone);
      expect(m.token, key).toBe(STATUS_TONES[m.tone]);
    }
    expect(Object.values(STATUS_TONES)).toEqual(['--signal', '--color-text-secondary', '--alert', '--color-text-tertiary']);
  });

  it('the same status reads the same mark wherever it is said', () => {
    expect(statusMark('draft')).toBe(STATUS_MARKS.draft);
    expect(statusMark('draft').name).toBe('AWAITING');
    expect(statusMark('failed')).toMatchObject({ shape: 'fault', tone: 'alert', name: 'FAILED' });
    expect(statusMark('sent')).toMatchObject({ shape: 'disc', tone: 'ink', name: 'SENT' });
    // ◇ waits on you, wherever it waits: a draft and a held read are both diamonds.
    expect([statusMark('draft').shape, statusMark('mandate-held').shape]).toEqual(['diamond', 'diamond-fill']);
  });
});

describe('the key a thing stands under', () => {
  it('a post the mandate approved stands BY MANDATE; any other approval is SCHEDULED', () => {
    expect(statusKeyOf({ status: 'approved', decidedUnder: 'mandate-7' })).toBe('by-mandate');
    expect(statusMark(statusKeyOf({ status: 'approved', decidedUnder: 'mandate-7' })).name).toBe('BY MANDATE');
    expect(statusKeyOf({ status: 'approved' })).toBe('approved');
    expect(statusKeyOf({ status: 'sent', decidedUnder: 'mandate-7' })).toBe('sent');
  });

  it('a DONE FOR YOU event stands under its own kind, never a post\'s (a withdrawn mandate is not a withdrawn post)', () => {
    expect(feedKeyOf({ kind: 'event', status: 'withdrawn' })).toBe('mandate-withdrawn');
    expect(feedKeyOf({ kind: 'act', status: 'withdrawn' })).toBe('withdrawn');
    expect(statusMark('mandate-withdrawn').name).not.toBe(statusMark('withdrawn').name);
  });

  it('a status the table has never met still says itself, as a quiet bar', () => {
    expect(statusMark('quarantined')).toMatchObject({ shape: 'line', tone: 'quiet', name: 'QUARANTINED' });
    expect(statusMark('mandate-audited').name).toBe('AUDITED');
    expect(statusMark('').name).toBe('UNKNOWN');
    expect(statusMark(statusKeyOf({})).name).toBe('UNKNOWN');
  });
});
