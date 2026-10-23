/**
 * THE CLIP PLAYS ON THE POST CARD (integration, RULE 0 — no mocks).
 *
 * Design note, 2026-10-23: a forge clip a being attaches to a post by its id
 * (`media: [{image: […]}]`) showed nothing on the approval card, though the
 * queue board played it. Real: the TikTok house kit (real stores, signed
 * sessions, a REAL WebSocket pair the card crosses — TikTok's API is the local
 * stand-in, test/helpers/tiktok-stand-in.js), renders filed by the real image
 * store, a social/queue intent settled by the REAL sweep under a lane rule that
 * asks (the operator's own row), the real approval broker, then the card frame
 * as it arrived over the socket → the real action translator → the real reducer
 * → the PRODUCTION ApprovalChip rendered to HTML. Every card is answered DENY:
 * nothing is staged or sent. That the clip actually PLAYS in a browser on this
 * card is proven in real Chromium (forge-video-chip-browser.test.js).
 */
/* global setTimeout, Buffer */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { standTikTokHouses, CMO, OTHER } from '../helpers/tiktok-being-kit.js';
import { mp4Bytes } from '../helpers/tiktok-stand-in.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { requestToolApproval, resolveToolApproval } from '../../backend/services/tool-approval.js';
import { approvalRenders } from '../../backend/services/image-forge/approval-renders.js';
import { streamCardAction } from '../../frontend/app/RelinkShell/stream-card-actions.js';
import { run, streamingMsg } from '../helpers/stream-reducer-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(64, 1)]);
// The operator's own row on this lane: staging asks (the default lets it stage with no card).
const ASKS_TO_STAGE = Object.freeze({ intents: { requireApproval: ['social.queue'] } });

let kit; let clip; let still; let theirs; let ApprovalChip;

// The card as the desk folds it: the frame → the real translator → the real reducer → the chip, rendered.
const cardHtml = (frame) => {
  const { action } = streamCardAction(frame.type, frame, CMO);
  const [segment] = streamingMsg(run([{ type: 'USER_SENT', text: 'post it' }, { type: 'SPEECH', text: 'Staging.' }, action]))
    .segments.filter((s) => s.kind === 'approval');
  return { segment, html: renderToStaticMarkup(createElement(ApprovalChip, { segment, onRespond: () => {} })) };
};

beforeAll(async () => {
  kit = await standTikTokHouses();
  clip = await kit.render(CMO, 'clip.mp4', mp4Bytes(12, 400_000));
  still = await kit.render(CMO, 'still.png', PNG);
  theirs = await kit.render(OTHER, 'theirs.mp4', mp4Bytes(8, 200_000));
  kit.tiktok.state.processingReads = 0;
  // The sound engine registers a module-level `window` listener on import —
  // a browser fact a static render never exercises.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  ({ ApprovalChip } = await import('../../frontend/app/RelinkShell/ApprovalChip.jsx'));
}, 60_000);

afterAll(async () => kit?.close());

describe('a post card shows the forge render the being attached by id', () => {
  test('a TikTok draft with the being\'s own clip: the card that crossed the socket carries it, and the chip plays it', async () => {
    const connection = kit.connectionFor(CMO);
    const intents = path.join(workspace.pathFor(CMO), 'intents');
    await fs.mkdir(intents, { recursive: true });
    await fs.writeFile(path.join(intents, 'clip-post.json'), JSON.stringify({
      type: 'social/queue', channel: 'tiktok', text: 'Forge night #aiart', media: [{ image: clip.id, alt: 'the armillary turning' }],
    }));
    kit.decide = () => 'deny';
    const [receipt] = await sweepIntents(connection, { mode: 'ask', lanePolicy: ASKS_TO_STAGE, emit: () => {} });
    expect(receipt.status).toBe('denied');
    const card = kit.cards.at(-1);
    expect(card).toMatchObject({ type: 'tool:approval_request', tool: 'intents/social.queue' });
    expect(card.renders).toEqual([{ imageId: clip.id, mime: 'video/mp4', laneId: CMO, path: expect.any(String) }]);
    // The file's own place on disk rides the card, for its menu's SHOW IN FILES.
    expect(await fs.realpath(card.renders[0].path)).toBe(clip.path);
    expect(card.media).toBeUndefined(); // no brand card rides this post

    const { segment, html } = cardHtml(card);
    expect(segment.renders).toEqual(card.renders);
    expect(html).toContain('NEEDS APPROVAL');
    expect(html).toContain('class="approval-render"');
    expect(html).toContain('>VIDEO<');
    // The player is AuthImage: its bytes are fetched with the operator's token
    // once mounted; a static render shows its place holding the card's shape.
    expect(html).toContain('authimg-loading approval-render-media');
  }, 60_000);

  test('a still the being made shows as an image; another lane\'s id shows nothing', async () => {
    const frames = [];
    const connection = {
      companion: { name: CMO, neumaId: CMO },
      ws: { readyState: 1, OPEN: 1, send: (s) => frames.push(JSON.parse(s)) },
    };
    const deciding = requestToolApproval(connection, {
      tool: 'intents/social.post', args: { channel: 'x', text: 'Forge night', media: [{ image: still.id, alt: 'a still' }, { image: theirs.id, alt: 'not mine' }] },
      scope: 'publish to x NOW: "Forge night"',
    });
    for (let i = 0; i < 200 && !frames.length; i += 1) await new Promise((r) => setTimeout(r, 10));
    const [card] = frames;
    expect(card.renders).toEqual([{ imageId: still.id, mime: 'image/png', laneId: CMO, path: expect.any(String) }]);
    expect(await fs.realpath(card.renders[0].path)).toBe(still.path);
    resolveToolApproval(connection, card.id, 'deny');
    expect(await deciding).toBe('deny');

    const { html } = cardHtml(card);
    expect(html).toContain('>IMAGE<');
    expect(html).not.toContain('>VIDEO<');
  }, 30_000);

  test('the lookup reads only the asking lane\'s own manifest', () => {
    expect(approvalRenders(CMO, { media: [{ image: theirs.id }] })).toEqual([]);
    expect(approvalRenders(OTHER, { media: [{ image: theirs.id }] })).toEqual([{ imageId: theirs.id, mime: 'video/mp4', laneId: OTHER, path: expect.any(String) }]);
    expect(approvalRenders(null, { media: [{ image: clip.id }] })).toEqual([]);
    expect(approvalRenders(CMO, { media: [{ path: '/cards/a.png' }] })).toEqual([]);
  });
});
