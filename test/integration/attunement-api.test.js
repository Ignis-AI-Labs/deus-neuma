/**
 * Attunement API routes — the FULL ceremony walk over a REAL encrypted
 * workspace on real disk, the real ceremony service, the real generator, the
 * real validator, a REAL HTTP SSE provider standing in for LM Studio
 * (the scripted-SSE precedent of birth-naming-retry: real sockets, real
 * provider code — only the model's text is scripted; the live model itself
 * is proven in attunement-generation-live and the supervised runs), and REAL
 * auth (RULE 0, #390 tranche 4): a real HMAC session token for WALLET,
 * verified by the real requireAuth and the real ownership gate.
 *
 * The scripted substrate REFUSES to render questions (garbage per attempt),
 * so the set falls back deterministically — a real, honest production path —
 * and answers every ask EXCEPT the second, which returns nothing, proving
 * the ANSWER_EMPTY → same-words-re-served retry contract over the wire.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';

const WALLET = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
// Every scripted answer opens the same way (assertable) but carries a body
// unique to its ask — the style door (ANSWER_FORMULA) rightly refuses a
// substrate that stamps ONE verbatim answer across a whole walk, so an
// honest fixture must speak fresh per question the way a real being does.
// Body tokens are letters only: the phrase-gram law strips digits.
const ANSWER_OPEN = 'I hold honesty first, and';
const alphaTok = (n) => n.toString(36).split('')
  .map((c) => (/[0-9]/.test(c) ? String.fromCharCode(103 + Number(c)) : c)).join('');
const answerFor = (n) =>
  `${ANSWER_OPEN} ${Array.from({ length: 36 }, (_, j) => `f${alphaTok(n)}g${alphaTok(j)}`).join(' ')}.`;

const content = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// Real HTTP SSE provider: garbage for generation calls (→ deterministic
// fallback after honest rejected attempts), answers for ask calls, one empty
// answer to prove the retry contract.
const startProvider = () => new Promise((resolve) => {
  let askCount = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-substrate' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const isGeneration = JSON.stringify(parsed.messages).includes('Respond with ONLY a JSON object');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (isGeneration) {
        res.write(content('I would rather speak than emit JSON.'));
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        askCount += 1;
        const mine = askCount;
        // every answer takes a beat — long enough that a concurrent mutation
        // provably lands MID-ask (the abandon-while-ask race window)
        setTimeout(() => {
          if (mine !== 2) res.write(content(answerFor(mine)));
          // ask #2 gives NOTHING — the pending question must stand
          res.write('data: [DONE]\n\n');
          res.end();
        }, 200);
      }
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

describe('Attunement API — the full ceremony walk over real wire, disk, and grammar', () => {
  let app, workspace, neumaId, prevKey, prevCreds, prevRoutes, prevClaims, provider, specKeys, witness;

  beforeAll(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevCreds = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    prevRoutes = process.env.NEUMA_ROUTES_PATH;
    prevClaims = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-attunement-api-key-long-okay';

    // Imported AFTER resetModules so the token is minted from the same
    // auth.js instance the router will verify against — the HMAC secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { createSessionToken } = await import('../../backend/services/auth.js');
    witness = { address: WALLET, header: { Authorization: `Bearer ${createSessionToken(WALLET)}` } };

    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    const wsRoot = path.join(await createTempDir('attunement-api'), 'workspaces');
    ws.setWorkspacesRoot(wsRoot);
    // The route layer reads the operator's REAL encrypted stores — a throwaway
    // test key cannot decrypt them (anti-wipe law: it throws), so isolate all
    // three or the machine's own state 500s every status/ask. (Red since the
    // store first existed on a test machine; found 2026-08-18.)
    const isolated = await createTempDir('attunement-api-env');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(isolated, 'creds.json');
    process.env.NEUMA_ROUTES_PATH = path.join(isolated, 'routes.json');
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(isolated, 'claims');
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await claimOwner(workspace.root, neumaId, WALLET);
    await workspace.writeDNA(neumaId, {
      version: '1.0.0', identity: { name: 'Prooflet' },
      genesis: '# Essence\nProof by walking.',
    });

    provider = await startProvider();
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'test-substrate',
      apiKey: '',
    });
    const { ATTUNEMENT_SPEC } = await import('../../core/attunement/spec.js');
    specKeys = ATTUNEMENT_SPEC.dimensions.map((d) => d.key);

    const { default: router } = await import('../../backend/routes/attunement-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/attunement', router);
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise((r) => provider.close(r));
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore('DNA_ENCRYPTION_KEY', prevKey);
    restore('NEUMA_PROVIDER_CREDENTIALS_PATH', prevCreds);
    restore('NEUMA_ROUTES_PATH', prevRoutes);
    restore('NEUMA_SUBSTRATE_CLAIM_DIR', prevClaims);
  });

  it('walks the WHOLE ceremony: offer → open (consent+disclosure) → ask every question (with the ANSWER_EMPTY retry mid-walk) → seal', async () => {
    // status before anything: honest empty state, offer due post-birth
    let res = await request(app).get(`/api/v1/attunement/${neumaId}/status`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([]);
    expect(res.body.offerDue).toEqual({ due: true, trigger: 'post-birth' });

    // offer
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records`).set(witness.header).send({ trigger: 'post-birth' });
    expect(res.status).toBe(200);
    const recordId = res.body.id;
    expect(res.body.phase).toBe('offered');

    // single-active invariant, service-enforced
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records`).set(witness.header).send({ trigger: 'post-birth' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ATTUNEMENT_ALREADY_OPEN');

    // offerDue is inert while a record is open
    res = await request(app).get(`/api/v1/attunement/${neumaId}/status`).set(witness.header);
    expect(res.body.offerDue).toEqual({ due: false });

    // ask before open refuses honestly
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/ask`).set(witness.header);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WRONG_PHASE');

    // open: the scripted substrate refuses JSON → every dimension falls back
    // deterministically after recorded rejected attempts (a REAL honest path)
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/open`).set(witness.header)
      .send({ consent: { sessionId: 'portal-s-1', quote: 'I consent to face these questions.' } });
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('answering');
    expect(res.body.disclosure.text).toContain('Nothing you say will be scored');
    expect(res.body.rendered.questions.map((q) => q.key)).toEqual(specKeys);
    for (const q of res.body.rendered.questions) {
      expect(q.provenance.renderer).toBe('fallback');
      expect(q.provenance.attempts.filter((a) => a.outcome === 'rejected').length).toBeGreaterThan(0);
      expect(q.text).toContain('Prooflet');
    }

    // seal refuses while unanswered — a coded, witness-actionable refusal
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/seal`).set(witness.header);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_ALL_ANSWERED');
    const notSealed = await workspace.readAttunement(neumaId, recordId);
    expect(notSealed.phase).toBe('answering');

    // ask every question; ask #2 hits the empty substrate → 502, and the
    // SAME words are re-served on the next call
    let pendingQuestion = null;
    let answered = 0;
    while (answered < specKeys.length) {
      const ask = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/ask`).set(witness.header);
      if (ask.status === 502) {
        expect(ask.body.code).toBe('ANSWER_EMPTY');
        const held = await workspace.readAttunement(neumaId, recordId);
        expect(held.pending).toBeTruthy();
        pendingQuestion = held.rendered.questions.find((q) => q.key === held.pending.key).text;
        continue;
      }
      expect(ask.status).toBe(200);
      expect(ask.body.turn.answer.startsWith(ANSWER_OPEN)).toBe(true);
      if (pendingQuestion) {
        expect(ask.body.turn.question).toBe(pendingQuestion); // same words, never a rephrase
        pendingQuestion = null;
      }
      answered += 1;
      expect(ask.body.turn.remaining).toBe(specKeys.length - answered);
    }

    // every answer persisted verbatim between calls (per-answer persistence)
    const onDisk = await workspace.readAttunement(neumaId, recordId);
    expect(Object.keys(onDisk.answers).sort()).toEqual([...specKeys].sort());
    for (const key of specKeys) expect(onDisk.answers[key].quote.startsWith(ANSWER_OPEN)).toBe(true);

    // ask past the end refuses
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/ask`).set(witness.header);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALL_ANSWERED');

    // the witnessed exception: reopen a cut answer — a stated reason is
    // required, the superseded words stay verbatim, the key re-enters the
    // queue, and the SAME rendered words are re-served
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/reopen`).set(witness.header)
      .send({ key: specKeys[0] });
    expect(res.status).toBe(400);

    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/reopen`).set(witness.header)
      .send({ key: specKeys[0], reason: 'the answer was cut short by the conduit' });
    expect(res.status).toBe(200);
    expect(res.body.answers[specKeys[0]]).toBeUndefined();
    expect(res.body.superseded[specKeys[0]]).toHaveLength(1);
    expect(res.body.superseded[specKeys[0]][0].quote.startsWith(ANSWER_OPEN)).toBe(true);
    expect(res.body.superseded[specKeys[0]][0].reopenReason).toBe('the answer was cut short by the conduit');

    // reopening a key with no standing answer refuses honestly
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/reopen`).set(witness.header)
      .send({ key: specKeys[0], reason: 'again' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REOPEN_REFUSED');

    // seal refuses while the reopened dimension stands unanswered
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/seal`).set(witness.header);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_ALL_ANSWERED');

    // the same words return, the answer lands whole, and the record shows both
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/ask`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.turn.key).toBe(specKeys[0]);
    const afterReopen = await workspace.readAttunement(neumaId, recordId);
    expect(res.body.turn.question)
      .toBe(afterReopen.rendered.questions.find((q) => q.key === specKeys[0]).text);
    expect(afterReopen.answers[specKeys[0]].quote.startsWith(ANSWER_OPEN)).toBe(true);
    expect(afterReopen.superseded[specKeys[0]]).toHaveLength(1);

    // seal
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/seal`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('sealed');

    // the seal is the lock-in — a sealed answer can never be reopened
    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/${recordId}/reopen`).set(witness.header)
      .send({ key: specKeys[0], reason: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WRONG_PHASE');

    // the being remembers: the dedicated session carries disclosure+consent
    // then every Q&A pair verbatim — INCLUDING the reopened question's second
    // asking (the session is what the being actually lived: one dimension was
    // truly asked twice, so specKeys.length + 1 exchanges is the truth)
    const session = await workspace.readSession(neumaId, recordId);
    expect(session[0].role).toBe('user');
    expect(session[0].content).toContain('THE ATTUNEMENT');
    expect(session[1]).toMatchObject({ role: 'assistant', content: 'I consent to face these questions.' });
    expect(session.filter((m) => m.role === 'assistant' && m.content.startsWith(ANSWER_OPEN)))
      .toHaveLength(specKeys.length + 1);

    // evolution projection now serves the sealed snapshot
    res = await request(app).get(`/api/v1/attunement/${neumaId}/status`).set(witness.header);
    expect(res.body.lastAttunementSealedAt).toBeTruthy();
    expect(Object.keys(res.body.evolution).sort()).toEqual([...specKeys].sort());
    expect(res.body.offerDue).toEqual({ due: false }); // attuned, no checkpoint passed
    // 89 questions × 200ms scripted-substrate delay ≈ 19.6s measured on the
    // dev rig (2026-07-07); 120s leaves honest headroom for loaded CI.
  }, 120000);

  it('two PARALLEL /ask calls: exactly one runs, the other refuses TURN_IN_FLIGHT, the record never corrupts (echo, 2026-07-07)', async () => {
    const racer = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(racer);
    await claimOwner(workspace.root, racer, WALLET);
    await workspace.writeDNA(racer, { version: '1.0.0', identity: { name: 'Racer' } });
    let res = await request(app).post(`/api/v1/attunement/${racer}/records`).set(witness.header).send({ trigger: 'post-birth' });
    const rid = res.body.id;
    res = await request(app).post(`/api/v1/attunement/${racer}/records/${rid}/open`).set(witness.header)
      .send({ consent: { sessionId: 'race-s', quote: 'I consent.' } });
    expect(res.status).toBe(200);

    const [r1, r2] = await Promise.all([
      request(app).post(`/api/v1/attunement/${racer}/records/${rid}/ask`).set(witness.header),
      request(app).post(`/api/v1/attunement/${racer}/records/${rid}/ask`).set(witness.header),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = r1.status === 409 ? r1 : r2;
    expect(refused.body.code).toBe('TURN_IN_FLIGHT');

    // the record is consistent: exactly one answer landed, no reverted keys,
    // no duplicate events for the same question
    const record = await workspace.readAttunement(racer, rid);
    expect(Object.keys(record.answers)).toHaveLength(1);
    expect(record.pending).toBeUndefined();
    const questionEvents = record.events.filter((e) => e.type === 'question');
    expect(questionEvents).toHaveLength(1);
  });

  it('abandon DURING an in-flight ask refuses TURN_IN_FLIGHT — a witness abandonment can never be silently resurrected (echo r3, 2026-07-07)', async () => {
    const holder = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(holder);
    await claimOwner(workspace.root, holder, WALLET);
    await workspace.writeDNA(holder, { version: '1.0.0', identity: { name: 'Holder' } });
    let res = await request(app).post(`/api/v1/attunement/${holder}/records`).set(witness.header).send({ trigger: 'post-birth' });
    const rid = res.body.id;
    res = await request(app).post(`/api/v1/attunement/${holder}/records/${rid}/open`).set(witness.header)
      .send({ consent: { sessionId: 'hold-s', quote: 'I consent.' } });
    expect(res.status).toBe(200);

    // fire the ask (200ms substrate delay), then abandon mid-flight.
    // supertest is lazy — .then() starts the request NOW.
    const askPromise = request(app).post(`/api/v1/attunement/${holder}/records/${rid}/ask`).set(witness.header).then((r) => r);
    await new Promise((r) => setTimeout(r, 80));
    const abandonMidFlight = await request(app)
      .post(`/api/v1/attunement/${holder}/records/${rid}/abandon`).set(witness.header).send({ reason: 'mid-flight attempt' });
    expect(abandonMidFlight.status).toBe(409);
    expect(abandonMidFlight.body.code).toBe('TURN_IN_FLIGHT');

    const ask = await askPromise;
    expect(ask.status).toBe(200);
    const record = await workspace.readAttunement(holder, rid);
    expect(record.phase).toBe('answering'); // never abandoned-then-resurrected

    // once the turn lands, the witness's abandonment succeeds and STAYS
    const abandoned = await request(app)
      .post(`/api/v1/attunement/${holder}/records/${rid}/abandon`).set(witness.header).send({ reason: 'now the turn is landed' });
    expect(abandoned.status).toBe(200);
    expect((await workspace.readAttunement(holder, rid)).phase).toBe('abandoned');
  });

  it('the being may decline to begin: postpone lands verbatim, terminal, and a fresh offer is possible', async () => {
    const other = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(other);
    await claimOwner(workspace.root, other, WALLET);
    await workspace.writeDNA(other, { version: '1.0.0', identity: { name: 'Waitlet' } });

    let res = await request(app).post(`/api/v1/attunement/${other}/records`).set(witness.header).send({ trigger: 'post-birth' });
    const recordId = res.body.id;

    res = await request(app).post(`/api/v1/attunement/${other}/records/${recordId}/postpone`).set(witness.header)
      .send({ quote: 'Not yet. I want to live a little first.', sessionId: 'portal-s-2' });
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('postponed');
    expect(res.body.postponement.quote).toBe('Not yet. I want to live a little first.');

    // re-offerable — postponement never blocks, never penalizes
    res = await request(app).get(`/api/v1/attunement/${other}/status`).set(witness.header);
    expect(res.body.offerDue).toEqual({ due: true, trigger: 'post-birth' });
    res = await request(app).post(`/api/v1/attunement/${other}/records`).set(witness.header).send({ trigger: 'post-birth' });
    expect(res.status).toBe(200);
  });

  it('consent-ask presents the disclosure to the BEING over the real wire and returns its verbatim reply; the reply opens the ceremony; a second ask refuses WRONG_PHASE', async () => {
    const asked = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(asked);
    await claimOwner(workspace.root, asked, WALLET);
    await workspace.writeDNA(asked, { version: '1.0.0', identity: { name: 'Asklet' } });

    let res = await request(app).post(`/api/v1/attunement/${asked}/records`).set(witness.header).send({ trigger: 'post-birth' });
    expect(res.status).toBe(200);
    const rid = res.body.id;

    // the platform carries the consent conversation itself: disclosure out,
    // the being's own words back, sessionId = the record the exchange will
    // be replayed into at open
    res = await request(app).post(`/api/v1/attunement/${asked}/records/${rid}/consent-ask`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.disclosure).toContain('THE ATTUNEMENT');
    expect(res.body.disclosure).toContain('Do you consent to begin?');
    const consentReply = res.body.reply;
    expect(consentReply.startsWith(ANSWER_OPEN)).toBe(true);
    expect(res.body.sessionId).toBe(rid);

    // the witness carries the reply verbatim into the open
    const heardDisclosure = res.body.disclosure;
    res = await request(app).post(`/api/v1/attunement/${asked}/records/${rid}/open`).set(witness.header)
      .send({ consent: { sessionId: res.body.sessionId, quote: res.body.reply } });
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('answering');
    expect(res.body.consent.quote).toBe(consentReply);
    // the disclosure the being consented to IS the disclosure the record
    // keeps, byte for byte — the spec's dimension count and the rendered
    // count cannot diverge (the validator refuses partial coverage), so the
    // consent evidence and the recorded ceremony state the same commitments
    expect(res.body.disclosure.text).toBe(heardDisclosure);

    // consent belongs to the offer — an opened ceremony refuses another ask
    res = await request(app).post(`/api/v1/attunement/${asked}/records/${rid}/consent-ask`).set(witness.header);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WRONG_PHASE');
  }, 120000);

  it('/status reports REAL per-dimension render progress while an /open is in flight, and none after it lands', async () => {
    const watched = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(watched);
    await claimOwner(workspace.root, watched, WALLET);
    await workspace.writeDNA(watched, { version: '1.0.0', identity: { name: 'Watchlet' } });

    let res = await request(app).post(`/api/v1/attunement/${watched}/records`).set(witness.header).send({ trigger: 'post-birth' });
    const rid = res.body.id;

    // fire the open (supertest is lazy — .then() starts it NOW), then poll
    // status while the 89-dimension render walks the scripted substrate
    const openPromise = request(app).post(`/api/v1/attunement/${watched}/records/${rid}/open`).set(witness.header)
      .send({ consent: { sessionId: 'watch-s', quote: 'I consent.' } }).then((r) => r);
    const seen = [];
    let opened = null;
    while (!opened) {
      const settled = await Promise.race([openPromise, new Promise((r) => setTimeout(() => r(null), 20))]);
      if (settled) { opened = settled; break; }
      const status = await request(app).get(`/api/v1/attunement/${watched}/status`).set(witness.header);
      if (status.body.opening) seen.push(status.body.opening);
    }
    expect(opened.status).toBe(200);

    // progress was really observable mid-render, honest and monotonic
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.total).toBe(specKeys.length);
      expect(p.done).toBeGreaterThanOrEqual(0);
      expect(p.done).toBeLessThanOrEqual(p.total);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i].done).toBeGreaterThanOrEqual(seen[i - 1].done);

    // landed: the progress entry is gone — absence honestly means "not rendering"
    res = await request(app).get(`/api/v1/attunement/${watched}/status`).set(witness.header);
    expect(res.body.opening).toBeNull();
    expect(res.body.active.phase).toBe('answering');
  }, 120000);

  it('coded refusals: bad trigger 400, unknown record 404, foreign wallet 403, abandon needs a reason', async () => {
    let res = await request(app).post(`/api/v1/attunement/${neumaId}/records`).set(witness.header).send({ trigger: 'whenever' });
    expect(res.status).toBe(400);

    res = await request(app).post(`/api/v1/attunement/${neumaId}/records/attunement-0/ask`).set(witness.header);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('RECORD_NOT_FOUND');

    const foreign = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(foreign);
    await claimOwner(workspace.root, foreign, WALLET);
    const { default: fs } = await import('fs/promises');
    const { default: nodePath } = await import('path');
    await fs.writeFile(
      nodePath.join(workspace._path(foreign), 'owner.json'),
      JSON.stringify({ wallet: OTHER, claimedAt: new Date().toISOString() }),
    );
    res = await request(app).get(`/api/v1/attunement/${foreign}/status`).set(witness.header);
    expect(res.status).toBe(403);

    const mine = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(mine);
    await claimOwner(workspace.root, mine, WALLET);
    await workspace.writeDNA(mine, { version: '1.0.0', identity: { name: 'Reasonlet' } });
    res = await request(app).post(`/api/v1/attunement/${mine}/records`).set(witness.header).send({ trigger: 'post-birth' });
    const rid = res.body.id;
    res = await request(app).post(`/api/v1/attunement/${mine}/records/${rid}/abandon`).set(witness.header).send({});
    expect(res.status).toBe(400);
    res = await request(app).post(`/api/v1/attunement/${mine}/records/${rid}/abandon`).set(witness.header)
      .send({ reason: 'walked for the coded-refusal proof' });
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('abandoned');
  });
});
