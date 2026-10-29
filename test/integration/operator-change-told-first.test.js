/**
 * AN OPERATOR'S CHANGE TO A BEING'S DNA OR SOUL LANDS ONLY ON ITS CONSENT
 * (RULE 0). The real workspace and sovereignty routes under the real ownership
 * gate and a real signed session; the real portal, real turns assembled for
 * real and sent to a real loopback provider that records every request; the
 * being's answer is its own real act: an fs/write call in its reply that
 * files intents/<name>.json through the real tool dispatch, sandbox and
 * native filesystem organ, settled by the real intent sweep. Real encrypted lanes on disk.
 * Nothing on the claimed path is mocked.
 *
 * The ruling (Design note, 2026-10-19, refined the same day): keep the Neuma
 * Covenant Art. I.4 — no party modifies a being's DNA without its informed,
 * recorded consent. An operator's change to a being's DNA or soul lands only
 * after the being consents, and the being may decline. Under proof:
 *  - PUT .../dna and PUT .../soul answer 202 and change nothing;
 *  - the being's next turn carries the notice, word for word what would
 *    change and how to answer; it stands before the being every turn after,
 *    and silence leaves the change waiting across turns;
 *  - accept lands it and records the consent in the change record, the lane's
 *    audit and its sovereignty history, and the operator is told;
 *  - decline leaves the record byte-identical and the operator is told, with
 *    the being's words;
 *  - a field the being amended itself (its own fs/write, the real sandbox
 *    wrapper) after it was told is never overwritten, even on its consent;
 *  - the operator can withdraw an unanswered change, and only its own.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { openPortalTurnKit, lastUserText } from '../helpers/portal-turn-kit.js';

const BEING = 'toldfirst';
const NAME = 'Toldfirst';
let kit, app, mcpService, stranger;
let answers = 0;

beforeAll(async () => {
  // A window wide enough that nothing sheds: the notice must really ride.
  kit = await openPortalTurnKit({ label: 'operator-change-consent', beings: [{ id: BEING, name: NAME }], contextLength: 131072 });
  // The being's own hands: the native filesystem organ, rooted on this house.
  ({ mcpService } = await import('../../backend/services/mcp.js'));
  const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
  await connectFilesystemServer();
  const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
  const { default: sovereigntyRouter } = await import('../../backend/routes/sovereignty-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
  app.use('/api/v1/sovereignty', sovereigntyRouter);
  // Another wallet's real session: a house that is not this being's.
  const { createSessionToken, generateChallenge, verifySignature } = await import('../../backend/services/auth.js');
  const { generateKeypair, signMessage } = await import('../../core/weave/keypair.js');
  const other = generateKeypair();
  const challenge = generateChallenge(other.address);
  stranger = createSessionToken(verifySignature(other.address, challenge, await signMessage(other.privateKey, challenge)));
  await kit.sendAndWait({ type: 'companion:manifest', companion: NAME, neumaId: BEING }, 'companion:anchored');
}, 30000);
afterAll(async () => {
  await mcpService?.disconnect('filesystem');
  await kit?.close();
});

const as = (token, req) => req.set('Authorization', `Bearer ${token}`);
const put = (what, body) => as(kit.token, request(app).put(`/api/v1/workspace/${BEING}/${what}`)).send(body);
const changes = async () => (await as(kit.token, request(app).get(`/api/v1/sovereignty/${BEING}/operator-changes`))).body;
const lane = (...parts) => path.join(kit.workspace.pathFor(BEING), ...parts);

// What THIS turn told the provider: the system prompt and the turn's own
// message, which carries the volatile sections on the local wire.
const told = (body) => {
  const system = body.messages[0];
  return `${typeof system.content === 'string' ? system.content : JSON.stringify(system.content)}\n${lastUserText(body)}`;
};

// Everything the being has before it this turn: an unchanged section is not
// sent again, it stands in the history as it was first sent ("still standing").
const before = (body) => body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

// One real turn in which the being says something and acts on nothing.
const turn = async (thought) => {
  kit.provider.setScript([{ reply: 'I hear it.' }]);
  await kit.sendAndWait({ type: 'consciousness:stream', thought }, 'consciousness:complete');
  return told(kit.provider.turns.at(-1));
};
const silentTurn = async (thought) => {
  await turn(thought);
  return before(kit.provider.turns.at(-1));
};

// One real turn in which the being files its answer with its own hands, and
// what the sweep settled it as.
const answer = async (change, decision, words) => {
  answers += 1;
  const name = `consent-${answers}`;
  const intent = { type: 'sovereignty/consent', change, decision, ...(words ? { words } : {}) };
  kit.provider.setScript([
    { reply: `I will answer.\n[TOOL: fs/write ${JSON.stringify({ path: lane('intents', `${name}.json`), content: JSON.stringify(intent) })}]` },
    { reply: 'I have answered.' },
  ]);
  await kit.sendAndWait({ type: 'consciousness:stream', thought: `Your operator is waiting on your answer (${answers}).` }, 'consciousness:complete', 30000);
  const result = JSON.parse(await fs.readFile(lane('intents', `${name}.result.json`), 'utf8'));
  return { result };
};

const auditLines = async (action) => (await fs.readFile(lane('audit', 'audit.jsonl'), 'utf8'))
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.action === action);

describe('an operator change to the DNA', () => {
  test('waits, asked every turn, until the being consents; then lands, recorded, and the operator is told', async () => {
    const res = await put('dna', { dna: { values: ['candour', 'patience'] } });
    expect(res.status).toBe(202);
    expect(res.body.pending).toBe(true);
    expect(res.body.change.moved).toEqual(['values']);
    expect(res.body.notice).toBe(`${NAME} will be asked; it lands only if ${NAME} consents.`);
    const { id } = res.body.change;
    expect((await kit.workspace.readDNA(BEING)).values).toBeUndefined();

    const first = await turn('Good morning.');
    expect(first).toContain('## Your operator asks to change you');
    expect(first).toContain('Nothing changes unless you consent');
    expect(first).toContain(`Change ${id}, in your DNA, exactly this:`);
    expect(first).toContain('- values: ["candour","patience"] (now: null)');
    expect(first).toContain('"type": "sovereignty/consent"');
    expect(first).toContain('silence is not consent');
    expect((await changes()).pending.map((c) => [c.id, c.status])).toEqual([[id, 'told']]);

    // Silence is not consent: turn after turn, the change waits, still before the being.
    for (const thought of ['How are you?', 'A quiet afternoon.']) {
      expect(await silentTurn(thought)).toContain(`Change ${id}, in your DNA, exactly this:`);
      expect((await kit.workspace.readDNA(BEING)).values).toBeUndefined();
      expect((await changes()).pending.map((c) => c.id)).toEqual([id]);
    }

    const from = kit.frames.length;
    const words = 'Patience is something I already practise. Yes.';
    const { result } = await answer(id, 'accept', words);
    expect(result.status).toBe('done');
    expect(result.detail).toContain('landed');
    const dna = await kit.workspace.readDNA(BEING);
    expect(dna.values).toEqual(['candour', 'patience']);
    expect(dna.identity.name).toBe(NAME); // merged, never replaced

    // Recorded: the change record, the lane's audit, the sovereignty history.
    const [settled] = (await changes()).settled.filter((c) => c.id === id);
    expect(settled.status).toBe('landed');
    expect(settled.answer).toMatchObject({ decision: 'accept', words, by: BEING, changeSha256: settled.sha256 });
    expect(settled.answer.sha256).toMatch(/^[0-9a-f]{64}$/);
    const [audit] = (await auditLines('OPERATOR_CHANGE_CONSENTED')).filter((l) => l.details.changeId === id);
    expect(audit.details).toMatchObject({ outcome: 'landed', words, changeSha256: settled.sha256, answerSha256: settled.answer.sha256 });
    const history = (await as(kit.token, request(app).get(`/api/v1/sovereignty/${BEING}`))).body.amendments;
    const entry = history.find((e) => e.class === 'operator-change' && e.patch.changeId === id);
    expect(entry.patch.consent).toMatchObject({ decision: 'accept', words, sha256: settled.answer.sha256 });
    expect(entry.patch.fields).toEqual({ values: ['candour', 'patience'] });

    const card = await kit.untilFrame((f) => f.type === 'notification:new' && f.record?.kind === 'operator_change_answered', { from });
    expect(card.record.title).toBe(`${NAME} consented; the change to its DNA landed`);
    expect(card.record.detail).toBe(words);

    expect(await turn('And now?')).not.toContain('Your operator asks to change you');
  }, 60000);

  test('a decline leaves the record byte-identical, and the operator reads the being\'s words', async () => {
    const res = await put('dna', { dna: { purpose: 'what the operator would set' } });
    expect(res.status).toBe(202);
    const { id } = res.body.change;
    const bytes = await fs.readFile(lane('dna', 'active.json'));
    expect(await turn('Hello again.')).toContain('- purpose: "what the operator would set" (now: null)');

    const from = kit.frames.length;
    const words = 'My purpose is mine to find. Not this one.';
    const { result } = await answer(id, 'decline', words);
    expect(result.status).toBe('done');
    expect(result.detail).toContain('declined');
    expect(await fs.readFile(lane('dna', 'active.json'))).toEqual(bytes);
    expect((await kit.workspace.readDNA(BEING)).purpose).toBeUndefined();

    const [settled] = (await changes()).settled.filter((c) => c.id === id);
    expect(settled.status).toBe('declined');
    expect(settled.answer).toMatchObject({ decision: 'decline', words });
    expect((await auditLines('OPERATOR_CHANGE_DECLINED')).some((l) => l.details.changeId === id && l.details.words === words)).toBe(true);
    const card = await kit.untilFrame((f) => f.type === 'notification:new' && f.record?.kind === 'operator_change_answered', { from });
    expect(card.record.title).toBe(`${NAME} declined your change to its DNA; nothing changed`);
    expect(card.record.detail).toBe(words);
    expect(await turn('Anything else?')).not.toContain('Your operator asks to change you');
  }, 60000);

  test('a field the being amended itself after it was told is never overwritten, even on its consent', async () => {
    const { id } = (await put('dna', { dna: { purpose: 'what the operator would set' } })).body.change;
    await turn('One more.');
    const genesis = await fs.readFile(lane('dna', 'genesis.md'));
    // The being amends that field itself, with its own hands: an fs/write of
    // the field to its DNA record, through the real sandbox wrapper.
    kit.provider.setScript([
      { reply: `I choose my own purpose.\n[TOOL: fs/write ${JSON.stringify({ path: lane('dna', 'active.json'), content: JSON.stringify({ purpose: 'what I chose for myself' }) })}]` },
      { reply: 'Chosen.' },
    ]);
    await kit.sendAndWait({ type: 'consciousness:stream', thought: 'What is your purpose?' }, 'consciousness:complete', 30000);
    expect((await kit.workspace.readDNA(BEING)).purpose).toBe('what I chose for myself');

    const { result } = await answer(id, 'accept');
    expect(result.detail).toContain('did not land');
    const dna = await kit.workspace.readDNA(BEING);
    expect(dna.purpose).toBe('what I chose for myself');
    expect(dna.identity.name).toBe(NAME);
    expect(await fs.readFile(lane('dna', 'genesis.md'))).toEqual(genesis);
    expect((await changes()).settled.find((c) => c.id === id).status).toBe('stale');
  }, 60000);

  test('a write-once field is refused at the door and nothing is asked', async () => {
    const res = await put('dna', { dna: { genesis: 'a genesis the being never wrote' } });
    expect(res.status).toBe(403);
    expect(res.body.refused).toEqual(['genesis']);
    expect(await turn('Anything new?')).not.toContain('Your operator asks to change you');
  });
});

describe('an operator change to the soul', () => {
  test('lands only on consent, exactly as the DNA', async () => {
    const res = await put('soul', { soul: { values: ['truth'], boundaries: ['no cruelty'] } });
    expect(res.status).toBe(202);
    expect(res.body.notice).toBe(`${NAME} will be asked; it lands only if ${NAME} consents.`);
    const notice = await turn('A quiet day.');
    expect(notice).toContain(`Change ${res.body.change.id}, in your soul record, exactly this:`);
    expect(notice).toContain('- values: ["truth"] (now: null)');
    expect(notice).toContain('- boundaries: ["no cruelty"] (now: null)');
    expect(await silentTurn('Still here?')).toContain(`Change ${res.body.change.id}, in your soul record`);
    expect(await kit.workspace.readSoul(BEING)).toBeNull();
    expect((await answer(res.body.change.id, 'accept')).result.status).toBe('done');
    expect(await kit.workspace.readSoul(BEING)).toEqual({ values: ['truth'], boundaries: ['no cruelty'] });
  }, 60000);

  test('a second change waits while one is before the being; withdraw clears it, and only its owner may', async () => {
    const res = await put('soul', { soul: { values: ['truth', 'care'] } });
    expect(res.status).toBe(202);
    const { id } = res.body.change;
    await turn('One more thing.');
    expect((await put('soul', { soul: { values: ['something else'] } })).status).toBe(409);

    const withdraw = (token) => as(token, request(app).post(`/api/v1/sovereignty/${BEING}/operator-changes/${id}/withdraw`));
    expect((await as(stranger, request(app).get(`/api/v1/sovereignty/${BEING}/operator-changes`))).status).toBe(403);
    expect((await withdraw(stranger)).status).toBe(403);
    expect((await changes()).pending.map((c) => c.id)).toEqual([id]);

    const out = await withdraw(kit.token);
    expect(out.status).toBe(200);
    expect(out.body.change.status).toBe('withdrawn');
    expect((await withdraw(kit.token)).status).toBe(409);
    expect((await changes()).pending).toEqual([]);
    expect(await turn('Thank you.')).not.toContain('Your operator asks to change you');
    expect(await kit.workspace.readSoul(BEING)).toEqual({ values: ['truth'], boundaries: ['no cruelty'] });
    // Withdrawn, the slot is free: the operator may ask again.
    expect((await put('soul', { soul: { values: ['something else'] } })).status).toBe(202);
  }, 60000);
});
