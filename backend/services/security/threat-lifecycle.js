// Threat lifecycle — how the WATCH itself moves a ledger entry, apart from
// the CSO's verdicts: what a scan no longer sees is settled, what returns is
// reopened, and a re-seen finding's description stays current.
//
// The ruling, 2026-10-19: […] Before this, the ledger only
// ever added: a listener gone since August still read `new`, so the open
// count stopped meaning anything and the real threats drowned in it.
//
// The watch's authority is narrow by design. It settles only what it can
// measure — an open entry inside a scope the scan read WHOLE.
//
// A VERDICT IS VERIFIED, NOT TRUSTED (Design note, 2026-10-19: the CSO must address
// threats […]). `mitigated` is a CLAIM the next whole
// scan of its scope checks: still seen → the watch reopens it and says whose
// claim the scan contradicted; gone → a `verified` row and a `verifiedAt`
// stamp, so a settled entry shows it was proven, not just said. A leaked
// secret never leaves the history, so for one the measure is whether its
// value is still LIVE in the checkout's env files (leak-liveness.js), not
// whether it is still seen. `not_affected` stays a judgement the watch never
// reopens — its evidence rides the verdict (verdict-evidence.js).
//
// Every function here mutates the entry it is handed and runs inside the
// ledger's mutate lock (the same posture as applyVerdict); none does IO.

const WATCH_ACTOR = 'watch';

// Unsettled: the threat still stands for somebody (`confirmed` is real and
// owed to the fix pipeline; `needs_operator` waits on a human).
const OPEN_STATUSES = Object.freeze(['new', 'confirmed', 'needs_operator']);

export const SUMMARY_MAX = 2000;
export const REMEDY_MAX = 1000;

const SEVERITY_RANK = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, unknown: 4 });
const LOUD = Object.freeze(['critical', 'high']);

// The history row's `event` marks what the WATCH did, so […] never rests on `assessedBy` alone — a CSO lane id is free
// text and could be spelled `watch`.
const EVENT = Object.freeze({
  vanished: 'vanished', reopened: 'reopened', severity: 'severity', verified: 'verified', fixFiled: 'fix-filed',
});

// pure — a (source, repo-or-host) scope as one comparable string.
export const scopeKey = ({ source, repo }) => `${source}::${repo || ''}`;

// pure — is this entry still standing?
const isOpen = (entry) => OPEN_STATUSES.includes(entry?.status);

// pure — rank for ordering; anything unrecognised sorts with `unknown`.
const rankOf = (severity) => SEVERITY_RANK[severity] ?? SEVERITY_RANK.unknown;

// pure — comparator: critical first, then the newest finding first.
export const bySeverityThenNewest = (a, b) =>
  (rankOf(a.severity) - rankOf(b.severity))
  || ((Date.parse(b.ingestedAt) || 0) - (Date.parse(a.ingestedAt) || 0));

// pure — did the watch, and only the watch, settle this entry last?
const isWatchClosed = (entry) => {
  if (entry?.status !== 'mitigated' || !Array.isArray(entry.history)) return false;
  return entry.history[entry.history.length - 1]?.event === EVENT.vanished;
};

// pure — a `mitigated` someone CLAIMED (the CSO, the operator), as opposed
// to one the watch itself closed.
const isClaimed = (entry) => entry?.status === 'mitigated' && !isWatchClosed(entry);

// pure — has the claim standing now not yet been proven by a scan? A new
// claim is newer than any earlier verification.
const awaitsVerification = (entry) => !entry.verifiedAt || entry.verifiedAt < (entry.assessedAt || '');

// pure — […], for the rows that answer a claim.
const claimOf = (entry) => `mitigation claimed by ${entry.assessedBy || 'an unrecorded hand'} at ${entry.assessedAt || 'an unrecorded time'}`;

// Append one record to the entry's history; entries written before history
// existed start their record here.
const appendHistory = (entry, row) => {
  entry.history = [...(Array.isArray(entry.history) ? entry.history : []), row];
};

