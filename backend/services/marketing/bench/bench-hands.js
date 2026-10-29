// bench-hands — the campaign benchmark's HANDS score (campaign plan §6.2,
// slice 13): how much of the operator's hand each published post took, and
// how often a draft was right the first time. The house wants this to FALL
// week over week; the score is the record, never a target the record is
// bent to.
//
// A touch is an act of the operator's own wallet on a post: staging it by
// hand, approving or declining it, editing it. A being's acts are not
// touches. A draft […] carries no change to its words or
// media in its revision trail, by anyone.
//
// Pure.

const DAY_MS = 24 * 60 * 60 * 1000;

const lower = (v) => String(v || '').toLowerCase();

// pure — the ISO week a moment falls in: "2026-W43".
const isoWeek = (ms) => {
  const d = new Date(ms);
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

// pure — every act of the operator's hand on one post, each with its moment.
const touchesOf = (entry, house) => [
  ...(!entry.authorNeumaId && lower(entry.queuedBy) === house ? [{ at: entry.createdAt, kind: 'staged' }] : []),
  ...(lower(entry.decidedBy) === house && entry.decidedAt ? [{ at: entry.decidedAt, kind: entry.status === 'rejected' ? 'declined' : 'approved' }] : []),
  ...(Array.isArray(entry.revisions) ? entry.revisions : []).filter((r) => lower(r.by) === house).map((r) => ({ at: r.at, kind: 'edited' })),
].filter((t) => Number.isFinite(Date.parse(t.at)));

const editedWords = (entry) => (Array.isArray(entry.revisions) ? entry.revisions : [])
  .some((r) => r?.changed && ('text' in r.changed || 'media' in r.changed));

const per10 = (touches, published) => (published ? Math.round((touches / published) * 100) / 10 : null);

/**
 * The HANDS score over a set of posts. Pure.
 * @param {object[]} entries - the posts in scope (a campaign's, a company's, the house's)
 * @param {string} house - the operator's wallet
 * @returns {{touches: number, published: number, per10: ?number, byKind: object,
 *   weeks: Array<{week: string, touches: number, published: number, per10: ?number}>,
 *   trend: ?string, firstTime: {approved: number, unedited: number, share: ?number}}}
 */
export const handsOf = (entries, house) => {
  const me = lower(house);
  const touches = entries.flatMap((e) => touchesOf(e, me));
  const sent = entries.filter((e) => e.status === 'sent' && Number.isFinite(Date.parse(e.sentAt)));
  const weeks = new Map();
  const bump = (ms, key) => {
    const w = isoWeek(ms);
    if (!weeks.has(w)) weeks.set(w, { week: w, touches: 0, published: 0 });
    weeks.get(w)[key] += 1;
  };
  for (const t of touches) bump(Date.parse(t.at), 'touches');
  for (const e of sent) bump(Date.parse(e.sentAt), 'published');
  const series = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ ...w, per10: per10(w.touches, w.published) }));
  const rated = series.filter((w) => w.per10 !== null);
  const [prev, last] = rated.slice(-2);
  const decided = entries.filter((e) => e.decidedBy && ['approved', 'sending', 'sent'].includes(e.status));
  const unedited = decided.filter((e) => !editedWords(e)).length;
  return {
    touches: touches.length,
    published: sent.length,
    per10: per10(touches.length, sent.length),
    byKind: touches.reduce((acc, t) => ({ ...acc, [t.kind]: (acc[t.kind] || 0) + 1 }), {}),
    weeks: series,
    trend: !prev ? null : last.per10 < prev.per10 ? 'falling' : last.per10 > prev.per10 ? 'rising' : 'flat',
    firstTime: { approved: decided.length, unedited, share: decided.length ? Math.round((unedited / decided.length) * 1000) / 10 : null },
  };
};
