// THE POSITION MAP — everything a house position handles, named once (Founder,
// 2026-11-14: […]). The POSITIONS window draws each position's hub from this map and
// the seat's holder reads the same map at the top of its turn, so the operator
// and the being can never be told two different things
// (docs/design/interface/position-hubs-plan.md).
//
// A position: office (the seat's short name, house-<office>.json) · seat (the corporate seat,
// CHIEF OF STAFF) · acronym (COS) · title (the house title, Optio) — all three from the one
// canonical legend (founding-titles-legend.js), so every surface names a seat the same way
// (Design note, 2026-11-16: […]) · plain (the FUNCTION in a word, MANAGEMENT — a label, never the seat's name) ·
// covers (one sentence) ·
// functions[] · connections[] (electron/connections.json ids it needs) ·
// waiting[] (the WAITING ON YOU kinds that are its own).
// A function: id · label · what (one sentence) · acts[] (intent types the
// holder files) · tools[] (portal tools named for it).
// PURE data and lookups.

import { TITLE_LEGEND } from '../founding-titles-legend.js';

const fn = (id, label, what, acts = [], tools = []) => Object.freeze({ id, label, what, acts: Object.freeze(acts), tools: Object.freeze(tools) });
const legendOf = (office) => TITLE_LEGEND.find((t) => t.position === office.toUpperCase());
const position = (p) => Object.freeze({
  connections: Object.freeze([]), waiting: Object.freeze([]), ...p,
  seat: legendOf(p.office).seat, acronym: legendOf(p.office).position, title: legendOf(p.office).title,
  functions: Object.freeze(p.functions),
});

export const POSITIONS = Object.freeze([
  position({
    office: 'cos', plain: 'MANAGEMENT',
    covers: 'Runs the house day to day: hands each seat its work and tracks it to done.',
    functions: [
      fn('model', 'COMPANY', 'What is true of each company, in one place: its business model (what it sells, who pays, what it costs, what objectively changes for the buyer) and the facts a buyer may be told. Everything said for a company starts here.', ['company/model']),
      fn('staff', 'THE BOARD', 'Every task handed out, who holds it and where it stands.', ['staff/dispatch', 'staff/dispatch-update', 'staff/ack', 'board/add', 'board/update']),
      // house/charter: a member sets the charter itself; house/wake: a member sets what wakes it (house-clock/wake-rules.js)
      fn('clock', 'HOUSE CLOCK', 'The house waking itself for its own work, under the charter.', ['house/charter', 'house/wake']),
    ],
    waiting: ['house-ask', 'charter', 'plan'],
  }),
  position({
    office: 'cro', plain: 'SALES',
    covers: 'Brings money in: finds the buyers, writes to them, and carries each deal to delivery.',
    functions: [
      fn('model', 'COMPANY', 'What is true of each company, in one place: its business model (what it sells, who pays, what it costs, what objectively changes for the buyer) and the facts a buyer may be told. Everything said for a company starts here.', ['company/model']),
      fn('campaigns', 'CAMPAIGNS', 'One flow per push: its goal and numbers, then each audience that serves it (the offer, who it reaches and where) with the companies found for it and the leads it produced, then the campaigns of other positions it works with.', ['sales/campaign', 'campaigns/link', 'sales/segment']),
      fn('leads', 'LEADS', 'What belongs to no one campaign: what is due on the lead list, the do-not-contact list, and when paid lead data may be spent.', ['sales/discover', 'sales/gather', 'sales/candidates', 'sales/read-sites', 'sales/find-address', 'sales/draft-email', 'sales/contacts', 'sales/prospect', 'sales/drop', 'sales/lead', 'sales/facts', 'sales/suppress', 'sales/mail-scan', 'sales/inbound', 'sales/kind']),
      fn('deals', 'DEALS', 'The pipeline, each open deal with its next step, and what was delivered.', ['revenue/deal', 'revenue/move', 'delivery/publish']),
      fn('mailbox', 'MAILBOX', 'The house email account: who holds it, what was sent and what came back, kept in order under labels.', ['email/send'], ['check_email_inbox', 'read_email', 'list_email_labels', 'label_email']),
    ],
    connections: ['mail-watch', 'lead-sources'],
    waiting: ['sales-facts', 'sales-audience', 'sales-list', 'business-model'],
  }),
  position({
    office: 'cmo', plain: 'MARKETING',
    covers: 'Makes the house known: campaigns, accounts, the brand and which leads are real.',
    functions: [
      fn('model', 'COMPANY', 'What is true of each company, in one place: its business model (what it sells, who pays, what it costs, what objectively changes for the buyer) and the facts a buyer may be told. Everything said for a company starts here.', ['company/model']),
      fn('campaigns', 'CAMPAIGNS', 'Each marketing campaign once: what it is, the campaigns of other positions it works with, and the press onto its own page.'),
      fn('marketing', 'MARKETING', 'The post queue, accounts, the brand and the board; a campaign is opened from CAMPAIGNS.', ['campaigns/create', 'campaigns/update', 'campaigns/ask', 'marketing/plan', 'marketing/account-handle', 'marketing/account-holder', 'marketing/account-company', 'marketing/company-links', 'marketing/board-arrange', 'marketing/card', 'social/queue', 'social/post'], ['queue_list', 'queue_get']),
      fn('gallery', 'GALLERY', 'Every image and video the house has made.', ['image/generate']),
    ],
    waiting: ['post', 'reply', 'campaign-ask', 'mandate', 'link-change'],
  }),
  position({
    office: 'clo', plain: 'LAW',
    covers: 'Watches the law that touches the house; it flags and cites, a lawyer decides.',
    functions: [fn('legal', 'LEGAL', 'The legal posture, every matter, the watch and the second reader.', ['legal/scan', 'legal/assess', 'legal/file', 'registry/lookup'])],
  }),
  position({
    office: 'cso', plain: 'SECURITY',
    covers: 'Guards the digital walls: what could be stolen, faked or broken, and who holds which key.',
    functions: [fn('security', 'SECURITY', 'The watch, every finding and the circuit breaker.', ['security/scan', 'security/assess', 'security/escalate', 'security/circuit-breaker', 'security/file-fix'])],
    waiting: ['security'],
  }),
  position({
    office: 'cfo', plain: 'TREASURY',
    covers: 'Plans and approves the spending of money, compute and time.',
    functions: [
      fn('treasury', 'TREASURY', 'Spend requests, flags and invoices.', ['treasury/review', 'treasury/flag', 'treasury/invoice', 'treasury/invoice-paid']),
      fn('wallet', 'WALLET', 'What the house holds and every movement of it.'),
    ],
    waiting: ['spend', 'treasury-flag'],
  }),
  position({
    office: 'cao', plain: 'BOOKS',
    covers: 'Keeps the books: every dollar recorded, matched to its receipt, and every deadline.',
    functions: [fn('books', 'THE BOOKS', 'The ledger, what is unmatched and what is due.', ['accounts/book', 'accounts/void', 'accounts/deadline', 'accounts/deadline-met'])],
  }),
]);