// One watch row, in the verdict shape the desk already renders.
const watchRow = (entry, event, assessment, at, extra = {}) => ({
  event,
  status: entry.status,
  assessment,
  surfaces: entry.surfaces,
  assessedBy: WATCH_ACTOR,
  assessedAt: at,
  githubIssue: entry.githubIssue ?? null,
  ...extra,
});

// The watch puts an entry back to `new`, saying why in its history.
const reopenByWatch = (entry, why, at, extra = {}) => {
  entry.status = 'new';
  entry.assessment = null;
  entry.assessedAt = null;
  entry.assessedBy = null;
  entry.verifiedAt = null;
  appendHistory(entry, watchRow(entry, EVENT.reopened, why, at, extra));
};

// The watch proves a claim: the stamp, and the row that says how.
const verifyClaim = (entry, how, at) => {
  entry.verifiedAt = at;
  appendHistory(entry, watchRow(entry, EVENT.verified, how, at, { claimedBy: entry.assessedBy, claimedAt: entry.assessedAt }));
};

/**
 * A re-seen finding: refresh what the scan now says about it, and reopen it
 * if the watch had closed it — or if it was CLAIMED mitigated and this whole
 * scan still sees it (a leak: still sees its value live). A claimed leak whose
 * value is no longer live is verified instead. Severity, title, summary and `affected` were
 * frozen at first ingest before this — an advisory re-rated critical kept
 * reading medium forever. A finding that arrives with severity `unknown`
 * (OSV's detail fetch failed) carries no fresh description, so it never
 * erases a known one.
 * @param {{whole?: boolean}} [opts] whole — the finding's scope was read whole,
 *   so a claim may be judged by it
 * @returns {{reopened: boolean, escalated: boolean, verified: boolean}}
 */
export const refreshSeen = (entry, finding, at, { whole = false } = {}) => {
  entry.lastSeenAt = at;
  let reopened = false;
  let escalated = false;
  let verified = false;
  // A leak's finding carries `live`: it stands while its value is live, and
  // null means liveness could not be measured, so nothing is judged.
  const stands = finding.live === undefined ? true : finding.live;
  if (isWatchClosed(entry)) {
    reopenByWatch(entry, `seen again by the ${finding.source} scan at ${at} — reopened`, at);
    reopened = true;
  } else if (whole && isClaimed(entry) && stands === true) {
    const still = finding.liveAs ? `still sees it live as ${finding.liveAs}` : 'still sees it';
    reopenByWatch(entry, `${claimOf(entry)}, but the ${finding.source} scan ${still} (${at}) — reopened`, at, { claimedBy: entry.assessedBy, claimedAt: entry.assessedAt });
    reopened = true;
  } else if (whole && isClaimed(entry) && stands === false && awaitsVerification(entry)) {
    verifyClaim(entry, `verified not live by the ${finding.source} scan at ${at} — no env file of this checkout holds the value; the history still carries it, as expected: a leak is fixed by rotation, not erasure`, at);
    verified = true;
  }
  if (Array.isArray(finding.affected)) entry.affected = finding.affected;
  if (typeof finding.shipped === 'boolean') entry.shipped = finding.shipped;
  const severity = finding.severity || 'unknown';
  if (severity === 'unknown' && entry.severity !== 'unknown') return { reopened, escalated, verified };
  entry.title = finding.title.trim();
  if (finding.summary !== undefined) entry.summary = String(finding.summary || '').slice(0, SUMMARY_MAX);
  if (finding.remedy) entry.remedy = String(finding.remedy).slice(0, REMEDY_MAX);
  if (severity !== entry.severity) {
    const from = entry.severity;
    entry.severity = severity;
    appendHistory(entry, watchRow(entry, EVENT.severity, `severity ${from} → ${severity}, as the ${finding.source} scan reported at ${at}`, at, { from, to: severity }));
    escalated = isOpen(entry) && LOUD.includes(severity) && rankOf(severity) < rankOf(from);
  }
  return { reopened, escalated, verified };
};

