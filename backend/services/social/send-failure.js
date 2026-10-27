// send-failure — why a post did not send, read as the fix it needs (MARKETING
// show-dont-tell-audit.md, finding 29: […]):
//
//   locked    the house's keys file can't be opened       → its Channel keys row (LOCKED); TRY AGAIN once open
//   keys      the platform refused the account's keys     → that account's Channel keys row
//   retry     the platform stumbled and nothing went out  → TRY AGAIN (the operator's own press)
//   content   the platform refused the words or media     → REVISE
//   standing  the house's own law held it (holder, crew)   → the platform's STANDING
//   other     anything else                                → the card, as it was
//
// Read from what the record already keeps: the platform's HTTP status when
// the poster had one (`errorStatus`), else the words of `error`.
//
// TRY AGAIN is offered only where nothing went out: the platform ANSWERED
// with a passing error (408, 429, 5xx), the reconciler proved the copy is not
// live, or the operator interrupted it before publishing. A send whose
// outcome is unknown (a dropped connection, a publish nobody confirmed) is
// never offered it: a second try there could post the same thing twice.
// A post held for its keys (`locked`, `keys`) went nowhere either — the
// platform refused it, or was never called — so once the keys are fixed it
// may go back to the operator's decision too (canTryAgain).
//
// Pure.

export const SEND_FAILURE = Object.freeze({ locked: 'locked', keys: 'keys', retry: 'retry', content: 'content', standing: 'standing', other: 'other' });

// account-store.js LOCKED_SEND_DETAIL's words.
const LOCKED_WORDS = /keys file can't be opened/i;
const STANDING_WORDS = /no longer on the crew|has no holder/i;
const CONTENT_WORDS = /\b(spam|automated|duplicate|too long|policy|violat\w*|not allowed to create|sensitive|inappropriate)\b|media refused/i;
const KEYS_WORDS = /credentials are not configured|unauthori[sz]ed|invalid (access )?token|token (has )?expired|expired token|could not authenticate|authentication|invalid_grant|bad credentials/i;
const UNSURE_WORDS = /outcome (is )?unknown|could not be confirmed/i;
const RETRY_WORDS = /\bHTTP (408|429|5\d\d)\b|service unavailable|internal server error|bad gateway|gateway time-?out|over capacity|too many requests|rate limit|try again later|lost mid-flight|interrupted by your operator before publishing/i;

// pure — the platform's status, as recorded or as the words carry it (`HTTP 503`).
const statusOf = (entry) => {
  if (Number.isInteger(entry.errorStatus)) return entry.errorStatus;
  const m = /\bHTTP (\d{3})\b/.exec(String(entry.error || ''));
  return m ? Number(m[1]) : null;
};

/**
 * Why a failed post did not send. Pure.
 * @param {?{status: string, error?: string, errorStatus?: number}} entry - a queue entry
 * @returns {?('locked'|'keys'|'retry'|'content'|'standing'|'other')} null when the post did not fail
 */
export const sendFailureCause = (entry) => {
  if (entry?.status !== 'failed') return null;
  const words = String(entry.error || '');
  const status = statusOf(entry);
  if (LOCKED_WORDS.test(words)) return SEND_FAILURE.locked;
  if (STANDING_WORDS.test(words)) return SEND_FAILURE.standing;
  if (CONTENT_WORDS.test(words)) return SEND_FAILURE.content;
  if (status === 401 || status === 403 || KEYS_WORDS.test(words)) return SEND_FAILURE.keys;
  if (UNSURE_WORDS.test(words)) return SEND_FAILURE.other;
  if (status === 408 || status === 429 || (status >= 500 && status <= 599) || RETRY_WORDS.test(words)) return SEND_FAILURE.retry;
  return SEND_FAILURE.other;
};

/**
 * Whether a failed post may go back to the operator's decision (TRY AGAIN):
 * nothing of it went out — the platform stumbled, refused its keys, or was
 * never called. Pure.
 */
export const canTryAgain = (entry) => [SEND_FAILURE.retry, SEND_FAILURE.locked, SEND_FAILURE.keys].includes(sendFailureCause(entry));
