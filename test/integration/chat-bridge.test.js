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
  const operator = { token: null };
  const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);

  beforeAll(async () => {
    saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
    house = await createWakeHouse();
    await house.serve([{ reply: 'Hello Cy. The house is listening: the tide tables for Brine are on our weekly sheet.' }]);
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
