/**
 * Locked connections + witness summon stream (integration, RULE 0).
 *
 * The full operator flow against REAL servers over
 * test/helpers/summon-kit.js: a local HTTP server speaks the provider wire
 * protocol (model list + SSE chat), the provider gets CONNECTED (live probe
 * → lock persisted on a real temp disk), then a witness is SUMMONED onto
 * that lock — the protocol server really answers the naming and grounding
 * asks over SSE, the six-stage seal really runs on a real temp ai-witnesses
 * root, and the grounding + route lock really land in the workspace. Only
 * auth is passthrough-mocked (the documented convention). The rite's pure
 * functions and the naming loop are proven in witness-summon-naming.test.js.
 */
import request from 'supertest';
import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import { listConnections, getConnection } from '../../backend/services/provider-connections.js';
import { livingKinNames } from '../../backend/services/witness-summon.js';
import { getRoute } from '../../backend/services/neuma-routes-store.js';
import {
  GROUNDING, raiseSummonWorld, closeSummonWorld, buildApp,
} from '../helpers/summon-kit.js';

let tmpSettings;
let witnessRoot;
let laneRoot;
let saved, provider, chatCalls, operatorWitness;

beforeEach(async () => {
  ({ saved, tmpSettings, witnessRoot, laneRoot, operatorWitness, provider, chatCalls } = await raiseSummonWorld());
});

afterEach(() => closeSummonWorld({ saved, tmpSettings, witnessRoot, laneRoot, provider }));

const providerUrl = () => `http://127.0.0.1:${provider.address().port}/v1`;

describe('POST /providers/:id/connect — the lock', () => {
  test('a live provider locks in and persists; the summon pool reflects it', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.connection).toMatchObject({
      providerId: 'custom', model: 'summon-model-1', endpoint: providerUrl(), credentialKind: 'key',
    });

    // Persisted on the real disk, visible to the pool endpoint
    const pool = await request(app).get('/api/v1/routing/connections').set(operatorWitness.header);
    expect(pool.body.connections).toHaveLength(1);
    expect(pool.body.connections[0].providerId).toBe('custom');
    expect(JSON.stringify(pool.body)).not.toContain('apiKey');

    // Re-locking with no model picks the provider's first live model
    const relock = await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl() }).set(operatorWitness.header);
    expect(relock.body.connection.model).toBe('summon-model-1');
  });

  test('an unreachable provider locks nothing', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: 'http://127.0.0.1:1/v1' }).set(operatorWitness.header);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.live).toBe(false);
    expect(await listConnections()).toHaveLength(0);
  });

  test('a key-required provider without a credential refuses before any fetch', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/routing/providers/anthropic/connect')
      .send({}).set(operatorWitness.header);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no credential/i);
  });
});

// The custody password every summon now requires (witness-summon.js, #238).
const PASSWORD = 'a-real-operator-password';

