// sales-pipeline-view — THE SALES HUB AS ONE STRAIGHT LINE (Design note, 2026-11-18: […]; […]). Nine stages (CALLS stands just before DEALS — Design note, 2026-11-20: […]), each counted over the campaign in view (all of them,
// or one), each marked when it waits on the operator; and the rows that stand at each stage. The counts are the lead
// engine's own (lead-pipeline.js, through segmentRows), so the seat's briefing and this screen never disagree. Pure.

import { segmentRows, MATCH_WORDS } from './lead-engine-view.js';

export const STAGES = Object.freeze([
  { id: 'setup', n: 1, label: 'SETUP', does: 'WHAT THE POSITION NEEDS BEFORE ANYTHING RUNS' },
  { id: 'discover', n: 2, label: 'DISCOVER', does: 'WHO EACH AUDIENCE LOOKS FOR, AND WHAT ITS SEARCHES FOUND' },
  { id: 'filter', n: 3, label: 'FILTER', does: 'THE FOUND COMPANIES NARROWED TO THE MOST REASONABLE PROSPECTS' },
  { id: 'validate', n: 4, label: 'VALIDATE', does: 'EACH SITE CHECKED, EACH COMPANY SCORED, ITS RIGHT PERSON FOUND, THEN ONTO THE LIST' },
  // VALIDATED stands between the validating and the emails (Design note, 2026-11-21: […]).
  { id: 'ready', n: 5, label: 'VALIDATED', does: 'EVERY LEAD CONFIRMED AND FILED TO ITS CAMPAIGN, WAITING FOR ITS EMAIL TO BE WRITTEN' },
  { id: 'emails', n: 6, label: 'EMAILS', does: 'THE FIRST EMAILS, WRITTEN BY THE SEAT, WAITING FOR YOU TO READ AND SEND' },
  { id: 'sent', n: 7, label: 'SENT', does: 'EVERYONE WRITTEN TO, AND THE FOLLOW-UPS DUE' },
  { id: 'replies', n: 8, label: 'REPLIES', does: 'EVERYONE WHO ANSWERED, AND WHAT THEY WERE PROMISED' },
  { id: 'calls', n: 9, label: 'CALLS', does: 'EVERY CALL BOOKED WITH A LEAD, THE NEXT ONE FIRST' },
  { id: 'deals', n: 10, label: 'DEALS', does: 'THE DEALS OPEN, AND THE DEALS WON' },
]);
// What is not a stage of the line: kept one quiet row below it.
export const MORE = Object.freeze([
  { id: 'campaigns', label: 'CAMPAIGNS' },
  { id: 'leads', label: 'ALL PEOPLE' },
  { id: 'costs', label: 'COSTS' },
  { id: 'model', label: 'COMPANY FACTS' },
  { id: 'mailbox', label: 'MAILBOX' },
  { id: '_switches', label: 'SETTINGS' },
  { id: '_eyes', label: 'THEIR EYES' },
]);
export const ALL = 'all';
export const LOOSE = 'loose';

const n = (v) => Number(v || 0).toLocaleString('en-US');
const WRITTEN = new Set(['contacted', 'replied', 'qualified', 'won', 'lost']);
const HEARD = new Set(['replied', 'qualified']);

// pure — is this record part of the campaign in view? ALL is every one; LOOSE is the audiences under no campaign.
const inCampaign = (campaignId, view, known) => view === ALL || (view === LOOSE ? !known.has(campaignId) : campaignId === view);

/** The audiences (with their roads) in the campaign in view. */
export const rowsIn = (engine, view) => {
  const known = new Set((engine?.campaigns ?? []).map((c) => c.id));
  return segmentRows(engine).filter((r) => inCampaign(r.segment.campaign, view, known));
};

/** The leads in the campaign in view (each lead knows its campaign through the audience that found it). */
export const leadsIn = (engine, view) => {
  const known = new Set((engine?.campaigns ?? []).map((c) => c.id));
  return (engine?.leads ?? []).filter((l) => (view === ALL ? true : l.origin && inCampaign(l.origin.campaignId, view, known)));
};

