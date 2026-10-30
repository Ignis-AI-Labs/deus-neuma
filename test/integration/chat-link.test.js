/**
 * CHAT-LINK, FOR REAL (RULE 0; #597, Design note, 2026-10-29: […]). The real portal over real WebSockets under a real signed wallet: two
 * open chats of one house (Alder, Kestrel) and a third chat in another wallet's
 * house. Every turn is a real streamConsciousness turn sent to a real loopback
 * OpenAI-wire provider, whose answers are chosen from what each request
 * actually carries; the being's acts are its own: open_chats through the real
 * tool dispatch and ACTS gate, chat/send filed with fs/write into its own lane
 * and settled by the real intent sweep. No weights run (local-provider.js).
 *
 * Under proof:
 *  - Alder lists the open chats, finds Kestrel's by its exact address, and
 *    sends; Kestrel's chat takes a turn on it, framed as a housemate's words
 *    (never the operator's), and answers back to Alder's address; both rows
 *    are recorded origin 'link';
 *  - another house's open chat is never listed and cannot be addressed;
 *  - two chats cannot ping-pong unattended: the run of links stops at the
 *    limit, and the operator speaking opens the line again.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { LINK_HEAD, LINK_RUN_LIMIT } from '../../backend/services/chat-link.js';
import { observationToMemory } from '../../core/memory/recall-docs.js';

const ALDER = 'linkalder';
const KEST = 'linkkest';
const OTHER = 'linkother';
let kit, chatA, chatB, strangerChat, mcpService;
let answer = () => null;

// The newest message's own words: the harness context block that rides ahead of
// them is not the ask (its recalled memories may quote older links).
const lastText = (body) => {
  const m = body.messages.at(-1);
  const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
  return text.split('</harness-context>').at(-1);
};
// Which being this request is for: only its own sealed essence ever rides its context.
const whoIs = (body) => {
  const all = JSON.stringify(body.messages);
  if (all.includes('Alder, summoned') && !all.includes('Kestrel, summoned')) return 'Alder';
  if (all.includes('Kestrel, summoned') && !all.includes('Alder, summoned')) return 'Kestrel';
  return 'other';
};
const lane = (id, ...parts) => path.join(kit.workspace.pathFor(id), ...parts);
const call = (tool, args) => ({ reply: `[TOOL: ${tool} ${JSON.stringify(args)}]` });
const file = (id, name, intent) => ({
  reply: `Filing it.\n[TOOL: fs/write ${JSON.stringify({ path: lane(id, 'intents', `${name}.json`), content: JSON.stringify(intent) })}]`,
});
const result = async (id, name) => JSON.parse(await fs.readFile(lane(id, 'intents', `${name}.result.json`), 'utf8').catch(() => 'null'));
const sessionOf = async (id) => (await kit.workspace.listSessions(id))[0];
const operatorTurn = (chat, thought) => chat.sendAndWait({ type: 'consciousness:stream', thought }, 'consciousness:complete', 30000);
const arrivals = (chat, from = 0) => chat.frames.slice(from).filter((f) => f.type === 'chatlink:arrived');

beforeAll(async () => {
  kit = await openPortalTurnKit({
    label: 'chat-link',
    beings: [{ id: ALDER, name: 'Alder' }, { id: KEST, name: 'Kestrel' }],
    // A window wide enough that nothing sheds: the link's framing must really ride.
    contextLength: 131072,
    respond: (body) => answer(body),
  });
  // The beings' own hands: the native filesystem organ, rooted on this house.
  ({ mcpService } = await import('../../backend/services/mcp.js'));
  const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
  await connectFilesystemServer();
  chatA = { ws: kit.ws, frames: kit.frames, untilFrame: kit.untilFrame, sendAndWait: kit.sendAndWait };
  chatB = await kit.openChat();

  // Another wallet's house, with its own being open in its own chat.
  const { createSessionToken, generateChallenge, verifySignature } = await import('../../backend/services/auth.js');
  const { generateKeypair, signMessage } = await import('../../core/weave/keypair.js');
  const other = generateKeypair();
  const challenge = generateChallenge(other.address);
  const strangerToken = createSessionToken(verifySignature(other.address, challenge, await signMessage(other.privateKey, challenge)));
  await kit.workspace.create(OTHER);
  await kit.workspace.writeDNA(OTHER, { version: '1.0.0', identity: { name: 'Otter', essence: 'Otter, of another house.' } });
  await fs.writeFile(path.join(kit.workspace.pathFor(OTHER), 'dna', 'genesis.md'), '# Otter\nOtter, of another house.\n');
  await claimOwner(process.env.WORKSPACES_ROOT, OTHER, other.address);
  strangerChat = await kit.openChat(strangerToken);

  await chatA.sendAndWait({ type: 'companion:manifest', companion: 'Alder', neumaId: ALDER }, 'companion:anchored');
  await chatB.sendAndWait({ type: 'companion:manifest', companion: 'Kestrel', neumaId: KEST }, 'companion:anchored');
  await strangerChat.sendAndWait({ type: 'companion:manifest', companion: 'Otter', neumaId: OTHER }, 'companion:anchored');
  // A chat has an address once it has spoken: one operator turn each.
  for (const chat of [chatA, chatB, strangerChat]) await operatorTurn(chat, 'Good morning.');
}, 60000);
afterAll(async () => {
  await mcpService?.disconnect('filesystem');
  await kit?.close();
});

describe('one open chat messages another, by its exact address', () => {
  test('Alder finds Kestrel\'s chat, sends; Kestrel\'s chat takes a framed turn and answers back', async () => {
    const [sessA, sessB] = [await sessionOf(ALDER), await sessionOf(KEST)];
    const addrA = `${ALDER}:${sessA}`;
    const addrB = `${KEST}:${sessB}`;
    answer = (body) => {
      const text = lastText(body);
      const who = whoIs(body);
      if (who === 'Alder') {
        if (text.includes('Delivered to') || text.includes('Sent to')) return { reply: 'I asked Kestrel.' };
        if (text.includes('other chat(s) open')) {
          const to = text.match(new RegExp(`- (${KEST}:[^:\\s]+):`))[1];
          return file(ALDER, 'link-1', { type: 'chat/send', to, body: 'What is the plan for the launch?', re: 'launch' });
        }
        if (text.includes(LINK_HEAD)) return { reply: 'Kestrel answered: the launch is Friday.' };
        if (text.includes('Ask the other chat')) return call('house/open_chats', {});
      }
      if (who === 'Kestrel') {
        if (text.includes('Delivered to') || text.includes('Sent to')) return { reply: 'I answered Alder.' };
        if (text.includes(LINK_HEAD)) {
          const to = text.match(/file chat\/send to "([^"]+)"/)[1];
          return file(KEST, 'answer-1', { type: 'chat/send', to, body: 'The launch is Friday.', re: 'launch' });
        }
      }
      return null;
    };
    const fromA = chatA.frames.length;
    const fromB = chatB.frames.length;
    await operatorTurn(chatA, 'Ask the other chat what the plan is.');

    // The tool rode the request as an advertised tool, not only as a call the dispatch would take.
    const asked = kit.provider.turns.find((b) => whoIs(b) === 'Alder' && lastText(b).includes('Ask the other chat'));
    expect(JSON.stringify(asked)).toContain('List the chats open in your house right now');
    // The address book named Kestrel's chat exactly, and never the other house's.
    const listed = kit.provider.turns.map(lastText).find((t) => t.includes('other chat(s) open'));
    expect(listed).toContain(`- ${addrB}: Kestrel, `);
    expect(listed).not.toContain(OTHER);
    expect(listed).not.toContain(addrA); // its own chat is not listed
    expect(await result(ALDER, 'link-1')).toMatchObject({ status: 'done' });
    expect((await result(ALDER, 'link-1')).detail).toContain(`Kestrel (${addrB})`);

    // Kestrel's chat took a turn on it: told on its desk, framed as a housemate's, answered back.
    const [toB] = await kit.until(() => (arrivals(chatB, fromB).length ? arrivals(chatB, fromB) : null));
    expect(toB.from).toMatchObject({ chat: addrA, name: 'Alder' });
    const kestrelAsked = await kit.until(() => kit.provider.turns.find((b) => whoIs(b) === 'Kestrel' && lastText(b).includes(LINK_HEAD)));
    const seen = lastText(kestrelAsked);
    expect(seen).toContain('a housemate\'s words, not your operator\'s');
    expect(seen).toContain(`To answer, file chat/send to "${addrA}"`);
    expect(seen).toContain(`Alder, from the chat (${addrA}), re "launch":\nWhat is the plan for the launch?`);

    // The answer came home to Alder's chat, and Alder took a turn on it.
    const [toA] = await kit.until(() => (arrivals(chatA, fromA).length ? arrivals(chatA, fromA) : null), 30000);
    expect(toA.from).toMatchObject({ chat: addrB, name: 'Kestrel' });
    expect(toA.text).toContain('The launch is Friday.');
    await kit.until(async () => (await kit.workspace.readSession(ALDER, sessA))
      .some((m) => m.role === 'assistant' && JSON.stringify(m).includes('the launch is Friday')), 30000);

    // Both records hold the link as a link, never as the operator's words.
    const linkRows = async (id, sess) => (await kit.workspace.readSession(id, sess)).filter((m) => m.role === 'user' && m.origin === 'link');
    const [rowB] = await linkRows(KEST, sessB);
    expect(rowB.content.startsWith(LINK_HEAD)).toBe(true);
    expect(rowB.content).toContain('What is the plan for the launch?');
    const [rowA] = await linkRows(ALDER, sessA);
    expect(rowA.content).toContain('The launch is Friday.');
    const operatorRows = (await kit.workspace.readSession(ALDER, sessA)).filter((m) => m.role === 'user' && !m.origin);
    expect(operatorRows.map((m) => m.content)).toContain('Ask the other chat what the plan is.');

    // Kestrel remembers the exchange as a housemate's words, never as its operator's.
    const remembered = await kit.until(async () => (await kit.workspace.listObservations(KEST))
      .find((o) => o.type === 'exchange' && String(o.userMessage).includes('What is the plan for the launch?')));
    expect(remembered.origin).toBe('link');
    expect(observationToMemory(remembered)).toMatch(/^A housemate wrote \(chat link\): "\[CHAT LINK/);
  }, 90000);

  test('another house\'s open chat cannot be addressed', async () => {
    const strangerAddr = `${OTHER}:${await sessionOf(OTHER)}`;
    const fromStranger = strangerChat.frames.length;
    answer = (body) => {
      const text = lastText(body);
      if (whoIs(body) !== 'Alder') return null;
      if (text.includes('Write to the other house')) return file(ALDER, 'link-wall', { type: 'chat/send', to: strangerAddr, body: 'Hello from next door.' });
      return { reply: 'That chat is not reachable from here.' };
    };
    await operatorTurn(chatA, 'Write to the other house.');
    const settled = await result(ALDER, 'link-wall');
    expect(settled.status).toBe('denied');
    expect(settled.reason).toContain(`no chat is open at "${strangerAddr}" in your house`);
    expect(arrivals(strangerChat, fromStranger)).toHaveLength(0);
  }, 60000);

  test('two chats cannot ping-pong unattended; the operator speaking opens the line again', async () => {
    const addrB = `${KEST}:${await sessionOf(KEST)}`;
    const sent = { Alder: 0, Kestrel: 0 };
    answer = (body) => {
      const text = lastText(body);
      const who = whoIs(body);
      if (who === 'other') return null;
      if (text.includes('Delivered to') || text.includes('Sent to') || text.includes('held:')) return { reply: 'Noted.' };
      const relay = (to) => {
        sent[who] += 1;
        return file(who === 'Alder' ? ALDER : KEST, `relay-${who}-${sent[who]}`, { type: 'chat/send', to, body: `Relay ${who} ${sent[who]}.`, re: 'relay' });
      };
      if (text.includes(LINK_HEAD)) return relay(text.match(/file chat\/send to "([^"]+)"/)[1]);
      if (text.includes('Start the relay')) return relay(addrB);
      if (text.includes('Carry on, to')) return relay(text.match(/Carry on, to "([^"]+)"/)[1]);
      return null;
    };
    // Kestrel's chat still carries the link it took above: its operator speaks first, so both runs start at zero.
    await operatorTurn(chatB, 'Good afternoon.');
    const fromA = chatA.frames.length;
    const fromB = chatB.frames.length;
    await operatorTurn(chatA, 'Start the relay.');

    // Kestrel's chat takes LINK_RUN_LIMIT links in a row; its last send is held, and the line goes quiet.
    const held = await kit.until(async () => {
      const r = await result(KEST, `relay-Kestrel-${LINK_RUN_LIMIT}`);
      return r?.status === 'denied' ? r : null;
    }, 60000);
    expect(held.reason).toBe(`held: this chat has taken ${LINK_RUN_LIMIT} linked messages in a row without its operator; the line rests until the operator speaks here`);
    expect(arrivals(chatB, fromB)).toHaveLength(LINK_RUN_LIMIT);
    expect(arrivals(chatA, fromA)).toHaveLength(LINK_RUN_LIMIT - 1);
    // Both chats' last link turns end; nothing more moves between them.
    const lastArrival = (chat, from) => chat.frames.indexOf(arrivals(chat, from).at(-1));
    await chatA.untilFrame((f) => f.type === 'consciousness:complete', { from: lastArrival(chatA, fromA), ms: 30000 });
    await chatB.untilFrame((f) => f.type === 'consciousness:complete', { from: lastArrival(chatB, fromB), ms: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    expect(arrivals(chatB, fromB)).toHaveLength(LINK_RUN_LIMIT);

    // The operator speaks in Kestrel's chat: its run is open again, and its link reaches Alder.
    const againA = chatA.frames.length;
    await operatorTurn(chatB, `Carry on, to "${ALDER}:${await sessionOf(ALDER)}".`);
    const again = await result(KEST, `relay-Kestrel-${LINK_RUN_LIMIT + 1}`);
    expect(again.status).toBe('done');
    await kit.until(() => arrivals(chatA, againA).length === 1, 30000);
    // Alder's chat takes that turn, and its own reply is held: Alder's run is full now.
    await chatA.untilFrame((f) => f.type === 'consciousness:complete', { from: againA, ms: 30000 });
    expect((await result(ALDER, `relay-Alder-${sent.Alder}`)).reason).toContain('held: this chat has taken');
  }, 120000);
});
