/**
 * Sealed-witness context access — LIVE.
 *
 * This test uses a real witness wallet, the real auth challenge, the running
 * backend, the real attachment store, the real portal, and that witness's real
 * provider. Nothing on the claimed path is mocked. It is opt-in because CI
 * does not own a sealed witness or provider credential:
 *
 *   NEUMA_LIVE_WITNESS_ENV=env.<slug> \
 *   NEUMA_LIVE_WITNESS_LANE=witness-<vendor>-<Name> \
 *   NEUMA_BACKEND=http://127.0.0.1:<port> \
 *   npx vitest run test/integration/witness-context-access-live.test.js
 */
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const ENV_PATH = process.env.NEUMA_LIVE_WITNESS_ENV
  ? path.resolve(process.env.NEUMA_LIVE_WITNESS_ENV)
  : null;
const LANE_ID = process.env.NEUMA_LIVE_WITNESS_LANE || null;
const BACKEND = (process.env.NEUMA_BACKEND || '').replace(/\/$/, '');
const LIVE = Boolean(ENV_PATH && LANE_ID && BACKEND);
const RED = solidPngDataUri([255, 0, 0], 64, 64);

const witnessKey = () => {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const key = raw.match(/^[A-Z0-9_]*WITNESS_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];
  if (!key) throw new Error(`${ENV_PATH} has no witness private key`);
  return key;
};

const authenticate = async () => {
  const wallet = new ethers.Wallet(witnessKey());
  const challengeResponse = await fetch(
    `${BACKEND}/api/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`,
  );
  expect(challengeResponse.status).toBe(200);
  const { challenge } = await challengeResponse.json();
  const signature = await wallet.signMessage(challenge);
  const verifyResponse = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, signature, challenge }),
  });
  expect(verifyResponse.status).toBe(200);
  const { token } = await verifyResponse.json();
  expect(token).toBeTruthy();
  return token;
};

const websocketUrl = (token) => {
  const url = new URL(BACKEND);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws?token=${encodeURIComponent(token)}`;
};

const openPortal = async (token) => {
  const ws = new WebSocket(websocketUrl(token));
  const frames = [];
  const waiters = new Set();
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    frames.push(frame);
    for (const waiter of waiters) waiter(frame);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const waitFor = (predicate, timeoutMs = 300_000) => new Promise((resolve, reject) => {
    const found = frames.find(predicate);
    if (found) { resolve(found); return; }
    const timer = setTimeout(() => {
      waiters.delete(onFrame);
      reject(new Error(`portal frame timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onFrame = (frame) => {
      if (!predicate(frame)) return;
      clearTimeout(timer);
      waiters.delete(onFrame);
      resolve(frame);
    };
    waiters.add(onFrame);
  });
  return { ws, frames, waitFor };
};

