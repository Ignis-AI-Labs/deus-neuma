// account-setup — how to get a platform's keys, in the platform's own words, beside its accounts.
// Design note, 2026-11-11: […], and on X: […].
// Pure data and pure readers; AccountsList renders it folded (fine print folds: a one-line summary,
// the steps one press away).

/** @type {Readonly<Record<string, {summary: string, steps: ReadonlyArray<string>}>>} */
export const ACCOUNT_SETUP = Object.freeze({
  x: Object.freeze({
    summary: 'Every X account needs its own developer app, set to Read and write.',
    steps: Object.freeze([
      'Sign in to developer.x.com as the account you are adding, and open (or create) its app.',
      'User authentication settings → Set up: App permissions "Read and write" (with Direct message if the account answers DMs). Type of App: Web App, Automated App or Bot (Native App works too). Callback URI and Website URL: your own site\'s https:// address — the callback is required but never used. Save.',
      'Keys and tokens → Consumer Key: reveal it, and paste the Consumer Key and its Secret on this account\'s row (THIS ACCOUNT HAS ITS OWN APP for an added account).',
      'Keys and tokens → Access Token: Regenerate. It must say "Read and Write" — a token made before the permission changed stays read-only. Paste the Access Token and its Secret.',
      'SAVE KEYS. PROVEN names the account when X accepts all four keys.',
    ]),
  }),
});

/**
 * pure — what a failed proof means in plain words, where the platform's own answer is terse; null
 * when the answer already says it. X answers 401 to keys that do not belong together.
 * @param {string} channelId
 * @param {?{ok?: boolean, status?: number}} test
 */
export const flightHint = (channelId, test) => {
  if (channelId === 'x' && test?.ok === false && test.status === 401) {
    return 'X refused these keys: the Access Token must come from this account\'s own app (the Consumer Key above), made after the app was set to Read and write.';
  }
  return null;
};
