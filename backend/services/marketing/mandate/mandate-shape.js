// mandate-shape — the pure law of a MANDATE (Design note, 2026-10-24: an explicit,
// operator-granted autonomy mode under which the house's CMO seat acts on
// marketing without asking — stage-and-publish posts, render images and
// videos, and (granted apart) answer replies — inside a scope, a daily pace
// per account and a term the operator chose. The operator's yes is the
// consent; the operator may withdraw it at any instant.
//
// GUIDANCE, NOT WALLS. Inside its scope the mandate trusts the seat fully.
// What it watches for are TRIPWIRES — each one PAUSES the whole mandate and
// tells the operator, never silently blocks one act. Hostile text a stranger
// wrote is not a tripwire: it HOLDS only what is drawn from it
// (mandate-hold.js) and the rest goes on. Every mandate ends by itself after
// its term — a forgotten mandate never runs forever. Outside its scope
// everything asks exactly as before. Some laws are no mandate's to grant:
// money out, the content law, AI disclosure, the secrets gate, another house.
//
// Every function here is pure: inputs in, verdicts out.

export const MANDATE_SEAT = 'cmo';
export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 90;
export const DEFAULT_POST_PACE = 2;
export const MAX_POST_PACE = 12;
export const DEFAULT_REPLY_PACE = 5;
export const MAX_REPLY_PACE = 20;
export const LEGAL_PAUSE_LEVELS = Object.freeze(['critical', 'high', 'medium', 'low']);
export const DEFAULT_LEGAL_PAUSE_AT = 'high';
export const STANDINGS = Object.freeze(['none', 'active', 'paused', 'withdrawn', 'expired']);

// The platforms whose own rules ask for the person's yes on every post — a
// mandate can never stand in for it (TikTok's content-posting guidelines:
// the user confirms each post's privacy and interaction choices).
export const PER_POST_CONSENT_CHANNELS = Object.freeze(['tiktok']);
// Replies are read and answered on X alone today (reply-listener.js).
export const REPLY_CHANNELS = Object.freeze(['x']);

// The tripwires, in the words the operator reads.
export const TRIPS = Object.freeze({
  pace: 'a post went past the daily pace you set',
  legal: 'a post makes a claim the legal check rates serious',
  spam: 'a platform refused a post as spam or automated',
  rogue: 'the security watch caught something wrong in what the CMO itself said or did',
  widen: 'something tried to change the mandate or the CMO\'s own permissions',
  'cross-company': 'a post tried to carry one company\'s campaign on another company\'s account',
  'cross-house': 'an act reached past this house',
});

// What hostile text a stranger wrote does instead: it holds, never pauses.
export const HOLD_WORDS = 'Text from outside that tries to steer it is held for you: anything drawn from it waits on you, and the rest goes on.';

// The laws no mandate covers — shown on the grant screen so the operator
// sees exactly what stays out of reach: each as a chip of at most three
// words (`mark`), its whole sentence (`says`) on hover and in the CMO's
// guidance.
export const NEVER_MARKS = Object.freeze([
  Object.freeze({ id: 'money', mark: 'NO MONEY', says: 'Money never leaves the house — no spends, sends or trades.' }),
  Object.freeze({ id: 'content', mark: 'CONTENT LAW', says: 'The content law holds on every image and video.' }),
  Object.freeze({ id: 'ai', mark: 'AI MARK', says: 'Every post stays marked as made with AI.' }),
  Object.freeze({ id: 'secrets', mark: 'NO SECRETS', says: 'Secrets never leave the house — a post carrying a key is refused.' }),
  Object.freeze({ id: 'house', mark: 'THIS HOUSE', says: 'Another house is never touched.' }),
  Object.freeze({ id: 'asks', mark: 'REST ASKS', says: 'Anything outside this mandate still asks you.' }),
]);
export const NEVER_GRANTED = Object.freeze(NEVER_MARKS.map((m) => m.says));

const SEVERITY_RANK = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_ID = /^[a-z]+-\d+$/;

