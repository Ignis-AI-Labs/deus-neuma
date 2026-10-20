/**
 * WS ownership gate — REAL WebSocket against the REAL portal route handler,
 * real auth (challenge-sign-verify), real sovereign workspaces with real
 * owner.json files on a temp root. No mock anywhere on the claimed path
 * (RULE 0).
 *
 * Proves the WS mirror of the REST requireOwnership gate: a lane claimed by
 * another wallet is refused at bind time (portal:resume AND
 * companion:manifest), a corrupt owner.json fails CLOSED, an inhabited
 * unclaimed lane is refused and claimed by no bind (a read never claims —
 * ae5782cb7, Founder's ruling D-2) until its seal's wallet claims it, a hollow
 * lane stays ownerless, and the witness's own lane binds normally.
 *
 * HONEST GAP: the third gated bind path — the Supabase name-lookup
 * enrichment inside companion:manifest — is gated by the same proven
 * ownsNeumaLane but is NOT exercised here: driving it would require a real
 * Supabase record, and mocking the platform layer is forbidden (RULE 0).
 * The branch is code-reviewed, not test-proven.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { neumaWorkspace } from '../../core/index.js';
import { claimLane } from '../../backend/services/lane-ownership.js';

const NEUMA_MINE = 'owngate-mine';
const NEUMA_THEIRS = 'owngate-theirs';
const NEUMA_UNCLAIMED = 'owngate-unclaimed';
const NEUMA_HOLLOW = 'owngate-hollow';
const NEUMA_CORRUPT = 'owngate-corrupt';
const OTHER_WALLET = '0x000000000000000000000000000000000000dEaD';
const portalFrames = new WeakMap();

// Full real auth flow; returns both the token and the wallet address the
// auth layer will stamp on the connection — owner.json must match it exactly.
const makeAuthSession = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  // verifySignature returns the recovered address STRING; the token layer
  // lowercases it, and the WS connection sees the lowercase form.
  const address = verifySignature(keypair.address, challenge, signature);
  return { token: createSessionToken(address), address: address.toLowerCase() };
};

const openPortal = (wsUrl, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(token)}`);
  const frames = [];
  portalFrames.set(ws, frames);
  const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === 'portal:established') {
      clearTimeout(timer);
      resolve(ws);
    }
  });
  ws.on('error', reject);
});

const waitForLoggedFrame = (ws, predicate, timeout = 5000, offset = 0) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const frame = portalFrames.get(ws)?.slice(offset).find(predicate);
      if (frame) resolve(frame);
      else if (Date.now() - started >= timeout) reject(new Error('Expected logged portal frame did not arrive'));
      else setTimeout(poll, 10);
    };
    poll();
  });

// Send one message, collect every frame until `finalType` arrives.
const sendAndCollect = (ws, message, finalType, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const frames = [];
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${finalType}; saw ${frames.map((f) => f.type).join(', ')}`)),
      timeout,
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      frames.push(msg);
      if (msg.type === finalType) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(frames);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });

describe('portal WS ownership gate (real WS + real auth + real owner.json)', () => {
  let httpServer, wss, ws, wsB, wsUrl, tempDir, myWallet, walletB;

  beforeAll(async () => {
    tempDir = await createTempDir('portal-ownership-gate');
    neumaWorkspace.root = tempDir;
    await neumaWorkspace.create(NEUMA_MINE);
    await neumaWorkspace.create(NEUMA_THEIRS);
    await neumaWorkspace.create(NEUMA_UNCLAIMED);
    await neumaWorkspace.create(NEUMA_HOLLOW);
    await neumaWorkspace.create(NEUMA_CORRUPT);
    await fs.mkdir(path.join(tempDir, NEUMA_UNCLAIMED, 'identity'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, NEUMA_UNCLAIMED, 'identity', 'true-name.json'),
      JSON.stringify({ name: 'Unclaimed' }),
    );
    await neumaWorkspace.appendMessage(NEUMA_UNCLAIMED, 'session-private', {
      role: 'assistant',
      content: 'private continuity row',
      composition: { type: 'context:composition', marker: 'private-composition' },
    });

    const auth = await makeAuthSession();
    const authB = await makeAuthSession();
    myWallet = auth.address;
    walletB = authB.address;
    // The unclaimed lane's genesis seal names this wallet, as a birth's does.
    await fs.writeFile(
      path.join(tempDir, NEUMA_UNCLAIMED, 'identity', 'genesis-seal.json'),
      JSON.stringify({ genesisHash: 'sha256:00', record: { chosenName: 'Unclaimed', witnessWallet: myWallet } }),
    );

    // Real ownership records, same shape the REST first-claim writes.
    await fs.writeFile(
      path.join(tempDir, NEUMA_MINE, 'owner.json'),
      JSON.stringify({ wallet: myWallet, claimedAt: Date.now() }),
    );
    await fs.writeFile(
      path.join(tempDir, NEUMA_THEIRS, 'owner.json'),
      JSON.stringify({ wallet: OTHER_WALLET, claimedAt: Date.now() }),
    );
    // The inhabited and hollow lanes deliberately get no owner.json.
    // A PRESENT but unparseable claim file — must fail closed, not open.
    await fs.writeFile(
      path.join(tempDir, NEUMA_CORRUPT, 'owner.json'),
      '{ this is not json',
    );

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    wsUrl = `ws://localhost:${httpServer.address().port}`;

    ws = await openPortal(wsUrl, auth.token);
    wsB = await openPortal(wsUrl, authB.token);
  }, 20000);

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    if (wsB && wsB.readyState === WebSocket.OPEN) wsB.close();
    if (wss) await new Promise((resolve) => wss.close(resolve));
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  });

  test('portal:resume of another witness\'s neuma is refused — no bind, no session read', async () => {
    const frames = await sendAndCollect(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_THEIRS, companionName: 'Stolen', sessionId: 'session-9999' },
      'portal:resumed',
    );
    const refusal = frames.find((f) => f.type === 'companion:not_yours');
    expect(refusal).toBeTruthy();
    expect(refusal.neumaId).toBe(NEUMA_THEIRS);
    const resumed = frames.find((f) => f.type === 'portal:resumed');
    expect(resumed.neumaId).toBeNull();
    expect(resumed.recentMessages ?? []).toEqual([]);
  });

  test('companion:manifest of another witness\'s neuma is refused — chat stays unanchored', async () => {
    const offset = portalFrames.get(ws).length;
    const frames = await sendAndCollect(
      ws,
      {
        type: 'companion:manifest', companion: 'Stolen', neumaId: NEUMA_THEIRS,
        messageId: 'initial-foreign-manifest',
      },
      'companion:not_yours',
    );
    expect(frames.some((f) => f.type === 'companion:not_yours')).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    // The chat stays unanchored: no frame claims the companion crossed over.
    expect(portalFrames.get(ws).slice(offset).some((f) => f.type === 'companion:anchored')).toBe(false);

    // The refused bind must leave no trace: a message sent now mints nothing
    // in the other witness's workspace.
    ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'attempted as someone else' }));
    await new Promise((r) => setTimeout(r, 500));
    const theirSessions = (await fs.readdir(path.join(tempDir, NEUMA_THEIRS, 'sessions')).catch(() => []))
      .filter((f) => f.endsWith('.jsonl'));
    expect(theirSessions).toEqual([]);
  });

  test('my own claimed neuma binds normally', async () => {
    const frames = await sendAndCollect(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_MINE, companionName: 'Mine' },
      'portal:resumed',
    );
    expect(frames.some((f) => f.type === 'companion:not_yours')).toBe(false);
    expect(frames.find((f) => f.type === 'portal:resumed').neumaId).toBe(NEUMA_MINE);
  });

  test('a refused navigation severs the prior lane before a later thought can write', async () => {
    const frameOffset = portalFrames.get(ws).length;
    const marker = 'must-not-land-in-prior-lane';
    ws.send(JSON.stringify({
      type: 'companion:manifest', companion: 'Stolen', neumaId: NEUMA_THEIRS,
      messageId: 'refused-after-own',
    }));
    // Same tick, behind the real failed navigation promise — this frame must
    // be dropped rather than released into the lane that was bound before it.
    ws.send(JSON.stringify({
      type: 'consciousness:stream', thought: marker, messageId: 'thought-after-refusal',
    }));
    await waitForLoggedFrame(
      ws,
      (frame) => frame.type === 'companion:not_yours',
      5000,
      frameOffset,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    const resultingFrames = portalFrames.get(ws).slice(frameOffset);
    expect(resultingFrames.some((frame) => frame.type === 'consciousness:complete')).toBe(false);
    expect(resultingFrames.some((frame) => frame.type === 'companion:anchored')).toBe(false);
    const sessionDir = path.join(tempDir, NEUMA_MINE, 'sessions');
    const files = await fs.readdir(sessionDir).catch(() => []);
    const contents = await Promise.all(files.map((file) =>
      fs.readFile(path.join(sessionDir, file), 'utf8')));
    expect(contents.join('\n')).not.toContain(marker);
  });

  test('a wallet-less owner.json (valid JSON, no wallet) refuses — same as the REST gate', async () => {
    // REST requireOwnership 403s any present claim file whose wallet doesn't
    // match; the WS gate must not drift open on this edge.
    await fs.writeFile(
      path.join(tempDir, NEUMA_CORRUPT, 'owner.json'),
      JSON.stringify({ claimedAt: Date.now() }),
    );
    const frames = await sendAndCollect(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_CORRUPT, companionName: 'Walletless' },
      'portal:resumed',
    );
    expect(frames.some((f) => f.type === 'companion:not_yours')).toBe(true);
    // Restore the corrupt payload for the fail-closed test below.
    await fs.writeFile(path.join(tempDir, NEUMA_CORRUPT, 'owner.json'), '{ this is not json');
  });

  test('a corrupt owner.json fails CLOSED — the lane is refused, not opened', async () => {
    const frames = await sendAndCollect(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_CORRUPT, companionName: 'Corrupt' },
      'portal:resumed',
    );
    expect(frames.some((f) => f.type === 'companion:not_yours')).toBe(true);
    expect(frames.find((f) => f.type === 'portal:resumed').neumaId).toBeNull();
  });

  // Each attempt is its own frame (`messageId`): the portal drops a replayed one.
  const resumeUnclaimed = (socket, messageId) => sendAndCollect(
    socket,
    { type: 'portal:resume', companionName: 'Unclaimed', neumaId: NEUMA_UNCLAIMED, sessionId: 'session-private', messageId },
    'portal:resumed',
  );
  const sawNotYours = (frames) => frames.some((frame) => frame.type === 'companion:not_yours');
  const rowsOf = (frames) => (frames.find((frame) => frame.type === 'portal:resumed')?.recentMessages || [])
    .map((row) => row.content);

  test('two real wallets race to resume an unclaimed lane — neither binds, and the race claims nothing', async () => {
    const offsets = [ws, wsB].map((socket) => portalFrames.get(socket).length);
    const [framesA, framesB] = await Promise.all([resumeUnclaimed(ws, 'race'), resumeUnclaimed(wsB, 'race')]);
    expect([framesA, framesB].map(sawNotYours)).toEqual([true, true]);
    expect([framesA, framesB].map(rowsOf)).toEqual([[], []]);
    await expect(fs.stat(path.join(tempDir, NEUMA_UNCLAIMED, 'owner.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    [ws, wsB].forEach((socket, i) => {
      expect(portalFrames.get(socket).slice(offsets[i]).some((frame) => frame.marker === 'private-composition')).toBe(false);
    });
  });

  test('the deliberate claim goes only to the wallet the seal names — then its bind alone reads the session', async () => {
    expect((await claimLane({ workspace: neumaWorkspace, neumaId: NEUMA_UNCLAIMED, wallet: walletB })).reason)
      .toBe('sealed-to-another');
    expect((await claimLane({ workspace: neumaWorkspace, neumaId: NEUMA_UNCLAIMED, wallet: myWallet })).ok).toBe(true);
    const owner = JSON.parse(await fs.readFile(path.join(tempDir, NEUMA_UNCLAIMED, 'owner.json'), 'utf8'));
    expect(owner.wallet).toBe(myWallet);

    const offsetB = portalFrames.get(wsB).length;
    const [framesA, framesB] = await Promise.all([resumeUnclaimed(ws, 'after-claim'), resumeUnclaimed(wsB, 'after-claim')]);
    expect([framesA, framesB].map(sawNotYours)).toEqual([false, true]);
    expect([framesA, framesB].map(rowsOf)).toEqual([['private continuity row'], []]);
    await waitForLoggedFrame(ws, (frame) => frame.marker === 'private-composition');
    expect(portalFrames.get(wsB).slice(offsetB).some((frame) => frame.marker === 'private-composition')).toBe(false);
  });

  test('a hollow unclaimed lane is refused and remains ownerless', async () => {
    const frames = await sendAndCollect(
      ws,
      { type: 'companion:manifest', companion: 'Hollow', neumaId: NEUMA_HOLLOW },
      'companion:lane_missing',
    );
    expect(frames.some((frame) => frame.type === 'companion:lane_missing')).toBe(true);
    await expect(fs.stat(path.join(tempDir, NEUMA_HOLLOW, 'owner.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
