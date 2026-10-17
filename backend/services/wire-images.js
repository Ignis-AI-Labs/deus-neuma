/**
 * WIRE IMAGES — the images a request body actually carried, as a benchmark
 * receipt records them (`benchmark.imagesSent`): the sha256 of the DECODED
 * bytes, the media type, the byte count. Read off the body the substrate
 * accepted (llm-provider's onWireBody), never off the caller's input, so the
 * record proves the pixels went out — a relay compares it to what it sent.
 *
 * Reads the image_url parts of the OpenAI chat wire (llama-server, LM Studio,
 * custom) and the input_image parts of the Responses wire. A dialect that
 * re-encodes an image without its media type (Ollama's bare base64) records
 * nothing, and the relay's exact match refuses that sample out loud.
 *
 * Pure, except the observer `wireImageRecorder` returns, which writes the
 * sitting's connection.
 */

import { createHash } from 'node:crypto';

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is;

// pure — the URL an image part names, in either wire's shape.
const imageUrlOf = (part) => {
  if (part?.type === 'image_url') return part.image_url?.url;
  if (part?.type === 'input_image') return part.image_url;
  return null;
};

/**
 * pure — one entry per image part the body carries, in order.
 * @param {object} body a built request body (llm-request-builders buildStreamBody)
 * @returns {Array<{sha256: string, mediaType: string, bytes: number}>}
 */
export const wireImagesOf = (body) => (body?.messages ?? body?.input ?? [])
  .flatMap((message) => (Array.isArray(message?.content) ? message.content : []))
  .map((part) => {
    const url = imageUrlOf(part);
    return typeof url === 'string' ? DATA_URI.exec(url) : null;
  })
  .filter(Boolean)
  .map(([, mediaType, base64]) => {
    const decoded = Buffer.from(base64, 'base64');
    return Object.freeze({
      sha256: createHash('sha256').update(decoded).digest('hex'),
      mediaType: mediaType.toLowerCase(),
      bytes: decoded.length,
    });
  });

const keyOf = (image) => `${image.sha256}:${image.mediaType}:${image.bytes}`;

/**
 * pure — fold one request's images into the sitting's record. Every round of
 * a turn re-sends the conversation, so counting per request would repeat each
 * image once per round: an image keeps the most copies any single request
 * carried, which is the multiset the caller sent.
 */
const mergeImagesSent = (recorded, sent) => {
  const countIn = (list, key) => list.filter((image) => keyOf(image) === key).length;
  const more = sent.filter((image, i) => countIn(sent.slice(0, i + 1), keyOf(image)) > countIn(recorded, keyOf(image)));
  return Object.freeze([...recorded, ...more]);
};

/** The observer a benchmark sitting hands the wire; it keeps the record on the connection. */
export const wireImageRecorder = (connection) => (body) => {
  const sent = wireImagesOf(body);
  if (sent.length > 0) connection._benchmarkImagesSent = mergeImagesSent(connection._benchmarkImagesSent ?? [], sent);
};
