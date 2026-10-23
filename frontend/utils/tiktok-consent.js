// tiktok-consent.js — the pure law of approving a TikTok Direct Post: what
// the person must choose on the post's card, what blocks the approval, the
// words TikTok requires beside it, and what the approval records. The card
// (TikTokPostSettings.jsx) and the backend (the approve route, the poster at
// send time) judge with these same functions, so what the card allows is
// exactly what the backend accepts and what the post carries.
//
// THE SOURCE: TikTok's Content Sharing Guidelines, […] (developers.tiktok.com/doc/content-sharing-guidelines,
// last updated 2026-08-04, read 2026-10-23); quoted in
// docs/work/closed/tiktok-direct-post-audit-ux.md. Its rules, as built here:
//   · privacy: […], options from creator_info's
//     privacy_level_options. A being's `privacy:` line is a suggestion shown
//     beside the empty dropdown, never a preselection;
//   · Allow Comment / Duet / Stitch: […],
//     greyed out when creator_info says the account turned one off;
//   · commercial content: off by default; on, "Your brand" and/or "Branded
//     content" (at least one), branded content never […];
//   · the declaration before the publish button, in TikTok's words.
// The AI-generated label is not here: it is always on (ai-disclosure.js),
// never a choice.

export const MUSIC_USAGE_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** TikTok's privacy levels, in the words the dropdown shows. */
export const PRIVACY_LABELS = Object.freeze({
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
});

/** The guidelines' own sentences, verbatim where TikTok gives one. */
export const TIKTOK_WORDS = Object.freeze({
  choosePrivacy: 'Choose who can watch this video: TikTok asks you to pick it yourself',
  brandedNotPrivate: 'Branded content visibility cannot be set to private.',
  pickCommercial: 'You need to indicate if your content promotes yourself, a third party, or both.',
  processing: 'After it is published, it may take a few minutes for the video to process and be visible on the profile.',
});

/** Nothing chosen: the card's starting state, by TikTok's rule. */
export const EMPTY_CHOICE = Object.freeze({
  privacyLevel: '',
  allow: Object.freeze({ comment: false, duet: false, stitch: false }),
  commercial: Object.freeze({ on: false, yourBrand: false, branded: false }),
});

const INTERACTIONS = Object.freeze([
  ['comment', 'comments', 'commentDisabled'],
  ['duet', 'duet', 'duetDisabled'],
  ['stitch', 'stitch', 'stitchDisabled'],
]);

/**
 * creator_info's `data` as the card and the law read it. Pure.
 * @param {object} data
 */
export const creatorView = (data) => Object.freeze({
  nickname: String(data?.creator_nickname || ''),
  username: String(data?.creator_username || ''),
  privacyOptions: Object.freeze((Array.isArray(data?.privacy_level_options) ? data.privacy_level_options : [])
    .filter((o) => Object.hasOwn(PRIVACY_LABELS, o))),
  commentDisabled: data?.comment_disabled === true,
  duetDisabled: data?.duet_disabled === true,
  stitchDisabled: data?.stitch_disabled === true,
  maxVideoSec: Number(data?.max_video_post_duration_sec) || null,
});

/**
 * A choice read off the wire: only `true` turns anything on, an unknown
 * privacy is no privacy, and nothing under a closed disclosure counts. Pure.
 * @param {object} raw
 */
export const readChoice = (raw) => {
  const on = (v) => v === true;
  const commercialOn = on(raw?.commercial?.on);
  const level = raw?.privacyLevel;
  return Object.freeze({
    privacyLevel: typeof level === 'string' && Object.hasOwn(PRIVACY_LABELS, level) ? level : '',
    allow: Object.freeze({ comment: on(raw?.allow?.comment), duet: on(raw?.allow?.duet), stitch: on(raw?.allow?.stitch) }),
    commercial: Object.freeze({
      on: commercialOn,
      yourBrand: commercialOn && on(raw?.commercial?.yourBrand),
      branded: commercialOn && on(raw?.commercial?.branded),
    }),
  });
};

