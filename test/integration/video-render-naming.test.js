/**
 * A VIDEO RENDER SAYS VIDEO — through the REAL intent path (RULE 0, no mocks).
 *
 * Design note, 2026-10-23, watching a being animate a still into a TikTok clip: […]
 *
 * Real: tmp workspaces, a real still filed by the real image store, real filed
 * intents, the REAL sweep (validate → ACTS card → the operator's answer), the
 * real approval broker, and the real desk reducer + the PRODUCTION chips
 * rendered to HTML from the frames the sweep actually sent. The engine never
 * runs here — every card is answered DENY, so nothing reaches ComfyUI, the GPU
 * or the machine lane (the engine leg belongs to the excluded live lane); the
 * render-time words are proven on the pure map (test/unit/render-kind.test.js).
 * The one machine read is the real capacity probe a video filing makes before
 * its card; a machine that cannot hold a clip is refused in video words too.
 */
/* global process, Buffer, setTimeout */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { handleImageTool } from '../../backend/services/image-forge/image-being-tools.js';
import { streamCardAction } from '../../frontend/app/RelinkShell/stream-card-actions.js';
import { lifecycleAction } from '../../frontend/app/RelinkShell/stream-lifecycle-actions.js';
import { run, streamingMsg } from '../helpers/stream-reducer-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const LANE = 'videonamingecho';
const ENV_KEYS = ['COMFYUI_INSTALL_DIR', 'COMFYUI_CONTENT_LAW_PATH', 'NEUMA_DATA_ROOT', 'NEUMA_STAFF_COS_PATH'];
const PNG_2X2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxIHAgLADS3AR6O5ZFyAAAAAElFTkSuQmCC', 'base64');

let house; let origRoot; let savedEnv; let still; let ApprovalChip; let ToolChip;

// One seat whose socket records every frame the desk would receive, and whose
// emit sink records every chip event — one timeline, in the order they happened.
const seat = () => {
  const timeline = [];
  const connection = {
    companion: { name: 'VideoNamingEcho', neumaId: LANE },
    ws: { readyState: 1, OPEN: 1, send: (s) => timeline.push(JSON.parse(s)) },
  };
  return { connection, timeline, emit: (event) => timeline.push({ type: 'tool:usage', ...event }) };
};

const fileIntent = async (name, payload) => {
  const dir = path.join(workspace.pathFor(LANE), 'intents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
};

// File one intent and settle it through the real sweep; every card it raises
// is answered DENY on the real broker, so no act ever executes.
const settleDenying = async (name, payload) => {
  const { connection, timeline, emit } = seat();
  await fileIntent(name, payload);
  const sweeping = sweepIntents(connection, { mode: 'ask', lanePolicy: null, emit });
  let card = null;
  for (let i = 0; i < 400 && !card; i += 1) {
    card = timeline.find((f) => f.type === 'tool:approval_request') || null;
    if (card) break;
    const settled = await Promise.race([sweeping.then(() => true), new Promise((r) => setTimeout(() => r(false), 25))]);
    if (settled) break;
  }
  if (card) resolveToolApproval(connection, card.id, 'deny');
  const [receipt] = await sweeping;
  return { receipt, timeline, card };
};

// The desk's own path: frames → the real action translators → the real reducer
// → the PRODUCTION chips, rendered. What a person would read, as HTML.
const deskHtml = (timeline) => {
  const actions = [{ type: 'USER_SENT', text: 'animate it for TikTok' }, { type: 'SPEECH', text: 'On it.' }];
  for (const frame of timeline) {
    if (frame.type === 'tool:usage') actions.push(lifecycleAction('tool:usage', frame));
    else {
      const translated = streamCardAction(frame.type, frame, LANE);
      if (translated) actions.push(translated.action);
    }
  }
  const segments = streamingMsg(run(actions)).segments;
  return segments.map((segment) => {
    if (segment.kind === 'approval') return renderToStaticMarkup(createElement(ApprovalChip, { segment, onRespond: () => {} }));
    if (segment.kind === 'tool') return renderToStaticMarkup(createElement(ToolChip, { segment }));
    return '';
  }).join('\n');
};

beforeAll(async () => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  house = await createTempDir('video-naming-house');
  process.env.NEUMA_DATA_ROOT = house;
  process.env.NEUMA_STAFF_COS_PATH = path.join(house, 'staff-cos.json');
  origRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(house, 'workspaces'));
  await workspace.create(LANE);
  // A standing install the real probe recognizes (main.py + venv python) and a
  // readable law: both honesty gates pass, so the filings reach the screen and the card.
  const install = path.join(house, 'comfy-install');
  await fs.mkdir(path.join(install, '.venv', 'bin'), { recursive: true });
  await fs.writeFile(path.join(install, 'main.py'), '# probe fixture\n');
  await fs.writeFile(path.join(install, '.venv', 'bin', 'python'), '#!/bin/false\n');
  process.env.COMFYUI_INSTALL_DIR = install;
  const law = path.join(house, 'content-law.json');
  await fs.writeFile(law, JSON.stringify({ classes: { bestiality: ['testbannedterm'] } }));
  process.env.COMFYUI_CONTENT_LAW_PATH = law;
  // The being's own still, filed the way the forge files it.
  const out = path.join(house, 'engine-out');
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'job_00001_.png'), PNG_2X2);
  [still] = collectOutputs({ outputDir: out, outputs: [{ filename: 'job_00001_.png', subfolder: '', type: 'output' }], laneId: LANE, jobId: crypto.randomUUID() });
  // The sound engine registers a module-level `window` listener on import and
  // warms its sprite when the page goes idle — browser facts a static render
  // never exercises (a page that never idles never warms).
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  ({ ApprovalChip } = await import('../../frontend/app/RelinkShell/ApprovalChip.jsx'));
  ({ ToolChip } = await import('../../frontend/app/RelinkShell/ToolChip.jsx'));
}, 60_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setWorkspacesRoot(origRoot);
  await fs.rm(house, { recursive: true, force: true });
});

