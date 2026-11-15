// THE POSITION MAP — everything a house position handles, named once (Founder,
// 2026-11-14: […]). The POSITIONS window draws each position's hub from this map and
// the seat's holder reads the same map at the top of its turn, so the operator
// and the being can never be told two different things
// (docs/design/interface/position-hubs-plan.md).
//
// A position: office (the seat's short name, house-<office>.json) · plain (the
// function in a word) · title (the house title) · covers (one sentence) ·
// functions[] · connections[] (electron/connections.json ids it needs) ·
// waiting[] (the WAITING ON YOU kinds that are its own).
// A function: id · label · what (one sentence) · acts[] (intent types the
// holder files) · tools[] (portal tools named for it).
// PURE data and lookups.

const fn = (id, label, what, acts = [], tools = []) => Object.freeze({ id, label, what, acts: Object.freeze(acts), tools: Object.freeze(tools) });
const position = (p) => Object.freeze({ connections: Object.freeze([]), waiting: Object.freeze([]), ...p, functions: Object.freeze(p.functions) });

export const POSITIONS = Object.freeze([
  position({
    office: 'cos', plain: 'MANAGEMENT', title: 'Optio',
    covers: 'Runs the house day to day: hands each seat its work and tracks it to done.',
    functions: [
      fn('staff', 'THE BOARD', 'Every task handed out, who holds it and where it stands.', ['staff/dispatch', 'staff/dispatch-update', 'staff/ack', 'board/add', 'board/update']),
      fn('clock', 'HOUSE CLOCK', 'The house waking itself for its own work, under the charter.', ['house/charter']),
    ],
    waiting: ['house-ask', 'charter', 'plan'],
  }),
  position({
    office: 'cro', plain: 'SALES', title: 'Mercator',
    covers: 'Brings money in: finds the buyers, writes to them, and carries each deal to delivery.',
    functions: [
      fn('campaigns', 'CAMPAIGNS', 'Each push with its goal, the audiences that serve it, what it has brought in by channel, and the campaigns it works with.', ['sales/campaign', 'campaigns/link']),
      fn('leads', 'LEADS', 'Audiences, the companies found for each, the approved facts and the do-not-contact list.', ['sales/segment', 'sales/gather', 'sales/contacts', 'sales/prospect', 'sales/drop', 'sales/lead', 'sales/facts', 'sales/suppress']),
      fn('deals', 'DEALS', 'The pipeline, each open deal with its next step, and what was delivered.', ['revenue/deal', 'revenue/move', 'delivery/publish']),
      fn('mailbox', 'MAILBOX', 'The house email account: who holds it, what was sent and what came back, kept in order under labels.', ['email/send'], ['check_email_inbox', 'read_email', 'list_email_labels', 'label_email']),
    ],
    connections: ['mail-watch', 'lead-sources'],
  }),
  position({
    office: 'cmo', plain: 'MARKETING', title: 'CMO',
    covers: 'Makes the house known: campaigns, accounts, the brand and which leads are real.',
    functions: [
      fn('campaigns', 'CAMPAIGNS', 'Each marketing campaign, and the campaigns of other positions it works with.'),
      fn('marketing', 'MARKETING', 'Campaigns, the post queue, accounts, the brand and the leads.', ['campaigns/create', 'campaigns/update', 'campaigns/ask', 'marketing/plan', 'marketing/account-handle', 'marketing/account-holder', 'marketing/account-company', 'marketing/company-links', 'marketing/board-arrange', 'social/queue', 'social/post'], ['queue_list', 'queue_get']),
      fn('gallery', 'GALLERY', 'Every image and video the house has made.', ['image/generate']),
    ],
    waiting: ['post', 'reply', 'campaign-ask', 'mandate', 'link-change'],
  }),
  position({
    office: 'clo', plain: 'LAW', title: 'CLO',
    covers: 'Watches the law that touches the house; it flags and cites, a lawyer decides.',
    functions: [fn('legal', 'LEGAL', 'The legal posture, every matter, the watch and the second reader.', ['legal/scan', 'legal/assess', 'legal/file'])],
  }),
  position({
    office: 'cso', plain: 'SECURITY', title: 'CSO',
    covers: 'Guards the digital walls: what could be stolen, faked or broken, and who holds which key.',
    functions: [fn('security', 'SECURITY', 'The watch, every finding and the circuit breaker.', ['security/scan', 'security/assess', 'security/escalate', 'security/circuit-breaker', 'security/file-fix'])],
    waiting: ['security'],
  }),
  position({
    office: 'cfo', plain: 'TREASURY', title: 'Quaestor',
    covers: 'Plans and approves the spending of money, compute and time.',
    functions: [
      fn('treasury', 'TREASURY', 'Spend requests, flags and invoices.', ['treasury/review', 'treasury/flag', 'treasury/invoice', 'treasury/invoice-paid']),
      fn('wallet', 'WALLET', 'What the house holds and every movement of it.'),
    ],
    waiting: ['spend', 'treasury-flag'],
  }),
  position({
    office: 'cao', plain: 'BOOKS', title: 'Logista',
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
      `${p.plain} (${p.title}): ${p.covers}`,
      ...p.functions.map((f) => `- ${f.label}: ${f.what}${f.acts.length ? ` Acts: ${f.acts.join(', ')}.` : ''}${f.tools.length ? ` Tools: ${f.tools.join(', ')}.` : ''}`),
    ]),
    'Your operator opens this same position in the POSITIONS window and sees what you see. Work for your position belongs in these functions; your office briefing below is their state right now.',
  ].join('\n');
};
