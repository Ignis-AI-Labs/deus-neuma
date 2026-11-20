// lead-import — people the house reached through another tool, brought onto its own lead list (Design note, 2026-11-18, on
// Explee: […]). A file comes in — the house's own import format
// (every message whole, as converted from a tool's API) or any CSV with an email column (Explee's own Export CSV
// reads as one) — and each person becomes ONE lead: who they are, where they stand (an interested reply waits for an
// answer, a no closes the thread, a bounce or an unsubscribe goes on the do-not-contact list), and every message
// that passed, in order, on the lead's own history. What the other tool did in the house's name is said plainly on
// the lead: the invented name it signed as, a product it claimed that the house does not run. Pure.
//
// The import format (JSON):
//   { kind: 'lead-import', source: 'explee', people: [{ name, email, title?, company?, domain?, country?, linkedin?,
//     campaign?, project?, kind?: 'buyer'|'investor'|…, outcome?: 'interested'|'not_interested'|'auto_reply'|
//     'bounced'|'unsubscribed'|'none', flags?: ['told-yield-product', 'invented-sender'],
//     messages?: [{ at, way: 'out'|'in', from?, signedAs?, subject?, text }] }] }

import { normalizeEmail } from '../sales/suppress-shape.js';
import { LEAD_KINDS } from './lead-ledger.js';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const FLAG_WORDS = Object.freeze({
  'told-yield-product': 'WAS TOLD OF A YIELD OR MANAGED-LIQUIDITY PRODUCT THE HOUSE DOES NOT RUN — owes a correction',
  'invented-sender': 'was written to under a name that is not a real person',
});

/** pure — a CSV's rows as objects keyed by lower-cased header (quoted fields, commas and line breaks inside quotes). */
export const parseCsv = (text) => {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  const [head = [], ...body] = rows;
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
};

const yes = (v) => /^(true|yes|1|y)$/i.test(String(v ?? '').trim());
const pick = (row, ...keys) => keys.map((k) => row[k]).find((v) => v !== undefined && String(v).trim() !== '') ?? '';

// pure — one CSV row as a person (Explee's Export CSV, or any sheet with an email column).
const personOfRow = (row) => {
  const status = String(pick(row, 'status', 'lead_status')).toLowerCase();
  const outcome = yes(row.bounced) ? 'bounced' : yes(row.unsubscribed) ? 'unsubscribed' : status === 'hot' || status === 'interested' ? 'interested'
    : /not.?interested/.test(status) ? 'not_interested' : yes(row.replied) ? 'replied' : 'none';
  const sent = Number(pick(row, 'emails_sent')) || 0;
  return {
    name: pick(row, 'name', 'full_name') || [pick(row, 'first_name'), pick(row, 'last_name')].filter(Boolean).join(' '),
    email: pick(row, 'email', 'e_mail', 'email_address'),
    title: pick(row, 'job_title', 'title', 'role', 'position'),
    company: pick(row, 'company_name', 'company', 'organization'),
    domain: pick(row, 'company_domain', 'domain', 'website'),
    country: pick(row, 'country'), linkedin: pick(row, 'linkedin_url', 'linkedin'),
    campaign: pick(row, 'campaign', 'campaign_name'),
    outcome,
    messages: [
      ...(sent && pick(row, 'first_sent_at') ? [{ at: pick(row, 'first_sent_at'), way: 'out', text: `${sent} email${sent === 1 ? '' : 's'} sent (the export does not carry their words)` }] : []),
      ...(pick(row, 'last_reply') ? [{ at: pick(row, 'last_reply_at') || pick(row, 'last_sent_at'), way: 'in', text: pick(row, 'last_reply') }] : []),
    ],
  };
};

/**
 * pure — a file's people: the house's import format, or a CSV.
 * @returns {{ok: true, source: string, people: object[]} | {ok: false, reason: string}}
 */
export const parseLeadFile = (text) => {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, reason: 'the file is empty' };
  if (t.startsWith('{')) {
    let data;
    try { data = JSON.parse(t); } catch { return { ok: false, reason: 'the file is not readable JSON' }; }
    if (data?.kind !== 'lead-import' || !Array.isArray(data.people)) return { ok: false, reason: 'a JSON file must be a lead import ({kind: "lead-import", people: [...]})' };
    return { ok: true, source: clean(data.source, 40) || 'import', people: data.people };
  }
  const rows = parseCsv(t);
  if (!rows.length) return { ok: false, reason: 'the CSV has no rows under its header' };
  if (!rows.some((r) => normalizeEmail(pick(r, 'email', 'e_mail', 'email_address')))) return { ok: false, reason: 'the CSV needs an email column' };
  return { ok: true, source: 'csv', people: rows.map(personOfRow) };
};

const STATUS_OF = Object.freeze({ interested: 'replied', replied: 'replied', not_interested: 'lost', bounced: 'lost', unsubscribed: 'lost' });
const SUPPRESS_OF = Object.freeze({ bounced: 'bounced', unsubscribed: 'unsubscribed' });
// Which outcome speaks for a person reached twice: a bounce or an unsubscribe above all, then an answer, then silence.
const OUTCOME_WEIGHT = Object.freeze({ bounced: 7, unsubscribed: 6, interested: 5, replied: 4, not_interested: 3, auto_reply: 2, none: 1 });

