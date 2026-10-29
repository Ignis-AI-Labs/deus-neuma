// campaign-shape — the law of a campaign, shape v2 (campaign plan §3.1).
//
// A campaign belongs to ONE company (a brand kit of the house). It names
// what it is for (goal + KPI target + window), a budget that is a planning
// number only (nothing spends it), the ANGLES each piece argues (angles
// replace the old bare-string pillars, owner 2026-10-24), and one
// SUB-campaign per account it runs on. A sub is part of the campaign record:
// one file, one card, one re-validation. A sub is named by its account, so a
// post's (campaignId, accountId) names its sub.
//
// Pure: inputs in, a shaped record or a refusal in words out. The house's
// companies and accounts arrive as arguments (campaign-context.js reads them).

import { getChannel } from '../social/channel-registry.js';

export const CAMPAIGN_VERSION = 2;
export const CAMPAIGN_STATUSES = Object.freeze(['draft', 'active', 'paused', 'done']);
export const GOAL_KINDS = Object.freeze(['downloads', 'bookings', 'purchases', 'followers', 'signups', 'visits', 'custom']);
export const KPI_METRICS = Object.freeze(['conversions', 'clicks', 'reach', 'followers']);
export const ANGLES_MAX = 12;
export const SUBS_MAX = 40;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ANGLE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TEXT_LIMITS = Object.freeze({ cadence: 200, marketingPlan: 20000, funnelPlan: 20000, notes: 20000 });

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const validDay = (v) => DAY.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** An angle's id from its name: lowercase words joined by hyphens. Pure. */
export const angleSlug = (name) => text(name).toLowerCase()
  .normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-')
  .replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40) || 'angle';

/**
 * Settle a list of angles: names (the old pillars) or {id?, name, thesis?,
 * audience?}. An angle keeps its id across edits (by id, else by its name in
 * `previous`); a new one gets the slug of its name, made unique. Pure.
 * @param {Array<string|object>} input
 * @param {Array<object>} [previous]
 * @returns {Array<{id: string, name: string, thesis: string, audience: string}>}
 */
