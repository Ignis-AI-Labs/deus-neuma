/**
 * read_tiktok — the TikTok channel holder's read of the house's OWN TikTok
 * account: the profile, the four counts and the newest videos with their
 * views, likes, comments and shares, so the marketing seat can judge what
 * works (tiktok-profile.js reads it; the desk's ACCOUNT board reads the same).
 *
 * The house's account and nobody else's, read with the house's own sign-in:
 * the lane's house is its owner's wallet, and only the lane bound to TikTok in
 * that house may read it — advertised to the holder alone
 * (social-queue-tools.js channelToolsFor) and re-checked here at every call.
 * It leaves the machine on the house's credentials, so it asks like read_x
 * (tool-policy-defaults.js, `social` row). The handler is social-read-tools.js.
 */
import { createLogger } from '../logger.js';
import { neumaWorkspace } from '../../../core/index.js';
import { channelBindings } from '../social/channel-bindings.js';
import { heldAccounts, pickAccount } from '../social/account-shape.js';
import { houseOfLane } from '../social/house-positions.js';
import { readTikTokProfile } from '../social/tiktok-profile.js';
import { frameUntrustedSections } from '../untrusted-content.js';

const log = createLogger('Portal');

export const READ_TIKTOK_TOOL = Object.freeze({
  name: 'read_tiktok',
  server: 'social',
  description: 'Read a TikTok account of the house that you hold — args {account?}: name the account (tiktok-1, tiktok-2…) when you hold more than one. You get the profile (name, @username, verified, bio, profile link), the four counts (followers, following, likes, videos) and the newest public videos (up to 20, newest first), each with its date, length, views, likes, comments, shares and link — the measure of what works. TikTok lists public videos only, so a private (only me) post is not among them. Reading only: nothing is posted or changed. Profile edits are made in TikTok itself.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      account: Object.freeze({ type: 'string', description: 'Which TikTok account (tiktok-1, tiktok-2…) — only needed when you hold more than one' }),
    }),
  }),
});

const NOT_SHARED = 'not shared';
const count = (n) => (n == null ? NOT_SHARED : String(n));

// pure — one video's identifiers and figures: ours, so outside the frame.
const videoLead = (v) => [
  `video ${v.id}`,
  v.postedAt ? `posted ${v.postedAt}` : null,
  v.durationSec != null ? `${v.durationSec}s` : null,
  `views ${count(v.counts.views)}`,
  `likes ${count(v.counts.likes)}`,
  `comments ${count(v.counts.comments)}`,
  `shares ${count(v.counts.shares)}`,
  v.shareUrl,
].filter(Boolean).join(' · ');

/**
 * The account read for a being's window, fitted in WHOLE videos (the read
 * window social-read-tools keeps): the oldest are held back first and the
 * answer says so. The bio and captions are TikTok-returned text and ride
 * inside the untrusted frame. Pure given `token`.
 * @param {object} read - readTikTokProfile's ok answer
 * @param {{budget?: number|null, token?: string}} [opts]
 * @returns {{text: string, shown: number}}
 */
const renderTikTokRead = (read, { budget = null, token } = {}) => {
  const { account: a, videos, hasMore, videosError, reconnect, readAt } = read;
  const head = [
    `The house's TikTok account, read ${readAt}:`,
    [a.username ? `@${a.username}` : null, a.displayName ? `(${a.displayName})` : null,
      a.verified === true ? 'verified' : a.verified === false ? 'not verified' : null, a.profileUrl].filter(Boolean).join(' · '),
    `followers ${count(a.counts.followers)} · following ${count(a.counts.following)} · likes ${count(a.counts.likes)} · videos ${count(a.counts.videos)}`,
    ...(reconnect ? [reconnect] : []),
  ].join('\n');
  const list = videos || [];
  const draw = (n) => {
    const sections = [
      ...(a.bio ? [{ lead: 'the profile bio', text: a.bio }] : []),
      ...list.slice(0, n).map((v) => ({ lead: videoLead(v), text: v.caption || '(no caption)' })),
    ];
    const heading = videosError ? `The videos could not be read: ${videosError}.`
      : videos === null ? 'The videos are not shown: the connection lacks the permission to list them.'
        : list.length ? `${n} of the ${list.length} newest public video(s)${hasMore ? ' (more on TikTok)' : ''}:` : 'No public videos are listed.';
    return [
      head,
      heading,
      frameUntrustedSections('the house\'s TikTok profile bio and video captions, returned by TikTok\'s API', sections, token),
      ...(n < list.length ? [`…and ${list.length - n} older video(s) held back so this read fits your window WHOLE.`] : []),
    ].filter(Boolean).join('\n\n');
  };
  let shown = list.length;
  if (Number.isFinite(budget) && budget > 0) {
    while (shown > 0 && draw(shown).length > budget) shown -= 1;
  }
  return { text: draw(shown), shown };
};

// impure — the lane's house and the TikTok account the read is for, when the
// lane holds it there; else the refusal in words.
const holderAccount = async (neumaId, asked) => {
  const house = await houseOfLane(neumaId);
  const bindings = house ? await channelBindings.load(house).catch(() => ({})) : {};
  const held = heldAccounts(bindings, 'tiktok', neumaId);
  if (!held.length) return { ok: false, error: NOT_HOLDER };
  const pick = pickAccount(held, asked, 'TikTok');
  return pick.ok ? { ok: true, house, accountId: pick.accountId } : pick;
};

const NOT_HOLDER = 'read_tiktok is the TikTok channel holder\'s read, and you do not hold TikTok in your house. Ask the holder for what you need, or your operator to bind you.';

/**
 * Why this lane may not read the house's TikTok account, or null — asked
 * before the operator's card, so no card is raised for a read that cannot run.
 * impure — stores.
 * @param {string} neumaId
 * @returns {Promise<string|null>}
 */
export const tiktokReadRefusal = async (neumaId, asked) => {
  const held = await holderAccount(neumaId, asked);
  return held.ok ? null : held.error;
};

/**
 * Read the house's TikTok account for the lane that holds the channel; the
 * binding is read again here, after any card. impure — stores, network, the
 * being's journal.
 * @param {string} neumaId
 * @param {{signal?: AbortSignal, budget?: number, account?: string}} [opts]
 *   account — which of the lane's TikTok accounts (needed when it holds several)
 * @returns {Promise<{ok: true, text: string, shown: number}|{ok: false, error: string}>}
 */
export const readTikTokForBeing = async (neumaId, { signal, budget, account } = {}) => {
  const held = await holderAccount(neumaId, account);
  if (!held.ok) return { ok: false, error: held.error };
  const read = await readTikTokProfile(held.house, { signal, accountId: held.accountId });
  if (!read.ok) return { ok: false, error: `The TikTok read did not land: ${read.detail}.` };
  const drawn = renderTikTokRead(read, { budget });
  // What the being received is on its own record (the egress audit read_x keeps).
  neumaWorkspace.addJournalEntry(neumaId, {
    type: 'tool_call',
    content: `read_tiktok — read the house's TikTok account and ${drawn.shown} video(s)`,
    significance: 0.3,
    metadata: { server: 'social', tool: 'read_tiktok', consumed: drawn.shown, status: 'ok' },
  }).catch((err) => log.warn('read_tiktok not journaled', { neumaId, error: err.message }));
  return { ok: true, text: drawn.text, shown: drawn.shown };
};
