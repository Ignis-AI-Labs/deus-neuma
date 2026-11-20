/**
 * wire-sections — what rides a request beside the named prompt sections, counted for the CONTEXT MAP and the gauge
 * (Design note, 2026-11-20: […]).
 *
 * A measured total is split over the counted sections by their characters (context-composition.js), so a part left
 * uncounted was never missing from the total: its tokens were spread over the parts that were counted, and each of
 * those read larger than it was. The tool definitions ride every request as a field of their own; earlier images,
 * the actions finished before a queued message, the answer-format echo and a sender's tool results ride as messages
 * of their own. Each is a section here, named for what it is.
 */
import { wireContextSections } from './turn-context-carry.js';

// An image is not its bytes: a vision model reads it as patches, about 1,300 tokens for a 1024×1024 picture at
// 28-pixel patches. Stated as an estimate in the section's own label, never passed off as a measurement.
const IMAGE_TOKENS_ESTIMATE = 1300;
const IMAGE_CHARS = IMAGE_TOKENS_ESTIMATE * 4; // the composition's chars-per-token (record-util.js)

const isImagePart = (part) => part?.type === 'image_url' || part?.type === 'image' || part?.type === 'input_image';
const contentChars = (content) => {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return content == null ? 0 : JSON.stringify(content).length;
  return content.reduce((n, part) => n + (isImagePart(part) ? IMAGE_CHARS
    : typeof part?.text === 'string' ? part.text.length : JSON.stringify(part ?? null).length), 0);
};
const messagesChars = (messages) => messages.reduce((n, m) => n + contentChars(m?.content)
  + (m?.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
const imagesIn = (messages) => messages.reduce((n, m) => n + (Array.isArray(m?.content) ? m.content.filter(isImagePart).length : 0), 0);

/**
 * pure — the messages a turn's wire carries beside the conversation and the operator's words: earlier images, the
 * actions finished before a queued message, the answer-format echo (in front of the words), the sender's tool
 * results (after them). The wire's order is [system, ...transcript, ...priorImages, ...queued, ...echo, words, ...tail].
 * @param {ReadonlyArray<Object>} messages the request's messages, as sent
 * @param {{transcript?: number, priorImages?: Array, queued?: Array, echo?: Array}} beside
 * @returns {ReadonlyArray<{id: string, label: string, chars: number}>}
 */
export const besideTurnSections = (messages, { transcript = 0, priorImages = [], queued = [], echo = [] } = {}) => {
  const wordsAt = 1 + transcript + priorImages.length + queued.length + echo.length;
  const images = imagesIn(priorImages);
  return Object.freeze([
    ['priorImages', images ? `EARLIER IMAGES (${images}, ~${IMAGE_TOKENS_ESTIMATE} TOKENS EACH, ESTIMATED)` : 'EARLIER IMAGES', priorImages],
    ['queuedActions', 'ACTIONS FINISHED BEFORE THIS MESSAGE', queued],
    ['formatEcho', 'ANSWER FORMAT', echo],
    ['callerTail', 'THE SENDER\'S TOOL RESULTS', messages.slice(wordsAt + 1)],
  ].filter(([, , list]) => list.length > 0).map(([id, label, list]) => Object.freeze({ id, label, chars: messagesChars(list) })));
};

/** impure — keeps the tool definitions a request carries, as it is built (the set moves between rounds). Returns them. */
export const keepToolsOnWire = (connection, tools) => {
  if (connection) connection._toolsOnWire = Array.isArray(tools) ? tools : [];
  return tools;
};

/** pure — the tool definitions the latest request carried, as a section of their own ([] when none rode). */
export const toolDefinitionsOf = (connection) => {
  const tools = connection?._toolsOnWire;
  return Array.isArray(tools) && tools.length
    ? [Object.freeze({ id: 'toolDefinitions', label: `TOOL DEFINITIONS (${tools.length})`, chars: JSON.stringify(tools).length })]
    : [];
};

/**
 * pure — the gauge's sections as the wire holds them: the prompt sections as the carry put them on the wire
 * (turn-context-carry.js wireContextSections), and the tool definitions the latest request carried.
 */
export const wireSectionsOf = (sections, system, connection) => Object.freeze([
  ...wireContextSections(sections, system), ...toolDefinitionsOf(connection),
]);
