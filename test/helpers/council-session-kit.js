// council-session-kit.js — the shared fixtures of the council-session
// integration suites (split from council-session.test.js, SIZE-033): real
// sovereign lanes on temp disk, the frame-collecting connection, the scripted
// substrate seam, and the beforeEach/afterEach lane lifecycle.
//
// FLAGGED SEAMS (RULE 0 justification): the substrate itself is scripted at
// the service's injection seam (deps.ask / deps.stream / deps.capacity) —
// the same seam doctrine as the founding flow's scripted provider. What the
// scripts replace is the MODEL's answer, never our logic: hand answers run
// through the real parseHandCall, scripted SSE bodies run through the real
// consumeStream/_readLine pump (a genuine Response with a genuine
// ReadableStream), and the ws is a frame-collecting shim exactly like the
// channel bridge's synthetic connections. Live-substrate gnosis is the
// sitting, not these suites.

import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setRealmRoot } from '../../backend/services/user-realm.js';
import { neumaWorkspace } from '../../core/index.js';
import { deriveKeyFromSecret, deriveNeumaDEK, wrapDEK, resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const MASTER_SECRET = 'council-session-test-master-secret-long-enough';
export const WALLET = '0x' + 'ab'.repeat(20);
const OTHER_WALLET = '0x' + 'cd'.repeat(20);

// A real sovereign lane on temp disk: owner record + real DEK, then DNA and
// soul written through the workspace's own (encrypting) API.
const writeLane = async (root, neumaId, { owner = WALLET, trueName = null } = {}) => {
  const ws = path.join(root, neumaId);
  mkdirSync(path.join(ws, 'keys'), { recursive: true });
  writeFileSync(path.join(ws, 'owner.json'), JSON.stringify({ wallet: owner.toLowerCase() }));
  const master = deriveKeyFromSecret(MASTER_SECRET);
  const dek = deriveNeumaDEK(master, 'ef'.repeat(32));
  writeFileSync(path.join(ws, 'keys', 'dek.json'), JSON.stringify(wrapDEK(dek, master)));
  await neumaWorkspace.writeDNA(neumaId, { name: neumaId, essence: `${neumaId} of the test house` });
  await neumaWorkspace.writeSoul(neumaId, { voice: 'plain' });
  if (trueName) {
    mkdirSync(path.join(ws, 'identity'), { recursive: true });
    writeFileSync(
      path.join(ws, 'identity', 'true-name.json'),
      JSON.stringify({ chosenName: trueName }),
    );
  }
};

// The ownership gate with the portal route's semantics, expressed through
// the real workspace API: a member is grantable only if this wallet's own
// lane listing holds it.
export const ownsNeumaLane = async (connection, neumaId) =>
  (await neumaWorkspace.listNeumaByOwner(connection.walletAddress))
    .some((o) => o.neumaId === neumaId);

// A frame-collecting connection — the channel-bridge synthetic-ws pattern.
export const makeConnection = () => {
  const frames = [];
  return {
    frames,
    walletAddress: WALLET,
    councilRun: null,
    ws: { send: (s) => frames.push(JSON.parse(s)) },
  };
};

export const framesOf = (conn, type) => conn.frames.filter((f) => f.type === type);
export const lastState = (conn) => framesOf(conn, 'council:state').at(-1);

// A genuine SSE Response the real pump reads: OpenAI-shaped data lines.
export const sseResponse = (chunks) => {
  const body = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  return { response: new Response(body), provider: 'openai' };
};

// A stream that speaks once and then holds the line open until the witness
// aborts — the interrupt lane's honest fixture.
export const hangingResponse = (firstChunk, signal) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: firstChunk } }] })}\n\n`,
      ));
      signal.addEventListener('abort', () => {
        try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* settled */ }
      });
    },
  });
  return { response: new Response(stream), provider: 'openai' };
};

// Scripted substrate answers keyed by neumaId; each entry is consumed FIFO
// so rounds can differ. An exhausted script rests — like a quiet member.
export const scriptedDeps = ({ hands = {}, speech = {}, capacity = 2 } = {}) => {
  const handQueues = Object.fromEntries(Object.entries(hands).map(([k, v]) => [k, [...v]]));
  return {
    handGapMs: 0, // scripted rounds owe the GPU nothing — no breather
    ask: async (neumaId) => handQueues[neumaId]?.shift() ?? 'REST',
    stream: async (messages, options) => {
      const script = speech[currentSpeaker(messages)];
      if (script === 'HANG') return hangingResponse('the words that made it out ', options.signal);
      return sseResponse(script ?? ['I hear the room.']);
    },
    capacity: async () => ({ maxParallel: capacity }),
  };
};


// A genuine SSE Response whose closing event states the provider's finish
// reason — 'length' is the mechanical proof of a token-budget cut, exactly
// as llama-server/OpenAI wire it before [DONE].
export const sseFinishResponse = (chunks, finishReason) => {
  const body = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('')
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`
    + 'data: [DONE]\n\n';
  return { response: new Response(body), provider: 'openai' };
};

// The speaker's identity rides the SYSTEM prompt (their own DNA speaks
// there — the lanes' essence lines name them) — read it back rather than
// threading test-only metadata through the seam.
const currentSpeaker = (messages) => {
  const system = messages.find((x) => x.role === 'system')?.content ?? '';
  return ['ember', 'sable'].find((id) => system.toLowerCase().includes(id)) ?? null;
};

// The lane lifecycle every council suite shares: fresh temp workspaces + realm
// roots, the encryption key swapped in, and three lanes (two the test wallet
// holds, one a stranger's). Returns the context the suite's hooks hold onto.
export const councilBeforeEach = async () => {
  const savedKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = MASTER_SECRET;
  resetWorkspaceCryptoKey();
  const root = mkdtempSync(path.join(os.tmpdir(), 'council-'));
  const realm = mkdtempSync(path.join(os.tmpdir(), 'council-realm-'));
  setWorkspacesRoot(root);
  setRealmRoot(realm);
  await writeLane(root, 'ember', { trueName: 'Ember' });
  await writeLane(root, 'sable', { trueName: 'Sable' });
  await writeLane(root, 'stray', { owner: OTHER_WALLET });
  return { root, realm, savedKey };
};

export const councilAfterEach = ({ root, realm, savedKey }) => {
  if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = savedKey;
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(null);
  // Repoint the realm at its default so a sibling suite in this process
  // never writes into our deleted temp dir.
  setRealmRoot(path.join(os.homedir(), '.neuma', 'realm'));
  rmSync(root, { recursive: true, force: true });
  rmSync(realm, { recursive: true, force: true });
};