/**
 * Settle every open entry of a fully-scanned scope that this scan did not
 * surface. Scopes that errored are simply absent from `scanned`, so a blind
 * leg closes nothing.
 * @param {Array<Object>} entries the whole ledger
 * @param {{scanned: Set<string>, seenKeys: Set<string>, keyOf: (e: Object) => string, at: string}} opts
 *   scanned — scopeKey()s the scan read whole; seenKeys — threat keys it surfaced
 * @returns {Array<Object>} the entries the watch closed
 */
export const settleVanished = (entries, { scanned, seenKeys, keyOf, at }) => {
  const closed = [];
  for (const entry of entries) {
    if (!isOpen(entry) || !scanned.has(scopeKey(entry)) || seenKeys.has(keyOf(entry))) continue;
    entry.status = 'mitigated';
    entry.assessment = `no longer seen by the ${entry.source} scan at ${at}`;
    entry.assessedAt = at;
    entry.assessedBy = WATCH_ACTOR;
    appendHistory(entry, watchRow(entry, EVENT.vanished, entry.assessment, at));
    closed.push(entry);
  }
  return closed;
};

/**
 * Prove every claimed `mitigated` of a fully-scanned scope that this scan no
 * longer surfaces — once per claim (a later claim is proven afresh).
 * @param {Array<Object>} entries the whole ledger
 * @param {{scanned: Set<string>, seenKeys: Set<string>, keyOf: (e: Object) => string, at: string}} opts
 * @returns {Array<Object>} the entries verified
 */
export const verifyVanishedClaims = (entries, { scanned, seenKeys, keyOf, at }) => {
  const verified = [];
  for (const entry of entries) {
    if (!isClaimed(entry) || !awaitsVerification(entry) || !scanned.has(scopeKey(entry)) || seenKeys.has(keyOf(entry))) continue;
    verifyClaim(entry, `verified by the ${entry.source} scan at ${at} — no longer seen since the ${claimOf(entry)}`, at);
    verified.push(entry);
  }
  return verified;
};

/**
 * The CSO handed the fix to the operator's task list: the entry says so, and
 * when. Its status is untouched — the fix is owed until it is verified.
 * @param {Object} entry
 * @param {{by: string, title: string, at: string}} opts
 */
export const noteFixFiled = (entry, { by, title, at }) => {
  entry.fixFiledAt = at;
  appendHistory(entry, {
    event: EVENT.fixFiled, status: entry.status,
    assessment: `fix filed to the operator's task list by ${by} at ${at}: "${title}"`,
    surfaces: entry.surfaces, assessedBy: by, assessedAt: at, githubIssue: entry.githubIssue ?? null,
  });
};

/**
 * The operator's overturn: any settled entry back to `new`. The verdict it
 * overturns stays in the history (an entry from before history existed has
 * that verdict written there first, so it is not lost).
 * @param {Object} entry
 * @param {{by: string, note: string, at: string}} opts
 */
export const reopenEntry = (entry, { by, note, at }) => {
  const from = entry.status;
  if ((!Array.isArray(entry.history) || entry.history.length === 0) && entry.assessment) {
    appendHistory(entry, {
      status: from, assessment: entry.assessment, surfaces: entry.surfaces,
      assessedBy: entry.assessedBy, assessedAt: entry.assessedAt, githubIssue: entry.githubIssue ?? null,
    });
  }
  entry.status = 'new';
  entry.assessment = null;
  entry.assessedAt = null;
  entry.assessedBy = null;
  entry.verifiedAt = null;
  appendHistory(entry, {
    at, by, from, to: 'new', note,
    event: EVENT.reopened, status: 'new', assessment: note, assessedBy: by, assessedAt: at,
  });
};

/**
 * Open criticals whose last card is older than `everyMs` — the reminder set.
 * An entry never carded counts from its first sighting.
 * @returns {Array<Object>} most urgent first
 */
export const remindersDue = (entries, nowMs, everyMs) => entries
  .filter((e) => isOpen(e) && e.severity === 'critical')
  .filter((e) => nowMs - (Date.parse(e.alertedAt || e.ingestedAt) || 0) >= everyMs)
  .sort(bySeverityThenNewest);