describe('a video filing reads video on every chip and card the desk shows', () => {
  test('a clip filed without its still is refused as video/generate, and the reason names the still it needs', async () => {
    const { receipt, timeline } = await settleDenying('no-still', { type: 'image/generate', pipeline: 'video.ltx.i2v', prompt: 'the water ripples outward' });
    expect(receipt.status).toBe('error');
    expect(receipt.error).toContain("'video.ltx.i2v' starts from one of your own images");
    const chip = timeline.find((f) => f.type === 'tool:usage');
    expect(chip).toMatchObject({ tool: 'intents/video.generate', summary: 'video/generate — invalid' });
    const html = deskHtml(timeline);
    expect(html).toContain('video/generate — invalid');
    expect(html).not.toContain('image/generate');
  }, 30_000);

  test('a clip from its own still: the card says video/generate and what it renders; the deny reads video too', async () => {
    const { receipt, timeline, card } = await settleDenying('clip', {
      type: 'image/generate', pipeline: 'video.ltx.i2v', image: still.imageId, aspect: 'portrait', prompt: 'the water ripples outward',
    });
    expect(receipt.status).toBe('denied');
    const html = deskHtml(timeline);
    if (card) {
      // A clip asks on its own grant row; the person reads the act.
      expect(card).toMatchObject({ tool: 'intents/video.generate', label: 'video/generate' });
      expect(card.scope).toBe(`render a video from image ${still.imageId}: "the water ripples outward" (video.ltx.i2v)`);
      expect(timeline.at(-1)).toMatchObject({ type: 'tool:usage', summary: 'video/generate — denied by operator' });
      expect(html).toContain('video/generate (render a video from image');
      expect(html).toContain('— DENIED');
    } else {
      // This machine cannot hold a clip: refused before any card, in video words.
      expect(receipt.error).toContain('this machine cannot render video');
      expect(timeline.at(-1)).toMatchObject({ summary: 'video/generate — denied' });
    }
    expect(html).toContain('video/generate');
    expect(html).not.toContain('intents/video.generate');
    expect(html).not.toContain('image/generate');
  }, 30_000);

  test('a still keeps saying image', async () => {
    const { receipt, timeline, card } = await settleDenying('still', { type: 'image/generate', prompt: 'a lighthouse at dusk' });
    expect(receipt.status).toBe('denied');
    expect(card).toMatchObject({ tool: 'intents/image.generate', label: 'image/generate', scope: 'render an image: "a lighthouse at dusk"' });
    const html = deskHtml(timeline);
    expect(html).toContain('image/generate (render an image: &quot;a lighthouse at dusk&quot;) — DENIED');
    expect(html).not.toContain('video');
  }, 30_000);
});

describe('review_image says which required field it is missing, so one retry is enough', () => {
  const review = (args) => {
    const chips = [];
    const { connection } = seat();
    return handleImageTool(connection.ws, connection, null, 'auto', { server: 'image', toolName: 'review_image', tool: 'image/review_image' }, args, {
      sendToolEvent: (_ws, _companion, event) => chips.push(event),
    }).then((result) => ({ result, chips }));
  };

  test('without matches: the refusal names matches, its values and the whole required set; then the whole call is kept', async () => {
    const refused = await review({ imageId: still.imageId, verdict: 'keep', note: 'clean water' });
    expect(refused.result.status).toBe('error');
    expect(refused.result.error).toContain('review_image needs matches (missing): one of yes, partial, no');
    expect(refused.result.error).toContain('{imageId, matches, verdict}');
    expect(refused.chips.at(-1).summary).toBe('review_image — needs matches');

    const kept = await review({ imageId: still.imageId, matches: 'yes', verdict: 'keep', note: 'clean water' });
    expect(kept.result.status).toBe('ok');
    expect(kept.chips.at(-1).summary).toBe('reviewed — keep · adherence yes');
  }, 30_000);
});
