// check-rules — the HOUSE SOCIAL CHECK's verdicts, one per check, for one
// account in use (campaign plan §6.1, slice 11, approved 2026-10-24).
//
// Every check answers ONE verdict over facts the gatherer read
// (house-check-facts.js), and says it in plain words: what it found, and —
// when it is not a pass — what to do, with env names and paths only as small
// print (`detail`). A failing verdict's `fix` is data (check-fixes.js): a
// short title, the sentence, the door to the exact place, and whom in the
// house to hand it to when a member can do it. A verdict is one of:
//   pass     measured, and as it should be
//   fail     measured, and not as it should be — the fix is named
//   unknown  could not be measured this time (the reason is named); it keeps
//            the account from reading clear, because an unproven account is
//            not a clear one
//   na       does not apply to this platform, or the platform does not let
//            the check read it — said so, never counted
//
// Pure throughout.

import { TIKTOK_POSTING_SCOPES, TIKTOK_PROFILE_SCOPES, missingTikTokScopes } from '../tiktok-oauth.js';
import { linkedinExpiryNote } from '../linkedin-poster.js';
import { NATIVE_LABEL_CHANNELS, ALT_MARK, carriesDisclosure } from '../disclosure-line.js';
import {
  keysDoor, houseKeysDoor, handleDoor, brandDoor, standingDoor, queueDoor, fixOf, holderHandTo, disclosurePrompt, cmoHandTo, sitePrompt,
} from './check-fixes.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TOKEN_HEADROOM_DAYS = 7;

/** The checks, in the order a person reads them. */
export const CHECKS = Object.freeze([
  Object.freeze({ id: 'keys', label: 'Keys present' }),
  Object.freeze({ id: 'live', label: 'Answers live' }),
  Object.freeze({ id: 'right-account', label: 'The right account' }),
  Object.freeze({ id: 'company', label: 'Belongs to a company' }),
  Object.freeze({ id: 'holder', label: 'One house member holds it' }),
  Object.freeze({ id: 'crew', label: 'Its crew' }),
  Object.freeze({ id: 'scopes', label: 'Permissions granted' }),
  Object.freeze({ id: 'token', label: 'Sign-in lasts' }),
  Object.freeze({ id: 'not-shared', label: 'Keys not shared' }),
  Object.freeze({ id: 'file', label: 'Keys file locked' }),
  Object.freeze({ id: 'disclosure', label: 'AI disclosure on' }),
  Object.freeze({ id: 'site', label: 'Company site on record' }),
  Object.freeze({ id: 'quota', label: 'App limits cover the plan' }),
]);

const KEYS_PLACE = 'Settings → API → Channel keys';

const verdict = (verdictId, words, extra = {}) => ({ verdict: verdictId, words, ...extra });
const pass = (words, extra) => verdict('pass', words, extra);
const fail = (words, fix, extra) => verdict('fail', words, { fix, ...extra });
const unknown = (words, extra) => verdict('unknown', words, extra);
const na = (words) => verdict('na', words);

const handleOf = (name) => String(name || '').replace(/^@/, '').toLowerCase();

// 1 — every field the platform call needs resolves.
const keysCheck = ({ account, envNames }) => {
  if (account.configured) {
    const fromEnv = account.fields.filter((f) => f.set && f.source === 'env').map((f) => f.key);
    return pass('Every key it needs is in place.', fromEnv.length ? { detail: `served from the machine's .env: ${fromEnv.join(', ')}` } : {});
  }
  const missing = account.fields.filter((f) => !f.set);
  const connect = missing.some((f) => f.connect);
  return fail(
    `${missing.length} of its keys ${missing.length === 1 ? 'is' : 'are'} missing: ${missing.map((f) => f.label).join(', ')}.`,
    fixOf(connect ? 'Connect the account' : 'Add the keys',
      `Add them in ${KEYS_PLACE} → ${account.channelName}${connect ? ' (press CONNECT for the sign-in ones)' : ''}.`,
      keysDoor(account, { connect })),
    { detail: missing.map((f) => envNames[f.key]).filter(Boolean).join(', ') },
  );
};

