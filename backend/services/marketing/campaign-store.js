// Campaign store — the marketing bench's book of declared campaigns: the
// organization layer over the post queue and the lead ledger, so outward
// speech and captured prospects can be gathered under one named push.
//
// A campaign is a DECLARATION, not an engine — it records what the house is
// pushing (brand, pillars, cadence, the plans) and its status; it never
// polices the queue or the ledger. Removal is a deliberate hard delete, same
// doctrine as the lead ledger: this is the operator's machine and the
// operator's data — sovereignty includes the right to erase.
//
// ONE BENCH PER HOUSE (Design note, 2026-10-16: […]): each house's campaigns
// live in its own office, `<realm>/<wallet>/offices/marketing/
// marketing-campaigns.json` (house-office.js); the machine-wide bench
// (data/settings/marketing-campaigns.json) moves once to its house.
// Governance record, not a secret: plain JSON, same 0600/0700 posture as the
// campaign queue. Factory shape so tests run the real disk path against tmp
// files.

import fs from 'fs/promises';
import crypto from 'crypto';
// `resolve` is aliased because `createCampaignStore` takes a `path` PARAMETER
// (the store file), which shadows a bare `path` module import inside it.
import { join, dirname, resolve as resolvePath } from 'path';
import { getChannel } from '../social/channel-registry.js';
import { checkPathAccess } from '../tool-sandbox.js';
import { withFileLock } from '../file-lock.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { legacyCmoPath } from './cmo-designation.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'marketing-campaigns.json');

// The pre-2026-10-16 machine bench, read per call so tests never touch the
// operator's live one.
const legacyCampaignsPath = () =>
  process.env.NEUMA_CAMPAIGNS_PATH || DEFAULT_LEGACY_PATH;

export const CAMPAIGN_STATUSES = Object.freeze(['active', 'paused', 'done']);

const PILLARS_MAX = 12;

/**
 * Validate the shape of a new or updated campaign (pure). Returns an error
 * string or null — the store never persists a malformed declaration.
 * @param {{name?: string, brand?: string, status?: string, channelId?: string,
 *   pillars?: string[], cadence?: string, marketingPlan?: string,
 *   funnelPlan?: string, notes?: string}} campaign
 */
export const validateCampaign = ({ name, brand, status, channelId, pillars, cadence, marketingPlan, funnelPlan, notes } = {}) => {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return 'a campaign needs a name';
  if (n.length > 200) return 'name is too long';
  const b = typeof brand === 'string' ? brand.trim() : '';
  if (!b) return 'a campaign needs a brand';
  if (b.length > 100) return 'brand is too long';
  if (status != null && !CAMPAIGN_STATUSES.includes(status)) {
    return `Unknown status: ${status}`;
  }
  // A campaign may belong to ONE platform (its own space in OUTREACH) —
  // each platform requires its own approach, so campaigns organize per
  // channel. Absent/null = a house-wide campaign spanning platforms.
  if (channelId != null && channelId !== '' && !getChannel(channelId)) {
    return `Unknown channel: ${channelId}`;
  }
  if (pillars != null) {
    if (!Array.isArray(pillars) || pillars.some((p) => typeof p !== 'string')) {
      return 'pillars must be an array of strings';
    }
    if (pillars.length > PILLARS_MAX) return `a campaign carries at most ${PILLARS_MAX} pillars`;
    if (pillars.some((p) => p.length > 100)) return 'a pillar is too long';
  }
  for (const [label, v, max] of [
    ['cadence', cadence, 200],
    ['marketingPlan', marketingPlan, 20000],
    ['funnelPlan', funnelPlan, 20000],
    ['notes', notes, 20000],
  ]) {
    if (v != null && (typeof v !== 'string' || v.length > max)) {
      // An error the being can act on: the limit, and for cadence — the
      // schedule's one-line home vs where long-form reasoning actually goes
      // (a research dump failing here taught nobody anything, 2026-07-28).
      return label === 'cadence'
        ? `cadence is too long (max ${max} chars — the schedule in one line, e.g. "2 posts/day, 9 AM + 6 PM ET"; long-form reasoning belongs in marketingPlan/notes)`
        : `${label} is too long (max ${max} chars)`;
    }
  }
  return null;
};

/**
 * Render the campaign bench for a being's context window (pure): one line
 * per campaign, capped so a large bench never floods a turn.
 * @param {Array<object>} campaigns
 */