/** The staged emails to people in the campaign in view. */
export const draftsIn = (engine, view) => {
  const drafts = engine?.outbox?.drafts ?? [];
  if (view === ALL) return drafts;
  const to = new Set(leadsIn(engine, view).map((l) => String(l.contact).toLowerCase()));
  return drafts.filter((d) => (d.to ?? []).some((a) => to.has(String(a).toLowerCase())));
};

const sum = (rows, pick) => rows.reduce((t, r) => t + (Number(pick(r.road.steps)) || 0), 0);

/**
 * The ten stages over the campaign in view: each with its headline count, the lines under it, and whether it waits
 * on the operator (you).
 * @param {{engine: ?object, view?: string, setup?: ?{done: number, total: number, steps?: object[]}, deals?: object[]}} state
 */
export const pipelineOf = ({ engine, view = ALL, setup = null, deals = [] }) => {
  const rows = rowsIn(engine, view);
  const leads = leadsIn(engine, view);
  const drafts = draftsIn(engine, view);
  const ids = new Set(leads.map((l) => l.id));
  const due = (kinds) => (engine?.upkeep ?? []).filter((u) => kinds.includes(u.kind) && ids.has(u.leadId)).length;
  const drafted = rows.filter((r) => r.segment.state === 'draft').length;
  const listWaits = rows.reduce((t, r) => t + (r.listable ?? 0), 0);
  const staged = drafts.filter((d) => d.state === 'waiting').length;
  const returned = drafts.filter((d) => d.state === 'returned').length;
  const setupOpen = setup ? (setup.steps ?? []).some((s) => !s.done && !s.optional && s.who === 'operator') : false;
  const open = deals.filter((d) => d.stage === 'qualified' || d.stage === 'proposed').length;
  const calls = callRows(engine, view);
  const coming = calls.filter((l) => callComing(l));
  const stage = {
    setup: { head: setup ? (setup.done >= setup.total ? 'DONE' : `${setup.done}/${setup.total}`) : '—', lines: [], you: setupOpen },
    discover: { head: n(sum(rows, (s) => s.discover.gathered)), unit: 'FOUND', lines: [`${n(sum(rows, (s) => s.discover.searches))} SEARCHES`, `${rows.length} AUDIENCE${rows.length === 1 ? '' : 'S'}`], you: drafted > 0, yours: drafted ? `${drafted} TO APPROVE` : null },
    filter: { head: n(sum(rows, (s) => s.filter.kept)), unit: 'SHORTLISTED', lines: [`${n(sum(rows, (s) => s.filter.unsorted))} TO FILTER`, `${n(sum(rows, (s) => s.filter.passed))} PASSED`] },
    validate: { head: n(sum(rows, (s) => s.leads.leads)), unit: 'LEADS', lines: [`${n(sum(rows, (s) => s.verify.unread))} TO READ`, `${n(sum(rows, (s) => s.score.toScore))} TO SCORE`, ...(listWaits ? [`${n(listWaits)} TO VALIDATE`] : []), `${n(sum(rows, (s) => s.leads.toFile))} TO FILE`] },
    ready: (() => { const ready = readyRows(engine, view); const general = ready.filter((l) => isGeneral(l)).length; return { head: n(ready.length), unit: 'READY', lines: [`${n(ready.length - general)} NAMED PEOPLE`, `${n(general)} GENERAL MAILBOXES`, ...(ready.some((l) => l.origin?.countryOpen) ? [`${n(ready.filter((l) => l.origin?.countryOpen).length)} COUNTRY TO FIND`] : [])] }; })(),
    emails: { head: n(staged), unit: 'TO REVIEW', lines: [`${n(sum(rows, (s) => s.outreach.unwritten))} TO WRITE`, ...(returned ? [`${returned} RETURNED`] : [])], you: staged > 0, yours: staged ? 'YOURS TO SEND' : null },
    sent: { head: n(leads.filter((l) => WRITTEN.has(l.status)).length), unit: 'WRITTEN', lines: [`${due(['follow-up', 'next-up'])} TO FOLLOW UP`], ...(leads.some((l) => l.bounced) ? { yours: `${leads.filter((l) => l.bounced).length} BOUNCED` } : {}) },
    replies: { head: n(leads.filter((l) => HEARD.has(l.status)).length), unit: 'REPLIED', lines: [`${due(['answer'])} TO ANSWER`] },
    // A call is the operator's to take: the stage is marked while one is coming, with when the next one is.
    calls: { head: n(coming.length), unit: 'BOOKED', lines: [`${calls.length - coming.length} HELD`, ...(calledOffRows(engine, view).length ? [`${calledOffRows(engine, view).length} CALLED OFF`] : [])], you: coming.length > 0, yours: coming.length ? `NEXT · ${whenWords(coming[0].call.at)}` : null },
    deals: { head: n(open), unit: 'OPEN', lines: [`${deals.filter((d) => d.stage === 'won').length} WON`] },
  };
  return STAGES.map((s) => ({ ...s, ...stage[s.id], you: Boolean(stage[s.id].you) }));
};

