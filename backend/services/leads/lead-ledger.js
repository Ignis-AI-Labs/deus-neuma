// Lead ledger — the return current of the outreach machine: every prospect
// the house is working, from first sighting to won or lost, in one tracked
// list a team can divide and walk.
//
// The ledger records what IS — it does not police a funnel. Any status can
// follow any status (a replied lead goes cold; a lost lead comes back), but
// EVERY change appends a touch to the lead's append-only history — status
// moves AND ownership handoffs — so the record of how a relationship actually
// moved can never be quietly rewritten. Removal is a deliberate hard delete:
// the honest end of a funnel is the `lost` status; remove exists for mistakes
// and duplicates, because this is the operator's machine and the operator's
// data — sovereignty includes the right to erase.
//
// ONE LEDGER PER HOUSE (Design note, 2026-10-16: each house's leads live in its own
// office, `<realm>/<wallet>/offices/marketing/lead-ledger.json`
// (house-office.js); the machine-wide ledger (data/settings/lead-ledger.json)
// moves once to its house. Governance record, not a secret: plain JSON, same
// 0600/0700 posture as the campaign queue. Factory shape so tests run the
// real disk path against tmp files.

import fs from 'fs/promises';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { getChannel } from '../social/channel-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { legacyCmoPath } from '../marketing/cmo-designation.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'lead-ledger.json');

// The pre-2026-10-16 machine ledger, read per call so tests never touch the
// operator's live one.
const legacyLeadLedgerPath = () =>
  process.env.NEUMA_LEAD_LEDGER_PATH || DEFAULT_LEGACY_PATH;

export const LEAD_STATUSES = Object.freeze(['cold', 'contacted', 'replied', 'qualified', 'won', 'lost']);

// Where a lead can come from: any social channel the house speaks through,
// the email lane, or anywhere else the field produced one.
const KNOWN_LANES = Object.freeze(['email', 'other']);
const FIELD_MAX = 500;
const NOTE_MAX = 2000;

/**
 * Validate the shape of a new or updated lead (pure). Returns an error string
 * or null — the ledger never persists a malformed entry.
 * @param {{name?: string, contact?: string, channelId?: string,
 *   source?: string, status?: string, campaignId?: string}} lead
 */
export const validateLead = ({ name, contact, channelId, source, status, campaignId } = {}) => {
  const n = typeof name === 'string' ? name.trim() : '';
  const c = typeof contact === 'string' ? contact.trim() : '';
  if (!n && !c) return 'a lead needs a name or a way to reach them';
  for (const [label, v] of [['name', n], ['contact', c], ['source', source]]) {
    if (typeof v === 'string' && v.length > FIELD_MAX) return `${label} is too long`;
  }
  if (campaignId != null) {
    if (typeof campaignId !== 'string') return 'campaignId must be a string';
    if (campaignId.length > 100) return 'campaignId is too long';
  }
  if (channelId != null && !KNOWN_LANES.includes(channelId) && !getChannel(channelId)) {
    return `Unknown lane: ${channelId}`;
  }
  if (status != null && !LEAD_STATUSES.includes(status)) {
    return `Unknown status: ${status}`;
  }
  return null;
};

/**
 * Group a ledger by status for a board view (pure) — every status keyed,
 * empty arrays included, so a board renders honest zeros.
 * @param {Array<{status: string}>} leads
 */
export const leadsByStatus = (leads) => {
  const board = Object.fromEntries(LEAD_STATUSES.map((s) => [s, []]));
  for (const lead of leads) (board[lead.status] || (board[lead.status] = [])).push(lead);
  return board;
};

/**
 * Render the ledger for a being's context window (pure): one line per lead,
 * capped so a large ledger never floods a turn.
 * @param {Array<object>} leads
 */
export const formatLeadsForBeing = (leads, { max = 60 } = {}) => {
  if (!leads.length) return 'The lead ledger is empty — no prospects are being worked yet.';
  const lines = leads.slice(0, max).map((l) => {
    const last = [...(l.touches || [])].reverse().find((t) => t.note);
    return [
      `[${l.id.slice(0, 8)}] ${l.name || l.contact}`,
      l.name && l.contact ? `(${l.contact})` : null,
      `— ${l.status}`,
      l.channelId && l.channelId !== 'other' ? `via ${l.channelId}` : null,
      l.ownerNeumaId ? `held by ${l.ownerNeumaId}` : '· unheld',
      last ? `· last: ${last.note.slice(0, 80)}` : null,
    ].filter(Boolean).join(' ');
  });
  const dropped = leads.length - lines.length;
  return [
    `${leads.length} lead(s) on the house ledger:`,
    ...lines,
    ...(dropped > 0 ? [`…and ${dropped} more — the operator's board carries the full ledger.`] : []),
  ].join('\n');
};

