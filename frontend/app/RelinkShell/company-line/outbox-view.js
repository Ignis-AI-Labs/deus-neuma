// outbox-view.js — how the outbox reads: the emails the sales seat staged, waiting for the operator. Pure.

/** The outbox's own line: what waits, what went, what came back. */
export const outboxStats = (drafts = []) => {
  const n = (state) => drafts.filter((d) => d.state === state).length;
  return [n('waiting') ? { text: `${n('waiting')} TO REVIEW`, tone: 'alert' } : { text: 'NOTHING WAITS', tone: 'on' }, `${n('sent')} SENT`, ...(n('uncertain') ? [{ text: `${n('uncertain')} MAYBE SENT`, tone: 'alert' }] : []), ...(n('returned') ? [`${n('returned')} RETURNED TO FIX`] : [])];
};

/** The emails that wait, oldest first (the order they were written in). */
export const waitingDrafts = (drafts = []) => drafts.filter((d) => d.state === 'waiting').slice().reverse();

/** Who an email is for, in words: the lead's name when the address is a lead's, with the campaign it is tied to. */
export const draftFor = (draft, leads = []) => {
  const lead = leads.find((l) => draft.to.includes(String(l.contact).toLowerCase()));
  return { name: lead?.name ?? draft.to.join(', '), campaign: lead?.origin?.campaign ?? null, audience: lead?.origin?.audience ?? null };
};

/** How many words an email runs to (a first email is short). */
export const wordCount = (text) => (String(text ?? '').trim().match(/\S+/g) ?? []).length;

/** Whether the operator's change to an email is worth saving: something changed, and it is still an email. */
export const editReady = (edit, draft) => Boolean(edit) && edit.subject.trim().length > 0 && edit.text.trim().length >= 20 && (edit.subject.trim() !== draft.subject || edit.text.trim() !== draft.text);

// A batch of emails being sent (Design note, 2026-11-19: […]). The desk sends them one at a time
// (use-lead-engine.js), so each row says where it stands as it changes: WAITING, SENDING…, SENT, or NOT SENT.
export const SEND_STATE_WORDS = Object.freeze({ queued: 'WAITING', sending: 'SENDING…', sent: 'SENT', refused: 'NOT SENT' });

/**
 * pure — where a batch stands: each email's state, the counts, and one line saying it.
 * @param {?{ids: string[], results: Object<string, {state: 'sent'|'refused', reason?: string}>, current: ?string, done?: boolean, stopped?: boolean}} sending
 */
export const sendingView = (sending) => {
  if (!sending?.ids?.length) return null;
  const stateOf = (id) => sending.results?.[id]?.state ?? (sending.current === id ? 'sending' : 'queued');
  const states = sending.ids.map(stateOf);
  const count = (s) => states.filter((x) => x === s).length;
  const [sent, refused, queued] = [count('sent'), count('refused'), count('queued')];
  const total = sending.ids.length;
  const notSent = refused ? ` · ${refused} NOT SENT` : '';
  const words = !sending.done
    ? `SENDING ${Math.min(total, sent + refused + 1)} OF ${total} · ${sent} SENT · ${queued} WAITING${notSent}`
    : sending.stopped && queued
      ? `STOPPED · ${sent} OF ${total} SENT${notSent}${queued ? ` · ${queued} STILL WAIT IN THE OUTBOX` : ''}`
      : `DONE · ${sent} OF ${total} SENT${notSent}`;
  return { total, sent, refused, queued, done: Boolean(sending.done), running: !sending.done, share: total ? (sent + refused) / total : 0, words, stateOf };
};

// What an address's check said (address-check.js), in the operator's words, and whether it is fine to send to.
// unknown: the database could not confirm it — its server did not answer, or (Apollo) it would not say.
export const CHECK_WORDS = Object.freeze({
  valid: ['VALID', 'on'], invalid: ['WILL BOUNCE', 'alert'], disposable: ['THROWAWAY — WILL NOT BE SENT', 'alert'],
  accept_all: ['RISKY — ITS SERVER TAKES ANY ADDRESS', null], webmail: ['PERSONAL MAILBOX — NOT CONFIRMED', null], unknown: ['RISKY — NOT CONFIRMED', null],
});
const ANSWER_WORDS = Object.freeze({ valid: 'valid', invalid: 'will bounce', disposable: 'a throwaway address', accept_all: 'its server takes any address', webmail: 'a personal mailbox it does not confirm', unknown: 'could not confirm it' });