/**
 * Every reason this choice cannot be approved for this account right now,
 * in the order the card reads; empty when it can. Pure.
 * @param {ReturnType<typeof readChoice>} choice
 * @param {ReturnType<typeof creatorView>|null} creator
 * @returns {string[]}
 */
export const choiceBlockers = (choice, creator) => {
  if (!creator) return ['TikTok has not said yet what this account allows'];
  const out = [];
  if (!choice.privacyLevel) out.push(TIKTOK_WORDS.choosePrivacy);
  else if (!creator.privacyOptions.includes(choice.privacyLevel)) {
    out.push(`This TikTok account does not offer "${PRIVACY_LABELS[choice.privacyLevel]}" right now`);
  }
  const off = INTERACTIONS.filter(([key, , disabled]) => choice.allow[key] && creator[disabled]).map(([, word]) => word);
  if (off.length) out.push(`This TikTok account has ${off.join(' and ')} turned off`);
  if (choice.commercial.on && !choice.commercial.yourBrand && !choice.commercial.branded) out.push(TIKTOK_WORDS.pickCommercial);
  if (choice.commercial.branded && choice.privacyLevel === 'SELF_ONLY') out.push(TIKTOK_WORDS.brandedNotPrivate);
  return out;
};

/**
 * The label TikTok puts on a disclosed video, in the guidelines' words, or
 * null when nothing is disclosed. Branded content wins when both are chosen.
 * Pure.
 * @param {{on: boolean, yourBrand: boolean, branded: boolean}} commercial
 */
export const commercialLabel = (commercial) => {
  if (!commercial.on) return null;
  if (commercial.branded) return 'Your video will be labeled as \'Paid partnership\'';
  return commercial.yourBrand ? 'Your video will be labeled as \'Promotional content\'' : null;
};

/**
 * The declaration TikTok requires before the publish button: the Music
 * Usage Confirmation always, the Branded Content Policy too once branded
 * content is chosen. Pure.
 * @param {{on: boolean, branded: boolean}} commercial
 * @returns {{text: string, policies: Array<'branded'|'music'>}}
 */
export const consentDeclaration = (commercial) => (commercial.on && commercial.branded
  ? { text: 'By posting, you agree to TikTok\'s Branded Content Policy and Music Usage Confirmation.', policies: ['branded', 'music'] }
  : { text: 'By posting, you agree to TikTok\'s Music Usage Confirmation.', policies: ['music'] });

/**
 * What an approval records: exactly the choices, the account the card named,
 * and the declaration the person read. Pure.
 * @param {ReturnType<typeof readChoice>} choice
 * @param {ReturnType<typeof creatorView>} creator
 * @param {Date} at
 */
export const consentRecord = (choice, creator, at) => Object.freeze({
  privacyLevel: choice.privacyLevel,
  allow: choice.allow,
  commercial: choice.commercial,
  account: Object.freeze({ username: creator.username, nickname: creator.nickname }),
  declaration: consentDeclaration(choice.commercial).text,
  consentedAt: at.toISOString(),
});

/**
 * Why an approved post cannot go out as approved, judged against creator
 * info read at send time; null when it can. A changed world is refused,
 * never adjusted: the post leaves with exactly what was approved or not at
 * all. Pure.
 * @param {object|null|undefined} consent - the entry's consentRecord
 * @param {ReturnType<typeof creatorView>} creator
 * @returns {string|null}
 */
export const sendRefusal = (consent, creator) => {
  const again = 'Approve it again from its card. Nothing was published';
  if (!consent?.privacyLevel) {
    return `this TikTok post carries no approval of who can watch it, its interactions and its disclosure. ${again}`;
  }
  if (consent.account?.username !== creator.username) {
    return `the TikTok connection now posts as @${creator.username}; this post was approved for @${consent.account?.username}. ${again}`;
  }
  const [first] = choiceBlockers(readChoice(consent), creator);
  return first ? `${first}, so the post cannot go out as approved. ${again}` : null;
};
