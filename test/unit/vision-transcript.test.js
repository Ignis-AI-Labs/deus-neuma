/**
 * THE TRANSCRIPT CARRIES ITS IMAGES (vision-proof, Design note, 2026-10-16: […]). The benchmarks relay hands `neuma agent` the
 * request's messages verbatim; an image part must reach the model request as
 * the exact bytes, and the receipt must name what went out.
 *
 * RULE 0: real PNG bytes (image-fixtures.js), the real transcript seat, the
 * real wallet-bound attachment store and its redeemer, the portal's own vision
 * composer and the production body builders. No model is invoked here; the
 * live sitting on the real substrate is vision-transcript-live.test.js.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { seatCallerTranscript } from '../../backend/services/caller-tools.js';
import { resolveCallerTurn, stageCallerImages } from '../../cli/lib/caller-turn.js';
import { redeemAttachments, composeVisionTurn } from '../../backend/services/portal-turn-input.js';
import { buildStreamBody } from '../../backend/services/llm-request-builders.js';
import { wireImagesOf, wireImageRecorder } from '../../backend/services/wire-images.js';
import { benchmarkTurnPreset } from '../../backend/services/llm-presets.js';
import { MAX_DATA_URI_CHARS, MAX_IMAGES_PER_MESSAGE } from '../../backend/services/attachment-store.js';
import { solidPng } from '../helpers/image-fixtures.js';

const PNG = solidPng([12, 34, 56], 7, 5);
const URI = `data:image/png;base64,${PNG.toString('base64')}`;
const PNG_SHA256 = createHash('sha256').update(PNG).digest('hex');
const ASK = 'What six-digit number is shown?';
// The relay's vision-proof item: one user message, a text part and an image part.
const ITEM = Object.freeze([{ role: 'user', content: [{ type: 'text', text: ASK }, { type: 'image_url', image_url: { url: URI } }] }]);
const LLAMA = Object.freeze({ provider: 'llama-server', model: 'qwen', endpoint: 'http://127.0.0.1:1' });

// The wire as fetch sends it: the body serialized, as llm-provider does.
const sentBody = (config, messages) => JSON.parse(JSON.stringify(buildStreamBody(config, messages, {})));

describe('the relay\'s image item rides the operator\'s attachment path to the wire', () => {
  test('a single user message with an image part, no tools, becomes the thought plus its image', async () => {
    const caller = await resolveCallerTurn({ callerTools: [], transcript: ITEM }, process.cwd());
    expect(caller).toEqual({ tools: [], tail: [], thought: ASK, images: [URI] });
  });

  test('staged, redeemed and composed as the portal does, the request body carries the exact image data', async () => {
    const wallet = '0x00000000000000000000000000000000000a1b2c';
    const { thought, images } = await resolveCallerTurn({ callerTools: [], transcript: ITEM }, process.cwd());
    const staged = stageCallerImages(images, wallet);
    expect(staged.ids).toHaveLength(1);
    const redeemed = redeemAttachments({ walletAddress: wallet }, staged.ids);
    expect(redeemed).toEqual({ ok: true, images: [URI], docs: [] });
    // portal-stream's turn message: composeVisionTurn(words, redeemed images).
    const body = sentBody(LLAMA, [{ role: 'user', content: composeVisionTurn(thought, redeemed.images) }]);
    const user = body.messages.find((m) => m.role === 'user');
    expect(user.content[0].text.startsWith(ASK)).toBe(true);
    expect(user.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url)).toEqual([URI]);
    // Single use: the ids are spent by the turn that carried them.
    expect(redeemAttachments({ walletAddress: wallet }, staged.ids).ok).toBe(false);
  });

  test('a transcript without images stages nothing and keeps its former shape', async () => {
    expect(seatCallerTranscript([{ role: 'user', content: 'Oslo?' }])).toEqual({ thought: 'Oslo?', tail: [] });
    expect(stageCallerImages(undefined, '0x01')).toEqual({ ids: [] });
  });
});

describe('benchmark.imagesSent names the decoded bytes that went out', () => {
  test('a known PNG records its sha256, media type and byte length — of the bytes, not the base64', () => {
    const body = sentBody(LLAMA, [{ role: 'user', content: composeVisionTurn(ASK, [URI]) }]);
    expect(wireImagesOf(body)).toEqual([{ sha256: PNG_SHA256, mediaType: 'image/png', bytes: PNG.length }]);
    expect(PNG_SHA256).not.toBe(createHash('sha256').update(URI.split(',')[1]).digest('hex'));
    expect(PNG.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  test('the Responses wire\'s input_image parts are read the same way', () => {
    const body = sentBody({ provider: 'openai-chatgpt', model: 'm', endpoint: 'http://127.0.0.1:1' }, [{ role: 'user', content: composeVisionTurn(ASK, [URI]) }]);
    expect(wireImagesOf(body)).toEqual([{ sha256: PNG_SHA256, mediaType: 'image/png', bytes: PNG.length }]);
  });

  test('the media type is recorded lowercased', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: URI.replace('image/png', 'image/PNG') } }] }] };
    expect(wireImagesOf(body)[0].mediaType).toBe('image/png');
  });

  test('every round re-sends the conversation, yet each image is counted once per copy the caller sent', () => {
    const other = solidPng([200, 10, 10], 3, 3);
    const otherUri = `data:image/png;base64,${other.toString('base64')}`;
    const connection = {};
    const record = wireImageRecorder(connection);
    const round = sentBody(LLAMA, [{ role: 'user', content: composeVisionTurn(ASK, [URI, URI]) }]);
    record(round);
    record(round);
    record(sentBody(LLAMA, [{ role: 'user', content: composeVisionTurn(ASK, [URI, otherUri]) }]));
    expect(connection._benchmarkImagesSent.map((i) => i.sha256)).toEqual([PNG_SHA256, PNG_SHA256, createHash('sha256').update(other).digest('hex')]);
    const textOnly = {};
    wireImageRecorder(textOnly)(sentBody(LLAMA, [{ role: 'user', content: ASK }]));
    expect(textOnly._benchmarkImagesSent).toBeUndefined();
  });

  test('a benchmark turn\'s preset carries the sitting\'s wire observer to every request', () => {
    const onWireBody = () => {};
    expect(benchmarkTurnPreset({ sampling: { temperature: 0 }, onWireBody }).onWireBody).toBe(onWireBody);
    expect(benchmarkTurnPreset({ sampling: { temperature: 0 } })).toEqual({ temperature: 0, sharedOutputBudget: true });
  });
});

describe('an image the path cannot carry is refused out loud, never dropped', () => {
  const withImages = (urls) => [{ role: 'user', content: [{ type: 'text', text: ASK }, ...urls.map((url) => ({ type: 'image_url', image_url: { url } }))] }];

  test('outside the opening user message', () => {
    expect(seatCallerTranscript([...ITEM, { role: 'assistant', content: 'one moment' }, ...ITEM]).error).toMatch(/opening user message/);
    expect(seatCallerTranscript([{ role: 'system', content: [{ type: 'image_url', image_url: { url: URI } }] }, ...ITEM]).error).toMatch(/opening user message/);
  });

  test('a remote URL, a scripting format, an unknown part', () => {
    expect(seatCallerTranscript(withImages(['https://example.com/a.png'])).error).toMatch(/refused — not an accepted image data URI/);
    expect(seatCallerTranscript(withImages(['data:image/svg+xml;base64,PHN2Zy8+'])).error).toMatch(/not an accepted image data URI/);
    expect(seatCallerTranscript([{ role: 'user', content: [{ type: 'input_audio', input_audio: {} }] }]).error).toMatch(/text and image_url parts only/);
  });

  test('past the attachment caps: count, size, and the store\'s pending ceiling', () => {
    expect(seatCallerTranscript(withImages(Array(MAX_IMAGES_PER_MESSAGE + 1).fill(URI))).error).toMatch(/at most 4 images/);
    const huge = `data:image/png;base64,${'A'.repeat(MAX_DATA_URI_CHARS)}`;
    expect(seatCallerTranscript(withImages([huge])).error).toMatch(/image too large/);
    const wallet = '0x00000000000000000000000000000000000c4f5';
    for (let i = 0; i < 3; i++) expect(stageCallerImages(Array(4).fill(URI), wallet).ids).toHaveLength(4);
    expect(stageCallerImages([URI], wallet).error).toMatch(/could not be carried — too many pending attachments/);
  });
});