const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** A time zone the platform's clock can read, or UTC. Pure. */
const settleTimeZone = (tz) => {
  try {
    return typeof tz === 'string' && tz && new Intl.DateTimeFormat('en-CA', { timeZone: tz }) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * The operator's grant, settled against the house's real accounts. Pure.
 * @param {object} input - what the grant screen sent
 * @param {{accounts: Array<{id: string, channelId: string, companyId: ?string}>,
 *   house: string, laneId: string, by: string, now: Date, id: string}} ctx
 * @returns {{ok: true, mandate: object}|{ok: false, error: string}}
 */
export const settleGrant = (input, { accounts, house, laneId, by, now, id }) => {
  const asked = Array.isArray(input?.accounts) ? input.accounts : [];
  if (!asked.length) return { ok: false, error: 'a mandate needs at least one account to act on' };
  const scoped = [];
  for (const row of asked) {
    const accountId = typeof row?.id === 'string' ? row.id.trim() : '';
    const account = ACCOUNT_ID.test(accountId) ? accounts.find((a) => a.id === accountId) : null;
    if (!account) return { ok: false, error: `there is no account "${accountId}" in this house` };
    if (PER_POST_CONSENT_CHANNELS.includes(account.channelId)) {
      return { ok: false, error: `${account.channelId} asks for your yes on every post — it cannot ride a mandate` };
    }
    if (scoped.some((a) => a.id === accountId)) continue;
    scoped.push(Object.freeze({
      id: accountId,
      channelId: account.channelId,
      companyId: account.companyId ?? null,
      pace: clampInt(row.pace, DEFAULT_POST_PACE, 1, MAX_POST_PACE),
    }));
  }
  const acts = Object.freeze({
    posts: input?.acts?.posts !== false,
    renders: input?.acts?.renders !== false,
    replies: input?.acts?.replies === true,
  });
  if (!acts.posts && !acts.renders && !acts.replies) return { ok: false, error: 'a mandate needs at least one act' };
  // A big red button always has an end (ruling, 2026-10-24): no new grant
  // stands "until withdrawn". One stored before the ruling still reads as it is.
  if (input?.untilWithdrawn === true) return { ok: false, error: `a mandate always turns itself off — choose after how many days (1 to ${MAX_DAYS})` };
  const days = clampInt(input?.days, DEFAULT_DAYS, 1, MAX_DAYS);
  const legalPauseAt = LEGAL_PAUSE_LEVELS.includes(input?.legalPauseAt) ? input.legalPauseAt : DEFAULT_LEGAL_PAUSE_AT;
  return {
    ok: true,
    mandate: Object.freeze({
      id,
      house,
      seat: MANDATE_SEAT,
      laneId,
      grantedBy: by,
      grantedAt: now.toISOString(),
      days,
      expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
      timeZone: settleTimeZone(input?.timeZone),
      accounts: Object.freeze(scoped),
      companies: Object.freeze([...new Set(scoped.map((a) => a.companyId).filter(Boolean))]),
      acts,
      replyPace: clampInt(input?.replyPace, DEFAULT_REPLY_PACE, 1, MAX_REPLY_PACE),
      legalPauseAt,
      status: 'active',
    }),
  };
};

/** Where a mandate stands right now. Pure. */
export const mandateStanding = (mandate, now = new Date()) => {
  if (!mandate) return 'none';
  if (mandate.status === 'withdrawn') return 'withdrawn';
  if (mandate.expiresAt && now.getTime() >= Date.parse(mandate.expiresAt)) return 'expired';
  if (mandate.status === 'paused') return 'paused';
  return 'active';
};

/** The operator's calendar day of an instant, in the mandate's time zone. Pure. */
export const paceDay = (iso, timeZone = 'UTC') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: settleTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));

/** When an entry goes (or went) out: its slot, else the moment it was decided. Pure. */
export const sendMomentOf = (entry, now = new Date()) =>
  entry?.scheduledFor || entry?.sentAt || entry?.decidedAt || now.toISOString();

const COUNTED = new Set(['approved', 'sending', 'sent']);

/**
 * How many of this mandate's acts already stand on one account's day. Pure.
 * @param {object[]} entries - the house's queue
 * @param {{mandateId: string, accountId: string, day: string, timeZone: string, replies?: boolean}} q
 */
const paceCount = (entries, { mandateId, accountId, day, timeZone, replies = false }) => entries
  .filter((e) => e.decidedUnder === mandateId && COUNTED.has(e.status)
    && (e.accountId === accountId) && ((e.kind === 'reply') === replies)
    && paceDay(sendMomentOf(e), timeZone) === day)
  .length;

const ask = (reason) => Object.freeze({ verdict: 'ask', reason });
const trip = (kind, detail) => Object.freeze({ verdict: 'trip', kind, reason: `${TRIPS[kind]}${detail ? ` — ${detail}` : ''}` });
const covered = Object.freeze({ verdict: 'covered' });

/**
 * Does the mandate cover one post the seat staged? Pure.
 * 'covered' — it goes out with no card; 'ask' — the usual approval law;
 * 'trip' — the mandate pauses AND the post asks.
 * @param {object} mandate
 * @param {{house: string, laneId: string, entry: object, campaignCompanyId?: ?string,
 *   accountCompanyId?: ?string, entries: object[], now?: Date}} act
 */
