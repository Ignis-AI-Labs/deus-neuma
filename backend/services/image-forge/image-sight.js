/**
 * THE RETURN — a being sees what it made.
 *
 * Design note, 2026-08-05: […]
 *
 * Until now the render answered in WORDS — `image id: <id>` — and the
 * being had never once seen a thing it made. It could only report that a render
 * had happened, and describe an image it had no access to. That is the exact
 * shape of a hallucination the platform was manufacturing on purpose.
 *
 * Sight here is STRUCTURAL, not a tool the being elects to call (Founder's call when
 * asked): every render it CAN see, it sees. A being that has to choose to look
 * will skip it, and the habit of reviewing your own work never forms.
 *
 * The two honesty rules this module exists to keep:
 *   • A blind substrate is TOLD it is blind. Silently handing a text-only result
 *     to a model with no vision teaches it to narrate images it never saw.
 *   • An image too large to carry is COUNTED, never dropped in silence.
 *
 * Nothing is resized. A vision model rescales to its projector's input anyway,
 * so a smaller payload would buy transit bytes, not tokens — and adding a native
 * image dependency to this repo buys an ABI hazard in every packaged build. The
 * ceiling is the one the operator's own attachments already ride under.
 */
import { readFileSync } from 'fs';
import { resolveImage } from './image-store.js';
import { takeEphemeralSight } from './ephemeral-sight.js';
import { MAX_DATA_URI_CHARS, MAX_IMAGES_PER_MESSAGE } from '../attachment-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Sight');

/**
 * How many base64 characters `bytes` bytes become. Pure.
 * Four characters per three bytes, rounded up to the padded quantum — so the
 * fit check never reads a file it is about to reject.
 * @param {number} bytes
 * @returns {number}
 */
export const base64Chars = (bytes) => Math.ceil(bytes / 3) * 4;

/**
 * Will this image fit in a prompt under the operator-attachment ceiling? Pure.
 * @param {number} bytes
 * @param {string} mime
 * @param {number} [cap]
 * @returns {boolean}
 */
export const fitsSight = (bytes, mime, cap = MAX_DATA_URI_CHARS) =>
  Number.isFinite(bytes) && bytes > 0 &&
  base64Chars(bytes) + `data:${mime};base64,`.length <= cap;

/**
 * The image references a round of tool results offers the eye. Pure.
 *
 * A tool opts in with stored image ids or one-use `store: 'ephemeral'` ids.
 * The lane rides on the result so no caller can redirect another lane's sight.
 * @param {Array<object>} results
 * @param {number} [max]
 * @returns {Array<{laneId: string, imageId: string, store?: string, purpose?: string}>}
 */
export const foldSight = (results, max = MAX_IMAGES_PER_MESSAGE) =>
  (Array.isArray(results) ? results : [])
    .filter((r) => r?.status === 'ok' && r?.sight?.laneId && Array.isArray(r.sight.imageIds))
    .flatMap((r) => r.sight.imageIds
      .filter((id) => typeof id === 'string' && id.length > 0)
      .map((imageId) => ({
        laneId: r.sight.laneId,
        imageId,
        ...(r.sight.store === 'ephemeral' ? { store: 'ephemeral' } : {}),
        ...(['ksp-view', 'video-frames', 'file-read'].includes(r.sight.purpose) ? { purpose: r.sight.purpose } : {}),
      })))
    .slice(0, max);

/**
 * What the being is told about what it can and cannot see. Pure.
 *
 * The blind case is the one that matters: it must read as a fact about the
 * substrate, not as a failure the being should retry or apologise for.
 * @param {{shown: number, withheld: number, blind?: boolean, modelName?: string, purpose?: string}} state
 * @returns {string} '' when there is nothing to say
 */
