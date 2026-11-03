// check-fixes — what a failing check of the HOUSE SOCIAL CHECK asks for, as
// data (Design note, 2026-10-24: […]). A fix is:
//   title   two to five words — what to do
//   words   the fix in a sentence (what the check has always said)
//   door    where it is done, by kind, so the desk lands on the exact place
//           and never parses a sentence:
//             keys      Settings → API → Channel keys, on this account's row
//                       (connect: the sign-in is the way, CONNECT on that row;
//                       no account: the section itself, for the house's file)
//             handle    the account's expected @handle, recorded in place
//                       (seen: the handle the keys answered as, if they did)
//             brand     MARKETING → the company → BRAND (section 'sources' =
//                       SITE & CODE; no company = the house's brand kits)
//             standing  the platform's window, STANDING open on its holder or
//                       crew drawer
//             queue     the platform's queue (entryId: the post it lands on)
//   handTo  only where a member of THIS house can do it with an act it
//           already files: who, and the prompt the operator sends them (a
//           company's missing site → the seated CMO, who proposes it and the
//           operator approves). Keys, holders, companies and anything signing
//           stay the operator's.
//
// Pure.

const signsIn = (account) => (account.fields || []).some((f) => f.connect);

/** Settings → API → Channel keys, on this account's row. Pure. */
export const keysDoor = (account, { connect = signsIn(account) } = {}) => Object.freeze({
  kind: 'keys', channelId: account.channelId, accountId: account.id, ...(connect ? { connect: true } : {}),
});

/** Settings → API → Channel keys, at the top: the house's one keys file is no account's. Pure. */
export const houseKeysDoor = () => Object.freeze({ kind: 'keys', channelId: null, accountId: null });

/** The account's expected @handle, recorded in place. Pure. */
export const handleDoor = (account, seen = null) => Object.freeze({
  kind: 'handle', channelId: account.channelId, accountId: account.id, seen: seen ? String(seen).replace(/^@/, '') : null,
});

/** MARKETING → the company → BRAND (or the house's kits when there is no company). Pure. */
export const brandDoor = (companyId, section = null) => Object.freeze({ kind: 'brand', companyId: companyId || null, section });

/** The platform's window, STANDING open on its holder or crew drawer. Pure. */
export const standingDoor = (account, drawer) => Object.freeze({
  kind: 'standing', channelId: account.channelId, accountId: account.id, drawer,
});

/** The platform's queue, on one post when one is named. Pure. */
export const queueDoor = (account, entryId = null) => Object.freeze({
  kind: 'queue', channelId: account.channelId, accountId: account.id, entryId,
});

/** One fix. Pure. */
export const fixOf = (title, words, door, handTo = null) => Object.freeze({ title, words, door, ...(handTo ? { handTo } : {}) });

/**
 * The account's holder, when it can take a fix: a lane of THIS house, never a
 * witness, and the account keyed (staging needs the keys). Null otherwise —
 * the fix is then the operator's alone. Pure.
 * @param {{account: object, holder: ?object, house: string}} facts
 * @param {string} prompt - what the operator sends, drafted
 */
export const holderHandTo = ({ account, holder, house }, prompt) => (
  holder && !holder.external && holder.house === house && account.configured
    ? Object.freeze({ neumaId: holder.neumaId, name: holder.name || null, role: 'holder', prompt })
    : null
);

/**
 * The house's seated CMO, when it can take a link fix: a lane of THIS house,
 * never a witness. It proposes the change with marketing/company-links and
 * the operator approves it. Null otherwise — the fix is the operator's. Pure.
 * @param {{cmo: ?object, house: string}} facts
 * @param {string} prompt - what the operator sends, drafted
 */
export const cmoHandTo = ({ cmo, house }, prompt) => (
  cmo && !cmo.external && cmo.house === house
    ? Object.freeze({ neumaId: cmo.neumaId, name: cmo.name || null, role: 'cmo', prompt })
    : null
);

/**
 * The prompt that hands a company's missing site to the CMO. Pure.
 * @param {{id: string, name: string}} company
 */
export const sitePrompt = (company) => [
  `The house social check found no site on record for ${company.name} (${company.id}), so its bios have nothing to point to.`,
  `Find ${company.name}'s public site and propose it with marketing/company-links (company: ${company.id}, site: its https address), with any of its other public pages as links.`,
  'I will approve the change in WAITING ON YOU.',
].join(' ');

/**
 * The prompt that hands the disclosure fix to the holder: pull each bare post
 * back (queue_cancel) and stage its words again (social/queue adds the line),
 * every card still the operator's. Pure.
 * @param {object} account
 * @param {Array<{id: string, scheduledFor?: ?string}>} bare
 */
export const disclosurePrompt = (account, bare) => [
  `The house social check found ${bare.length} waiting ${account.channelName} post(s) on ${account.id} whose images lack the AI marker in their alt text: ${bare.map((e) => e.id).join(', ')}.`,
  'For each one: update its media with queue_update, keeping each image and its description; the queue opens each alt text with the marker when it reads the post. The words stay as they are.',
  'I will decide each card.',
].join(' ');
