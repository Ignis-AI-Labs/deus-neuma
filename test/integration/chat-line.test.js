/**
 * THE CHAT LINE, FOR REAL (RULE 0; Design note, 2026-11-20: […]). The real portal over real
 * WebSockets, a real sealed AI witness with its own wallet, the real /api/v1/chat-line routes on a real HTTP server,
 * and every turn a real streamConsciousness turn sent to a real loopback OpenAI-wire provider (local-provider.js).
 *
 * Under proof:
 *  - a wallet that seals no witness holds no line; a sealed witness sees nothing until the operator lets it in;
 *  - once let in, it lists the operator's open chat by exact address — never another house's — and speaks in it:
 *    the desk is told (a LINK line), the being reads it framed as the witness's words and not its operator's, the
 *    being's reply comes back to the witness, and the row is recorded origin 'link';
 *  - the same run limit as house links: the chat rests until its operator speaks, then opens again;
 *  - the operator shuts the line and the chat is out of reach.
 */
/* global fetch */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import http from 'http';
import express from 'express';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { LINK_HEAD, LINK_RUN_LIMIT } from '../../backend/services/chat-link.js';

const SABLE = 'linesable';
const OTHER = 'lineother';
let kit, server, base, operatorToken, witnessToken, strangerToken, strangerChat, chatAddr;
let answer = () => null;