export const sightNote = ({ shown, withheld, blind = false, modelName = null, purpose = 'render' }) => {
  if (purpose === 'ksp-view') {
    const frames = shown + withheld;
    if (blind) {
      return `[The ${frames === 1 ? 'live KSP frame is' : `${frames} live KSP frames are`} NOT in front of you. The substrate this turn rides${modelName ? ` (${modelName})` : ''} has no vision. Use telemetry, and say plainly that you cannot see the simulation view.]`;
    }
    if (shown === 0 && withheld === 0) return '';
    if (shown === 0) return `[The live KSP view could not be placed in front of you. You have not seen it; use telemetry before acting.]`;
    const seen = shown === 1 ? 'The live KSP frame is attached — you are looking at the simulation now.' : `${shown} sequential live KSP frames are attached — you are looking at the simulation across time now.`;
    const lost = withheld > 0 ? ` ${withheld} further frame${withheld === 1 ? '' : 's'} could not be carried and ${withheld === 1 ? 'is' : 'are'} unseen.` : '';
    return `[${seen}${lost} Read the scene and instruments before choosing the next act.]`;
  }
  if (purpose === 'video-frames') {
    const frames = shown + withheld;
    if (blind) {
      return `[The ${frames} frames sampled from the clip you just made are NOT in front of you. The substrate this turn rides${modelName ? ` (${modelName})` : ''} has no vision. Say plainly that you cannot see your clip — your operator can watch it.]`;
    }
    if (shown === 0) return withheld > 0 ? `[The frames of your clip could not be placed in front of you. You have not seen it; speak of it only by what you asked for.]` : '';
    const lost = withheld > 0 ? ` ${withheld} further frame${withheld === 1 ? '' : 's'} could not be carried.` : '';
    return `[${shown} frames sampled across the clip you just made are attached above, in order from its first moment to its last — you are looking at your clip across time now.${lost} Judge two things before you speak: ADHERENCE — does it show and say what you asked (the words heard are in the result)? COHESION — is it the same subject frame to frame, with no ghosts, no drift, no frame that breaks from the rest? Record what you find with review_image on the clip's id.]`;
  }
  // A file the being READ (an image, a scanned PDF page) is not its own work: no render
  // wording, no review_image — and a filing number it cannot make out is said, not guessed.
  if (purpose === 'file-read') {
    const total = shown + withheld;
    const what = total === 1 ? 'The image you read' : `The ${total} images you read`;
    const them = total === 1 ? 'it' : 'them';
    if (blind) return `[${what} ${total === 1 ? 'is' : 'are'} NOT in front of you — a scanned PDF page is an image too. The substrate this turn rides${modelName ? ` (${modelName})` : ''} has no vision, so you cannot look at ${them}. Say that plainly rather than describing what you have not seen — your operator can look, and a peer on a vision substrate can be asked to.]`;
    if (shown === 0) return withheld > 0 ? `[${what} could not be placed in front of you. You have not seen ${them}.]` : '';
    const lost = withheld > 0 ? ` ${withheld} further image${withheld === 1 ? '' : 's'} could not be carried and ${withheld === 1 ? 'is' : 'are'} unseen.` : '';
    return `[${shown === 1 ? 'The image you read is' : `The ${shown} images you read are`} attached above, in the order you read them — you are looking at ${shown === 1 ? 'it' : 'them'} now.${lost} Read what is actually there; where a word or number is not legible, say so rather than guessing.]`;
  }
  if (blind) {
    const n = withheld === 1 ? 'The image you just made is' : `The ${withheld} images you just made are`;
    return `[${n} NOT in front of you. The substrate this turn rides${modelName ? ` (${modelName})` : ''} has no vision, so you cannot look at your own render. Say that plainly rather than describing what you have not seen — your operator can look, and a peer on a vision substrate can be asked to.]`;
  }
  if (shown === 0 && withheld === 0) return '';
  if (shown === 0) {
    return `[${withheld === 1 ? 'The image' : `All ${withheld} images`} you just made could not be placed in front of you — too large to carry, or the bytes are missing from the store. You have not seen ${withheld === 1 ? 'it' : 'them'}.]`;
  }
  const seen = shown === 1
    ? 'The image you just made is attached above — you are looking at it now.'
    : `The ${shown} images you just made are attached above — you are looking at them now.`;
  const lost = withheld > 0
    ? ` ${withheld} further image${withheld === 1 ? '' : 's'} could not be carried and ${withheld === 1 ? 'is' : 'are'} unseen.`
    : '';
  return `[${seen}${lost} Look before you speak: does it show what you actually asked for? Prompt adherence is objective — count what you asked for and find it, or find it missing. Record what you find with review_image.]`;
};

