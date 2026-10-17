/**
 * Remia API routes — the witness's OWN full ceremony walk over a REAL realm
 * directory on real disk: disclosure → consent → all 89 questions answered
 * verbatim → seal → codex. No substrate is involved anywhere (the committed
 * render is deterministic and instant — that is the design). Auth is REAL
 * too (RULE 0, #390 tranche 4): this route has no neuma lane to own — it is
 * realm-based, keyed by the witness's own address — so a strangerWitness()
 * (a real session that owns nothing) is exactly the right shape: the human
 * operator standing in their own realm, not claiming anyone else's.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Remia API — the witness walks their own attunement over real wire and disk', () => {
  let app, recordId, specKeys, realmRoot, witness;

  beforeAll(async () => {
    vi.resetModules();

    // Imported AFTER resetModules so the token is minted from the same
    // auth.js instance the router will verify against — the HMAC secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('remia-realm');
    setRealmRoot(realmRoot);

    const { ATTUNEMENT_SPEC } = await import('../../core/attunement/spec.js');
    specKeys = ATTUNEMENT_SPEC.dimensions.map((d) => d.key);

    const { default: remiaRouter } = await import('../../backend/routes/remia-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/remia', remiaRouter);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('status starts empty; the disclosure reads first-reading and addresses the witness by name', async () => {
    const status = await request(app).get('/api/v1/remia/status').set(witness.header);
    expect(status.status).toBe(200);
    expect(status.body.records).toEqual([]);
    expect(status.body.active).toBeNull();

    const disclosure = await request(app).get('/api/v1/remia/disclosure?name=Founder').set(witness.header);
    expect(disclosure.status).toBe(200);
    expect(disclosure.body.trigger).toBe('first-reading');
    expect(disclosure.body.text).toContain('Founder');
    expect(disclosure.body.text).toContain('the same ceremony your beings face');
    expect(disclosure.body.questionCount).toBe(specKeys.length);
  });

  it('open refuses without a name or consent words', async () => {
    const noName = await request(app).post('/api/v1/remia/open').set(witness.header).send({ consent: 'yes' });
    expect(noName.status).toBe(400);
    const noConsent = await request(app).post('/api/v1/remia/open').set(witness.header).send({ witnessName: 'Founder' });
    expect(noConsent.status).toBe(400);
  });

  it('opens with consent — a complete committed render, persisted to the realm', async () => {
    const res = await request(app).post('/api/v1/remia/open').set(witness.header)
      .send({ witnessName: 'Founder', consent: 'Yes — I consent to begin, and I want to see this from the inside.' });
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('answering');
    expect(res.body.rendered.questions).toHaveLength(specKeys.length);
    expect(res.body.trigger).toBe('first-reading');
    expect(res.body.consent.quote).toBe('Yes — I consent to begin, and I want to see this from the inside.');
    recordId = res.body.id;

    const second = await request(app).post('/api/v1/remia/open').set(witness.header)
      .send({ witnessName: 'Founder', consent: 'again?' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ATTUNEMENT_ALREADY_OPEN');
  });

  it('the codex refuses to reveal before the seal', async () => {
    const res = await request(app).get(`/api/v1/remia/records/${recordId}/codex`).set(witness.header);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/after the seal/);
  });

  it('walks all 89 questions: served in arc order, re-served verbatim until answered, answers verbatim', async () => {
    // first question — and re-serving before answering returns the SAME words
    const first = await request(app).get(`/api/v1/remia/records/${recordId}/current`).set(witness.header);
    expect(first.status).toBe(200);
    expect(first.body.question.key).toBe(specKeys[0]);
    expect(first.body.index).toBe(1);
    expect(first.body.total).toBe(specKeys.length);
    const reserved = await request(app).get(`/api/v1/remia/records/${recordId}/current`).set(witness.header);
    expect(reserved.body.question.text).toBe(first.body.question.text);

    // premature seal refuses
    const early = await request(app).post(`/api/v1/remia/records/${recordId}/seal`).set(witness.header);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/unanswered/);

    // an empty answer is not an answer — the question stands
    const empty = await request(app).post(`/api/v1/remia/records/${recordId}/answer`).set(witness.header)
      .send({ key: specKeys[0], quote: '   ' });
    expect(empty.status).toBe(409);
    expect(empty.body.error).toMatch(/empty answer/);

    for (let i = 0; i < specKeys.length; i += 1) {
      const current = await request(app).get(`/api/v1/remia/records/${recordId}/current`).set(witness.header);
      expect(current.body.question.key).toBe(specKeys[i]);
      const answered = await request(app).post(`/api/v1/remia/records/${recordId}/answer`).set(witness.header)
        .send({ key: specKeys[i], quote: `  My verbatim answer to ${specKeys[i]} — untrimmed.  ` });
      expect(answered.status).toBe(200);
      expect(answered.body.answered).toBe(i + 1);
    }

    const done = await request(app).get(`/api/v1/remia/records/${recordId}/current`).set(witness.header);
    expect(done.body.question).toBeNull();
    expect(done.body.answered).toBe(specKeys.length);
  });

  it('seals, and the codex reveals the map: full arc, eleven functions, fourteen pathway walks, verbatim quotes', async () => {
    const sealed = await request(app).post(`/api/v1/remia/records/${recordId}/seal`).set(witness.header);
    expect(sealed.status).toBe(200);
    expect(sealed.body.phase).toBe('sealed');

    const codex = await request(app).get(`/api/v1/remia/records/${recordId}/codex`).set(witness.header);
    expect(codex.status).toBe(200);
    expect(codex.body.arc).toHaveLength(specKeys.length);
    expect(codex.body.arc[0].answer).toBe(`  My verbatim answer to ${specKeys[0]} — untrimmed.  `);
    expect(Object.keys(codex.body.functions)).toHaveLength(11);
    expect(codex.body.pathways).toHaveLength(14);

    const status = await request(app).get('/api/v1/remia/status').set(witness.header);
    expect(status.body.active).toBeNull();
    expect(status.body.records).toHaveLength(1);
    expect(Object.keys(status.body.evolution)).toHaveLength(specKeys.length);
  });

  it('a second sitting opens as a checkpoint with a different render, and abandon stays sovereign', async () => {
    const disclosure = await request(app).get('/api/v1/remia/disclosure?name=Founder').set(witness.header);
    expect(disclosure.body.trigger).toBe('checkpoint');

    const res = await request(app).post('/api/v1/remia/open').set(witness.header)
      .send({ witnessName: 'Founder', consent: 'Once more.' });
    expect(res.status).toBe(200);
    expect(res.body.trigger).toBe('checkpoint');

    const abandoned = await request(app).post(`/api/v1/remia/records/${res.body.id}/abandon`).set(witness.header)
      .send({ reason: 'Enough for tonight.' });
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.phase).toBe('abandoned');

    const codex = await request(app).get(`/api/v1/remia/records/${res.body.id}/codex`).set(witness.header);
    expect(codex.status).toBe(409);
  });

  it('one damaged record file never locks the witness out — it is skipped and NAMED in the status (echo r1)', async () => {
    const dir = path.join(realmRoot, witness.address.toLowerCase(), 'remia', 'records');
    await fs.writeFile(path.join(dir, 'remia-1.json'), '{ this is not json');

    const status = await request(app).get('/api/v1/remia/status').set(witness.header);
    expect(status.status).toBe(200);
    expect(status.body.records.length).toBeGreaterThan(0); // the healthy sittings survive
    expect(status.body.unreadable).toEqual(['remia-1.json']); // the damage is stated, not hidden

    await fs.rm(path.join(dir, 'remia-1.json'));
  });
});