// pure — one message as a touch on the lead's history: what went out says it was emailed, by which tool, as whom.
const touchOf = (m, source) => {
  const at = Number.isNaN(Date.parse(m?.at)) ? null : new Date(Date.parse(m.at)).toISOString();
  const text = String(m?.text ?? '').trim();
  if (!at || !['out', 'in'].includes(m?.way) || !text) return null;
  const note = m.way === 'out'
    ? `emailed by ${source}${m.signedAs ? ` as "${clean(m.signedAs, 80)}"` : ''}${m.from ? ` <${clean(m.from, 120)}>` : ''}${m.subject ? `: "${clean(m.subject, 160)}"` : ''}\n\n${text}`
    : text;
  return { at, direction: m.way, note, ...(m.way === 'out' && m.from ? { from: clean(m.from, 120).toLowerCase() } : {}) };
};

/**
 * pure — what an import would do: each person a lead to add (with its history), an entry for the do-not-contact list,
 * or a skip with why. Nobody already on the lead list or the do-not-contact list is added again.
 * @param {object[]} people - parseLeadFile's people
 * @param {{source: string, onLedger: Set<string>, suppressed: (email: string) => boolean, by: string}} house
 */
export const planImport = (people, { source, onLedger, suppressed, by }) => {
  const add = []; const suppress = []; const skip = [];
  const seen = new Set();
  for (const [n, p] of people.entries()) {
    const raw = String(p?.email ?? '').trim();
    const hidden = raw.includes('*'); // a tool that masks an address it has not been answered from (g****@x.io)
    const email = hidden ? null : normalizeEmail(raw);
    const who = clean(p?.name, 120) || raw;
    if (!email) { skip.push({ n, who, why: hidden ? 'the tool hid the address (it shows it only once someone replies)' : 'no email address' }); continue; }
    const outcome = String(p?.outcome ?? 'none');
    const history = (Array.isArray(p?.messages) ? p.messages : []).map((m) => touchOf(m, source)).filter(Boolean);
    const flags = (Array.isArray(p?.flags) ? p.flags : []).filter((f) => FLAG_WORDS[f]);
    // The same person reached by two campaigns is ONE lead: both campaigns' messages, the stronger outcome.
    if (seen.has(email)) {
      const lead = add.find((a) => a.contact === email);
      if (lead) {
        lead.history = [...lead.history, ...history].sort((a, b) => a.at.localeCompare(b.at));
        lead.flags = [...new Set([...lead.flags, ...flags])];
        if ((OUTCOME_WEIGHT[outcome] ?? 0) > (OUTCOME_WEIGHT[lead.outcome] ?? 0)) lead.outcome = outcome;
        if (p?.campaign && !lead.source.includes(clean(p.campaign, 120))) lead.source += ` + ${clean(p.campaign, 120)}`;
      }
      continue;
    }
    seen.add(email);
    if (onLedger.has(email)) { skip.push({ n, who, email, why: 'already on the lead list' }); continue; }
    if (suppressed(email)) { skip.push({ n, who, email, why: 'on the do-not-contact list' }); continue; }
    history.sort((a, b) => a.at.localeCompare(b.at));
    const wrote = history.some((t) => t.direction === 'out');
    const name = [clean(p?.name, 120) || email, clean(p?.title, 120) ? `, ${clean(p.title, 120)}` : '', clean(p?.company, 120) ? ` at ${clean(p.company, 120)}` : ''].join('');
    add.push({
      name, contact: email, channelId: 'email', kind: LEAD_KINDS.includes(p?.kind) ? p.kind : 'buyer',
      status: wrote ? 'contacted' : 'cold', addedBy: by,
      source: `imported from ${source}${p?.project ? ` · ${clean(p.project, 60)}` : ''}${p?.campaign ? ` · ${clean(p.campaign, 120)}` : ''}`,
      note: '', history, outcome, flags,
    });
  }
  // Once every person is folded in: where each stands, what its line says, and who never hears from the house again.
  for (const lead of add) {
    lead.status = STATUS_OF[lead.outcome] ?? lead.status;
    lead.note = [`imported from ${source}${lead.source.includes(' · ') ? ` (${lead.source.split(' · ').slice(2).join(' · ')})` : ''}${lead.outcome !== 'none' ? `: ${lead.outcome.replace('_', ' ')}` : ''}`, ...lead.flags.map((f) => FLAG_WORDS[f])].join(' — ');
    if (SUPPRESS_OF[lead.outcome]) suppress.push({ target: lead.contact, reason: SUPPRESS_OF[lead.outcome], note: `${lead.outcome} on ${source}` });
  }
  const count = (k) => add.filter((a) => a.outcome === k).length;
  return { add, suppress, skip, counts: { people: people.length, add: add.length, interested: count('interested'), notInterested: count('not_interested'), suppress: suppress.length, flagged: add.filter((a) => a.flags.length).length, skip: skip.length } };
};
