// send-pace — where each campaign stands against its share of the week's sending goal. Pure.
//
// Counted from the house's own records as the screen already holds them: an email counts when the outbox says it was
// SENT (so mail brought in from another tool never counts), in the week that began on Monday on this computer's clock,
// under the campaign of the lead it went to. Beside it stand what happened to the people written to this week:
// how many addresses bounced and how many wrote back. A bounce rate that climbs, or replies that stop while the
// sending holds, is the sign that mail is no longer reaching inboxes.

const DAY = 86_400_000;
/** The Monday 00:00, on this computer's clock, of the week `now` is in (ms). */
export const weekStart = (now = Date.now()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
/** The working days left in the week, today included (Monday to Friday; a weekend day counts as one). */
export const daysLeft = (now = Date.now()) => { const day = (new Date(now).getDay() + 6) % 7; return Math.max(1, 5 - day); };
const HEARD = new Set(['replied', 'qualified']);

/**
 * @param {object} engine - the lead engine as the screen holds it (campaigns, leads, outbox.drafts)
 * @param {?{weekly: number, campaigns: string[]}} goal
 * @param {number} [now]
 * @returns {{weekly: number, share: number, daysLeft: number, rows: object[], total: object}} rows: one a campaign of
 *   the goal, then one for everything sent under no campaign of it (when there is any)
 */
export const paceOf = (engine, goal, now = Date.now()) => {
  const from = weekStart(now);
  const today = new Date(now).setHours(0, 0, 0, 0);
  const lead = new Map((engine?.leads ?? []).map((l) => [String(l.contact ?? '').toLowerCase(), l]));
  const picked = goal?.campaigns ?? [];
  const share = picked.length ? Math.floor((goal?.weekly ?? 0) / picked.length) : 0;
  const left = daysLeft(now);
  const blank = (id, name, target) => ({ id, name, target, sent: 0, today: 0, bounced: 0, replied: 0, people: new Set() });
  const by = new Map(picked.map((id) => [id, blank(id, (engine?.campaigns ?? []).find((c) => c.id === id)?.name ?? id, share)]));
  const other = blank('other', 'EVERYTHING ELSE', null);
  for (const d of engine?.outbox?.drafts ?? []) {
    const at = Date.parse(d.sentAt ?? '');
    if (d.state !== 'sent' || !(at >= from) || at >= from + 7 * DAY) continue;
    const who = (d.to ?? []).map((a) => lead.get(String(a).toLowerCase())).find(Boolean) ?? null;
    const row = by.get(who?.origin?.campaignId) ?? other;
    row.sent += 1;
    if (at >= today) row.today += 1;
    if (who && !row.people.has(who.id)) { row.people.add(who.id); if (who.bounced) row.bounced += 1; if (HEARD.has(who.status)) row.replied += 1; }
  }
  const done = (r) => { const toGo = r.target == null ? null : Math.max(0, r.target - r.sent); return { id: r.id, name: r.name, target: r.target, sent: r.sent, today: r.today, toGo, aDay: toGo == null ? null : Math.ceil(toGo / left), bounced: r.bounced, replied: r.replied }; };
  const rows = [...by.values(), ...(other.sent ? [other] : [])].map(done);
  const sum = (k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const sent = sum('sent');
  const toGo = goal ? Math.max(0, goal.weekly - rows.filter((r) => r.target != null).reduce((n, r) => n + r.sent, 0)) : null;
  return { weekly: goal?.weekly ?? 0, share, daysLeft: left, rows, total: { sent, today: sum('today'), bounced: sum('bounced'), replied: sum('replied'), toGo, aDay: toGo == null ? null : Math.ceil(toGo / left) } };
};