// 2 — the platform accepts the keys and names an account.
const liveCheck = ({ account, probe }) => {
  if (!account.configured) return unknown('Not tried — its keys are not all in place.');
  if (!probe) return unknown('Not tried in this check — the live probe was not run.');
  if (probe.ok === true) return pass(`${account.channelName} answered${probe.account?.name ? ` as @${handleOf(probe.account.name)}` : ''}.`);
  return fail(`${account.channelName} did not accept the keys: ${String(probe.detail || 'no answer').slice(0, 160)}.`,
    fixOf('Replace the keys', `Check or replace the keys in ${KEYS_PLACE} → ${account.channelName}, then run the check again.`, keysDoor(account)),
    probe.status ? { detail: `HTTP ${probe.status}` } : {});
};

// 3 — the account that answered is the one this account is recorded to be.
const rightAccountCheck = ({ account, probe }) => {
  const expectedId = account.platformUserId ? String(account.platformUserId) : null;
  const expectedHandle = account.expectedHandle ? handleOf(account.expectedHandle) : null;
  if (!expectedId && !expectedHandle) {
    const seen = probe?.ok === true ? probe.account?.name : null;
    const connect = (account.fields || []).some((f) => f.connect);
    return fail('There is no record of which account this should be, so a swapped key would go unseen.',
      fixOf('Record the @handle',
        `Record its expected @handle in the house social check${connect ? ` (or CONNECT it again in ${KEYS_PLACE}, which records the account)` : ''}.`,
        handleDoor(account, seen)));
  }
  if (!probe || probe.ok !== true) return unknown('Not proven — the account did not answer live in this check.');
  const got = probe.account || {};
  if (expectedId && String(got.id) !== expectedId) {
    return fail(`The keys speak as a different account (${got.name ? `@${handleOf(got.name)}` : 'another id'}) than the one recorded.`,
      fixOf('Use the right account', 'Replace the keys with the right account\'s, or CONNECT it again with the right account.', keysDoor(account)),
      { detail: `recorded platform user id ${expectedId}, answered ${got.id}` });
  }
  if (expectedHandle && handleOf(got.name) !== expectedHandle) {
    return fail(`The keys speak as @${handleOf(got.name)}, not @${expectedHandle}.`,
      fixOf('Fix the keys or @handle', 'Replace the keys with the right account\'s, or correct the expected @handle if the account was renamed.',
        handleDoor(account, got.name)));
  }
  return pass(`It is ${expectedHandle ? `@${expectedHandle}` : 'the recorded account'}${expectedId ? ` (platform id ${expectedId})` : ''}.`);
};

// 4 — the account belongs to a company of this house (UNSORTED fails).
const companyCheck = ({ account, company }) => {
  if (!account.companyId) {
    return fail('It belongs to no company (UNSORTED).',
      fixOf('Pick its company', `Pick its company in ${KEYS_PLACE} → ${account.channelName}.`, keysDoor(account, { connect: false })));
  }
  if (!company) {
    return fail(`Its company "${account.companyId}" has no brand kit in this house.`,
      fixOf('Create the brand kit', `Create that company's brand kit in MARKETING → BRAND KITS, or move the account to another company in ${KEYS_PLACE}.`,
        brandDoor(null)));
  }
  return pass(`It belongs to ${company.name}.`);
};

// 5 — exactly one holder, a lane of this house, never an external.
const holderCheck = ({ account, holder, house }) => {
  if (!holder) {
    return fail('No house member holds it, so nothing can be posted through it.',
      fixOf('Seat a holder', `Seat its holder in the ${account.channelName} window (STANDING).`, standingDoor(account, 'holder')));
  }
  if (holder.external) {
    return fail(`It is held by ${holder.neumaId}, a witness — a witness may draft as crew, never hold an account.`,
      fixOf('Seat a house member', `Seat a member of this house as its holder in the ${account.channelName} window.`, standingDoor(account, 'holder')));
  }
  if (holder.house !== house) {
    return fail(`It is held by ${holder.neumaId}, which is not a lane of this house.`,
      fixOf('Seat a house member', `Release it and seat a member of this house in the ${account.channelName} window.`, standingDoor(account, 'holder')));
  }
  return pass(`Held by ${holder.neumaId}.`);
};