/** The campaigns to choose between: ALL, each open one, and the audiences under none when there are any — each marked when something in it waits on the operator. */
export const campaignChoices = (engine) => {
  const campaigns = (engine?.campaigns ?? []).filter((c) => c.state !== 'archived');
  const waits = (view) => pipelineOf({ engine, view }).some((s) => s.you);
  const loose = rowsIn(engine, LOOSE).length;
  return [
    { id: ALL, label: 'ALL', you: waits(ALL) },
    ...campaigns.map((c) => ({ id: c.id, label: c.name, company: c.company, you: waits(c.id) })),
    ...(loose ? [{ id: LOOSE, label: 'NO CAMPAIGN', you: waits(LOOSE) }] : []),
  ];
};

/** The campaign a record belongs to, by name (for the CAMPAIGN column while every campaign is in view). */
export const campaignNameOf = (engine, campaignId) => (engine?.campaigns ?? []).find((c) => c.id === campaignId)?.name ?? 'NO CAMPAIGN';

/** DISCOVER: one row an audience — what it looks for, whether it may, and what its searches found. */
export const discoverRows = (engine, view) => rowsIn(engine, view).map((r) => ({
  id: r.segment.id, segment: r.segment, row: r, campaign: campaignNameOf(engine, r.segment.campaign),
  searches: r.road.steps.discover.searches, found: r.road.steps.discover.gathered,
  named: r.gathered.filter((c) => Number(c.hunterEmails?.personal) > 0).length,
}));

export const FILTER_PICKS = Object.freeze([{ id: 'unsorted', label: 'TO FILTER' }, { id: 'kept', label: 'SHORTLISTED' }, { id: 'passed', label: 'PASSED' }]);

/** FILTER: the companies gathered, by where the filter left them; the most addresses at Hunter first. */
export const filterRows = (engine, view, pick = 'unsorted') => rowsIn(engine, view).flatMap((r) => r.gathered
  .filter((c) => (pick === 'unsorted' ? !c.shortlist && !c.siteRead : c.shortlist === pick))
  .map((c) => ({ ...c, audience: r.segment.name, campaign: campaignNameOf(engine, r.segment.campaign) })))
  .sort((a, b) => (Number(b.hunterEmails?.total) || 0) - (Number(a.hunterEmails?.total) || 0));

// pure — where a company stands in VALIDATE, in one word or two.
const standingOf = (p) => {
  if (p.stage === 'promoted') return 'A LEAD';
  if (p.match < 2) return 'NO FIT';
  return p.people?.length ? 'TO FILE' : 'FIND PEOPLE';
};

/**
 * VALIDATE: every company past the filter — its site checked, then scored, then the right person found, then on the
 * list. A shortlisted company not yet scored stands as its site reading; a scored one as its fit.
 */
