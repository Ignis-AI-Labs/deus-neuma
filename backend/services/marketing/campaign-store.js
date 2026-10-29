// Campaign store — the marketing bench's book of declared campaigns: the
// organization layer over the post queue and the lead ledger, so outward
// speech and captured prospects can be gathered under one named push.
//
// A campaign is a DECLARATION, not an engine — it records what the house is
// pushing (its company, goal, KPI, window, angles, one sub-campaign per
// account, the plans) and its status; it never polices the queue or the
// ledger. The shape's law is campaign-shape.js (v2, campaign plan §3.1); a
// house's first-shape campaigns are moved to it on the first read, with the
// old file kept beside the store (campaign-upgrade.js). Removal is a deliberate hard delete, same
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
import { checkPathAccess } from '../tool-sandbox.js';
import { withFileLock } from '../file-lock.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { createLogger } from '../logger.js';
import { listBrandNames } from '../branding/kit-locate.js';
import { brandsDir } from '../branding/brand-tokens.js';
import { legacyCmoPath } from './cmo-designation.js';
import { CAMPAIGN_STATUSES, CAMPAIGN_VERSION, campaignRefusal, shapeCampaign, settleAngles, changeWords } from './campaign-shape.js';
import { upgradeCampaign, isCampaignV2, companyForBrand } from './campaign-upgrade.js';
import { openAsk, settleAsk, withLogLine, asksOwedBy } from './campaign-asks.js';

export { CAMPAIGN_STATUSES };

const log = createLogger('Campaigns');

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'marketing-campaigns.json');

// The pre-2026-10-16 machine bench, read per call so tests never touch the
// operator's live one.
const legacyCampaignsPath = () =>
  process.env.NEUMA_CAMPAIGNS_PATH || DEFAULT_LEGACY_PATH;

// The fields a campaign DECLARES — what an edit may change. Asks, the log,
// files and timestamps have their own doors.
const DECLARED = Object.freeze(['name', 'companyId', 'brand', 'status', 'goal', 'kpi', 'window', 'budget',
  'angles', 'subs', 'cadence', 'marketingPlan', 'funnelPlan', 'notes']);

/**
 * Why a campaign cannot be recorded, or null (pure) — the routes refuse at
 * the door with the same words the store would.
 * @param {object} campaign
 * @param {{companies?: Array<{id: string}>, accounts?: Array<object>, previous?: object}} [ctx]
 */
export const validateCampaign = (campaign, ctx = {}) => campaignRefusal(campaign, ctx);

const kpiLine = (c) => (c.kpi ? ` · KPI ${c.kpi.target} ${c.kpi.metric}${c.kpi.by ? ` by ${c.kpi.by}` : ''}` : '');
const windowLine = (c) => (c.window ? ` · ${c.window.start} → ${c.window.end}` : '');

/**
 * Render the campaign bench for a being's context window (pure): one line
 * per campaign, capped so a large bench never floods a turn.
 * @param {Array<object>} campaigns
 */
export const formatCampaignsForBeing = (campaigns, { max = 20 } = {}) => {
  if (!campaigns.length) return 'No campaigns are declared yet — the marketing bench is empty.';
  const lines = campaigns.slice(0, max).flatMap((c) => {
    const angles = (c.angles || []).map((a) => a.name);
    const subs = (c.subs || []).map((s) => s.accountId);
    const owed = asksOwedBy(c, 'cmo');
    return [
      `[${c.id.slice(0, 8)}] ${c.name} (${c.companyId || `UNSORTED: ${c.brand || 'no company'}`}) — ${c.status}`
        + `${c.goal ? ` · goal ${c.goal.kind}${c.goal.label ? ` (${c.goal.label})` : ''}` : ''}${kpiLine(c)}${windowLine(c)}`
        + ` · angles: ${angles.length ? angles.join(', ') : 'none'} · subs: ${subs.length ? subs.join(', ') : 'none'}`
        + `${c.cadence ? ` · ${c.cadence}` : ''}`,
      ...owed.slice(0, 5).map((a) => `  ask [${a.id.slice(0, 8)}] from the operator, open: ${a.text.replace(/\s+/g, ' ').slice(0, 200)}`),
    ];
  });
  const dropped = Math.max(0, campaigns.length - max);
  return [
    `${campaigns.length} campaign(s) on the house bench:`,
    ...lines,
    ...(dropped > 0 ? [`…and ${dropped} more — the operator's board carries the full bench.`] : []),
  ].join('\n');
};

// The declared fields of an edit: the record's, with every field the caller
// passed laid over it. `company` and `pillars` are aliases a caller may still
// speak; a company change carries the display brand with it.
const mergeDeclared = (record, fields) => {
  const merged = {};
  for (const k of DECLARED) merged[k] = fields[k] !== undefined ? fields[k] : record[k];
  if (fields.companyId === undefined && fields.company !== undefined) merged.companyId = fields.company;
  if (fields.angles === undefined && fields.pillars !== undefined) merged.angles = fields.pillars;
  if (merged.companyId !== record.companyId && fields.brand === undefined) merged.brand = merged.companyId || record.brand;
  if (fields.channelId !== undefined) merged.channelId = fields.channelId;
  // New angles with no new subs: a sub's angle that no longer exists falls away.
  if (fields.subs === undefined && merged.angles !== record.angles) {
    const ids = new Set(settleAngles(merged.angles, record.angles || []).map((a) => a.id));
    merged.subs = (record.subs || []).map((s) => ({ ...s, angleIds: (s.angleIds || []).filter((id) => ids.has(id)) }));
  }
  return merged;
};