export const formatCampaignsForBeing = (campaigns, { max = 20 } = {}) => {
  if (!campaigns.length) return 'No campaigns are declared yet — the marketing bench is empty.';
  const lines = campaigns.slice(0, max).map((c) =>
    `[${c.id.slice(0, 8)}] ${c.name} (${c.brand}) — ${c.status}${c.channelId ? ` · ${c.channelId}` : ' · house-wide'} · ${c.pillars.length} pillars${c.cadence ? ` · ${c.cadence}` : ''}`);
  const dropped = campaigns.length - lines.length;
  return [
    `${campaigns.length} campaign(s) on the house bench:`,
    ...lines,
    ...(dropped > 0 ? [`…and ${dropped} more — the operator's board carries the full bench.`] : []),
  ].join('\n');
};

/**
 * @param {{ path: string|(() => string) }} opts
 */
export const createCampaignStore = ({ path }) => {
  const target = () => (typeof path === 'function' ? path() : path);

  // Serialize mutations — two concurrent edits must never clobber each
  // other's read+write.
  //
  // The promise chain alone is per-PROCESS, and this box runs two servers
  // against one checkout (the dev stack and the Electron desk), both writing
  // this same file — an operator declaring a campaign through the tool and the
  // operator editing one on the board are, routinely, two different processes.
  // So the chain is paired with a cross-process lock, exactly as the post queue
  // is (see `file-lock.js`, where a 400-entry two-process race lost 26 writes).
  const inProcess = createWriteChain();
  const serialize = (fn) => inProcess(() => withFileLock(`${target()}.lock`, fn));

  // impure — missing file = empty bench; a corrupt file surfaces, never
  // collapses to [] (that would silently drop the house's declared work).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('campaign-store: store is not an array');
    return parsed;
  };

  // impure — atomic tmp+rename write with the 0600/0700 re-tighten.
  const save = async (campaigns) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(campaigns, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

  const shaped = (source) => ({
    name: trimmed(source.name),
    brand: trimmed(source.brand),
    status: source.status || 'active',
    channelId: trimmed(source.channelId) || null,
    pillars: Array.isArray(source.pillars) ? source.pillars.map((p) => p.trim()) : [],
    cadence: trimmed(source.cadence),
    marketingPlan: trimmed(source.marketingPlan),
    funnelPlan: trimmed(source.funnelPlan),
    notes: trimmed(source.notes),
  });

  return {
    load,

    /**
     * Declare one campaign. impure.
     * @param {{name: string, brand: string, status?: string,
     *   pillars?: string[], cadence?: string, marketingPlan?: string,
     *   funnelPlan?: string, notes?: string}} campaign
     */
    add(campaign) {
      const invalid = validateCampaign(campaign);
      if (invalid) return Promise.reject(new Error(invalid));
      return serialize(async () => {
        const campaigns = await load();
        const now = new Date().toISOString();
        const entry = {
          id: crypto.randomBytes(8).toString('hex'),
          ...shaped(campaign),
          createdAt: now,
          updatedAt: now,
        };
        campaigns.push(entry);
        await save(campaigns);
        return entry;
      });
    },

    /**
     * Edit one campaign — the merged shape is re-validated whole, so no
     * partial edit can leave the declaration malformed. impure.
     * @param {string} id
     * @param {{name?: string, brand?: string, status?: string,
     *   pillars?: string[], cadence?: string, marketingPlan?: string,
     *   funnelPlan?: string, notes?: string}} fields
     */
    update(id, fields = {}) {
      return serialize(async () => {
        const campaigns = await load();
        const campaign = campaigns.find((c) => c.id === id);
        if (!campaign) return { ok: false, error: 'no such campaign' };
        const merged = {
          name: fields.name !== undefined ? fields.name : campaign.name,
          brand: fields.brand !== undefined ? fields.brand : campaign.brand,
          status: fields.status !== undefined ? fields.status : campaign.status,
          channelId: fields.channelId !== undefined ? fields.channelId : campaign.channelId,
          pillars: fields.pillars !== undefined ? fields.pillars : campaign.pillars,
          cadence: fields.cadence !== undefined ? fields.cadence : campaign.cadence,
          marketingPlan: fields.marketingPlan !== undefined ? fields.marketingPlan : campaign.marketingPlan,
          funnelPlan: fields.funnelPlan !== undefined ? fields.funnelPlan : campaign.funnelPlan,
          notes: fields.notes !== undefined ? fields.notes : campaign.notes,
        };
        const invalid = validateCampaign(merged);
        if (invalid) return { ok: false, error: invalid };
        Object.assign(campaign, shaped(merged), { updatedAt: new Date().toISOString() });
        await save(campaigns);
        return { ok: true, campaign };
      });
    },

    /**
     * Tie a file to a campaign — its brief, brand voice, approved copy.
     *
     * Design note, 2026-07-27: *[…]* Same shape as
     * a project's `sharedFiles`, read by the same bounded reader.
     *
     * THE FILE'S CONTENT BECOMES ALWAYS-ON CONTEXT for whoever works this
     * campaign, so attaching is a READ GRANT, not a bookmark. Every path
     * therefore crosses `checkPathAccess`, the same gate every tool call
     * crosses: `.env`, `.git`, `vault/`, `keys/`, another being's `data/dna/`
     * and the rest of the denied set are refused here exactly as they are
     * there. Without this, "attach a file" would be a way to read any secret
     * on the box by having a being recite it back.
     *
     * Deliberately NOT part of `shaped()`, so an ordinary campaign edit can
     * never clobber the attachments.
     *
     * impure.
     * @param {string} id
     * @param {string} filePath absolute path
     * @param {{addedBy?: string}} [by]
     */
    attachFile(id, filePath, by = {}) {
      return serialize(async () => {
        // REAL path, not the lexical one. `resolvePath` only normalizes . and ..
        // — it does not follow symlinks, while every later step does. A link at
        // an innocent name pointing into the denied set (`notes.md` -> `../.env`)
        // would otherwise pass the gate on its LINK NAME and hand the target's
        // content to a being as always-on context. Same class as the SEC-032
        // realpath re-check the sandbox already does.
        const lexical = resolvePath(String(filePath || ''));
        const real = await fs.realpath(lexical).catch(() => null);
        if (!real) return { ok: false, code: 'missing', error: 'no such file' };
        const verdict = checkPathAccess(real, []);
        if (!verdict.allowed) return { ok: false, code: 'access-denied', error: verdict.reason };
        const stat = await fs.stat(real).catch(() => null);
        if (!stat || !stat.isFile()) return { ok: false, code: 'missing', error: 'no such file' };
        // Store the REAL path, so the turn-time read cannot be redirected later.
        const resolved = real;

        const campaigns = await load();
        const campaign = campaigns.find((c) => c.id === id);
        if (!campaign) return { ok: false, code: 'no-campaign', error: 'no such campaign' };
        if (!Array.isArray(campaign.sharedFiles)) campaign.sharedFiles = [];
        if (campaign.sharedFiles.some((f) => f.path === resolved)) {
          return { ok: true, campaign }; // already tied — idempotent, not an error
        }
        campaign.sharedFiles.push({
          path: resolved,
          addedAt: new Date().toISOString(),
          ...(by.addedBy ? { addedBy: String(by.addedBy) } : {}),
        });
        campaign.updatedAt = new Date().toISOString();
        await save(campaigns);
        return { ok: true, campaign };
      });
    },

    /** Untie a file. The file itself is never touched. impure. */
    detachFile(id, filePath) {
      return serialize(async () => {
        const campaigns = await load();
        const campaign = campaigns.find((c) => c.id === id);
        if (!campaign) return { ok: false, error: 'no such campaign' };
        const resolved = resolvePath(String(filePath || ''));
        const before = (campaign.sharedFiles || []).length;
        campaign.sharedFiles = (campaign.sharedFiles || [])
          .filter((f) => f.path !== resolved && f.path !== filePath);
        if (campaign.sharedFiles.length === before) return { ok: false, error: 'that file is not tied to this campaign' };
        campaign.updatedAt = new Date().toISOString();
        await save(campaigns);
        return { ok: true, campaign };
      });
    },

    /** Drop one campaign from the bench entirely. impure. */
    remove(id) {
      return serialize(async () => {
        const campaigns = await load();
        if (!campaigns.some((c) => c.id === id)) return false;
        await save(campaigns.filter((c) => c.id !== id));
        return true;
      });
    },
  };
};

// A house's own bench — the routes, the being tools, the CMO briefing and
// the Optio's fold all open it for the house in question. impure.
export const campaignStoreFor = createHouseStore({
  office: 'marketing',
  name: 'marketing-campaigns.json',
  legacyPath: legacyCampaignsPath,
  legacySeatPath: legacyCmoPath,
  create: createCampaignStore,
});
