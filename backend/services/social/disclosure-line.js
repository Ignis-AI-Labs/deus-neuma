// disclosure-line — where a post says it is AI-made: in its METADATA, never in
// its words.
//
// The house never hides that its work is AI-made (2026-10-19). It used to say
// so with a "Made with AI." line at the end of every post on the platforms with
// no AI-label field; the operator ruled that out (2026-10-30): the disclosure
// belongs in the metadata, not in the space people read. So it rides:
//   - YouTube and TikTok: their own AI-made flags, always raised
//     (youtube-metadata.js `containsSyntheticMedia`, tiktok-metadata.js `is_aigc`);
//   - every image and video: the AI-generated marker in the file's own metadata
//     (image-forge/ai-disclosure.js), and on X the image's alt text, the field
//     the platform keeps beside the picture, opening with ALT_MARK.
// The words of a post are exactly what was written and approved.
//
// A being's images take the marker when staged or edited, so the card shows
// what goes out; the scheduler marks every AI-made image it sends regardless.
// Posts staged before this carried the old line as their last line. A post
// that can still go out loses it once, the first time the queue reads it, and
// is marked `disclosure: 'metadata'` so words written afterwards are never
// touched; an image it carried keeps its card's alt text until an edit marks
// it (the house social check names it). What already went out stays the record.
//
// Pure throughout.

/** The alt-text marker an AI-made post's images open with. */
export const ALT_MARK = 'AI-generated.';

/** The line posts carried before 2026-10-30, taken off a post that has not gone out. */
export const LEGACY_LINE = 'Made with AI.';

/** Marks a post whose disclosure lives in its metadata (and whose words are its own). */
export const IN_METADATA = 'metadata';

/** X caps alt text at 1000 characters (x-media.js ALT_TEXT_MAX). */
const ALT_MAX = 1000;

/** The platforms whose own AI-made label is raised. */
export const NATIVE_LABEL_CHANNELS = Object.freeze(['youtube', 'tiktok']);

/** Statuses a post can still go out from; the rest are the record. */
const UNSENT = new Set(['draft', 'approved', 'failed']);

/**
 * Whether a post is AI-made: a being wrote it, or it carries images or video.
 * The operator's own typed words with no media are theirs. Pure.
 * @param {{authorNeumaId?: ?string, media?: Array|null}} entry
 */
const needsDisclosure = ({ authorNeumaId, media } = {}) =>
  Boolean(authorNeumaId) || (Array.isArray(media) && media.length > 0);

/** The text without the old trailing line, trimmed; anything else as it is. Pure. */
const withoutLegacyLine = (text) => {
  const t = String(text ?? '').trim();
  return t.endsWith(LEGACY_LINE) ? t.slice(0, -LEGACY_LINE.length).trimEnd() : t;
};

/** An alt text that opens with the marker (idempotent). Pure. */
const markedAlt = (alt) => {
  const a = String(alt ?? '').trim();
  if (a.startsWith(ALT_MARK)) return a.slice(0, ALT_MAX);
  return (a ? `${ALT_MARK} ${a}` : ALT_MARK).slice(0, ALT_MAX);
};

/** What an alt text describes, the AI marker aside: '' when it is only the
 *  marker, so an image no one described still reads as undescribed. Pure. */
export const altDescription = (alt) => {
  const a = String(alt ?? '').trim();
  return (a.startsWith(ALT_MARK) ? a.slice(ALT_MARK.length) : a).trim();
};

/** An AI-made post's media with the marker in each alt text (YouTube and TikTok
 *  raise their own label instead). Pure. */
export const markedMedia = (entry) => (Array.isArray(entry?.media) && needsDisclosure(entry)
  && !NATIVE_LABEL_CHANNELS.includes(entry?.channelId)
  ? entry.media.map((m) => ({ ...m, alt: markedAlt(m.alt) }))
  : entry?.media);

/**
 * A queue entry as it is read: the old line comes off an unsent post's words,
 * once (entries not yet marked `disclosure: 'metadata'`). Sent, rejected and
 * withdrawn posts are returned as they are. Pure.
 * @param {object} entry
 * @returns {object}
 */
export const disclosed = (entry) => {
  if (!entry || !UNSENT.has(entry.status) || entry.disclosure === IN_METADATA) return entry;
  return { ...entry, text: withoutLegacyLine(entry.text), disclosure: IN_METADATA };
};

/** Whether a post carries the disclosure it owes in its metadata. Pure. */
export const carriesDisclosure = (entry) => NATIVE_LABEL_CHANNELS.includes(entry?.channelId)
  || !Array.isArray(entry?.media) || !entry.media.length || !needsDisclosure(entry)
  || entry.media.every((m) => String(m?.alt ?? '').startsWith(ALT_MARK));