/**
 * @param {{ path: string|(() => string), companyIds?: () => Promise<string[]> }} opts
 *   companyIds — the house's company (kit) ids, for moving first-shape
 *   campaigns onto their company
 */
export const createCampaignStore = ({ path, companyIds = async () => [] }) => {
  const target = () => (typeof path === 'function' ? path() : path);
  const backupOf = (file) => file.replace(/\.json$/, '') + '.v1.json';

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
  const readRaw = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { raw: null, list: [] };
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('campaign-store: store is not an array');
    return { raw, list: parsed };
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

  // impure — the first-shape bench moved to v2, under the lock: the old
  // bytes are kept read-only beside the store FIRST (never overwritten by a
  // later run), then the moved bench is written, then the move is logged.
  const migrate = async (raw, list) => {
    const ids = await companyIds().catch((err) => {
      log.warn('campaign move: the house\'s companies could not be read; unmatched brands stand UNSORTED', { error: err.message });
      return [];
    });
    const backup = backupOf(target());
    await fs.writeFile(backup, raw, { mode: 0o400, flag: 'wx' }).catch((err) => { if (err.code !== 'EEXIST') throw err; });
    const at = new Date().toISOString();
    const moved = list.map((c) => upgradeCampaign(c, { companyIds: ids, at }));
    await save(moved);
    log.info('the house\'s campaigns now stand in shape v2 (pillars → angles, one platform → a sub)', {
      file: target(),
      backup,
      moved: moved.filter((c) => c.migratedFrom?.at === at).map((c) => `${c.id}: ${c.log[c.log.length - 1].what}`),
    });
    return moved;
  };

  // impure — the v2 bench; call inside the lock.
  const loadUnlocked = async () => {
    const { raw, list } = await readRaw();
    return list.every(isCampaignV2) ? list : migrate(raw, list);
  };

  // impure — the v2 bench; a first-shape bench is moved on this read.
  const load = async () => {
    const { list } = await readRaw();
    return list.every(isCampaignV2) ? list : serialize(loadUnlocked);
  };

  // impure — one guarded change of one campaign: fn(record) returns the next
  // record or {error}.
  const change = (id, fn) => serialize(async () => {
    const campaigns = await loadUnlocked();
    const at = campaigns.findIndex((c) => c.id === id);
    if (at < 0) return { ok: false, code: 'no-campaign', error: 'no such campaign' };
    const next = fn(campaigns[at]);
    if (next.error) return { ok: false, error: next.error };
    campaigns[at] = next.campaign;
    await save(campaigns);
    return { ok: true, campaign: next.campaign };
  });

  return {
    load,

    /**
     * Declare one campaign. impure.
     * @param {object} campaign - campaign-shape fields (aliases: company, brand, pillars)
     * @param {{companies?: Array<{id: string}>, accounts?: Array<object>}} [ctx] - the house's, when the caller holds them
     * @param {string} [by] - who declared it (the operator's wallet or the filing lane)
     */
    add(campaign, ctx = {}, by = '') {
      const ids = (ctx.companies || []).map((c) => c.id);
      const source = { ...campaign, companyId: campaign?.companyId ?? campaign?.company ?? (companyForBrand(campaign?.brand, ids) || campaign?.brand) };
      const invalid = campaignRefusal(source, ctx);
      if (invalid) return Promise.reject(new Error(invalid));
      return serialize(async () => {
        const campaigns = await loadUnlocked();
        const now = new Date().toISOString();
        const entry = {
          id: crypto.randomBytes(8).toString('hex'),
          v: CAMPAIGN_VERSION,
          ...shapeCampaign(source).shaped,
          asks: [],
          log: withLogLine([], { at: now, by, what: 'declared' }),
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
     * partial edit can leave the declaration malformed; what changed lands in
     * the campaign's change log. impure.
     * @param {string} id
     * @param {object} fields - any declared field (aliases: company, pillars)
     * @param {{companies?: Array<{id: string}>, accounts?: Array<object>}} [ctx]
     * @param {string} [by]
     */
    update(id, fields = {}, ctx = {}, by = '') {
      return change(id, (record) => {
        const merged = mergeDeclared(record, fields);
        const invalid = campaignRefusal(merged, { ...ctx, previous: record });
        if (invalid) return { error: invalid };
        const shaped = shapeCampaign(merged, record).shaped;
        const now = new Date().toISOString();
        const what = changeWords(record, shaped);
        return {
          campaign: {
            ...record, ...shaped, updatedAt: now,
            log: what ? withLogLine(record.log, { at: now, by, what }) : record.log || [],
          },
        };
      });
    },

    /**
     * Open an ask on a campaign — the operator's to the CMO, or the CMO's to
     * the operator. impure.
     * @param {string} id
     * @param {{from: 'operator'|'cmo', text: string, by: string}} ask
     */
    ask(id, { from, text, by }) {
      const askId = crypto.randomBytes(6).toString('hex');
      return change(id, (record) => openAsk(record, { id: askId, from, text, by, at: new Date().toISOString() }));
    },

    /**
     * Settle an ask: answered by the side it was asked of, or withdrawn by the
     * side that asked. impure.
     * @param {string} id
     * @param {string} askId
     * @param {{side: 'operator'|'cmo', by: string, answer?: string}} settle
     */
    settleAsk(id, askId, { side, by, answer }) {
      return change(id, (record) => settleAsk(record, askId, { side, by, answer, at: new Date().toISOString() }));
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

        const campaigns = await loadUnlocked();
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
        const campaigns = await loadUnlocked();
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
        const campaigns = await loadUnlocked();
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
  create: ({ path, wallet }) => createCampaignStore({
    path,
    companyIds: async () => (await listBrandNames(wallet, brandsDir())).map((n) => n.brand),
  }),
});
