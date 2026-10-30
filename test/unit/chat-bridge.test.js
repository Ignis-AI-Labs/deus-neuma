/**
 * THE CHAT BRIDGE's law (channel connections C-03/C-04/C-06, RULE 0): the
 * real door over real-shaped events (default-deny: a stranger gets one code,
 * an approved person is heard, a group only when it names the bot, a sender
 * past its attempts dropped, codes for an hour); the real normalizers over
 * payloads shaped as Telegram's Bot API and Discord's gateway send them; the
 * answers' request bodies; the WAITING ON YOU rows; the CHATS tab's words.
 */
import { describe, test, expect } from 'vitest';
import { atTheDoor, answerCode, revoke, emptyAccess, pairingWords, pairingCode, PAIR_ATTEMPTS_MAX, PAIR_TTL_MS } from '../../backend/services/channels/chat-access.js';
import { normalizeTelegram, telegramReply, createTelegramAdapter } from '../../backend/services/channels/adapters/telegram.js';
import { normalizeDiscord, discordReply, createDiscordAdapter, DISCORD_INTENTS } from '../../backend/services/channels/adapters/discord.js';
import { validateAdapter, makeMessageEvent } from '../../backend/services/channels/adapter-contract.js';
import { chatWaitingRows } from '../../backend/services/channels/chat-waiting.js';
import { chatLineWords, whoWords, codeAge } from '../../frontend/app/RelinkShell/chats-view.js';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const dm = (userId, text = 'hello', name = 'Cy') => makeMessageEvent({ channelId: 'telegram', connectionId: 'h:telegram-1', chat: { id: userId, type: 'dm' }, user: { id: userId, name }, text, messageId: '7' });
const group = (chatId, userId = '55') => makeMessageEvent({ channelId: 'telegram', connectionId: 'h:telegram-1', chat: { id: chatId, type: 'group' }, user: { id: userId, name: 'Pell' }, text: '@tidewater_bot tides?', messageId: '8' });