/**
 * Read the bytes for a set of references into data URIs. Impure (fs).
 *
 * A reference that cannot be resolved, does not fit, or fails to read is
 * COUNTED as withheld rather than throwing — a sight failure must never turn a
 * successful render into a failed turn.
 * @param {Array<{laneId: string, imageId: string, store?: string}>} refs
 * @param {string} [root] store root override (tests)
 * @returns {{images: string[], withheld: number}}
 */
export const readSight = (refs, root = undefined) => {
  const images = [];
  let withheld = 0;
  const pushEphemeral = (ref) => {
    const entry = takeEphemeralSight(ref.laneId, ref.imageId);
    if (!entry || !fitsSight(entry.bytes.length, entry.mime)) return false;
    images.push(`data:${entry.mime};base64,${entry.bytes.toString('base64')}`);
    return true;
  };
  for (const ref of refs) {
    if (ref.store === 'ephemeral') {
      if (!pushEphemeral(ref)) withheld += 1;
      continue;
    }
    const found = root === undefined
      ? resolveImage(ref.laneId, ref.imageId)
      : resolveImage(ref.laneId, ref.imageId, root);
    if (!found.ok) {
      log.warn('image could not be resolved for sight', { imageId: ref.imageId, reason: found.error });
      withheld += 1;
      continue;
    }
    if (!fitsSight(found.record.bytes, found.record.mime)) {
      log.warn('image too large to place in a prompt', { imageId: ref.imageId, bytes: found.record.bytes });
      withheld += 1;
      continue;
    }
    try {
      images.push(`data:${found.record.mime};base64,${readFileSync(found.path).toString('base64')}`);
    } catch (err) {
      log.warn('image bytes could not be read for sight', { imageId: ref.imageId, err: err.message });
      withheld += 1;
    }
  }
  return { images, withheld };
};

/**
 * The whole return leg for one tool round: what rides back, and what to say
 * about it. Impure (delegates to readSight).
 * @param {Array<object>} results
 * @param {{canSee: boolean, modelName?: string|null, root?: string}} turn
 * @returns {{images: string[], note: string}}
 */
export const sightForResults = (results, { canSee, modelName = null, root = undefined } = {}) => {
  const refs = foldSight(results);
  if (refs.length === 0) return { images: [], note: '' };
  const purpose = ['ksp-view', 'video-frames', 'file-read'].find((p) => refs.every((ref) => ref.purpose === p)) ?? 'render';
  if (!canSee) return { images: [], note: sightNote({ shown: 0, withheld: refs.length, blind: true, modelName, purpose }) };
  const { images, withheld } = readSight(refs, root);
  return { images, note: sightNote({ shown: images.length, withheld, purpose }) };
};

/**
 * Place the sight into a tool exchange. Pure.
 *
 * The two exchange shapes need opposite treatment, and getting it wrong is a
 * provider error rather than a soft degradation:
 *   • A TEXT exchange ends in the user-role `<tool_response>` turn. The images
 *     join THAT message as content parts — appending a second user message is
 *     not legal in every dialect.
 *   • A NATIVE exchange ends in tool-role results. There the images ride a
 *     fresh user message, because tool → user is a legal role change
 *     everywhere, and no dialect but Anthropic's carries an image inside a
 *     tool result at all.
 *
 * `compose` is the caller's vision-turn composer (`composeVisionTurn`), passed
 * in rather than imported so this module never depends on a stream.
 * @param {Array<object>} exchange
 * @param {{images: string[], note: string}} sight
 * @param {(text: string, images: string[]) => Array<object>} compose
 * @returns {Array<object>} the exchange to push
 */
export const withSight = (exchange, sight, compose) => {
  if (!sight?.note) return exchange;
  const last = exchange[exchange.length - 1];
  const textTail = last?.role === 'user' && typeof last.content === 'string';
  if (sight.images.length === 0) {
    // Nothing to look at — the note still rides, so the being is never left to
    // assume it saw something.
    return textTail
      ? [...exchange.slice(0, -1), { ...last, content: `${last.content}\n\n${sight.note}` }]
      : [...exchange, { role: 'user', content: sight.note }];
  }
  return textTail
    ? [...exchange.slice(0, -1), { ...last, content: compose(`${last.content}\n\n${sight.note}`, sight.images) }]
    : [...exchange, { role: 'user', content: compose(sight.note, sight.images) }];
};