/** The check on record for an email's address (the first of its addresses that has one). */
export const checkOf = (checks, d) => (d.to ?? []).map((a) => checks?.[String(a).toLowerCase()]).find(Boolean) ?? null;

/** Is this address confirmed by a LIVE check (what a first email needs at send, without SEND ANYWAY). */
export const isConfirmedLive = (check) => Boolean(check && check.status === 'valid' && check.live !== false && !check.settled);

/** The attached databases that have not checked this address yet. */
export const missingCheckers = (check, checkers = []) => {
  const asked = check?.checkedBy ?? (check?.checker ? [check.checker] : []);
  return checkers.filter((name) => !asked.includes(name));
};

/**
 * One ADDRESS CHECK cell: what the checks add up to, and how many databases confirmed the address (Design note, 2026-11-19:
 * […]); the hover names each database's answer, and those not asked yet.
 * @returns {{words: string, tone: ?string, title: string}}
 */
export const checkCell = (check, checkers = []) => {
  if (!check) return { words: 'NOT CHECKED YET', tone: null, title: 'Checked when you send it — or now, with CHECK ADDRESSES' };
  // ON A PROVIDER'S RECORD ONLY (address-verdict.js): "verified" from its own records, never asked live — a live check
  // outranks it (2026-11-19, one such address hard-bounced).
  if (check.live === false && !check.settled) return { words: 'VALID ON A PROVIDER\'S RECORD — NOT CHECKED LIVE', tone: null, title: `${(check.foundBy ?? [check.checker]).join(', ')} gave it as verified from its own records; no live check has answered. CHECK ADDRESSES asks one now — a first email waits for it.` };
  // SETTLED (address-confirm.js): every database asked, the person looked for, nothing confirmed — said once, for good.
  if (check.settled) return { words: check.settled.outcome === 'will-bounce' ? 'WILL BOUNCE — NO OTHER ADDRESS FOUND' : 'NO DATABASE CAN CONFIRM', tone: 'alert', title: settledTitle(check.settled) };
  const [word, tone] = CHECK_WORDS[check.status] ?? [String(check.status).toUpperCase(), null];
  const confirmedBy = check.confirmedBy ?? (check.status === 'valid' ? [check.checker] : []);
  const confirmed = confirmedBy.length;
  const every = confirmed > 1 && checkers.length > 1 && missingCheckers(check, checkers).length === 0 && confirmed === checkers.length;
  // VALID counts the databases that confirmed it; a verdict the others disagree with names who said valid.
  const count = check.status === 'valid' ? ` · ${every ? 'ALL ' : ''}${confirmed} DATABASE${confirmed === 1 ? '' : 'S'}`
    : confirmed ? ` · ${confirmedBy.join(' + ').toUpperCase()} SAID VALID` : '';
  const said = (check.checks ?? [{ checker: check.checker, status: check.status, at: check.at }])
    .map((c) => `${c.checker}: ${c.found ? 'verified it when it found the address' : ANSWER_WORDS[c.status] ?? c.status} (${String(c.at ?? '').slice(0, 10)})`);
  const unasked = missingCheckers(check, checkers).map((name) => `${name}: not asked yet — CHECK WITH EVERY DATABASE asks it`);
  return { words: `${word}${count}`, tone, title: [...said, ...unasked].join('\n') };
};

/** The answers that send but do not confirm, and the ones that will bounce: what FIND CONFIRMED ADDRESSES is for. */
export const TO_CONFIRM = Object.freeze(['unknown', 'accept_all', 'webmail', 'invalid', 'disposable']);
/** Does this email's address still want confirming: checked, not confirmed, and not settled. */
export const wantsConfirming = (check) => Boolean(check && TO_CONFIRM.includes(check.status) && !check.settled);

const list = (xs) => (xs?.length ? xs.join(', ') : 'none');
/** The hover of a settled address: who was asked, what was tried, and what is left to decide. */
export const settledTitle = (s) => [
  `Settled ${String(s.at ?? '').slice(0, 10)}: asked ${list(s.checkedBy)}${(s.findersAsked ?? []).length ? `; looked for the person with ${list(s.findersAsked)}${(s.tried ?? []).length ? ` (found ${s.tried.join(', ')}, not confirmed either)` : ' (no other address)'}` : ''}.`,
  ...(s.why ? [s.why] : []),
  'Nobody asks again. Send it as it is, or write to someone else at the company.',
].join('\n');