describe('the door: nobody is heard until the operator says so', () => {
  test('a stranger gets one code; their next words wait quietly; past the attempts they are dropped', () => {
    const first = atTheDoor(emptyAccess(), dm('42'), { nowMs: NOW, code: 'ABCD2345' });
    expect(first).toMatchObject({ door: 'pair', code: 'ABCD2345' });
    expect(first.access.pending).toEqual([{ code: 'ABCD2345', kind: 'user', id: '42', name: 'Cy', chat: { id: '42', type: 'dm' }, at: new Date(NOW).toISOString(), attempts: 1 }]);
    let access = first.access;
    for (let i = 2; i <= PAIR_ATTEMPTS_MAX; i += 1) {
      const again = atTheDoor(access, dm('42'), { nowMs: NOW + i });
      expect(again).toMatchObject({ door: 'quiet', why: 'its code waits on the operator' });
      access = again.access;
    }
    expect(atTheDoor(access, dm('42'), { nowMs: NOW + 99 }).why).toBe('past its attempts — dropped');
    expect(pairingWords('Ostra', 'ABCD2345')).toBe('Hello. To talk with Ostra here, ask its operator to approve this code: ABCD2345. Until then nothing you send is read.');
  });

  test('approved, a person is heard; denied or taken off, they are not; a code passes with its hour', () => {
    const { access } = atTheDoor(emptyAccess(), dm('42'), { nowMs: NOW, code: 'ABCD2345' });
    expect(answerCode(access, { code: 'zzzz', approve: true, by: 'operator', nowMs: NOW }).ok).toBe(false);
    const yes = answerCode(access, { code: 'abcd2345', approve: true, by: 'operator', nowMs: NOW });
    expect(yes.access).toEqual({ allowed: [{ kind: 'user', id: '42', name: 'Cy', by: 'operator', at: new Date(NOW).toISOString() }], pending: [] });
    expect(atTheDoor(yes.access, dm('42'), { nowMs: NOW })).toEqual({ door: 'hear' });
    const off = revoke(yes.access, { kind: 'user', id: '42' });
    expect(atTheDoor(off, dm('42'), { nowMs: NOW, code: 'NEWC0DE9' }).door).toBe('pair');
    const no = answerCode(access, { code: 'ABCD2345', approve: false, by: 'operator', nowMs: NOW });
    expect(no.access).toEqual({ allowed: [], pending: [] });
    expect(answerCode(access, { code: 'ABCD2345', approve: true, by: 'operator', nowMs: NOW + PAIR_TTL_MS + 1 }).ok).toBe(false);
  });

  test('a group: never heard unless it names the bot; then it pairs as a group, and once approved anyone in it is heard', () => {
    expect(atTheDoor(emptyAccess(), group('-100'), { nowMs: NOW })).toMatchObject({ door: 'quiet', why: 'a group message that does not name the bot' });
    const paired = atTheDoor(emptyAccess(), group('-100'), { nowMs: NOW, mentioned: true, code: 'GRP23456' });
    expect(paired.access.pending[0]).toMatchObject({ kind: 'group', id: '-100' });
    const yes = answerCode(paired.access, { code: 'GRP23456', approve: true, by: 'operator', nowMs: NOW });
    expect(atTheDoor(yes.access, group('-100', '77'), { nowMs: NOW, mentioned: true })).toEqual({ door: 'hear' });
    expect(atTheDoor(yes.access, group('-100', '77'), { nowMs: NOW, mentioned: false }).door).toBe('quiet');
  });

  test('a code: eight characters with no 0, O, 1, I or L', () => {
    for (let i = 0; i < 50; i += 1) expect(pairingCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
  });
});

describe('the adapters: Telegram\'s and Discord\'s own shapes', () => {
  const tgBot = { id: 9001, username: 'tidewater_bot' };
  test('Telegram: a private message is a direct chat; a group message names the bot, or answers it', () => {
    const update = { update_id: 3, message: { message_id: 11, from: { id: 42, is_bot: false, first_name: 'Cy', last_name: 'Ventures' }, chat: { id: 42, type: 'private' }, date: 1, text: 'hi there' } };
    const heard = normalizeTelegram(update, { connectionId: 'c', bot: tgBot });
    expect(heard.mentioned).toBe(true);
    expect(heard.event).toMatchObject({ channelId: 'telegram', chat: { id: '42', type: 'dm' }, user: { id: '42', name: 'Cy Ventures' }, text: 'hi there', messageId: '11' });
    const inGroup = { update_id: 4, message: { message_id: 12, from: { id: 55, first_name: 'Pell' }, chat: { id: -100, type: 'supergroup', title: 'Harbour' }, text: '@Tidewater_Bot tides today?', entities: [{ type: 'mention', offset: 0, length: 14 }] } };
    expect(normalizeTelegram(inGroup, { connectionId: 'c', bot: tgBot })).toMatchObject({ mentioned: true, event: { chat: { id: '-100', type: 'group' } } });
    expect(normalizeTelegram({ ...inGroup, message: { ...inGroup.message, entities: [] } }, { connectionId: 'c', bot: tgBot }).mentioned).toBe(false);
    expect(normalizeTelegram({ update_id: 5, message: { message_id: 13, from: { id: 1, is_bot: true }, chat: { id: 1, type: 'private' }, text: 'bot' } }, { connectionId: 'c', bot: tgBot })).toBeNull();
    expect(telegramReply({ id: '42', type: 'dm' }, 'answer', { replyTo: '11' })).toEqual({ chat_id: '42', text: 'answer', reply_parameters: { message_id: 11, allow_sending_without_reply: true } });
  });

  test('Discord: a DM is a direct chat; a server message names the bot, which is cut from the words', () => {
    const bot = { id: '777', username: 'tidewater' };
    const inDm = { id: '1', channel_id: '900', author: { id: '42', username: 'cy', global_name: 'Cy' }, content: 'hello', mentions: [] };
    expect(normalizeDiscord(inDm, { connectionId: 'c', bot })).toMatchObject({ mentioned: true, event: { channelId: 'discord', chat: { id: '900', type: 'dm' }, user: { id: '42', name: 'Cy' }, text: 'hello' } });
    const inServer = { id: '2', channel_id: '901', guild_id: '5', author: { id: '43', username: 'pell' }, content: '<@777> tides today?', mentions: [{ id: '777' }] };
    expect(normalizeDiscord(inServer, { connectionId: 'c', bot })).toMatchObject({ mentioned: true, event: { chat: { type: 'group' }, text: 'tides today?' } });
    expect(normalizeDiscord({ ...inServer, author: { id: '777', bot: true } }, { connectionId: 'c', bot })).toBeNull();
    expect(discordReply('answer', { replyTo: '2' })).toEqual({ content: 'answer', message_reference: { message_id: '2', fail_if_not_exists: false }, allowed_mentions: { parse: [] } });
    expect(DISCORD_INTENTS).toBe(512 + 4096 + 32768);
  });

  test('both keep the contract, and refuse a token that is not one', () => {
    const tg = createTelegramAdapter({ connectionId: 'c' });
    const dc = createDiscordAdapter({ connectionId: 'c' });
    expect([validateAdapter(tg), validateAdapter(dc)]).toEqual([{ ok: true }, { ok: true }]);
    // token-shaped, built at run time — no secret-looking literal in the source
    expect(tg.checkRequirements({ botToken: `${'1'.repeat(9)}:${'A'.repeat(35)}` })).toEqual({ ok: true });
    expect(tg.checkRequirements({ botToken: 'pasted-wrong' }).ok).toBe(false);
    expect(dc.checkRequirements({ botToken: ['M'.repeat(24), 'G'.repeat(6), 'a'.repeat(31)].join('.') })).toEqual({ ok: true });
    expect(dc.checkRequirements({ botToken: '' }).ok).toBe(false);
  });
});

describe('the operator\'s view', () => {
  test('WAITING ON YOU: one row per live code, landing on the platform\'s CHATS at that code', () => {
    const rows = chatWaitingRows({
      'telegram-1': { allowed: [], pending: [{ code: 'ABCD2345', kind: 'user', id: '42', name: 'Cy', at: new Date(NOW - 60_000).toISOString() }, { code: 'OLDC0DE2', kind: 'user', id: '9', name: 'Old', at: new Date(NOW - PAIR_TTL_MS - 1).toISOString() }] },
      'discord-1': { allowed: [], pending: [{ code: 'GRP23456', kind: 'group', id: '-1', name: 'Harbour', at: new Date(NOW).toISOString() }] },
    }, NOW);
    expect(rows).toEqual([
      { id: 'chat-pairing:telegram-1:ABCD2345', kind: 'chat-pairing', title: 'Cy asks to talk with the house on Telegram — code ABCD2345', where: { app: 'telegram', channelId: 'telegram', section: 'chats', accountId: 'telegram-1', code: 'ABCD2345' }, at: new Date(NOW - 60_000).toISOString() },
      { id: 'chat-pairing:discord-1:GRP23456', kind: 'chat-pairing', title: 'The group "Harbour" asks to talk with the house on Discord — code GRP23456', where: { app: 'discord', channelId: 'discord', section: 'chats', accountId: 'discord-1', code: 'GRP23456' }, at: new Date(NOW).toISOString() },
    ]);
  });

  test('CHATS: the line in one sentence, who, and how long a code waited', () => {
    expect(chatLineWords(false, [])).toBe('THE BOT HEARS NOBODY — TURN ON "CHATS WITH THE HOUSE" IN SETTINGS → SECURITY → CONNECTIONS');
    expect(chatLineWords(true, [])).toBe('ON — NO BOT OF THIS HOUSE HERE HAS A HOLDER AND ITS KEYS YET');
    expect(chatLineWords(true, [{ running: true }])).toBe('ON — HEARING THE BOT');
    expect(whoWords({ kind: 'group', name: 'Harbour' })).toBe('THE GROUP HARBOUR');
    expect(codeAge(new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe('5 MIN AGO');
  });
});
