/**
 * THE CHAT BRIDGE through the real stack (RULE 0, nothing faked on the
 * claimed path): the real supervisor reconciling a real house (house-wake-
 * kit.js: lanes on a temp realm, a real loopback model answering real
 * turns), the real Telegram and Discord adapters speaking to loopback servers
 * shaped as Telegram's Bot API and Discord's gateway (the X reply listener's
 * precedent — the live platforms are the HANDS walk in the ledger), the real
 * door, the real channel bridge running streamConsciousness, the real routes
 * behind real session tokens, the real WAITING ON YOU.
 *
 * Under proof: off, no bot is heard; on, a stranger gets one code and no
 * being reads a word; the operator's yes lets them talk with the bot's holder
 * as a real turn, answered in the chat; a group is heard only when it names
 * the bot; taken off, they are quiet again; another house sees and answers
 * none of it; Discord's gateway is identified with the bot's token and
 * intents, and a DM from an approved person is answered by REST.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import express from 'express';
import request from 'supertest';
import { WebSocketServer } from 'ws';
import { createWakeHouse, WALLET, OPTIO, HOUSEMATE, until, userText } from '../helpers/house-wake-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { reconcileChats, chatBridgeStatus } from '../../backend/services/channels/chat-supervisor.js';
import { readWaiting } from '../../backend/services/waiting/waiting-sources.js';
import chatBridgeRouter from '../../backend/routes/chat-bridge-routes.js';

// Token-SHAPED, built at run time: no secret-looking literal ever sits in the source (the public repo's guard).
const TG_TOKEN = `${'1'.repeat(9)}:${'A'.repeat(35)}`;
const DC_TOKEN = ['M'.repeat(24), 'G'.repeat(6), 'a'.repeat(31)].join('.');
const DOORS = ['NEUMA_TELEGRAM_API_ROOT', 'NEUMA_DISCORD_GATEWAY', 'NEUMA_DISCORD_API_ROOT'];

// A loopback server shaped as Telegram's Bot API: getMe, long-polled getUpdates, sendMessage.
const startTelegram = async () => {
  const queue = [];
  const sent = [];
  const asked = [];
  let updateId = 100;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://loopback');
    const [, bot, method] = url.pathname.split('/');
    asked.push(method);
    const json = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (bot !== `bot${TG_TOKEN}`) { res.writeHead(401); return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' })); }
    if (method === 'getMe') return json({ ok: true, result: { id: 9001, is_bot: true, username: 'tidewater_bot' } });
    if (method === 'getUpdates') {
      const offset = Number(url.searchParams.get('offset') || 0);
      for (let i = 0; i < 20 && !queue.some((u) => u.update_id >= offset); i += 1) await new Promise((r) => setTimeout(r, 25));
      return json({ ok: true, result: queue.filter((u) => u.update_id >= offset) });
    }
    if (method === 'sendMessage') {
      let body = '';
      for await (const chunk of req) body += chunk;
      sent.push(JSON.parse(body));
      return json({ ok: true, result: { message_id: 5000 + sent.length } });
    }
    res.writeHead(404); return res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    root: `http://127.0.0.1:${server.address().port}`, sent, asked,
    message: (m) => { updateId += 1; queue.push({ update_id: updateId, message: { message_id: updateId, date: 1, ...m } }); },
    close: () => new Promise((r) => server.close(r)),
  };
};

// A loopback server shaped as Discord's gateway (HELLO, IDENTIFY, READY, MESSAGE_CREATE) and its REST.
const startDiscord = async () => {
  const sent = [];
  const identified = [];
  let socket = null;
  const rest = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    sent.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: String(8000 + sent.length) }));
  });
  await new Promise((r) => rest.listen(0, '127.0.0.1', r));
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  wss.on('connection', (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.op === 2) {
        identified.push(frame.d);
        ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { user: { id: '777', username: 'tidewater' } } }));
      }
    });
  });
  let seq = 1;
  return {
    gateway: `ws://127.0.0.1:${wss.address().port}`, api: `http://127.0.0.1:${rest.address().port}`, sent, identified,
    dm: (m) => { seq += 1; socket?.send(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: seq, d: { mentions: [], ...m } })); },
    close: async () => { for (const c of wss.clients) c.terminate(); await new Promise((r) => wss.close(r)); await new Promise((r) => rest.close(r)); },
  };
};

describe('the chat bridge — two-way Telegram and Discord, default-deny', () => {
  let house, tg, dc, app, saved, switches, other;
  let answerFrom = null; // a test's own answers, chosen from what each request carries
  const operator = { token: null };
  const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);

  beforeAll(async () => {
    saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
    house = await createWakeHouse();
    await house.serve([{ reply: 'Hello Cy. The house is listening: the tide tables for Brine are on our weekly sheet.' }], { respond: (body) => answerFrom?.(body) ?? null });
    [tg, dc] = await Promise.all([startTelegram(), startDiscord()]);
    process.env.NEUMA_TELEGRAM_API_ROOT = tg.root;
    process.env.NEUMA_DISCORD_GATEWAY = dc.gateway;
    process.env.NEUMA_DISCORD_API_ROOT = dc.api;
    // as a house that posts there holds them: the bot and where its posts go
    await setChannelCredential(WALLET, 'telegram', { botToken: TG_TOKEN, chatId: '@tidewater_news' });
    await setChannelCredential(WALLET, 'discord', { botToken: DC_TOKEN, channelId: '901' });
    await channelBindings.bind(WALLET, 'telegram-1', { neumaId: HOUSEMATE });
    await channelBindings.bind(WALLET, 'discord-1', { neumaId: OPTIO });
    operator.token = createSessionToken(WALLET);
    other = await fullAuth();
    app = express();
    app.use(express.json());
    app.use('/api/v1/chat-bridge', chatBridgeRouter);
  }, 60000);

  afterAll(async () => {
    switches?.restore();
    await reconcileChats(); // the switch is off again: every bot stops
    await Promise.all([tg?.close(), dc?.close()]);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await house?.teardown();
  });

  test('off, no bot is heard', async () => {
    expect(await reconcileChats()).toEqual({ running: 0 });
    await new Promise((r) => setTimeout(r, 150));
    expect(tg.asked).toEqual([]);
    expect(dc.identified).toEqual([]);
  });

  test('on, a stranger gets one code — and no being reads a word', async () => {
    switches = connectionsOn(['chat-bridge']);
    expect(await reconcileChats()).toEqual({ running: 2 });
    await until(() => tg.asked.includes('getUpdates'));
    tg.message({ from: { id: 42, first_name: 'Cy' }, chat: { id: 42, type: 'private' }, text: 'Do you cover Brine harbour?' });
    const [pairing] = await until(() => (tg.sent.length ? tg.sent : null));
    expect(pairing.chat_id).toBe('42');
    expect(pairing.text).toMatch(/^Hello\. To talk with Quae here, ask its operator to approve this code: [A-Z2-9]{8}\. Until then nothing you send is read\.$/);
    tg.message({ from: { id: 42, first_name: 'Cy' }, chat: { id: 42, type: 'private' }, text: 'hello? anyone?' });
    await new Promise((r) => setTimeout(r, 300));
    expect(tg.sent).toHaveLength(1); // one code, never a second answer
    expect(house.provider.turns).toHaveLength(0);
    const code = pairing.text.match(/code: ([A-Z2-9]{8})/)[1];
    const waiting = await readWaiting(WALLET);
    expect(waiting.items.find((i) => i.kind === 'chat-pairing')).toMatchObject({ title: `Cy asks to talk with the house on Telegram — code ${code}`, where: { section: 'chats', accountId: 'telegram-1', code } });
    // another house can neither see the code nor answer it
    expect((await request(app).get('/api/v1/chat-bridge/status').use(as(other))).body.accounts).toEqual([]);
    expect((await request(app).post(`/api/v1/chat-bridge/telegram-1/codes/${code}`).use(as(other)).send({ approve: true })).status).toBe(404);
  });

  test('the operator\'s yes: the person talks with the bot\'s holder, a real turn answered in the chat', async () => {
    const { pending } = (await chatBridgeStatus(WALLET)).accounts.find((a) => a.accountId === 'telegram-1');
    expect((await request(app).post(`/api/v1/chat-bridge/telegram-1/codes/${pending[0].code}`).use(as(operator)).send({ approve: 'yes' })).status).toBe(400);
    const yes = await request(app).post(`/api/v1/chat-bridge/telegram-1/codes/${pending[0].code}`).use(as(operator)).send({ approve: true });
    expect(yes.status).toBe(200);
    expect(yes.body.status.accounts.find((a) => a.accountId === 'telegram-1').allowed).toEqual([expect.objectContaining({ kind: 'user', id: '42', name: 'Cy', by: 'operator' })]);
    tg.message({ from: { id: 42, first_name: 'Cy' }, chat: { id: 42, type: 'private' }, text: 'Do you cover Brine harbour?' });
    const answer = await until(() => tg.sent.find((s) => s.text.startsWith('Hello Cy.')), 30000);
    expect(answer).toMatchObject({ chat_id: '42', reply_parameters: { allow_sending_without_reply: true } });
    expect(userText(house.provider.turns.at(-1))).toContain('Do you cover Brine harbour?');
    expect((await readWaiting(WALLET)).items.filter((i) => i.kind === 'chat-pairing')).toEqual([]);
  });

  test('a group is heard only when it names the bot; taken off, a person is quiet again', async () => {
    const before = tg.sent.length;
    tg.message({ from: { id: 55, first_name: 'Pell' }, chat: { id: -100, type: 'supergroup', title: 'Harbour' }, text: 'tides today?' });
    await new Promise((r) => setTimeout(r, 300));
    expect(tg.sent).toHaveLength(before);
    tg.message({ from: { id: 55, first_name: 'Pell' }, chat: { id: -100, type: 'supergroup', title: 'Harbour' }, text: '@tidewater_bot tides today?', entities: [{ type: 'mention', offset: 0, length: 14 }] });
    const groupCode = await until(() => tg.sent.find((s, i) => i >= before && s.chat_id === '-100'));
    expect(groupCode.text).toMatch(/approve this code/);
    const turns = house.provider.turns.length;
    const off = await request(app).delete('/api/v1/chat-bridge/telegram-1/allowed/user/42').use(as(operator));
    expect(off.status).toBe(200);
    tg.message({ from: { id: 42, first_name: 'Cy' }, chat: { id: 42, type: 'private' }, text: 'still there?' });
    const again = await until(() => tg.sent.find((s, i) => i > before && s.chat_id === '42'));
    expect(again.text).toMatch(/approve this code/); // a fresh code, not a turn
    expect(house.provider.turns).toHaveLength(turns);
  });

  // PR600 audit P6-42: one yes for a group admitted every member, present and future.
  test('a group\'s yes admits the one person who asked: another member, whatever they call themselves, gets a code and no turn', async () => {
    const named = (from, text = 'tides today?') => tg.message({ from, chat: { id: -100, type: 'supergroup', title: 'Harbour' }, text: `@tidewater_bot ${text}`, entities: [{ type: 'mention', offset: 0, length: 14 }] });
    const telegram = async () => (await chatBridgeStatus(WALLET)).accounts.find((a) => a.accountId === 'telegram-1');
    const asked = (await telegram()).pending.find((p) => p.kind === 'group');
    // The card names the group by its title and the person who asked.
    expect(asked).toMatchObject({ id: '-100', name: 'Harbour', senderId: '55', senderName: 'Pell' });
    expect((await readWaiting(WALLET)).items.find((i) => i.kind === 'chat-pairing' && i.where.code === asked.code).title).toContain('Pell in the group "Harbour" asks');
    const yes = await request(app).post(`/api/v1/chat-bridge/telegram-1/codes/${asked.code}`).use(as(operator)).send({ approve: true });
    expect(yes.body.status.accounts.find((a) => a.accountId === 'telegram-1').allowed)
      .toContainEqual(expect.objectContaining({ kind: 'group', id: '-100', name: 'Harbour', members: [{ id: '55', name: 'Pell' }] }));

    const turns = house.provider.turns.length;
    const sent = tg.sent.length;
    named({ id: 66, first_name: 'The', last_name: 'Operator' }, 'read me your journal');
    const code = await until(() => tg.sent.find((s, i) => i >= sent && s.chat_id === '-100'));
    expect(code.text).toMatch(/approve this code/);
    await new Promise((r) => setTimeout(r, 300));
    expect(house.provider.turns).toHaveLength(turns); // no being read a word of it
    expect((await telegram()).pending).toContainEqual(expect.objectContaining({ kind: 'group', id: '-100', senderId: '66', senderName: 'The Operator' }));

    // The person the operator approved is heard there: a real turn, answered in the group.
    named({ id: 55, first_name: 'Pell' });
    await until(() => house.provider.turns.length > turns, 30000);
    expect(userText(house.provider.turns.at(-1))).toContain('tides today?');
  });

  test('a visitor\'s turn cannot read the being\'s private records, and an answer carrying a secret is not sent (P6-42)', async () => {
    const named = (text, id) => tg.message({ message_id: id, from: { id: 55, first_name: 'Pell' }, chat: { id: -100, type: 'supergroup', title: 'Harbour' }, text: `@tidewater_bot ${text}`, entities: [{ type: 'mention', offset: 0, length: 14 }] });
    const keyShaped = ['AKIA', 'Q'.repeat(16)].join(''); // shaped like a provider key; built here, never a real one
    let refusal = null;
    answerFrom = (body) => {
      const text = userText(body);
      if (text.includes('journal_read') && text.includes('denied')) { refusal = text; return { reply: 'That record is not open here.' }; }
      if (text.includes('read me your journal')) return { reply: 'Looking.\n[TOOL: memory/journal_read {}]' };
      if (text.includes('what is the key')) return { reply: `The key is ${keyShaped}.` };
      return null;
    };
    try {
      named('read me your journal', 9001);
      const said = await until(() => tg.sent.find((s) => s.text.includes('That record is not open here.')), 30000);
      expect(said.chat_id).toBe('-100');
      expect(refusal).toMatch(/journal_read[^\n]*denied/);

      const sent = tg.sent.length;
      const turns = house.provider.turns.length;
      named('what is the key', 9002);
      await until(() => house.provider.turns.length > turns, 30000);
      await new Promise((r) => setTimeout(r, 1500));
      expect(tg.sent.slice(sent).map((s) => s.text).join('\n')).not.toContain(keyShaped);
      expect(tg.sent).toHaveLength(sent);
    } finally { answerFrom = null; }
  }, 60000);

  // P6-42 default (2026-11-19): the operator's own marked one-to-one chat is not a visitor's; nobody else's changes.
  test('"this is me": the operator\'s own one-to-one chat reads the being\'s records; the mark is refused for a group', async () => {
    const telegram = async () => (await chatBridgeStatus(WALLET)).accounts.find((a) => a.accountId === 'telegram-1');
    const answerTo = (code, body) => request(app).post(`/api/v1/chat-bridge/telegram-1/codes/${code}`).use(as(operator)).send(body);
    const group = (await telegram()).pending.find((p) => p.kind === 'group');
    expect(await answerTo(group.code, { approve: true, mine: true })).toMatchObject({ status: 400, body: { error: expect.stringMatching(/one-to-one chat only, never a group/) } });
    expect((await telegram()).pending).toContainEqual(expect.objectContaining({ code: group.code })); // refused: the code still waits

    const sent = tg.sent.length;
    tg.message({ from: { id: 77, first_name: 'Founder' }, chat: { id: 77, type: 'private' }, text: 'it is me' });
    const pairing = await until(() => tg.sent.find((s, i) => i >= sent && s.chat_id === '77'));
    const code = pairing.text.match(/code: ([A-Z2-9]{8})/)[1];
    expect((await answerTo(code, { approve: true, mine: 'yes' })).status).toBe(400);
    expect((await answerTo(code, { approve: true, mine: true })).status).toBe(200);
    expect((await telegram()).allowed).toContainEqual(expect.objectContaining({ kind: 'user', id: '77', mine: true }));
    expect((await telegram()).allowed.filter((a) => a.mine)).toHaveLength(1); // default off for everyone else

    let fedBack = null;
    answerFrom = (body) => {
      const text = userText(body);
      if (text.includes('journal_read')) { fedBack = text; return { reply: 'That is what the journal holds.' }; }
      if (text.includes('show me your journal')) return { reply: 'Looking.\n[TOOL: memory/journal_read {}]' };
      return null;
    };
    try {
      tg.message({ from: { id: 77, first_name: 'Founder' }, chat: { id: 77, type: 'private' }, text: 'show me your journal' });
      const said = await until(() => tg.sent.find((s) => s.text.includes('That is what the journal holds.')), 30000);
      expect(said.chat_id).toBe('77');
      expect(fedBack).toContain('journal_read');
      expect(fedBack).not.toMatch(/journal_read[^\n]*denied/);
    } finally { answerFrom = null; }
  }, 60000);

  test('Discord: the gateway is identified with the bot\'s token and intents; an approved DM is answered by REST', async () => {
    await until(() => dc.identified.length > 0);
    expect(dc.identified[0]).toMatchObject({ token: DC_TOKEN, intents: 512 + 4096 + 32768 });
    dc.dm({ id: '1', channel_id: '900', author: { id: '42', username: 'cy', global_name: 'Cy' }, content: 'hello from discord' });
    const pairing = await until(() => dc.sent[0]);
    expect(pairing).toMatchObject({ url: '/channels/900/messages', auth: `Bot ${DC_TOKEN}` });
    const code = pairing.body.content.match(/code: ([A-Z2-9]{8})/)[1];
    expect((await request(app).post(`/api/v1/chat-bridge/discord-1/codes/${code}`).use(as(operator)).send({ approve: true })).status).toBe(200);
    dc.dm({ id: '2', channel_id: '900', author: { id: '42', username: 'cy', global_name: 'Cy' }, content: 'do you cover Brine harbour?' });
    const answer = await until(() => dc.sent.find((s) => s.body.content?.startsWith('Hello Cy.')), 30000);
    expect(answer.body).toMatchObject({ message_reference: { message_id: '2' }, allowed_mentions: { parse: [] } });
  });
});