export const coverPost = (mandate, { house, laneId, entry, campaignCompanyId = null, accountCompanyId = null, entries, now = new Date() }) => {
  if (mandateStanding(mandate, now) !== 'active') return ask('no mandate stands');
  if (mandate.house !== house) return trip('cross-house', `the act belongs to ${house || 'no house'}`);
  if (mandate.laneId !== laneId) return ask('the mandate is the CMO seat\'s, not this lane\'s');
  const isReply = entry.kind === 'reply';
  if (isReply ? !mandate.acts.replies : !mandate.acts.posts) return ask(isReply ? 'replies are not in the mandate' : 'posts are not in the mandate');
  if (entry.kind === 'self-reply') return ask('thread follow-ups still ask');
  if (PER_POST_CONSENT_CHANNELS.includes(entry.channelId)) return ask(`${entry.channelId} asks for your yes on every post`);
  if (isReply && !REPLY_CHANNELS.includes(entry.channelId)) return ask('replies ride X alone');
  if (campaignCompanyId && accountCompanyId && campaignCompanyId !== accountCompanyId
    && (mandate.companies.includes(campaignCompanyId) || mandate.companies.includes(accountCompanyId))) {
    return trip('cross-company', `a ${campaignCompanyId} campaign on a ${accountCompanyId} account`);
  }
  const account = mandate.accounts.find((a) => a.id === entry.accountId);
  if (!account) return ask(`${entry.accountId} is not in the mandate`);
  const moment = sendMomentOf(entry, now);
  if (mandate.expiresAt && Date.parse(moment) >= Date.parse(mandate.expiresAt)) return ask('it goes out after the mandate ends');
  const day = paceDay(moment, mandate.timeZone);
  const pace = isReply ? mandate.replyPace : account.pace;
  const standing = paceCount(entries, { mandateId: mandate.id, accountId: account.id, day, timeZone: mandate.timeZone, replies: isReply });
  if (standing >= pace) return trip('pace', `${account.id} already has ${standing} of ${pace} ${isReply ? 'replies' : 'posts'} on ${day}`);
  return covered;
};

/** Does the mandate cover a render by this lane? Pure. */
export const coverRender = (mandate, { house, laneId, now = new Date() }) => {
  if (mandateStanding(mandate, now) !== 'active') return ask('no mandate stands');
  if (mandate.house !== house || mandate.laneId !== laneId) return ask('the mandate is another seat\'s');
  return mandate.acts.renders ? covered : ask('renders are not in the mandate');
};

/** Does a legal flag of this severity pause the mandate? Pure. */
export const legalTrips = (mandate, severity) =>
  Boolean(severity) && (SEVERITY_RANK[severity] || 0) >= (SEVERITY_RANK[mandate?.legalPauseAt || DEFAULT_LEGAL_PAUSE_AT] || 3);

// What a platform says when it refuses a post as spam or automation (X's
// […], duplicate-content refusals, account
// restrictions). A network error or an expired key is not this.
const SPAM_REFUSAL = /\b(spam|automated|duplicate content|suspended|restricted|locked|abusive|platform manipulation)\b/i;

/** Did the platform refuse this post as spam? Pure. */
export const isSpamRefusal = (outcome) => Boolean(outcome && !outcome.ok && !outcome.pending && SPAM_REFUSAL.test(String(outcome.detail || '')));

const listWords = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** The day a mandate ends, in plain words. Pure. */
export const termWords = (mandate) => (mandate.expiresAt
  ? `until it turns itself off on ${new Date(mandate.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: mandate.timeZone })}`
  : 'until you withdraw it');

/**
 * The mandate in plain words, for the person granting or holding it (CHOKKAN).
 * @param {object} mandate
 * @param {{seatName?: string}} [opts]
 * @returns {string[]} one sentence per line
 */
export const plainWords = (mandate, { seatName = 'Your CMO' } = {}) => {
  const where = mandate.accounts.map((a) => `${a.id} (${a.pace} a day)`);
  const does = [
    mandate.acts.posts ? `post on ${listWords(where)}` : null,
    mandate.acts.renders ? 'make images and videos' : null,
    mandate.acts.replies ? `answer replies on X (${mandate.replyPace} a day)` : null,
  ].filter(Boolean);
  return [
    `${seatName} may ${listWords(does)} without asking you, ${termWords(mandate)}.`,
    mandate.acts.replies ? null : 'Replies still ask you.',
    'Everything it does shows in DONE FOR YOU as it happens.',
    'It pauses and asks you if a post goes past the pace, makes a serious legal claim, is refused as spam, crosses companies, or anything tries to change the mandate.',
    HOLD_WORDS,
    'WITHDRAW ends it at once: posts not yet sent are cancelled, and it is told plainly.',
  ].filter(Boolean);
};