/**
 * @param {{ path: string|(() => string) }} opts
 */
export const createLeadLedger = ({ path }) => {
  const target = () => (typeof path === 'function' ? path() : path);

  // Serialize mutations — two concurrent touches must never clobber each
  // other's read+write.
  const serialize = createWriteChain();

  // impure — missing file = empty ledger; a corrupt file surfaces, never
  // collapses to [] (that would silently drop the house's working leads).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('lead-ledger: store is not an array');
    return parsed;
  };

  // impure — atomic tmp+rename write with the 0600/0700 re-tighten.
  const save = async (leads) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(leads, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

  return {
    load,

    /**
     * Capture one lead. impure.
     * @param {{name?: string, contact?: string, channelId?: string,
     *   source?: string, note?: string, status?: string,
     *   campaignId?: string,
     *   ownerNeumaId?: string|null, addedBy: string}} lead
     */
    add(lead) {
      const invalid = validateLead(lead);
      if (invalid) return Promise.reject(new Error(invalid));
      return serialize(async () => {
        const leads = await load();
        const now = new Date().toISOString();
        const entry = {
          id: crypto.randomBytes(8).toString('hex'),
          name: trimmed(lead.name),
          contact: trimmed(lead.contact),
          channelId: lead.channelId || 'other',
          source: trimmed(lead.source),
          status: lead.status || 'cold',
          campaignId: trimmed(lead.campaignId) || null,
          ownerNeumaId: lead.ownerNeumaId || null,
          createdAt: now,
          updatedAt: now,
          touches: [{
            at: now,
            by: String(lead.addedBy || ''),
            status: lead.status || 'cold',
            ...(lead.ownerNeumaId ? { ownerTo: lead.ownerNeumaId } : {}),
            ...(trimmed(lead.note) ? { note: trimmed(lead.note).slice(0, NOTE_MAX) } : {}),
          }],
        };
        leads.push(entry);
        await save(leads);
        return entry;
      });
    },

    /**
     * Touch one lead: any combination of field edits, a status move, and a
     * note — recorded as ONE appended touch. impure.
     * @param {string} id
     * @param {{name?: string, contact?: string, channelId?: string,
     *   source?: string, status?: string, note?: string,
     *   ownerNeumaId?: string|null, by: string}} change
     */
    touch(id, change = {}) {
      return serialize(async () => {
        const leads = await load();
        const lead = leads.find((l) => l.id === id);
        if (!lead) return { ok: false, error: 'no such lead' };
        const merged = {
          name: change.name !== undefined ? change.name : lead.name,
          contact: change.contact !== undefined ? change.contact : lead.contact,
          channelId: change.channelId !== undefined ? change.channelId : lead.channelId,
          source: change.source !== undefined ? change.source : lead.source,
          status: change.status !== undefined ? change.status : lead.status,
        };
        const invalid = validateLead(merged);
        if (invalid) return { ok: false, error: invalid };
        const now = new Date().toISOString();
        Object.assign(lead, {
          name: trimmed(merged.name),
          contact: trimmed(merged.contact),
          channelId: merged.channelId || 'other',
          source: trimmed(merged.source),
          status: merged.status,
          updatedAt: now,
        });
        // An ownership handoff is relationship movement — who works the lead
        // is part of its history, never silently rewritten.
        const ownerBefore = lead.ownerNeumaId ?? null;
        const ownerAfter = change.ownerNeumaId !== undefined ? (change.ownerNeumaId || null) : ownerBefore;
        lead.ownerNeumaId = ownerAfter;
        lead.touches.push({
          at: now,
          by: String(change.by || ''),
          ...(change.status !== undefined ? { status: merged.status } : {}),
          ...(ownerAfter !== ownerBefore ? { ownerFrom: ownerBefore, ownerTo: ownerAfter } : {}),
          ...(trimmed(change.note) ? { note: trimmed(change.note).slice(0, NOTE_MAX) } : {}),
        });
        await save(leads);
        return { ok: true, lead };
      });
    },

    /** Drop one lead from the ledger entirely. impure. */
    remove(id) {
      return serialize(async () => {
        const leads = await load();
        if (!leads.some((l) => l.id === id)) return false;
        await save(leads.filter((l) => l.id !== id));
        return true;
      });
    },
  };
};

// A house's own ledger — the routes, the being tools, the CMO briefing and
// the Optio's fold all open it for the house in question. impure.
export const leadLedgerFor = createHouseStore({
  office: 'marketing',
  name: 'lead-ledger.json',
  legacyPath: legacyLeadLedgerPath,
  legacySeatPath: legacyCmoPath,
  create: createLeadLedger,
});
