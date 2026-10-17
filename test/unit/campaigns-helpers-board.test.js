import { describe, it, expect } from 'vitest';
import {
  QUEUE_LANES, QUEUE_SECTIONS, isSettled, laneOf,
  orderQueueForBoard, sectionOf, splitLaneIntoGroups,
  splitQueueIntoSections,
  postCountFor, postLengthOf, queueStandingLabel, queueToneOf, queueWhenLabel,
  xPostUrl,
} from '../../frontend/app/RelinkShell/campaigns-helpers.js';

// Every standing the post queue can hold, mirrored BY HAND from post-queue.js —
// it writes them as inline strings, so there is nothing to import. The mirror
// is asserted as a whole below rather than status by status: the property that
// matters is that the lanes cover the set, not that any one of them is placed.
// An unknown status is tested too, which is what actually catches drift.
const ALL_STANDINGS = ['draft', 'approved', 'sending', 'sent', 'failed', 'rejected', 'withdrawn'];


// THE OPERATOR'S BOARD ORDER.
//
// Design note, 2026-07-27, looking at two WITHDRAWN posts sitting above the one post
// awaiting him, each printing its full body: […] The board did not sort at all — it rendered insertion order,
// which is staging order, which puts the oldest dead copy first.
describe('orderQueueForBoard — what needs a decision comes first', () => {
  const e = (id, status, scheduledFor = null) => ({ id, status, scheduledFor, createdAt: '2026-07-01T00:00:00Z' });

  it('sinks withdrawn beneath the post awaiting a decision — the reported bug', () => {
    const out = orderQueueForBoard([e('w1', 'withdrawn'), e('w2', 'withdrawn'), e('d1', 'draft')]);
    expect(out[0].id).toBe('d1');
    expect(out.map((x) => x.status).slice(1)).toEqual(['withdrawn', 'withdrawn']);
  });

  it('ranks by standing: draft, approved, sending, then everything settled', () => {
    const out = orderQueueForBoard([
      e('sent', 'sent'), e('app', 'approved'), e('drf', 'draft'),
      e('wdn', 'withdrawn'), e('snd', 'sending'), e('rej', 'rejected'), e('fal', 'failed'),
    ]);
    expect(out.slice(0, 3).map((x) => x.id)).toEqual(['drf', 'app', 'snd']);
    expect(out.slice(3).every((x) => isSettled(x.status))).toBe(true);
  });

  it('keeps FAILED with the settled — it is history, not a task', () => {
    // Promoting a failure would push the decision the operator owes back down.
    const out = orderQueueForBoard([e('fal', 'failed'), e('drf', 'draft')]);
    expect(out[0].id).toBe('drf');
  });

  it('orders within a group by scheduled time, earliest first', () => {
    const out = orderQueueForBoard([
      e('late', 'draft', '2026-07-27T20:00:00Z'),
      e('early', 'draft', '2026-07-27T14:00:00Z'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['early', 'late']);
  });

  it('sinks an undated entry within its own group rather than to the bottom', () => {
    const out = orderQueueForBoard([
      { id: 'none', status: 'draft' },
      e('dated', 'draft', '2026-07-27T14:00:00Z'),
      e('settled', 'sent', '2026-07-01T00:00:00Z'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['dated', 'none', 'settled']);
  });

  it('is total and stable — equal entries fall back to id, never array order', () => {
    const a = [e('b', 'draft', '2026-07-27T14:00:00Z'), e('a', 'draft', '2026-07-27T14:00:00Z')];
    expect(orderQueueForBoard(a).map((x) => x.id)).toEqual(['a', 'b']);
    expect(orderQueueForBoard([...a].reverse()).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('never mutates the caller\'s array', () => {
    const input = [e('w', 'withdrawn'), e('d', 'draft')];
    orderQueueForBoard(input);
    expect(input.map((x) => x.id)).toEqual(['w', 'd']);
  });

  it('survives junk — the board hands it whatever the API returned', () => {
    expect(orderQueueForBoard(null)).toEqual([]);
    expect(orderQueueForBoard([])).toEqual([]);
    expect(orderQueueForBoard([{ id: 'x' }])).toHaveLength(1);
  });
});

// THE SECTIONS, then THE LANES.
//
// Design note, 2026-08-06: […] KIND first, STANDING second.
//
// The property under test is TOTALITY, carried up a level: an entry that
// falls between two (section, lane) seats is worse than the pile was,
// because the operator cannot even scroll to it.
describe('splitQueueIntoSections — POSTS and REPLIES, nothing between them', () => {
  const e = (id, status) => ({ id, status, scheduledFor: null, createdAt: '2026-07-01T00:00:00Z' });
  const reply = (id, status) => ({
    id, status, kind: 'reply', scheduledFor: null, createdAt: '2026-07-01T00:00:00Z',
    reply: { toPostId: '2001', toUserId: '42', toUsername: 'bluefriend' },
  });
  const all = () => ALL_STANDINGS.map((s) => e(`p-${s}`, s));
  const allReplies = () => ALL_STANDINGS.map((s) => reply(`r-${s}`, s));

  it('sectionOf: only kind reply is REPLIES — a self-reply is POSTS (thread copy, its parent\'s calendar)', () => {
    expect(sectionOf({ kind: 'reply' })).toBe('replies');
    expect(sectionOf({ kind: 'self-reply' })).toBe('posts');
    expect(sectionOf({})).toBe('posts');
    expect(sectionOf(null)).toBe('posts');
  });

  it('puts every (kind, standing) pair into exactly one (section, lane)', () => {
    const sections = splitQueueIntoSections([...all(), ...allReplies()]);
    const landed = Object.values(sections)
      .flatMap((lanes) => Object.values(lanes).flat())
      .map((x) => x.id).sort();
    expect(landed).toEqual([...all(), ...allReplies()].map((x) => x.id).sort()); // none lost, none doubled
    // No reply leaked into POSTS, no post leaked into REPLIES.
    for (const entry of Object.values(sections.posts).flat()) expect(entry.kind).not.toBe('reply');
    for (const entry of Object.values(sections.replies).flat()) expect(entry.kind).toBe('reply');
  });

  it('lands standings where Founder asked: queued, sent, withdrawn — in BOTH sections', () => {
    const sections = splitQueueIntoSections([...all(), ...allReplies()]);
    expect(sections.posts.queued.map((x) => x.id).sort()).toEqual(['p-approved', 'p-draft', 'p-sending']);
    expect(sections.posts.sent.map((x) => x.id).sort()).toEqual(['p-failed', 'p-sent']);
    // DECLINED shares the WITHDRAWN lane (2026-08-06) — two acts, one lane,
    // kept distinct by the group header and the entry's own chip.
    expect(sections.posts.withdrawn.map((x) => x.id).sort()).toEqual(['p-rejected', 'p-withdrawn']);
    expect(sections.replies.queued.map((x) => x.id).sort()).toEqual(['r-approved', 'r-draft', 'r-sending']);
    expect(sections.replies.sent.map((x) => x.id).sort()).toEqual(['r-failed', 'r-sent']);
    expect(sections.replies.withdrawn.map((x) => x.id).sort()).toEqual(['r-rejected', 'r-withdrawn']);
  });

  it('keeps a lane in board order — what needs a decision leads QUEUED', () => {
    const sections = splitQueueIntoSections([e('a', 'approved'), e('s', 'sending'), e('d', 'draft')]);
    expect(sections.posts.queued.map((x) => x.id)).toEqual(['d', 'a', 's']);
  });

  it('gives an unknown standing a lane rather than dropping it', () => {
    // A status this frontend has never heard of must still be reachable — a
    // post the operator cannot see is worse than one in the wrong tab.
    const sections = splitQueueIntoSections([e('x', 'quarantined')]);
    expect(laneOf('quarantined')).toBe('queued');
    expect(sections.posts.queued.map((x) => x.id)).toEqual(['x']);
  });

  it('always answers with every section and every lane, so no strip reads undefined', () => {
    const sections = splitQueueIntoSections([]);
    expect(Object.keys(sections).sort()).toEqual(QUEUE_SECTIONS.map((s) => s.id).sort());
    for (const s of QUEUE_SECTIONS) {
      expect(Object.keys(sections[s.id]).sort()).toEqual(QUEUE_LANES.map((l) => l.id).sort());
      for (const l of QUEUE_LANES) expect(sections[s.id][l.id]).toEqual([]);
    }
  });

  it('survives junk and never mutates the caller\'s array', () => {
    const input = [e('w', 'withdrawn'), e('d', 'draft')];
    splitQueueIntoSections(input);
    expect(input.map((x) => x.id)).toEqual(['w', 'd']);
    expect(splitQueueIntoSections(null).posts.queued).toEqual([]);
    expect(splitQueueIntoSections([{ id: 'bare' }]).posts.queued).toHaveLength(1);
  });

  it('names a label for each section, and a POSTS note and empty line for each lane', () => {
    // The posts strip renders these unconditionally; a missing one is a crash.
    // REPLIES speaks through its own buckets (reply-board.test.js).
    for (const s of QUEUE_SECTIONS) expect(s.label).toBeTruthy();
    for (const l of QUEUE_LANES) {
      expect(l.label).toBeTruthy();
      expect(l.note.posts).toBeTruthy();
      expect(l.empty.posts).toBeTruthy();
    }
  });
});

describe('splitLaneIntoGroups — the separations inside a (section, lane)', () => {
  const e = (id, status) => ({ id, status });

  it('separates awaiting-approval from approved inside POSTS/QUEUED, as asked', () => {
    // […]
    const groups = splitLaneIntoGroups('posts', 'queued', [e('d', 'draft'), e('a', 'approved'), e('s', 'sending')]);
    expect(groups.map((g) => g.label)).toEqual(['AWAITING YOUR APPROVAL', 'APPROVED — sends on its own']);
    expect(groups[0].entries.map((x) => x.id)).toEqual(['d']);
    expect(groups[1].entries.map((x) => x.id)).toEqual(['a', 's']); // sending rides with approved
  });

  it('REPLIES/QUEUED separates what needs you from what is mid-flight — never a schedule promise', () => {
    const groups = splitLaneIntoGroups('replies', 'queued', [e('d', 'draft'), e('s', 'sending')]);
    expect(groups.map((g) => g.label)).toEqual(['AWAITING YOUR APPROVAL', 'IN FLIGHT']);
    expect(groups[0].entries.map((x) => x.id)).toEqual(['d']);
    expect(groups[1].entries.map((x) => x.id)).toEqual(['s']);
  });

  it('leads SENT with what did NOT send — a failure wants an eye, not burial — in both sections', () => {
    for (const section of ['posts', 'replies']) {
      const groups = splitLaneIntoGroups(section, 'sent', [e('ok', 'sent'), e('bad', 'failed')]);
      expect(groups.map((g) => g.label)).toEqual(['DID NOT SEND', 'SENT']);
      expect(groups[0].entries.map((x) => x.id)).toEqual(['bad']);
    }
  });

  it('WITHDRAWN keeps the two acts distinct: DECLINED (the verdict) then WITHDRAWN (the pull-back)', () => {
    const groups = splitLaneIntoGroups('posts', 'withdrawn', [e('w', 'withdrawn'), e('r', 'rejected')]);
    expect(groups.map((g) => g.label)).toEqual(['DECLINED', 'WITHDRAWN']);
    expect(groups[0].entries.map((x) => x.id)).toEqual(['r']);
    expect(groups[1].entries.map((x) => x.id)).toEqual(['w']);
  });

  it('drops a group with nothing in it, rather than printing an empty header', () => {
    const groups = splitLaneIntoGroups('posts', 'queued', [e('a', 'approved')]);
    expect(groups.map((g) => g.label)).toEqual(['APPROVED — sends on its own']);
  });

  it('keeps the grouping TOTAL — no entry is lost between two headers', () => {
    for (const s of QUEUE_SECTIONS.map((x) => x.id)) {
      for (const lane of QUEUE_LANES.map((l) => l.id)) {
        const entries = ALL_STANDINGS.map((st) => e(st, st));
        const landed = splitLaneIntoGroups(s, lane, entries).flatMap((g) => g.entries);
        expect(landed).toHaveLength(entries.length);
      }
    }
  });

  it('preserves the order it was handed inside a group', () => {
    const groups = splitLaneIntoGroups('posts', 'queued', [e('a1', 'approved'), e('a2', 'approved')]);
    expect(groups[0].entries.map((x) => x.id)).toEqual(['a1', 'a2']);
  });

  it('survives an empty lane and junk', () => {
    expect(splitLaneIntoGroups('posts', 'withdrawn', [])).toEqual([]);
    expect(splitLaneIntoGroups('posts', 'queued', null)).toEqual([]);
    expect(splitLaneIntoGroups('posts', 'no-such-lane', [e('x', 'draft')])).toHaveLength(1);
  });
});

describe('isSettled', () => {
  it('names the four finished standings', () => {
    for (const s of ['sent', 'failed', 'rejected', 'withdrawn']) expect(isSettled(s)).toBe(true);
  });
  it('leaves the live ones open', () => {
    for (const s of ['draft', 'approved', 'sending', undefined, '']) expect(isSettled(s)).toBe(false);
  });
});

// THE ENTRY META LINE + STANDING REGISTER (#206, Design note, 2026-07-27: […]). Pure truth tables — `now` is injected, so the
// whole calendar is testable without a clock.
describe('queueWhenLabel — one meta line per entry, in the data register', () => {
  // A Tuesday at 18:00 local.
  const now = new Date(2026, 6, 28, 18, 0, 0).getTime();
  const iso = (d) => d.toISOString();

  it('a scheduled draft reads its slot, compact and relative', () => {
    const label = queueWhenLabel({ status: 'draft', scheduledFor: iso(new Date(2026, 6, 28, 21, 12, 0)) }, now);
    expect(label).toBe('GOES OUT IN 3H 12M · TUE 9:12 PM');
  });

  it('a slot under an hour reads in minutes; under a minute reads NOW', () => {
    expect(queueWhenLabel({ status: 'draft', scheduledFor: iso(new Date(2026, 6, 28, 18, 45, 0)) }, now))
      .toBe('GOES OUT IN 45M · TUE 6:45 PM');
    expect(queueWhenLabel({ status: 'draft', scheduledFor: iso(new Date(2026, 6, 28, 18, 0, 20)) }, now))
      .toBe('GOES OUT IN NOW · TUE 6:00 PM');
  });

  it('a missed slot reads OVERDUE — never silently stale', () => {
    const label = queueWhenLabel({ status: 'draft', scheduledFor: iso(new Date(2026, 6, 28, 15, 55, 0)) }, now);
    expect(label).toBe('OVERDUE 2H 5M · WAS TUE 3:55 PM');
  });

  it('an unscheduled draft reads its staging age', () => {
    const label = queueWhenLabel({ status: 'draft', scheduledFor: null, createdAt: iso(new Date(2026, 6, 28, 16, 0, 0)) }, now);
    expect(label).toBe('STAGED 2H AGO · UNSCHEDULED');
    expect(queueWhenLabel({ status: 'draft', scheduledFor: null }, now)).toBe('UNSCHEDULED');
  });

  it('an approved post reads its send; past-slot approved sends on the next pass', () => {
    expect(queueWhenLabel({ status: 'approved', scheduledFor: iso(new Date(2026, 6, 30, 20, 0, 0)) }, now))
      .toBe('SENDS IN 2D 2H · THU 8:00 PM');
    expect(queueWhenLabel({ status: 'approved', scheduledFor: iso(new Date(2026, 6, 28, 17, 0, 0)) }, now))
      .toBe('SENDS ON THE NEXT PASS · WAS TUE 5:00 PM');
    expect(queueWhenLabel({ status: 'approved', scheduledFor: null }, now)).toBe('SENDS ON THE NEXT PASS');
  });

  it('the schedule LOCK rides the approved card — the lock timestamp proves it armed (Design note, 2026-07-28', () => {
    const decidedAt = iso(new Date(2026, 6, 28, 13, 38, 0));
    expect(queueWhenLabel({ status: 'approved', scheduledFor: iso(new Date(2026, 6, 28, 20, 0, 0)), decidedAt }, now))
      .toBe('SENDS IN 2H · TUE 8:00 PM · LOCKED TUE 1:38 PM');
    expect(queueWhenLabel({ status: 'approved', scheduledFor: null, decidedAt }, now))
      .toBe('SENDS ON THE NEXT PASS · LOCKED TUE 1:38 PM');
  });

  it('the lock ID rides beside the timestamp — citeable, on the card', () => {
    const decidedAt = iso(new Date(2026, 6, 28, 13, 38, 0));
    expect(queueWhenLabel({ status: 'approved', id: 'a54d3735cd373b80', scheduledFor: iso(new Date(2026, 6, 28, 20, 0, 0)), decidedAt }, now))
      .toBe('SENDS IN 2H · TUE 8:00 PM · LOCKED TUE 1:38 PM · ID a54d3735cd373b80');
  });

  it('beyond the week the absolute date takes over from the weekday', () => {
    expect(queueWhenLabel({ status: 'approved', scheduledFor: iso(new Date(2026, 7, 12, 9, 30, 0)) }, now))
      .toBe('SENDS IN 14D 15H · AUG 12 · 9:30 AM');
  });

  it('the clock is 12-hour (Founder works AM/PM) — noon and midnight stay honest', () => {
    expect(queueWhenLabel({ status: 'sent', sentAt: iso(new Date(2026, 6, 27, 12, 0, 0)) }, now))
      .toBe('SENT MON 12:00 PM');
    expect(queueWhenLabel({ status: 'sent', sentAt: iso(new Date(2026, 6, 27, 0, 5, 0)) }, now))
      .toBe('SENT MON 12:05 AM');
  });

  it('settled standings read their own moment, with honest fallbacks', () => {
    expect(queueWhenLabel({ status: 'sending' }, now)).toBe('SENDING NOW');
    expect(queueWhenLabel({ status: 'sent', sentAt: iso(new Date(2026, 6, 27, 20, 4, 0)) }, now)).toBe('SENT MON 8:04 PM');
    expect(queueWhenLabel({ status: 'sent' }, now)).toBe('SENT'); // no timestamp — no invented one
    expect(queueWhenLabel({ status: 'failed', decidedAt: iso(new Date(2026, 6, 27, 20, 4, 0)) }, now)).toBe('FAILED MON 8:04 PM');
    expect(queueWhenLabel({ status: 'rejected', decidedAt: iso(new Date(2026, 6, 27, 21, 10, 0)) }, now)).toBe('DECLINED MON 9:10 PM');
    expect(queueWhenLabel({ status: 'withdrawn', decidedAt: iso(new Date(2026, 6, 27, 21, 10, 0)) }, now)).toBe('WITHDRAWN MON 9:10 PM');
    expect(queueWhenLabel({ status: 'rejected' }, now)).toBe('DECLINED');
    expect(queueWhenLabel({ status: 'something-new' }, now)).toBe('');
  });

  // THE REPLY'S CLOCK IS NOT A SLOT (Design note, 2026-08-06: the live standings
  // speak the approval law and the TTL — never GOES OUT IN / SENDS IN / the
  // schedule-lock vocabulary, which would all be lies for a reply.
  it('a draft REPLY reads the approval law and its expiry, never a slot', () => {
    const label = queueWhenLabel({
      kind: 'reply', status: 'draft',
      createdAt: iso(new Date(2026, 6, 28, 17, 15, 0)),
      expiresAt: iso(new Date(2026, 6, 29, 17, 15, 0)),
    }, now);
    expect(label).toBe('STAGED 45M AGO · SENDS THE MOMENT YOU APPROVE · EXPIRES IN 23H 15M');
    expect(queueWhenLabel({
      kind: 'reply', status: 'draft',
      createdAt: iso(new Date(2026, 6, 27, 10, 0, 0)),
      expiresAt: iso(new Date(2026, 6, 28, 10, 0, 0)),
    }, now)).toBe('STAGED 32H AGO · SENDS THE MOMENT YOU APPROVE · EXPIRED — WITHDRAWS UNANSWERED');
  });

  it('a legacy APPROVED reply says plainly it will never send', () => {
    expect(queueWhenLabel({ kind: 'reply', status: 'approved' }, now))
      .toBe('LEGACY SLOT — ARMED BEFORE APPROVE-AND-SEND · EXPIRES UNANSWERED');
  });

  it('a settled reply reads like any settled entry — the send moment is real', () => {
    expect(queueWhenLabel({ kind: 'reply', status: 'sending' }, now)).toBe('SENDING NOW');
    expect(queueWhenLabel({ kind: 'reply', status: 'sent', sentAt: iso(new Date(2026, 6, 28, 17, 50, 0)) }, now))
      .toBe('SENT TUE 5:50 PM');
  });
});

describe('queueToneOf — the rail and chip register', () => {
  it('draft is the one standing that is live BY DESIGN (a human owes a decision)', () => {
    expect(queueToneOf('draft')).toBe('await');
  });
  it('approved and sending move on their own', () => {
    expect(queueToneOf('approved')).toBe('live');
    expect(queueToneOf('sending')).toBe('live');
  });
  it('failed wants an eye; everything settled is history', () => {
    expect(queueToneOf('failed')).toBe('failed');
    for (const s of ['sent', 'rejected', 'withdrawn', 'unknown', '']) expect(queueToneOf(s)).toBe('done');
  });
});

describe('queueStandingLabel — the chip speaks the lanes\' vocabulary', () => {
  it('names every standing the queue can hold', () => {
    expect(queueStandingLabel({ status: 'draft' })).toBe('AWAITS YOUR DECISION');
    expect(queueStandingLabel({ status: 'approved' })).toBe('APPROVED');
    expect(queueStandingLabel({ status: 'sending' })).toBe('SENDING…');
    expect(queueStandingLabel({ status: 'sent' })).toBe('SENT');
    expect(queueStandingLabel({ status: 'sent', postId: 'abc123' })).toBe('SENT (abc123)');
    expect(queueStandingLabel({ status: 'failed' })).toBe('DID NOT SEND');
    expect(queueStandingLabel({ status: 'rejected' })).toBe('DECLINED');
    expect(queueStandingLabel({ status: 'withdrawn' })).toBe('WITHDRAWN');
  });
  it('an unknown standing still reads something, uppercased', () => {
    expect(queueStandingLabel({ status: 'quarantined' })).toBe('QUARANTINED');
    expect(queueStandingLabel({})).toBe('UNKNOWN');
  });
});

// THE PREVIEW'S MEASURE (Design note, 2026-07-27: […]).
describe('postLengthOf / postCountFor — the platform\'s own constraint, made visible', () => {
  it('counts code points, not UTF-16 units — an emoji is ONE', () => {
    expect(postLengthOf('hello')).toBe(5);
    expect(postLengthOf('one 🔥 post')).toBe(10); // 9 letters/spaces + 1 emoji = 10, not 11
    expect(postLengthOf('')).toBe(0);
    expect(postLengthOf(null)).toBe(0);
  });

  it('measures against the channel\'s own ceiling, and flags what would not fit', () => {
    const x = { id: 'x', maxChars: 280 };
    expect(postCountFor({ text: 'a'.repeat(247) }, x)).toEqual({ count: 247, limit: 280, over: false });
    expect(postCountFor({ text: 'a'.repeat(281) }, x)).toEqual({ count: 281, limit: 280, over: true });
    expect(postCountFor({ text: 'a'.repeat(280) }, x).over).toBe(false); // exactly at the ceiling fits
  });

  it('no ceiling on the channel → no limit, never over', () => {
    expect(postCountFor({ text: 'a'.repeat(5000) }, { id: 'custom' }))
      .toEqual({ count: 5000, limit: null, over: false });
    expect(postCountFor({ text: 'x' }, null)).toEqual({ count: 1, limit: null, over: false });
  });
});

// THE LINK BACK (Design note, 2026-08-28: […]).
// The handle-free /i/status/ form — the same permalink the backend's
// queue-render.js speaks — resolves for any account, so a reply card links
// the exact post from the id alone.
describe('xPostUrl — the permalink a reply card links the real post with', () => {
  it('builds the canonical permalink from the persisted post id', () => {
    expect(xPostUrl('2001')).toBe('https://x.com/i/status/2001');
  });

  it('no id → no link, never a broken anchor', () => {
    expect(xPostUrl(null)).toBeNull();
    expect(xPostUrl(undefined)).toBeNull();
    expect(xPostUrl('')).toBeNull();
    expect(xPostUrl('   ')).toBeNull();
  });

  it('survives non-string ids — ids arrive as numbers from some API shapes', () => {
    expect(xPostUrl(2001)).toBe('https://x.com/i/status/2001');
  });

  it('encodes the id — a crafted value cannot steer the path or add a query', () => {
    expect(xPostUrl('../evil')).toBe('https://x.com/i/status/..%2Fevil');
    expect(xPostUrl('1?x=2')).toBe('https://x.com/i/status/1%3Fx%3D2');
  });
});