export const validateRows = (engine, view) => rowsIn(engine, view).flatMap((r) => {
  const scored = [...r.pool, ...r.leads];
  const domains = new Set(scored.map((p) => p.domain));
  const waiting = r.gathered.filter((c) => !domains.has(c.domain) && (c.shortlist === 'kept' || c.siteRead));
  // What waits on the operator — a company on the list approval — stands FIRST, marked (Design note, 2026-11-18: […]).
  // What waits to be VALIDATED (a lead run does it — nothing here waits on the operator) stands first.
  const waits = (p) => (r.listableIds ? r.listableIds.includes(p.id) : r.segment.state === 'approved' && p.match >= 2 && !p.listApproved);
  return [
    ...scored.map((p) => ({ id: p.id, kind: 'prospect', prospect: p, name: p.name, domain: p.domain, segmentId: r.segment.id, audience: r.segment.name, campaign: campaignNameOf(engine, r.segment.campaign), site: 'ALIVE', fit: MATCH_WORDS[p.match], person: p.people?.[0] ?? null, standing: waits(p) ? 'TO VALIDATE' : standingOf(p), listed: Boolean(p.listApproved), waits: waits(p) })),
    ...waiting.map((c) => ({ id: c.id ?? c.domain, kind: 'candidate', name: c.name, domain: c.domain, segmentId: r.segment.id, audience: r.segment.name, campaign: campaignNameOf(engine, r.segment.campaign),
      site: !c.siteRead ? 'TO READ' : c.siteRead.alive ? 'ALIVE' : 'DEAD', fit: c.siteRead?.alive ? 'TO SCORE' : '—', person: null, standing: !c.siteRead ? 'READ ITS SITE' : c.siteRead.alive ? 'SCORE IT' : 'DEAD END', listed: false, waits: false })),
  ];
}).sort((a, b) => Number(b.waits) - Number(a.waits));

/**
 * VALIDATE's one decision for the operator: each audience whose found companies wait for the list approval. ids: the
 * exact companies the press approves (where the engine names them), count: how many.
 */
export const listApprovals = (engine, view) => rowsIn(engine, view).map((r) => ({ segment: r.segment, ids: r.listableIds ?? null, count: r.listable ?? r.listableIds?.length ?? 0 })).filter((a) => a.count > 0);

// A lead filed at a company's general mailbox (lead-run.js files it as […]).
const isGeneral = (l) => /, general address at /.test(String(l.name ?? ''));
/**
 * VALIDATED: every lead that is confirmed and filed to its campaign and has no email yet — never written to, nothing
 * staged or returned for it, its address not bounced. The newest first; each with what confirmed its address. pure.
 */