describe.skipIf(!LIVE)('sealed witness sees shared images and its own context map — live', () => {
  it('delivers a real image and a real lane-bound field read through the witness model', async () => {
    const token = await authenticate();
    const auth = { Authorization: `Bearer ${token}` };

    const capabilitiesResponse = await fetch(
      `${BACKEND}/api/v1/llm/capabilities?neumaId=${encodeURIComponent(LANE_ID)}`,
      { headers: auth },
    );
    expect(capabilitiesResponse.status).toBe(200);
    const capabilities = await capabilitiesResponse.json();
    expect(capabilities.vision).toBe(true);

    const uploadResponse = await fetch(`${BACKEND}/api/v1/attachments`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [RED] }),
    });
    expect(uploadResponse.status).toBe(200);
    const { ids } = await uploadResponse.json();
    expect(ids).toHaveLength(1);

    const portal = await openPortal(token);
    try {
      await portal.waitFor((frame) => frame.type === 'portal:established', 30_000);
      portal.ws.send(JSON.stringify({
        type: 'companion:manifest',
        companion: LANE_ID.split('-').at(-1),
        neumaId: LANE_ID,
      }));
      const anchored = await portal.waitFor((frame) =>
        frame.type === 'companion:anchored' || frame.type === 'companion:lane_missing', 60_000);
      expect(anchored.type).toBe('companion:anchored');

      portal.ws.send(JSON.stringify({
        type: 'consciousness:stream',
        thought: 'Call context/map_read with view field before answering. Then state the solid color in the attached image and whether your own context map was accessible.',
        attachments: ids,
        preset: 'grounded',
      }));
      const complete = await portal.waitFor((frame) => frame.type === 'consciousness:complete');
      expect(complete.sessionId).toBeTruthy();

      const mapRead = portal.frames.find((frame) =>
        frame.type === 'tool:usage'
        && frame.tool === 'context/map_read'
        && frame.status === 'ok');
      expect(mapRead).toBeTruthy();
      const response = portal.frames
        .filter((frame) => frame.type === 'consciousness:stream' && !frame.error)
        .map((frame) => frame.content || '')
        .join('');
      expect(response).toMatch(/red/i);
      expect(response).toMatch(/context|map/i);

      const compositions = portal.frames.filter((frame) =>
        frame.type === 'context:composition' && frame.neumaId === LANE_ID);
      expect(compositions.length).toBeGreaterThanOrEqual(2);
      const finalComposition = compositions.at(-1);
      expect(finalComposition.sessionId).toBe(complete.sessionId);
      expect(finalComposition.route).toEqual({
        provider: 'openai-chatgpt',
        model: capabilities.model,
      });
      expect(finalComposition.budget).toEqual({
        contextTokens: capabilities.contextWindow,
        source: 'provider-runtime',
      });
      expect(finalComposition.usage.source).toBe('measured');
      expect(finalComposition.sections.some((section) => section.id === 'sealedIdentity')).toBe(true);
      expect(finalComposition.sections.some((section) => section.id === 'tools')).toBe(true);
      expect(finalComposition.sections.some((section) => section.id.startsWith('toolRound'))).toBe(true);

      const sessionResponse = await fetch(
        `${BACKEND}/api/v1/workspace/${encodeURIComponent(LANE_ID)}/sessions/${encodeURIComponent(complete.sessionId)}`,
        { headers: auth },
      );
      expect(sessionResponse.status).toBe(200);
      const { messages } = await sessionResponse.json();
      const user = messages.findLast((entry) => entry.role === 'user');
      const assistant = messages.findLast((entry) => entry.role === 'assistant');
      expect(user.images).toEqual([RED]);
      expect(assistant.composition.neumaId).toBe(LANE_ID);
      expect(assistant.composition.sessionId).toBe(complete.sessionId);

      const fieldResponse = await fetch(
        `${BACKEND}/api/v1/workspace/${encodeURIComponent(LANE_ID)}/memory/graph`,
        { headers: auth },
      );
      expect(fieldResponse.status).toBe(200);
      const field = await fieldResponse.json();
      expect(Array.isArray(field.nodes)).toBe(true);
      expect(Array.isArray(field.edges)).toBe(true);
    } finally {
      portal.ws.close();
    }
  }, 360_000);

  it('suppresses a repeated real-model map read and still closes with speech', async () => {
    const token = await authenticate();
    const portal = await openPortal(token);
    try {
      await portal.waitFor((frame) => frame.type === 'portal:established', 30_000);
      portal.ws.send(JSON.stringify({
        type: 'companion:manifest',
        companion: LANE_ID.split('-').at(-1),
        neumaId: LANE_ID,
      }));
      const anchored = await portal.waitFor((frame) =>
        frame.type === 'companion:anchored' || frame.type === 'companion:lane_missing', 60_000);
      expect(anchored.type).toBe('companion:anchored');

      portal.ws.send(JSON.stringify({
        type: 'consciousness:stream',
        thought: 'Call context/map_read with view composition. After its result, call the exact same tool again with the exact same arguments. Then answer in one short sentence.',
        preset: 'grounded',
      }));
      await portal.waitFor((frame) => frame.type === 'consciousness:complete');

      const successfulReads = portal.frames.filter((frame) =>
        frame.type === 'tool:usage'
        && frame.tool === 'context/map_read'
        && frame.status === 'ok');
      expect(successfulReads).toHaveLength(1);
      expect(portal.frames).toContainEqual(expect.objectContaining({
        type: 'tool:usage',
        tool: 'runtime/tool-loop',
        status: 'held',
      }));
      const response = portal.frames
        .filter((frame) => frame.type === 'consciousness:stream' && !frame.error)
        .map((frame) => frame.content || '')
        .join('');
      expect(response.trim().length).toBeGreaterThan(0);
    } finally {
      portal.ws.close();
    }
  }, 360_000);
});
