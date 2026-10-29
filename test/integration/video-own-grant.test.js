/**
 * A VIDEO ASKS ON ITS OWN GRANT — through the REAL intent path (RULE 0, no mocks).
 *
 * Design note, 2026-10-23: a clip holds the machine for minutes and needs up to 40 GB of
 * RAM, so ALWAYS ALLOW for stills must not cover a video; the operator grants
 * video apart. Real: tmp workspaces, a real still filed by the real image store,
 * real filed intents, the REAL sweep (validate → policy → ACTS card → the
 * operator's ALWAYS → the grant persisted in the lane's own policy file), and the
 * next sweep reading that persisted policy back from disk.
 *
 * The engine never runs. Each act that is let through is interrupted at the
 * moment it begins (the operator's stop, the real abort path): the sweep has
 * already announced `executing` — the proof the act went through without a card
 * — and the aborted signal refuses the machine lane before anything is parked,
 * launched or rendered. Nothing reaches ComfyUI, the GPU or the model.
 */
/* global process, Buffer, setTimeout, AbortController */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { resolvePipeline } from '../../backend/services/image-forge/pack-registry.js';
import { forgeCapacity } from '../../backend/services/image-forge/forge-capacity.js';
import { probeMachine } from '../../backend/services/machine-probe.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const LANE = 'videograntecho';
const ENV_KEYS = ['COMFYUI_INSTALL_DIR', 'COMFYUI_CONTENT_LAW_PATH', 'NEUMA_DATA_ROOT', 'NEUMA_STAFF_COS_PATH'];
const PNG_2X2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxIHAgLADS3AR6O5ZFyAAAAAElFTkSuQmCC', 'base64');

let house; let origRoot; let savedEnv; let still; let videoFits;

const fileIntent = async (name, payload) => {
  const dir = path.join(workspace.pathFor(LANE), 'intents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
};

// File one intent and settle it through the real sweep on a FRESH seat (no
// session grant carries over — only what the lane's policy file holds). A card
// it raises is answered `answer`; an act let through is stopped as it begins.
const settle = async (name, payload, answer) => {
  const stop = new AbortController();
  const timeline = [];
  const connection = {
    companion: { name: 'VideoGrantEcho', neumaId: LANE },
    ws: { readyState: 1, OPEN: 1, send: (s) => timeline.push(JSON.parse(s)) },
  };
  const emit = (event) => {
    timeline.push({ type: 'tool:usage', ...event });
    if (event.status === 'executing') stop.abort();
  };
  await fileIntent(name, payload);
  const sweeping = sweepIntents(connection, { mode: 'ask', emit, signal: stop.signal });
  let card = null;
  for (let i = 0; i < 400 && !card; i += 1) {
    card = timeline.find((f) => f.type === 'tool:approval_request') || null;
    if (card) break;
    const settled = await Promise.race([sweeping.then(() => true), new Promise((r) => setTimeout(() => r(false), 25))]);
    if (settled) break;
  }
  if (card) resolveToolApproval(connection, card.id, answer);
  const [receipt] = await sweeping;
  const began = timeline.find((f) => f.type === 'tool:usage' && f.status === 'executing') || null;
  return { receipt, card, began };
};

// The lane's persisted policy, read the way the next sweep reads it.
const lanePolicy = () => workspace.readToolPolicy(LANE);
const clip = (n) => ({ type: 'image/generate', pipeline: 'video.ltx.i2v', image: still.imageId, aspect: 'portrait', prompt: `the water ripples outward ${n}` });
const picture = (n) => ({ type: 'image/generate', prompt: `a lighthouse at dusk ${n}` });

beforeAll(async () => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  house = await createTempDir('video-grant-house');
  process.env.NEUMA_DATA_ROOT = house;
  process.env.NEUMA_STAFF_COS_PATH = path.join(house, 'staff-cos.json');
  origRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(house, 'workspaces'));
  await workspace.create(LANE);
  // A standing install the real probe recognizes and a readable law: both
  // honesty gates pass, so every filing reaches the policy tier.
  const install = path.join(house, 'comfy-install');
  await fs.mkdir(path.join(install, '.venv', 'bin'), { recursive: true });
  await fs.writeFile(path.join(install, 'main.py'), '# probe fixture\n');
  await fs.writeFile(path.join(install, '.venv', 'bin', 'python'), '#!/bin/false\n');
  process.env.COMFYUI_INSTALL_DIR = install;
  const law = path.join(house, 'content-law.json');
  await fs.writeFile(law, JSON.stringify({ classes: { bestiality: ['testbannedterm'] } }));
  process.env.COMFYUI_CONTENT_LAW_PATH = law;
  const out = path.join(house, 'engine-out');
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'job_00001_.png'), PNG_2X2);
  [still] = collectOutputs({ outputDir: out, outputs: [{ filename: 'job_00001_.png', subfolder: '', type: 'output' }], laneId: LANE, jobId: crypto.randomUUID() });
  // The same capacity read a video filing makes before its card: a machine that
  // cannot hold a clip refuses it outright, and no grant question arises there.
  const pipeline = resolvePipeline('video.ltx.i2v').pipeline;
  videoFits = forgeCapacity(await probeMachine(), { videoRamGB: pipeline.ramGB }).video.ok;
}, 60_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setWorkspacesRoot(origRoot);
  await fs.rm(house, { recursive: true, force: true });
});