export const settleAngles = (input, previous = []) => {
  const taken = new Set();
  const unique = (base) => {
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base.slice(0, 44)}-${n}`;
    taken.add(id);
    return id;
  };
  return (Array.isArray(input) ? input : []).map((raw) => {
    const a = typeof raw === 'string' ? { name: raw } : (isObject(raw) ? raw : {});
    const name = text(a.name);
    const before = previous.find((p) => (a.id && p.id === a.id) || (!a.id && p.name === name));
    const wanted = ANGLE_ID.test(String(a.id || '')) ? a.id : before?.id;
    return {
      id: unique(wanted && !taken.has(wanted) ? wanted : angleSlug(name)),
      name,
      thesis: text(a.thesis ?? before?.thesis),
      audience: text(a.audience ?? before?.audience),
    };
  });
};

/** The angle a name or id names, in a campaign's angles. Pure. */
export const angleNamed = (angles, given) => {
  const g = text(given);
  if (!g) return null;
  return (angles || []).find((a) => a.id === g)
    || (angles || []).find((a) => a.name.toLowerCase() === g.toLowerCase()) || null;
};

/**
 * Settle the subs: `{account|accountId, role?, cadence?, angles?|angleIds?}`,
 * where angles may be names or ids of the campaign's own angles. Pure.
 * @returns {{subs: Array<object>, refusal: ?string}}
 */
export const settleSubs = (input, angles) => {
  const subs = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw)) return { subs, refusal: 'each sub-campaign is {account, role?, cadence?, angles?}' };
    const accountId = text(raw.accountId ?? raw.account);
    const named = Array.isArray(raw.angleIds) ? raw.angleIds : (Array.isArray(raw.angles) ? raw.angles : []);
    const angleIds = [];
    for (const given of named) {
      const angle = angleNamed(angles, given);
      if (!angle) return { subs, refusal: `the sub on ${accountId || '?'} names the angle "${given}", which this campaign does not have` };
      if (!angleIds.includes(angle.id)) angleIds.push(angle.id);
    }
    subs.push({ accountId, role: text(raw.role), cadence: text(raw.cadence), angleIds });
  }
  return { subs, refusal: null };
};

const goalRefusal = (goal) => {
  if (goal == null) return null;
  if (!isObject(goal) || !GOAL_KINDS.includes(goal.kind)) return `goal is {kind, label?} with kind one of ${GOAL_KINDS.join(', ')}`;
  if (goal.kind === 'custom' && !text(goal.label)) return 'a custom goal needs a label saying what counts';
  return text(goal.label).length > 120 ? 'the goal label is too long (max 120 chars)' : null;
};

const kpiRefusal = (kpi) => {
  if (kpi == null) return null;
  if (!isObject(kpi) || !KPI_METRICS.includes(kpi.metric)) return `kpi is {metric, target, by?} with metric one of ${KPI_METRICS.join(', ')}`;
  if (!Number.isInteger(kpi.target) || kpi.target <= 0) return 'the KPI target is a whole number above zero';
  return kpi.by != null && !validDay(kpi.by) ? 'kpi.by is a day, YYYY-MM-DD' : null;
};

const windowRefusal = (window) => {
  if (window == null) return null;
  if (!isObject(window) || !validDay(window.start) || !validDay(window.end)) return 'window is {start, end}, both days (YYYY-MM-DD)';
  return window.end < window.start ? 'the window ends before it starts' : null;
};

const budgetRefusal = (budget) => {
  if (budget == null) return null;
  if (!isObject(budget)) return 'budget is {hours?, money?, note?} — a planning number; nothing spends it';
  for (const k of ['hours', 'money']) {
    if (budget[k] != null && !(typeof budget[k] === 'number' && Number.isFinite(budget[k]) && budget[k] >= 0)) return `budget.${k} is a number, zero or more`;
  }
  return text(budget.note).length > 500 ? 'the budget note is too long (max 500 chars)' : null;
};

const anglesRefusal = (angles) => {
  if (angles.length > ANGLES_MAX) return `a campaign carries at most ${ANGLES_MAX} angles`;
  if (angles.some((a) => !a.name)) return 'every angle needs a name';
  if (angles.some((a) => a.name.length > 100 || a.thesis.length > 500 || a.audience.length > 300)) {
    return 'an angle is too long (name 100, thesis 500, audience 300 chars)';
  }
  const names = angles.map((a) => a.name.toLowerCase());
  return names.some((n, i) => names.indexOf(n) !== i) ? 'two angles carry the same name' : null;
};

/**
 * Why a sub cannot stand, in words — its account must be one of this house's,
 * belong to the campaign's company, and appear once. Only subs that are new
 * or changed (or every sub, when the company changed) are judged, so a
 * migrated sub on an account a later move put elsewhere does not lock the
 * campaign. Pure.
 */
const subsRefusal = (subs, { companyId, accounts, previous }) => {
  if (subs.length > SUBS_MAX) return `a campaign carries at most ${SUBS_MAX} sub-campaigns`;
  const seen = new Set();
  const judgeAll = !previous || previous.companyId !== companyId;
  for (const sub of subs) {
    if (!sub.accountId) return 'each sub-campaign names its account (e.g. "x-1")';
    if (seen.has(sub.accountId)) return `account ${sub.accountId} already has a sub in this campaign — one sub per account`;
    seen.add(sub.accountId);
    if (sub.role.length > 100 || sub.cadence.length > 200) return `the sub on ${sub.accountId} is too long (role 100, cadence 200 chars)`;
    const before = previous?.subs?.find((s) => s.accountId === sub.accountId);
    if (!judgeAll && before) continue;
    const account = (accounts || []).find((a) => a.id === sub.accountId);
    if (!account) return `there is no account ${sub.accountId} in this house`;
    if (!companyId) return 'a campaign needs its company before it can run on accounts';
    if (!account.companyId) return `account ${sub.accountId} has no company yet — set its company in Settings → API → Channel keys first`;
    if (account.companyId !== companyId) {
      return `account ${sub.accountId} belongs to ${account.companyId}, not ${companyId} — a campaign runs only on its own company's accounts`;
    }
  }
  return null;
};

/**
 * Shape a campaign's declared fields from a caller's input (pure). Aliases a
 * caller may still speak: `company`/`brand` for companyId, `pillars` for
 * angle names. The shaped record carries no id, asks, log or timestamps.
 * @param {object} source
 * @param {object} [previous] - the record being edited, for angle ids
 */