export function readyRows(engine, view) {
  const drafted = new Set((engine?.outbox?.drafts ?? []).filter((d) => d.state === 'waiting' || d.state === 'returned').flatMap((d) => d.to ?? []).map((a) => String(a).toLowerCase()));
  return leadsIn(engine, view).filter((l) => l.status === 'cold' && !l.bounced && !drafted.has(String(l.contact).toLowerCase()))
    .map((l) => ({ ...l, general: isGeneral(l), check: engine?.checks?.[String(l.contact).toLowerCase()] ?? null }))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

/** SENT: everyone written to, with what is due on them. REPLIES: everyone who answered. */
// A BOUNCE STANDS FIRST (Design note, 2026-11-19: […]): a lead whose address bounced leads SENT, marked.
// A lead closed because of what its reply said — a no, or a person who has left — is not […]:
// it has its own list under REPLIES, kept as a contact.
const closedBySaid = (l) => l.status === 'lost' && (l.said?.says === 'no' || l.said?.says === 'gone');
export const sentRows = (engine, view) => {
  const due = new Map((engine?.upkeep ?? []).map((u) => [u.leadId, u]));
  return leadsIn(engine, view).filter((l) => WRITTEN.has(l.status) && !HEARD.has(l.status) && !closedBySaid(l)).map((l) => ({ ...l, due: due.get(l.id) ?? null }))
    .sort((a, b) => Number(Boolean(b.bounced)) - Number(Boolean(a.bounced)));
};
// REPLIES in the order they want an answer: whoever asked for something first, then a reply still to be read, then
// a machine's (Design note, 2026-11-20: […]).
const SAID_ORDER = Object.freeze(['wants', 'open', 'auto']);
// A call already booked stands above everything: it has a time on it.
function whenWords(at) { return `${new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
function callComing(l, now = Date.now()) { return Boolean(l.call && Date.parse(l.call.at) > now - 3_600_000); }
const saidRank = (l) => { if (callComing(l)) return -1; const at = SAID_ORDER.indexOf(l.said?.says ?? 'open'); return at < 0 ? SAID_ORDER.length : at; };
/** A lead's booked call as the sheet says it ([…]), or null. pure. */
export const callWords = (l) => (l?.call ? `${Date.parse(l.call.at) > Date.now() ? 'CALL BOOKED' : { me: 'CALL · YOU DID NOT SHOW', them: 'CALL · THEY DID NOT SHOW' }[l.call.show] ?? 'CALL HELD'} · ${whenWords(l.call.at)}` : null);
/** Who showed for a call that has passed, as the sheet says it; a call still to come says nothing. pure. */
export const SHOW_WORDS = Object.freeze({ held: 'HELD', me: 'YOU DID NOT SHOW', them: 'THEY DID NOT SHOW' });
export const callShowWords = (l, now = Date.now()) => (Date.parse(l.call.at) > now ? '—' : SHOW_WORDS[l.call.show] ?? 'NOT MARKED');
/** CALLS: every lead with a call on the operator's calendar — the ones coming first, soonest on top; then the ones held, latest on top. pure. */
export function callRows(engine, view, now = Date.now()) {
  const rows = leadsIn(engine, view).filter((l) => l.call && Number.isFinite(Date.parse(l.call.at)));
  const at = (l) => Date.parse(l.call.at);
  return [...rows.filter((l) => callComing(l, now)).sort((a, b) => at(a) - at(b)), ...rows.filter((l) => !callComing(l, now)).sort((a, b) => at(b) - at(a))];
}
/** Every lead whose call was called off (and no new one booked since), the latest first. pure. */
export function calledOffRows(engine, view) {
  return leadsIn(engine, view).filter((l) => l.callOff).sort((a, b) => String(b.callOff.offAt ?? '').localeCompare(String(a.callOff.offAt ?? '')));
}
/** A time as the sheets say it: […]. pure. */
export const callWhen = (at) => whenWords(at);
/** How long until a call, or since it: "IN 3 H", "IN 2 D", "NOW", "HELD". pure. */
export const callAway = (l, now = Date.now()) => {
  const ms = Date.parse(l.call.at) - now;
  if (ms <= -3_600_000) return 'HELD';
  if (ms <= 0) return 'NOW';
  if (ms < 3_600_000) return `IN ${Math.max(1, Math.round(ms / 60_000))} MIN`;
  return ms < 48 * 3_600_000 ? `IN ${Math.round(ms / 3_600_000)} H` : `IN ${Math.round(ms / 86_400_000)} D`;
};
export const replyRows = (engine, view) => {
  const due = new Map((engine?.upkeep ?? []).map((u) => [u.leadId, u]));
  return leadsIn(engine, view).filter((l) => HEARD.has(l.status) || due.get(l.id)?.kind === 'answer' || (l.said?.says === 'auto' && l.status !== 'lost'))
    .map((l) => ({ ...l, due: due.get(l.id) ?? null }))
    .sort((a, b) => saidRank(a) - saidRank(b));
};
/** Everyone whose reply closed them, by what it said: 'no' (they declined) or 'gone' (they have left). Kept as contacts. */
export const closedRows = (engine, view, says) => leadsIn(engine, view).filter((l) => closedBySaid(l) && l.said.says === says);

const WANT_WORDS = Object.freeze({ deck: 'WANTS THE DECK', call: 'OPEN TO A CALL', more: 'ASKED A QUESTION' });
/** What a lead's reply says, in the sheet's words. pure. */
export const saidLabel = (said) => (!said ? 'READ IT'
  : said.says === 'wants' ? (WANT_WORDS[said.want] ?? 'ASKED FOR SOMETHING')
    : said.says === 'no' ? 'SAID NO'
      : said.says === 'gone' ? 'HAS LEFT'
        : said.says === 'auto' ? 'AUTOMATIC REPLY' : 'READ IT');

// How far along each word is, so a column of them sorts by meaning and not by spelling (Sheet sorts by these):
// the strongest fit first, a live site first, the company nearest the list first.
export const FIT_RANK = Object.freeze({ 'STRONG MATCH': 3, 'WEAK MATCH': 2, 'NO MATCH': 1, 'TO SCORE': 0 });
export const SITE_RANK = Object.freeze({ ALIVE: 2, 'TO READ': 1, DEAD: 0 });
export const STANDING_RANK = Object.freeze({ 'TO VALIDATE': 7, 'A LEAD': 6, 'TO FILE': 5, 'FIND PEOPLE': 4, 'SCORE IT': 3, 'READ ITS SITE': 2, 'NO FIT': 1, 'DEAD END': 0 });
export const STATE_RANK = Object.freeze({ draft: 3, approved: 2, paused: 1, retired: 0 });

// THE MESSAGES (Design note, 2026-11-18: […]). A lead's history (backend sales/lead-thread.js) says
// what went out and came in, and through which channel; an email sent from the outbox is joined to it whole.
const QUOTED = /"([^"]*)"\s*$/;

/**
 * Every message with a lead, oldest first: each the house wrote out (an outbox email with its subject, its words and
 * its promise) and each they wrote in.
 * @returns {Array<{at: string, way: 'out'|'in', channel: ?string, note: ?string, from: ?string, subject: ?string, text: ?string, promise: ?string}>}
 */
export const messagesOf = (engine, lead) => {
  const address = String(lead?.contact ?? '').toLowerCase();
  const sent = (engine?.outbox?.drafts ?? []).filter((d) => d.state === 'sent' && (d.to ?? []).some((a) => String(a).toLowerCase() === address));
  const used = new Set();
  const told = (lead?.thread ?? []).map((m) => {
    const subject = m.way === 'out' && m.channel === 'email' ? QUOTED.exec(String(m.note ?? ''))?.[1] ?? null : null;
    const draft = subject ? sent.find((d) => !used.has(d.id) && String(d.subject).startsWith(subject)) : null;
    if (draft) used.add(draft.id);
    return { ...m, subject: draft?.subject ?? subject ?? m.subject ?? null, text: draft?.text ?? m.text ?? null, promise: draft?.promise ?? null };
  });
  // An outbox email the lead's history does not name (sent before the mailbox marked its own) still stands, whole.
  const untold = sent.filter((d) => !used.has(d.id)).map((d) => ({ at: d.sentAt ?? d.at, way: 'out', channel: 'email', note: null, from: d.from ?? null, by: d.by ?? null, subject: d.subject, text: d.text, promise: d.promise ?? null }));
  return [...told, ...untold].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
};

/** How a lead was written to: the channel of the last message out, else the channel the lead is reached on. */
export const channelOf = (engine, lead) => [...messagesOf(engine, lead)].reverse().find((m) => m.way === 'out')?.channel ?? lead?.channel ?? null;

/**
 * When a staged email's person was already emailed, or null (Design note, 2026-11-18: […]): an email the outbox sent them, or one on their lead's
 * history — unless they wrote last (answering them is no second email). The server refuses to send such an email
 * unless it was staged as a follow-up (sales/email-outbox.js writtenAlready); the screen says so first.
 * @returns {?{at: string, subject: ?string}}
 */
export const emailedBefore = (draft, drafts = [], leads = []) => {
  const to = (draft?.to ?? []).map((a) => String(a).toLowerCase());
  const lead = leads.find((l) => to.includes(String(l.contact ?? '').toLowerCase()));
  const thread = lead?.thread ?? [];
  if (thread.length && thread.at(-1).way === 'in') return null;
  const sent = drafts.filter((d) => d.id !== draft?.id && (d.state === 'sent' || d.state === 'uncertain') && (d.to ?? []).some((a) => to.includes(String(a).toLowerCase())))
    .map((d) => ({ at: d.sentAt ?? d.at, subject: d.subject }));
  const out = thread.filter((m) => m.way === 'out').map((m) => ({ at: m.at, subject: /"([^"]*)"/.exec(String(m.note ?? ''))?.[1] ?? null }));
  return [...sent, ...out].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''))).at(-1) ?? null;
};

// THE KIND OF AN EMAIL (Design note, 2026-11-19: […]).
export const EMAIL_KINDS = Object.freeze({ first: 'FIRST EMAIL', 'follow-up': 'FOLLOW-UP', reply: 'REPLY' });
const low = (v) => String(v ?? '').trim().toLowerCase();
const byAt = (a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''));

/**
 * pure — what a staged email is to its person, from everything that went between them: the FIRST they ever get, a
 * FOLLOW-UP (written to before, and they have not answered since), or a REPLY (they wrote last) — with the last email
 * sent them and the last they wrote.
 * @returns {{kind: 'first'|'follow-up'|'reply', lastOut: ?{at: string, subject: ?string}, lastIn: ?{at: string}}}
 */
export const emailKind = (draft, drafts = [], leads = []) => {
  const to = (draft?.to ?? []).map(low);
  const thread = leads.find((l) => to.includes(low(l.contact)))?.thread ?? [];
  const sent = drafts.filter((d) => d.id !== draft?.id && (d.state === 'sent' || d.state === 'uncertain') && (d.to ?? []).some((a) => to.includes(low(a))))
    .map((d) => ({ at: d.sentAt ?? d.at, subject: d.subject }));
  const out = thread.filter((m) => m.way === 'out').map((m) => ({ at: m.at, subject: /"([^"]*)"/.exec(String(m.note ?? ''))?.[1] ?? null }));
  const lastOut = [...sent, ...out].sort(byAt).at(-1) ?? null;
  const lastIn = thread.filter((m) => m.way === 'in').sort(byAt).at(-1) ?? null;
  const kind = lastIn && (!lastOut || String(lastIn.at) > String(lastOut.at)) ? 'reply' : lastOut ? 'follow-up' : 'first';
  return { kind, lastOut, lastIn };
};

// A reply a machine wrote — an out-of-office, a […] — said as one, so it is not mistaken for theirs.
const AUTO = /^(auto(matic)?[\s-]*(reply|response|antwort)|out of (the )?office|abwesenheit|thank(s| you) for (your|contacting|reaching)|we('ve| have) received your|your (message|email) (has been|was) received)/i;
/** pure — is this message an automatic reply. */
export const isAutoReply = (m) => AUTO.test(String(m?.subject ?? '').replace(/^(re|aw|fwd?):\s*/i, '')) || AUTO.test(String(m?.text ?? '').trim());

/**
 * pure — where the house's answer to someone who wrote stands: SENT after their last message, STAGED (waiting in
 * EMAILS for the operator), or OWED.
 */
export const answerOf = (engine, lead) => {
  const messages = messagesOf(engine, lead);
  const lastIn = [...messages].reverse().find((m) => m.way === 'in') ?? null;
  const after = lastIn ? messages.filter((m) => m.way === 'out' && String(m.at) > String(lastIn.at)) : [];
  if (after.length) return { state: 'sent', at: after.at(-1).at };
  const staged = (engine?.outbox?.drafts ?? []).find((d) => d.state === 'waiting' && (d.to ?? []).some((a) => low(a) === low(lead?.contact)));
  return staged ? { state: 'staged', subject: staged.subject } : { state: 'owed' };
};

/** The stage a door or a WAITING row names, kept when it is one of this hub's own. */
export const isPipelineTab = (tab) => STAGES.some((s) => s.id === tab) || MORE.some((m) => m.id === tab);