// 6 — every crew member is of this house, or an external working as crew.
const crewCheck = ({ account, crew, house }) => {
  if (!crew.length) return pass('No crew — its holder works it alone.');
  const astray = crew.filter((m) => !m.external && m.house !== house);
  if (astray.length) {
    return fail(`${astray.map((m) => m.neumaId).join(', ')} on its crew ${astray.length === 1 ? 'is' : 'are'} not of this house.`,
      fixOf('Release from the crew', 'Release them from the crew in the platform window.', standingDoor(account, 'crew')));
  }
  return pass(`${crew.length} on its crew${crew.some((m) => m.external) ? ` (${crew.filter((m) => m.external).length} witness worker(s))` : ''}.`);
};

// 7 — granted ⊇ needed for posting and for reading its own numbers.
const scopesCheck = ({ account, meta }) => {
  if (account.channelId !== 'tiktok') {
    return na(account.channelId === 'youtube'
      ? 'YouTube does not tell the app which permissions were granted; a missing one shows as a failed post or read.'
      : `${account.channelName} keys carry no permission list the check can read.`);
  }
  if (!account.configured) return unknown('Not read — the account is not connected.');
  const posting = missingTikTokScopes(meta.grantedScope, TIKTOK_POSTING_SCOPES);
  const reading = missingTikTokScopes(meta.grantedScope, TIKTOK_PROFILE_SCOPES);
  if (!posting.length && !reading.length) return pass('Every permission for posting and for its numbers is granted.');
  return fail(
    posting.length ? `TikTok has not granted posting (${posting.join(', ')}).` : `TikTok has not granted reading its numbers (${reading.join(', ')}).`,
    fixOf('Grant every permission', `Press RECONNECT in ${KEYS_PLACE} → TikTok and allow every permission.`, keysDoor(account, { connect: true })),
  );
};

// 8 — a sign-in that dies does so more than a week out.
const tokenCheck = ({ account, meta, now }) => {
  if (account.channelId === 'linkedin') {
    const raw = meta.tokenExpiresAt;
    if (!raw) return unknown('The token\'s expiry is not recorded.');
    const days = Math.ceil((Date.parse(raw) - now) / DAY_MS);
    if (!Number.isFinite(days)) return fail('The recorded token expiry cannot be read.', fixOf('Record the expiry', 'Record the expiry again with the token.', keysDoor(account)));
    if (days > TOKEN_HEADROOM_DAYS) return pass(`The token lasts ${days} more days.`);
    return fail(linkedinExpiryNote(raw, now) || `The token lasts only ${days} more day(s).`,
      fixOf('Renew the token', `Renew the LinkedIn token and paste it in ${KEYS_PLACE} → LinkedIn.`, keysDoor(account)));
  }
  if (account.channelId === 'tiktok') return na('TikTok renews its sign-in by itself; the renewal\'s own end is not reported to the app.');
  if (account.channelId === 'youtube') return na('Google does not report when the sign-in ends (an app still in Testing mode loses it after 7 days).');
  return na(`${account.channelName} keys do not expire on a clock.`);
};

// 9 — one platform user is one account, under one tree, in one house.
const sharedCheck = ({ account, shared }) => {
  const problems = [
    ...(shared.sameUser.length ? [`the same ${shared.channelName} user is also connected here as ${shared.sameUser.join(', ')}`] : []),
    ...(shared.sameKeys.length ? [`the same keys also serve ${shared.sameKeys.join(', ')}`] : []),
    ...(shared.otherTree ? ['one of those accounts sits under another company tree'] : []),
    ...(shared.otherHouse ? ['another house on this machine connects the same account'] : []),
  ];
  if (problems.length) {
    return fail(`Its keys are shared: ${problems.join('; ')}.`,
      fixOf('Remove the duplicate', 'Keep one record per account: remove the duplicate, and give each company its own account.', keysDoor(account)));
  }
  if (shared.envOtherHouse) {
    return fail('The machine\'s .env keys for this platform are also held by another house.',
      fixOf('Store the house\'s own keys', `Store this house's own keys in ${KEYS_PLACE}, and take them out of .env.`, keysDoor(account)));
  }
  return pass('No other account, company tree or house shares its keys.');
};