describe('ALWAYS for stills never covers a video; video is granted apart', () => {
  test('stills: the first asks; ALWAYS lands intents/image.generate; the next still runs with no card', async () => {
    const first = await settle('still-1', picture(1), 'always');
    expect(first.card).toMatchObject({ tool: 'intents/image.generate', label: 'image/generate' });
    expect(first.began).toMatchObject({ tool: 'intents/image.generate', summary: 'image/generate — working' });
    expect((await lanePolicy()).intents.allowed).toContain('image.generate');

    const next = await settle('still-2', picture(2), 'deny');
    expect(next.card).toBeNull();
    expect(next.began).toMatchObject({ tool: 'intents/image.generate', summary: 'image/generate — working' });
    // Stopped as it began: the machine lane refused the aborted act, nothing rendered.
    expect(next.receipt).toMatchObject({ tool: 'intents/image.generate', status: 'error' });
  }, 60_000);

  test('a video under the image grant still raises its own card; ALWAYS there lets the next video run', async (ctx) => {
    if (!videoFits) ctx.skip(); // this machine refuses clips before any card (video-render-naming covers that branch)
    const first = await settle('clip-1', clip(1), 'always');
    expect(first.card).toMatchObject({ tool: 'intents/video.generate', label: 'video/generate' });
    expect(first.card.scope).toBe(`render a video from image ${still.imageId}: "the water ripples outward 1" (video.ltx.i2v)`);
    expect(first.began).toMatchObject({ tool: 'intents/video.generate', summary: 'video/generate — working' });
    const policy = await lanePolicy();
    expect(policy.intents.allowed).toEqual(expect.arrayContaining(['image.generate', 'video.generate']));

    const next = await settle('clip-2', clip(2), 'deny');
    expect(next.card).toBeNull();
    expect(next.began).toMatchObject({ tool: 'intents/video.generate', summary: 'video/generate — working' });

    // The image grant still stands for stills, untouched by the video grant.
    const still3 = await settle('still-3', picture(3), 'deny');
    expect(still3.card).toBeNull();
    expect(still3.began).toMatchObject({ tool: 'intents/image.generate' });
  }, 60_000);

  test('a video card answered DENY settles denied and grants nothing', async (ctx) => {
    if (!videoFits) ctx.skip();
    // A lane policy holding only the still grant — the state an existing install upgrades into.
    await workspace.writeToolPolicy(LANE, { intents: { allowed: ['image.generate'] } });
    const asked = await settle('clip-3', clip(3), 'deny');
    expect(asked.card).toMatchObject({ tool: 'intents/video.generate', label: 'video/generate' });
    expect(asked.began).toBeNull();
    expect(asked.receipt).toMatchObject({ tool: 'intents/video.generate', status: 'denied' });
    expect((await lanePolicy()).intents.allowed).not.toContain('video.generate');
  }, 60_000);
});