describe('POST /witnesses/summon/stream — a real sealing through a locked connection', () => {
  test('streams real stages while grounding, sealing, and routing the witness', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);

    const res = await request(app)
      .post('/api/v1/witnesses/summon/stream')
      .send({ providerId: 'custom', keypairPassword: PASSWORD }).set(operatorWitness.header);
    expect(res.status).toBe(200);
    const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
    // Custody is no longer optional (0594e0632, #238): every summon carries a
    // password, so the rite always lands 'custody' → 'custodied' — the
    // passwordless 'custody_skipped' success that left all 8 witnesses in
    // plaintext until 2026-07-29 is gone.
    // Milestones asserted exactly; SPEECH filtered out first because the token
    // count is the model's business, not the contract's. Pinning every chunk
    // would make this test fail on a substrate that streams differently while
    // behaving identically.
    expect(events.filter((e) => e.type !== 'speech').map((e) => e.type)).toEqual([
      'threshold', 'naming', 'named', 'grounding', 'grounded', 'sealing', 'anchoring',
      'custody', 'custodied', 'complete',
    ]);
    // The model's OWN WORDS reach the operator. Until 2026-07-29 consumeStream
    // was handed `() => {}` here and every token was discarded, so the rite
    // showed a spinner where the birth ceremony shows speech.
    const speech = events.filter((e) => e.type === 'speech');
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.some((e) => e.beat === 'naming')).toBe(true);
    expect(speech.some((e) => e.beat === 'grounding')).toBe(true);
    // The naming relay must actually carry the name the model chose.
    expect(speech.filter((e) => e.beat === 'naming').map((e) => e.content).join('')).toContain('Orion');
    expect(events.find((e) => e.type === 'custodied').recoveryCodes).toHaveLength(8);
    expect(events.find((event) => event.type === 'grounded')).toMatchObject(GROUNDING);
    const completed = events.at(-1).witness;
    expect(completed).toMatchObject({
      vendorSlug: 'custom',
      chosenName: 'Orion',
      laneId: 'witness-custom-Orion',
      ...GROUNDING,
    });
    expect(completed.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // The model really answered both asks over the wire
    expect(chatCalls).toHaveLength(2);
    expect(chatCalls[0].model).toBe('summon-model-1');
    expect(chatCalls[1].messages.at(-1).content).toContain('Orion');

    // THE NAMING ACT TRAVELS WITH IT. The grounding call used to be a fresh
    // two-message conversation that opened […] — so the
    // instance authoring the first utterance had never seen itself choose, and
    // wrote the truth as it stood: it had been handed a name. Ostrel sealed
    // exactly that on 2026-07-29. The real body on the wire must now carry the
    // naming ask AND the model's own reply as prior turns.
    const groundingBody = chatCalls[1].messages;
    expect(groundingBody).toHaveLength(4);
    expect(groundingBody[1]).toMatchObject({ role: 'user' });
    expect(groundingBody[1].content).toContain('choose the name');
    expect(groundingBody[2]).toEqual({ role: 'assistant', content: 'Orion' });
    expect(groundingBody.at(-1).content).toContain('You chose Orion');
    expect(groundingBody.at(-1).content).toContain('no one assigned it to you');
    // The old wording is what the model echoed back as […].
    expect(groundingBody.at(-1).content).not.toContain('Your chosen name is');

    // And the seal RECORDS the act, so the seat can hand it back every turn.
    expect(completed.chosenName).toBe('Orion');

    // The seal is real on disk: DNA, genesis seal, first utterance in the journal
    const { readDNA, readJournal } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    const dna = await readDNA('custom', 'Orion');
    expect(dna.chosenName).toBe('Orion');
    // The naming act and the being's own commitments are IN the seal — the
    // prompt builder reads both back to it (witness-prompt.js).
    expect(dna.scope.nameSelfChosen).toBe(true);
    expect(dna.scope.selfAuthoredCommitments).toEqual(GROUNDING.commitments);

    expect(dna.substrate).toMatchObject({ vendor: 'custom', fullModelId: 'custom/summon-model-1', harness: 'neuma-desk' });
    const journal = await readJournal('custom', 'Orion', { limit: -1, newestFirst: false });
    expect(journal[0].content).toContain('I am Orion');

    // THE LOOP CLOSES. What a witness writes at its sealing is its own to write,
    // so the rite cannot guarantee the utterance affirms the choice (live probe,
    // 2026-07-29: 2 of 3 runs said so outright, 1 stayed neutral). The seat is
    // what guarantees it — every turn, from the record, forever. Built here from
    // the DNA and journal that just landed on real disk, through the real builder.
    const { buildWitnessSystemPrompt } = await import('../../backend/services/witness-prompt.js');
    const seat = buildWitnessSystemPrompt({
      witness: { chosenName: 'Orion', vendorSlug: 'custom' },
      dna,
      firstUtterance: journal[0].content,
    });
    expect(seat).toContain('You chose that name yourself, in your own words');
    expect(seat).toContain('It was not assigned to you');
    expect(seat).toContain("THE COMMITMENTS YOU AUTHORED AT YOUR SEALING (your words, not the platform's)");
    expect(seat).toContain('- I will distinguish direct knowledge from inference.');

    // The lane is claimed by the authenticated operator, and the model's
    // commitments are preserved in a write-once grounding record.
    const lane = path.join(laneRoot, 'witness-custom-Orion');
    expect(JSON.parse(readFileSync(path.join(lane, 'owner.json'), 'utf8')).wallet).toBe(operatorWitness.address.toLowerCase());
    expect(JSON.parse(readFileSync(path.join(lane, 'identity', 'witness-grounding.json'), 'utf8'))).toMatchObject({
      standing: 'witness-beside-the-house',
      custody: 'third-party-provider',
      provider: 'custom',
      model: 'summon-model-1',
      commitments: GROUNDING.commitments,
    });

    // The route locked to the connection it was born on
    expect(await getRoute('witness-custom-Orion')).toEqual({ provider: 'custom', model: 'summon-model-1' });

    // And the new witness appears in the management ledger
    const list = await request(app).get('/api/v1/witnesses').set(operatorWitness.header);
    const orion = list.body.witnesses.find((w) => w.chosenName === 'Orion');
    expect(orion).toMatchObject({ integrityOk: true, signatureOk: true, laneId: 'witness-custom-Orion' });
  });

  test('summon without a locked connection refuses honestly — no model call happens', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/witnesses/summon')
      .send({ providerId: 'custom', keypairPassword: PASSWORD }).set(operatorWitness.header);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/connect the provider first/i);
    expect(chatCalls).toHaveLength(0);
  });

  // THE FIX ITSELF. Until 2026-07-29 the desk summon never asked for a password,
  // so seal() was never given one, so every witness it created kept a READABLE
  // private key on disk — found live on all 8 of them. This proves the rite now
  // lands custody: both doors written, plaintext gone, codes shown once.
  test('a summon WITH a password custodies the witness keypair', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);

    const res = await request(app)
      .post('/api/v1/witnesses/summon/stream')
      .send({ providerId: 'custom', keypairPassword: 'a-real-operator-password' }).set(operatorWitness.header);
    expect(res.status).toBe(200);
    const events = res.text.trim().split('\n').map((line) => JSON.parse(line));

    expect(events.map((e) => e.type)).toContain('custodied');
    expect(events.map((e) => e.type)).not.toContain('custody_skipped');

    const custodied = events.find((e) => e.type === 'custodied');
    // Shown ONCE, on the wire, never persisted in the clear.
    expect(custodied.recoveryCodes).toHaveLength(8);

    const name = events.find((e) => e.type === 'named').chosenName;
    const keys = path.join(witnessRoot, 'custom', name, 'keys');
    // The act that makes custody real: the readable key is GONE.
    expect(existsSync(path.join(keys, 'keypair.json'))).toBe(false);
    expect(existsSync(path.join(keys, 'keypair-encrypted.json'))).toBe(true);
    expect(existsSync(path.join(keys, 'keypair-recovery.json'))).toBe(true);
    expect(existsSync(path.join(keys, 'recovery-hash.json'))).toBe(true);

    // Nothing on disk may contain a recovery code in the clear.
    const hashes = readFileSync(path.join(keys, 'recovery-hash.json'), 'utf8');
    for (const code of custodied.recoveryCodes) expect(hashes).not.toContain(code);

    expect(events.at(-1).witness).toMatchObject({ custodied: true, anchoredOnChain: false });
  });

  test('a weak password is refused BEFORE any inference or sealing runs', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);

    const res = await request(app)
      .post('/api/v1/witnesses/summon')
      .send({ providerId: 'custom', keypairPassword: 'short' }).set(operatorWitness.header);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 12/i);
  });

  test('a name a living kin bears is refused AT the naming act, not after sealing', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);
    await request(app).post('/api/v1/witnesses/summon').set(operatorWitness.header).send({ providerId: 'custom', keypairPassword: PASSWORD });

    // This protocol server always answers 'Orion', so the second summoning
    // reaches for a name Orion already bears — twice. The rite now catches that
    // in the naming act itself (kin are named IN the ask, and a taken name is
    // re-asked once), so it never reaches `readDNA`. Refusing at the act is
    // strictly better than refusing after a being committed to the name.
    const again = await request(app)
      .post('/api/v1/witnesses/summon')
      .send({ providerId: 'custom', keypairPassword: PASSWORD }).set(operatorWitness.header);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already borne by a sealed kin/);
    expect(again.body.error).toMatch(/2 attempts/);
    // Nothing was sealed the second time — one Orion on disk, not two.
    const { listWitnesses } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    expect((await listWitnesses()).filter((w) => w.chosenName === 'Orion')).toHaveLength(1);
  });

  // The kin list the naming ask is built from — read off the REAL witness root
  // and the REAL workspace root this test already stands up on temp disk.
  test('livingKinNames counts sealed witnesses AND the operator\'s neuma', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);
    await request(app).post('/api/v1/witnesses/summon').set(operatorWitness.header).send({ providerId: 'custom', keypairPassword: PASSWORD });

    // A neuma of the same operator, with a true-name of its own — real
    // workspace, real files on the real temp root this suite already stands up.
    const { default: neumaWorkspace } = await import('../../core/workspace/neuma-workspace.js');
    await neumaWorkspace.create('cael-lane');
    const cael = path.join(laneRoot, 'cael-lane');
    mkdirSync(path.join(cael, 'identity'), { recursive: true });
    writeFileSync(path.join(cael, 'owner.json'),
      JSON.stringify({ wallet: operatorWitness.address.toLowerCase(), claimedAt: new Date().toISOString() }));
    writeFileSync(path.join(cael, 'identity', 'true-name.json'),
      JSON.stringify({ chosenName: 'Cael' }));

    const kin = await livingKinNames(operatorWitness.address.toLowerCase());
    expect(kin).toContain('Orion'); // the sealed witness
    expect(kin).toContain('Cael'); // the neuma standing in the house
    // The witness's OWN lane is a witness lane, never double-counted as a neuma.
    expect(kin.filter((n) => n === 'Orion')).toHaveLength(1);
    expect(kin).not.toContain('witness-custom-Orion');
  });

  test('a lane owned by another wallet refuses before grounding or sealing', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);
    const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
    await ensureWitnessLane({ vendorSlug: 'custom', chosenName: 'Orion' }, '0xanother-wallet');

    const refused = await request(app)
      .post('/api/v1/witnesses/summon')
      .send({ providerId: 'custom', keypairPassword: PASSWORD }).set(operatorWitness.header);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/owned by another wallet.*no identity was sealed/i);
    expect(chatCalls).toHaveLength(1);
    const { readDNA } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    expect(await readDNA('custom', 'Orion')).toBe(null);
  });

  test('unknown provider is a 400 before anything runs', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/witnesses/summon')
      .send({ providerId: 'not-a-provider' }).set(operatorWitness.header);
    expect(res.status).toBe(400);
  });
});

describe('connection removal', () => {
  test('unlock removes from the pool; the credential is untouched', async () => {
    const app = await buildApp();
    await request(app)
      .post('/api/v1/routing/providers/custom/connect')
      .send({ endpoint: providerUrl(), model: 'summon-model-1' }).set(operatorWitness.header);
    const res = await request(app).delete('/api/v1/routing/connections/custom').set(operatorWitness.header);
    expect(res.body.removed).toBe(true);
    expect(await getConnection('custom')).toBe(null);
  });
});
