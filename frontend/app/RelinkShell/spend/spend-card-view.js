// spend-card-view.js — how a SPEND card reads (#586). Pure.
//
// CHOKKAN: the card's one decision is plain — who asks, for what, how much,
// to whom, from where, and how long is left; the next step (SIGN & APPROVE
// or DENY) stands plainest, and depth (the limits, the Quaestor's reasons)
// stays in view, never behind a press. Amounts are shown exactly as the
// backend computed them in wei — never rounded here.

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Time left before the request expires: 23H 12M LEFT, 9M LEFT, EXPIRED.
 * @param {number} secondsLeft
 */
export const timeLeftLabel = (secondsLeft) => {
  const s = Math.floor(Number(secondsLeft));
  if (!Number.isFinite(s) || s <= 0) return 'EXPIRED';
  if (s < MINUTE) return 'UNDER A MINUTE LEFT';
  if (s < HOUR) return `${Math.floor(s / MINUTE)}M LEFT`;
  const m = Math.floor((s % HOUR) / MINUTE);
  return `${Math.floor(s / HOUR)}H${m ? ` ${m}M` : ''} LEFT`;
};

/** Under an hour left: the card says so louder. */
export const isClosing = (secondsLeft) => Number(secondsLeft) > 0 && Number(secondsLeft) < HOUR;

/** The seconds left now, from the card's read and the time since. */
export const secondsLeftAt = (card, readAtMs, nowMs) => Math.max(0, Number(card?.secondsLeft || 0) - Math.floor((nowMs - readAtMs) / 1000));

/** Who asks, by name. */
export const askerLabel = (card) => (card?.who?.name || card?.neumaId || 'A BEING').toUpperCase();

/**
 * The recipient's standing, in plain words: whether the operator approved
 * it (and when), and the first-time warning.
 * @param {object} recipient
 * @returns {{standing: string, warning: ?string}}
 */
export const recipientLines = (recipient) => ({
  standing: recipient?.standing === 'approved'
    ? `ON YOUR APPROVED LIST${recipient.label ? ` AS "${recipient.label}"` : ''}${recipient.approvedAt ? ` SINCE ${String(recipient.approvedAt).slice(0, 10)}` : ''}`
    : 'NO LONGER ON YOUR APPROVED LIST — APPROVING WILL BE REFUSED',
  warning: recipient?.firstTime
    ? 'FIRST TIME — this being has never sent money to this address. Check it is the one you meant.'
    : null,
});

/**
 * The wallet the money leaves and what it holds after — exact, before the
 * network fee; unread when the chain did not answer.
 * @param {object} from
 */
export const fromLine = (from) => {
  if (!from?.address) return 'NO WALLET FOUND FOR THIS BEING';
  if (from.balanceEth === null) return 'BALANCE UNREAD — THE CHAIN DID NOT ANSWER';
  return from.short
    ? `HOLDS ${from.balanceEth} ETH — NOT ENOUGH FOR THIS AMOUNT`
    : `HOLDS ${from.balanceEth} ETH · ${from.balanceAfterEth} ETH AFTER (BEFORE THE NETWORK FEE)`;
};

/** The limits that hold, in one line. */
export const limitsLine = (limits) => (Number(limits?.thresholdEth) > 0
  ? `IT MAY SEND UP TO ${limits.thresholdEth} ETH WITHOUT YOU (NEVER OVER ${limits.capEth} ETH A SEND). THIS ONE IS ABOVE THAT: IT GOES OUT ONLY ON YOUR SIGNATURE, FOR EXACTLY THIS AMOUNT.`
  : 'EVERY SEND FROM THIS BEING NEEDS YOUR SIGNATURE. THIS ONE GOES OUT ONLY ON IT, FOR EXACTLY THIS AMOUNT.');

/**
 * The Quaestor's word on this spend, or why there is none.
 * @param {?object} review
 * @param {boolean} seated - does the house seat a Quaestor?
 */
export const reviewLine = (review, seated) => {
  if (review) return { mark: review.recommend === 'approve' ? 'RECOMMENDS APPROVE' : 'RECOMMENDS DENY', reasons: review.reasons || '' };
  return { mark: seated ? 'NOT YET REVIEWED' : 'NO QUAESTOR SEATED — NOBODY REVIEWED THIS', reasons: '' };
};

/** May SIGN & APPROVE be pressed? A password typed, time left, and nothing that would refuse it. */
export const mayApprove = (card, password, secondsLeft) => Boolean(card?.amountValid)
  && secondsLeft > 0 && card?.recipient?.standing === 'approved' && !card?.from?.short && typeof password === 'string' && password.length > 0;
