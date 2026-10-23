/**
 * The social/queue contract's words — what a being reads when it asks
 * tool_search for the intent, and what it is told when a draft is refused or
 * staged. Pure.
 *
 * LOAD ON DEMAND: none of this rides the standing prompt (the INTENTS section
 * names types only); the channel guides are added for the channels THIS lane
 * may stage for, so a lane that cannot reach TikTok never pays for TikTok's
 * rules. Until 2026-10-23 a being learned TikTok's draft shape only from
 * refusals (#581).
 */
import { CAPTION_MAX } from '../social/tiktok-metadata.js';

/** How a draft names its files — every channel. */
const MEDIA_GUIDE = 'media attaches files, each {image, alt} or {path, alt}: image is the id image/generate gave you for one of your own renders (they are the files art/images/<id>.<ext> in your own lane); path is the absolute path of a file in a folder your operator has open or in the media library (media_library lists it). Always write alt text.';

/** How to make the one video a TikTok post is, when the being has none. */
const RENDER_A_VIDEO = 'render one with image/generate: pipeline video.ltx.i2v (with sound) or video.wan.i2v, image the id of one of your stills, aspect "portrait" for TikTok\'s vertical screen';

const TIKTOK_GUIDE = `TIKTOK (channel "tiktok"): a post is exactly ONE video, never text alone or a photo: media: [{image: "<your video's id>", alt}]. No video yet? ${RENDER_A_VIDEO}. text is the caption, at most ${CAPTION_MAX} characters (#hashtags and @mentions ride in it), and may carry these lines, each on its own line and never published: "privacy: only me|friends|followers|everyone", "allow: comments, duet, stitch" (or none), "promotion: own brand|paid partnership" — SUGGESTIONS only: TikTok requires your operator to choose who can watch, the interactions and the disclosure on the post's card themself, and what they choose is what posts. "send: drafts" sends the video to the account's TikTok inbox instead, where a person finishes it in the TikTok app (no privacy, allow or promotion lines then). The AI-generated label is always on. A video longer than the account may post is refused when you stage it. After your operator approves, it goes out at scheduledFor, or at the scheduler's next pass when unscheduled; follow it with queue_get {id}. The channel's holder reads the account itself with read_tiktok.`;

const GUIDES = Object.freeze({ tiktok: TIKTOK_GUIDE });

/**
 * The full social/queue description for the channels a lane may stage for.
 * @param {string} base - the type's own description
 * @param {ReadonlyArray<string>} channels
 * @returns {string}
 */
export const queueDescriptionFor = (base, channels) =>
  [base, MEDIA_GUIDE, ...channels.map((c) => GUIDES[c]).filter(Boolean)].join(' ');

/** The way forward a refused TikTok video names. */
export const TIKTOK_VIDEO_FIX = `Attach one video: media: [{image: "<the id image/generate gave you for a video>"}]; with no video yet, ${RENDER_A_VIDEO}`;

/**
 * What a being is told when its TikTok draft is staged: who decides what, when
 * it goes out, and how to follow it.
 * @param {{id: string, scheduledFor: string|null, mode: 'post'|'drafts', account: string|null, note: string|null}} staged
 * @returns {string}
 */
export const tiktokStagedWords = ({ id, scheduledFor, mode, account, note }) => [
  `Staged TikTok draft ${id}${account ? `, to post as @${account}` : ''}. Nothing is published yet.`,
  mode === 'drafts'
    ? 'Your operator approves it on its card; the video then goes to the account\'s TikTok inbox, where a person finishes the post in the TikTok app.'
    : 'Your operator opens its card, chooses who can watch, the interactions and the disclosure themself (your privacy, allow and promotion lines show there as suggestions only), and approves.',
  `It goes out ${scheduledFor ? `at ${scheduledFor}` : 'at the scheduler\'s next pass'} once approved; TikTok may take a few minutes to show it on the profile.`,
  `Follow it with queue_get {id: "${id}"}.`,
  ...(note ? [`Note: ${note}.`] : []),
].join(' ');