/** The position of an office, or null. Pure. */
export const positionOf = (office) => POSITIONS.find((p) => p.office === office) ?? null;

/**
 * Which position a WAITING ON YOU item belongs to: its kind's position first,
 * else the position its asker holds, else null (the house's own). Pure.
 * @param {{kind?: string, who?: ?{laneId?: string}}} item
 * @param {Record<string, ?string>} holders - office → laneId
 * @returns {?string} office
 */
export const officeOfWaiting = (item, holders) => {
  const byKind = POSITIONS.find((p) => p.waiting.includes(item?.kind));
  if (byKind) return byKind.office;
  const asker = item?.who?.laneId;
  return (asker && POSITIONS.find((p) => holders[p.office] === asker)?.office) || null;
};

/**
 * The seat holder's own map: what its position handles and the acts that do
 * it. '' for a lane that holds no position. Pure.
 * @param {string[]} offices - the offices this lane holds
 */
export const positionMapText = (offices) => {
  const held = POSITIONS.filter((p) => offices.includes(p.office));
  if (!held.length) return '';
  return [
    '## YOUR POSITION — everything it handles, in one place',
    ...held.flatMap((p) => [
      `${p.seat} — ${p.acronym}, the ${p.title}; its work is ${p.plain.toLowerCase()}: ${p.covers}`,
      ...p.functions.map((f) => `- ${f.label}: ${f.what}${f.acts.length ? ` Acts: ${f.acts.join(', ')}.` : ''}${f.tools.length ? ` Tools: ${f.tools.join(', ')}.` : ''}`),
    ]),
    'Your operator opens this same position in the POSITIONS window and sees what you see. Work for your position belongs in these functions; your office briefing below is their state right now.',
    // What a member names, the chat makes a door (frontend doors/record-door.js).
    `When you need your operator to do something, name the exact place as "POSITIONS → ${held[0].seat} → <the tab>", and name a record by its id (an audience s-…, a facts sheet fs-…, a campaign k-…). In their chat each becomes one press that opens it. Ask for one action at a time.`,
  ].join('\n');
};