export const shapeCampaign = (source, previous = null) => {
  const companyId = text(source.companyId ?? source.company) || null;
  const angles = settleAngles(source.angles ?? source.pillars ?? [], previous?.angles || []);
  const { subs, refusal } = settleSubs(source.subs ?? [], angles);
  return {
    shaped: {
      name: text(source.name),
      companyId,
      brand: text(source.brand) || companyId || '',
      status: source.status || 'active',
      goal: isObject(source.goal) ? { kind: source.goal.kind, label: text(source.goal.label) } : null,
      kpi: isObject(source.kpi) ? { metric: source.kpi.metric, target: source.kpi.target, by: source.kpi.by || null } : null,
      window: isObject(source.window) ? { start: source.window.start, end: source.window.end } : null,
      budget: isObject(source.budget) ? {
        hours: source.budget.hours ?? null, money: source.budget.money ?? null, note: text(source.budget.note),
      } : null,
      angles,
      subs,
      cadence: text(source.cadence),
      marketingPlan: text(source.marketingPlan),
      funnelPlan: text(source.funnelPlan),
      notes: text(source.notes),
    },
    refusal,
  };
};

/**
 * Why this campaign cannot be recorded, in words — or null (pure).
 * @param {object} source - the caller's input (aliases allowed)
 * @param {{companies?: Array<{id: string}>, accounts?: Array<object>, previous?: object}} [ctx]
 * @returns {string|null}
 */
export const campaignRefusal = (source, { companies = null, accounts = [], previous = null } = {}) => {
  if (!isObject(source)) return 'a campaign is an object';
  if (source.channelId != null && source.channelId !== '') {
    return getChannel(source.channelId)
      ? `campaigns no longer belong to one platform: name the accounts it runs on as subs, e.g. subs: [{account: "${source.channelId}-1"}]`
      : `Unknown channel: ${source.channelId}`;
  }
  const rawAngles = source.angles ?? source.pillars;
  if (rawAngles != null && !Array.isArray(rawAngles)) return 'angles is a list: [{name, thesis?, audience?}] (or names)';
  if (source.subs != null && !Array.isArray(source.subs)) return 'subs is a list: [{account, role?, cadence?, angles?}]';
  if (Array.isArray(rawAngles) && rawAngles.some((a) => typeof a !== 'string' && !isObject(a))) return 'each angle is {name, thesis?, audience?} or a name';
  const { shaped, refusal } = shapeCampaign(source, previous);
  if (refusal) return refusal;
  if (!shaped.name) return 'a campaign needs a name';
  if (shaped.name.length > 200) return 'name is too long';
  if (!shaped.companyId && !shaped.brand) return 'a campaign needs its company (the brand kit it speaks for)';
  if (shaped.companyId && companies && !companies.some((c) => c.id === shaped.companyId)) {
    return `there is no "${shaped.companyId}" company in this house — a company is one of the house's brand kits`;
  }
  if (!CAMPAIGN_STATUSES.includes(shaped.status)) return `Unknown status: ${shaped.status} (one of ${CAMPAIGN_STATUSES.join(', ')})`;
  for (const check of [goalRefusal(source.goal), kpiRefusal(source.kpi), windowRefusal(source.window),
    budgetRefusal(source.budget), anglesRefusal(shaped.angles)]) if (check) return check;
  for (const [label, max] of Object.entries(TEXT_LIMITS)) {
    const v = source[label];
    if (v != null && (typeof v !== 'string' || v.length > max)) {
      return label === 'cadence'
        ? `cadence is too long (max ${max} chars — the schedule in one line, e.g. "2 posts/day, 9 AM + 6 PM ET"; long-form reasoning belongs in marketingPlan/notes)`
        : `${label} is too long (max ${max} chars)`;
    }
  }
  return subsRefusal(shaped.subs, { companyId: shaped.companyId, accounts, previous });
};

const FIELD_WORDS = Object.freeze({
  name: 'name', companyId: 'company', status: 'status', goal: 'goal', kpi: 'KPI', window: 'window',
  budget: 'budget', angles: 'angles', subs: 'sub-campaigns', cadence: 'cadence',
  marketingPlan: 'marketing plan', funnelPlan: 'funnel plan', notes: 'notes',
});

/** What an edit changed, in words for the change log — or null when nothing did. Pure. */
export const changeWords = (before, after) => {
  const changed = Object.keys(FIELD_WORDS).filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
  if (!changed.length) return null;
  const status = changed.includes('status') ? `status ${before?.status} → ${after.status}` : null;
  const rest = changed.filter((k) => k !== 'status').map((k) => FIELD_WORDS[k]);
  return [status, rest.length ? `changed ${rest.join(', ')}` : null].filter(Boolean).join('; ');
};
