// tiktok-errors.js — every refusal TikTok can give, in plain words. Pure.
//
// TikTok answers its Content Posting API with `{data, error: {code, message,
// log_id}}`, where `code` is `ok` on success — sometimes with HTTP 200 even
// when it refuses (creator_info's spam-risk codes). Its OAuth token endpoint
// answers `{error, error_description, log_id}`. A publish that TikTok
// accepted and then dropped names a `fail_reason` in its status.
//
// Codes are TikTok's own (developers.tiktok.com: Direct Post, Upload,
// Query Creator Info, Get Post Status and token management references,
// read 2026-10-23).

/** Where the operator reconnects; named in every refusal that needs it. */
export const RECONNECT = 'reconnect TikTok in Settings → API → Channel keys (CONNECT)';

/** The one sentence an unaudited app's operator must hear. */
export const PRIVATE_UNTIL_REVIEW = 'TikTok keeps posts private until the app passes its review';

const NOTHING = 'nothing was published';

const CODE_WORDS = Object.freeze({
  spam_risk_too_many_posts: `this TikTok account has reached its posting limit for today (about 15 posts a day across every app); ${NOTHING}. Try again tomorrow`,
  spam_risk_user_banned_from_posting: `TikTok has blocked this account from posting for now; check the account in the TikTok app. ${NOTHING}`,
  reached_active_user_cap: `this TikTok app has reached its limit of accounts posting today (an app that has not passed TikTok's review allows 5 a day); ${NOTHING}. Try again tomorrow`,
  unaudited_client_can_only_post_to_private_accounts: `${PRIVATE_UNTIL_REVIEW}: choose "Only me" on the post's card, and set the TikTok account itself to private in the TikTok app. ${NOTHING}`,
  privacy_level_option_mismatch: `TikTok refused the privacy level: this account does not offer it. ${NOTHING}`,
  url_ownership_unverified: 'TikTok photo posts need a verified domain; coming later',
  spam_risk_too_many_pending_share: `TikTok holds at most 5 drafts waiting in this account's inbox a day; finish or delete them in the TikTok app, then try again. ${NOTHING}`,
  access_token_invalid: `the TikTok sign-in has expired or was removed; ${RECONNECT}`,
  scope_not_authorized: `the TikTok connection does not allow posting; ${RECONNECT} and allow every permission`,
  rate_limit_exceeded: `TikTok asked to slow down (it allows 6 posts a minute per account); ${NOTHING}. Try again in a minute`,
});

/** The codes after which only a new sign-in helps. */
const RECONNECT_CODES = new Set(['access_token_invalid', 'scope_not_authorized']);

/**
 * A Content Posting API refusal in plain words. Pure.
 * @param {number} status - the HTTP status
 * @param {object} body - `{error: {code, message}}`
 * @returns {{detail: string, code: string|null, reconnect: boolean}}
 */
export const mapTikTokError = (status, body) => {
  const code = typeof body?.error?.code === 'string' ? body.error.code : null;
  if (code && CODE_WORDS[code]) return { detail: CODE_WORDS[code], code, reconnect: RECONNECT_CODES.has(code) };
  if (status === 401) return { detail: CODE_WORDS.access_token_invalid, code: code || 'access_token_invalid', reconnect: true };
  if (status === 429) return { detail: CODE_WORDS.rate_limit_exceeded, code: code || 'rate_limit_exceeded', reconnect: false };
  const said = body?.error?.message || code || `HTTP ${status}`;
  return { detail: `TikTok refused the post (${said}); ${NOTHING}`, code, reconnect: false };
};

/**
 * A TikTok token-endpoint refusal in plain words. Pure.
 * @param {number} status
 * @param {object} body - `{error, error_description}`
 * @returns {{detail: string, reconnect: boolean}}
 */
export const mapTikTokTokenError = (status, body) => {
  const code = body?.error;
  if (code === 'invalid_grant') {
    return { reconnect: true, detail: `the TikTok sign-in has expired or was removed; ${RECONNECT}` };
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return { reconnect: true, detail: `TikTok does not accept the client key or client secret; check both (a sandbox has its own pair), save, then ${RECONNECT}` };
  }
  return { reconnect: false, detail: `TikTok's sign-in service refused (${body?.error_description || code || `HTTP ${status}`})` };
};

const FAIL_WORDS = Object.freeze({
  duration_check_failed: 'TikTok refused the video\'s length: it is too long or too short for this account',
  file_format_check_failed: 'TikTok refused the video file: use an MP4 (H.264) or WebM video',
  frame_rate_check_failed: 'TikTok refused the frame rate: it takes 23 to 60 frames a second',
  picture_size_check_failed: 'TikTok refused the picture size: each side must be 360 to 4096 pixels',
  spam_risk_too_many_posts: CODE_WORDS.spam_risk_too_many_posts,
  spam_risk_user_banned_from_posting: CODE_WORDS.spam_risk_user_banned_from_posting,
  spam_risk_text: 'TikTok flagged the caption as a spam risk; change the words and try again',
  spam_risk: 'TikTok flagged this post as a spam risk',
  publish_cancelled: 'the post was cancelled on TikTok before it published',
  auth_removed: `the TikTok account removed this app's access; ${RECONNECT}`,
  internal: 'TikTok failed on its side while processing the video; try again later',
});

/**
 * Why TikTok dropped a publish it had accepted, in plain words. Pure.
 * @param {string} reason - the status fetch's `fail_reason`
 * @returns {string}
 */
export const failReasonWords = (reason) => {
  const words = FAIL_WORDS[reason] || `TikTok did not publish the video (${reason || 'no reason given'})`;
  return words.includes(NOTHING) ? words : `${words}; ${NOTHING}`;
};
