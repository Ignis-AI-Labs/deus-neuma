// disclosure-line — the words that tell people a post is AI-made, on the
// platforms that have no AI-label field of their own (campaign plan §7,
// slice 12; owner default 2026-10-24, changeable: the line below, for
// AI-written text AND AI-made media).
//
// The house never hides that its work is AI-made (Design note, 2026-10-19. YouTube
// and TikTok raise their own AI-made flag on every post (youtube-metadata.js
// `containsSyntheticMedia`, tiktok-metadata.js `is_aigc`); the other seven
// carry this line at the end of the post's own text, added at STAGING, so the
// words the operator approves are the words that go out (exact output).
//
// A post needs it when a being wrote it (it has an author lane) or when it
// carries images or video. The operator's own typed words with no media are
// theirs, and carry none.
//
// Pure throughout.

import { CHANNEL_CATALOG } from './channel-registry.js';

/** The line itself — the owner's default wording, changeable here alone. */
export const DISCLOSURE_LINE = 'Made with AI.';

const SEPARATOR = '\n\n';

/** The platforms whose own AI-made label is raised instead of a line. */
export const NATIVE_LABEL_CHANNELS = Object.freeze(['youtube', 'tiktok']);

/** The platforms that carry the line (every other platform the house speaks on). */
export const LINE_CHANNELS = Object.freeze(CHANNEL_CATALOG.map((c) => c.id).filter((id) => !NATIVE_LABEL_CHANNELS.includes(id)));

/**
 * Whether a post must carry the line. Pure.
 * @param {{channelId?: string, authorNeumaId?: ?string, media?: Array|null}} entry
 */
export const needsDisclosureLine = ({ channelId, authorNeumaId, media } = {}) =>
  LINE_CHANNELS.includes(channelId) && (Boolean(authorNeumaId) || (Array.isArray(media) && media.length > 0));

const endsWithLine = (text) => String(text || '').trimEnd().endsWith(DISCLOSURE_LINE);

/** Whether a post carries the disclosure it owes (true when it owes none). Pure. */
export const carriesDisclosureLine = (entry) => !needsDisclosureLine(entry) || endsWithLine(entry?.text);

/**
 * The post's text with the line at its end when it owes one and lacks it.
 * Idempotent: text that already ends with the line is returned as it is.
 * Pure.
 * @param {{channelId?: string, text?: string, authorNeumaId?: ?string, media?: Array|null}} entry
 * @returns {string}
 */
export const withDisclosureLine = (entry) => {
  const text = String(entry?.text ?? '').trim();
  return carriesDisclosureLine(entry) || !text ? text : `${text}${SEPARATOR}${DISCLOSURE_LINE}`;
};