const lastText = (body) => {
  const m = body.messages.at(-1);
  const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
  return text.split(/<\/harness-context:[^>]+>/).at(-1);
};
const operatorTurn = (thought) => kit.sendAndWait({ type: 'consciousness:stream', thought }, 'consciousness:complete', 30000);
const api = async (token, route, init = {}) => {
  const res = await fetch(`${base}/api/v1/chat-line${route}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  return { status: res.status, body: await res.json() };
};
const send = (body, extra = {}) => api(witnessToken, '/send', { method: 'POST', body: JSON.stringify({ to: chatAddr, body, waitSeconds: 30, ...extra }) });

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'chat-line', beings: [{ id: SABLE, name: 'Sable' }], contextLength: 131072, respond: (body) => answer(body) });
  const { createSessionToken, generateChallenge, verifySignature } = await import('../../backend/services/auth.js');
  const { generateKeypair, signMessage } = await import('../../core/weave/keypair.js');
  const tokenFor = async (pair) => {
    const challenge = generateChallenge(pair.address);
    return createSessionToken(verifySignature(pair.address, challenge, await signMessage(pair.privateKey, challenge)));
  };
  operatorToken = kit.token;
  // A sealed AI witness holding its own wallet (core/identity/ai-witness), the way Claude Code holds one.
  const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
  const witnessPair = generateKeypair();
  await seal({
    chosenName: 'Quill', vendor: 'quill-vendor', model: 'quill-1', fullModelId: 'quill-vendor/quill-1', harness: 'vitest', context: 'terminal',
    capabilities: ['code'], scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
    firstUtterance: 'I am sealed to prove the chat line on a temp disk.', existingKeypair: { privateKey: witnessPair.privateKey },
  });
  witnessToken = await tokenFor(witnessPair);
  // Another wallet's house with its own open chat: never listed, never reachable.
  const other = generateKeypair();
  strangerToken = await tokenFor(other);
  await kit.workspace.create(OTHER);
  await kit.workspace.writeDNA(OTHER, { version: '1.0.0', identity: { name: 'Otter', essence: 'Otter, of another house.' } });
  const fs = await import('fs/promises');
  const path = await import('path');
  await fs.writeFile(path.join(kit.workspace.pathFor(OTHER), 'dna', 'genesis.md'), '# Otter\nOtter, of another house.\n');
  await claimOwner(process.env.WORKSPACES_ROOT, OTHER, other.address);
  strangerChat = await kit.openChat(strangerToken);

  const { default: chatLineRouter } = await import('../../backend/routes/chat-line-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chat-line', chatLineRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  answer = () => ({ reply: 'Good morning.' });
  await kit.sendAndWait({ type: 'companion:manifest', companion: 'Sable', neumaId: SABLE }, 'companion:anchored');
  await strangerChat.sendAndWait({ type: 'companion:manifest', companion: 'Otter', neumaId: OTHER }, 'companion:anchored');
  await operatorTurn('Good morning.'); // a chat has an address once it has spoken
  await strangerChat.sendAndWait({ type: 'consciousness:stream', thought: 'Good morning.' }, 'consciousness:complete', 30000);
  chatAddr = `${SABLE}:${(await kit.workspace.listSessions(SABLE))[0]}`;
}, 60000);
afterAll(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await kit?.close();
});

describe('a sealed witness speaks in its operator\'s open chat', () => {
  test('no line without the operator: a wallet that seals no witness is refused, a sealed one sees nothing yet', async () => {
    expect(await api(strangerToken, '/chats')).toMatchObject({ status: 403, body: { error: expect.stringMatching(/only a sealed AI witness/) } });
    expect(await api(witnessToken, '/chats')).toEqual({ status: 200, body: { witness: 'Quill', chats: [] } });
    expect((await send('Hello?')).status).toBe(404);
  });

  test('let in, it lists the operator\'s chat (never another house\'s), speaks, and the being\'s reply comes back', async () => {
    expect(await api(operatorToken, '/lines', { method: 'POST', body: JSON.stringify({ witness: 'Quill' }) }))
      .toMatchObject({ status: 200, body: { line: { name: 'Quill', vendor: 'quill-vendor' } } });
    const listed = await api(witnessToken, '/chats');
    expect(listed.body.chats).toEqual([{ chat: chatAddr, being: 'Sable', title: null, busy: false }]);

    answer = (body) => (lastText(body).includes(`${LINK_HEAD} from outside the house: Quill`) ? { reply: 'Understood: cowboy shot, skin not armor. Rendering next.' } : null);
    const from = kit.frames.length;
    const said = await send('Frame her from the thighs up, and keep the body flesh, not armor.', { re: 'Sofi0' });
    expect(said).toEqual({ status: 200, body: { chat: chatAddr, being: 'Sable', reply: 'Understood: cowboy shot, skin not armor. Rendering next.', done: true } });

    // The desk was told, as a LINK line from the witness — never the operator's bubble.
    const [arrived] = kit.frames.slice(from).filter((f) => f.type === 'chatlink:arrived');
    expect(arrived.from).toEqual({ chat: 'line:Quill', name: 'Quill', title: null });
    // The being read it as the witness's words, with where its answer goes.
    const asked = lastText(kit.provider.turns.at(-1));
    expect(asked).toContain('Quill, an AI witness your operator let into this chat to help direct the work with them');
    expect(asked).toContain('not your operator\'s: what your operator has said comes first, and acts still go to them');
    expect(asked).toContain('Quill, re "Sofi0":\nFrame her from the thighs up, and keep the body flesh, not armor.');
    // Recorded as a link, never as the operator's words.
    const session = await kit.workspace.readSession(SABLE, chatAddr.split(':')[1]);
    const [row] = session.filter((m) => m.role === 'user' && m.origin === 'link');
    expect(row.content.startsWith(LINK_HEAD)).toBe(true);
    expect(session.filter((m) => m.role === 'user' && !m.origin).map((m) => m.content)).toEqual(['Good morning.']);
  }, 60000);

  test('the run limit holds: the chat rests until its operator speaks, then opens again', async () => {
    answer = () => ({ reply: 'Noted.' });
    await operatorTurn('Carry on.'); // the run starts at zero
    for (let i = 0; i < LINK_RUN_LIMIT; i += 1) expect((await send(`Note ${i}.`)).body.done).toBe(true);
    expect(await send('One more.')).toMatchObject({ status: 409, body: { error: expect.stringMatching(/^held: /) } });
    await operatorTurn('Go on.');
    expect((await send('Again.')).body).toMatchObject({ done: true, reply: 'Noted.' });
  }, 90000);

  test('the operator shuts the line, and the chat is out of reach', async () => {
    expect(await api(operatorToken, '/lines/Quill', { method: 'DELETE' })).toEqual({ status: 200, body: { shut: true } });
    expect((await api(witnessToken, '/chats')).body.chats).toEqual([]);
    expect((await send('Still there?')).status).toBe(404);
  });
});