// 10 — the house's keys file is 0600 in a 0700 folder.
const fileCheck = ({ file }) => {
  if (!file.exists) return na('No keys file yet — the keys come from the machine\'s .env.');
  const mode = (m) => m.toString(8).padStart(4, '0');
  const fileOk = file.mode === 0o600 || file.mode === 0o400;
  const dirOk = file.dirMode === 0o700;
  if (fileOk && dirOk) return pass('Only you can read the house\'s keys file.');
  return fail('The house\'s keys file can be read by more than its owner.',
    fixOf('Lock the keys file', 'Lock it: the file to 0600 and its folder to 0700 (the app does this on the next key change).', houseKeysDoor()),
    { detail: `${file.path} is ${mode(file.mode)}, its folder ${mode(file.dirMode)}` });
};

// 11 — the AI disclosure rides every post from this account, in its metadata.
const disclosureCheck = (facts) => {
  const { account, live } = facts;
  if (NATIVE_LABEL_CHANNELS.includes(account.channelId)) {
    return pass(`${account.channelName} posts carry its own AI-made label, always raised.`);
  }
  const bare = live.filter((e) => !carriesDisclosure(e));
  if (bare.length) {
    return fail(`${bare.length} waiting post(s) have images whose alt text lacks the AI marker (${ALT_MARK})`,
      fixOf('Mark the images', 'Edit the post\'s images (the queue marks them when it reads them), or withdraw it.', queueDoor(account, bare[0].id),
        holderHandTo(facts, disclosurePrompt(account, bare))),
      { detail: bare.map((e) => e.id).join(', ') });
  }
  return pass(`AI-made posts say so in their metadata: each image's alt text opens with "${ALT_MARK}", and the words carry no line.`);
};

// 12 — the company's site is on record (what a bio link points to).
const siteCheck = ({ company, cmo, house }) => {
  if (!company) return unknown('No company to read a site from.');
  if (!company.site?.url) {
    return fail(`${company.name} has no site on record, so there is nothing for a bio link to point to.`,
      fixOf('Add the company site', `Add its site in MARKETING → ${company.name} → BRAND → SITE & CODE.`, brandDoor(company.id, 'sources'),
        cmoHandTo({ cmo, house }, sitePrompt(company))));
  }
  return pass(`${company.site.url} is on record. (Bios are not read by this check yet.)`);
};

// 13 — the app's shared limits cover the planned posts.
const quotaCheck = ({ account, quota }) => {
  if (!quota) return na(`${account.channelName} has no shared app limit the plan could reach.`);
  if (quota.problems.length) {
    return fail(quota.problems.join(' '), fixOf('Spread the posts', 'Spread the posts over more days, or move accounts to another app.', queueDoor(account)));
  }
  return pass(quota.words);
};

const RULES = Object.freeze({
  keys: keysCheck,
  live: liveCheck,
  'right-account': rightAccountCheck,
  company: companyCheck,
  holder: holderCheck,
  crew: crewCheck,
  scopes: scopesCheck,
  token: tokenCheck,
  'not-shared': sharedCheck,
  file: fileCheck,
  disclosure: disclosureCheck,
  site: siteCheck,
  quota: quotaCheck,
});

/**
 * Every check of one in-use account, in reading order. Pure.
 * @param {object} facts - one account's facts (house-check-facts.js)
 * @returns {Array<{id: string, label: string, verdict: string, words: string, fix?: object, detail?: string}>}
 */
export const checkAccount = (facts) => CHECKS.map(({ id, label }) => ({ id, label, ...RULES[id](facts) }));

/** An account reads clear when nothing failed and nothing went unproven. Pure. */
export const isClear = (checks) => checks.every((c) => c.verdict === 'pass' || c.verdict === 'na');
