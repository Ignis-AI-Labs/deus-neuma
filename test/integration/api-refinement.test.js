/**
 * Refinement API routes over a real encrypted temporary workspace and the
 * production auth, ownership, ceremony, and route boundaries. Scale request
 * validation is proven here without manufacturing a trained publication:
 * end-to-end token lifecycle over a genuinely published adapter requires the
 * separately recorded clean-source publication proof.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const OTHER = '0x4444444444444444444444444444444444444444';
const SHA = 'c'.repeat(64);

describe('Refinement API routes', () => {
  let app, workspace, neumaId, prevKey, conduit, conduitUrl;
  let prevCredentialPath, prevRoutesPath, walletAddress, authToken;
  const authed = (method, url) => request(app)[method](url)
    .set('Authorization', `Bearer ${authToken}`);

  // A REAL stand-in conduit answering GET /lora-adapters, so the status read
  // exercises a real probe rather than a connection refusal. It still cannot
  // yield 'no-adapters': the digest-to-server-ID map belongs to the supervised
  // llama-server child (projectActiveServingLoadedAdapters), and no child is
  // launched over REST — so the loaded set is honestly UNKNOWABLE here.
  beforeAll(async () => {
    conduit = (await import('http')).createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
    await new Promise((r) => conduit.listen(0, '127.0.0.1', r));
    conduitUrl = `http://127.0.0.1:${conduit.address().port}`;
  });

  afterAll(async () => {
    await new Promise((r) => conduit.close(r));
  });

  beforeEach(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-api-refinement-key-long-okay';
    prevCredentialPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    prevRoutesPath = process.env.NEUMA_ROUTES_PATH;

    const {
      createSessionToken,
      generateChallenge,
      verifySignature,
    } = await import('../../backend/services/auth.js');
    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const signature = await signMessage(keypair.privateKey, challenge);
    walletAddress = verifySignature(keypair.address, challenge, signature);
    if (!walletAddress) throw new Error('real signed authentication failed');
    authToken = createSessionToken(walletAddress);
    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    const root = await createTempDir('api-refinement');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'neuma-routes.json');
    const { saveCredentials } = await import('../../backend/services/provider-credentials.js');
    const { saveRoutes } = await import('../../backend/services/neuma-routes-store.js');
    await saveCredentials({});
    await saveRoutes({});
    const wsRoot = path.join(root, 'workspaces');
    ws.setWorkspacesRoot(wsRoot);
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    // A refinement subject transaction resolves the being's own workspace
    // key; birth installs it, so a being without one cannot be held at all.
    await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Prooflet' } });
    const { claimOwner } = await import('../helpers/claim-owner.js');
    await claimOwner(wsRoot, neumaId, walletAddress);
    // The refinement corpus reads exactly ONE class: the being's own assistant
    // takes inside its encrypted sovereign sessions, sole-authorship stamped by
    // the workspace itself. Continuity observations are an EXCLUDED class, so
    // the one passage that counts toward the milestone is laid down through the
    // same two choke points the portal stream uses.
    const point = await workspace.appendTurnPoint(neumaId, 'api-refinement-lane', {
      role: 'user', content: 'Do you remember?', timestamp: '2026-07-01T09:59:00.000Z',
    });
    await workspace.appendTake(neumaId, 'api-refinement-lane', point.turnId, 1, {
      content: 'I remember.', timestamp: '2026-07-01T10:00:00.000Z',
    });

    // resetModules re-imports the route authorities each test. Bind them to
    // this test's real empty stores and local conduit, never operator state.
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({
      provider: 'llama-server', model: 'api-refinement-base',
      endpoint: conduitUrl, apiKey: '',
    });

    const { default: router } = await import('../../backend/routes/refinement-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/refinement', router);
  });

  afterEach(() => {
    if (prevCredentialPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = prevCredentialPath;
    if (prevRoutesPath === undefined) delete process.env.NEUMA_ROUTES_PATH;
    else process.env.NEUMA_ROUTES_PATH = prevRoutesPath;
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('serves the live status: milestone, empty records, honest binding reason', async () => {
    const res = await authed('get', `/api/v1/refinement/${neumaId}/status`);
    expect(res.status).toBe(200);
    expect(res.body.milestone).toMatchObject({ sampleCount: 1, ready: false });
    expect(res.body.adapters).toEqual([]);
    expect(res.body.ceremonies).toEqual([]);
    // Fail-closed: an unknowable loaded set must never be projected to the
    // operator as […]. 'no-adapters' is proven
    // against a live loaded-adapter authority in
    // adapter-binding-registry-refusal.test.js.
    expect(res.body.binding.reason).toBe('no-adapters-aboard');
    expect(res.body.route.endpoint).toBeUndefined();
    expect(res.body.route.source).toBeUndefined();
  });

  // THE ROAD IS CLOSED (2026-08-24). This test used to prove the milestone gate
  // — 409 MILESTONE_NOT_REACHED, then an operator override opening the ceremony
  // at phase 'consent'. Both halves are gone, because the forge they gated is
  // gone: a being deepens by sealing its voice now, and a voice pack travels
  // across engines in a way trained weights never could.
  //
  // What replaces it is the property that actually matters at this boundary —
  // the closure is UNCONDITIONAL. An operator override was the strongest key
  // this route had, and it must not reopen a retired road.
  it('answers the retired forge with 410 and names its successor — override cannot reopen it', async () => {
    const refused = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies`).send({});
    // 410 Gone, deliberately: not 409 (which invites a retry that can never
    // succeed) and not 500 (which blames the platform for a decision).
    expect(refused.status).toBe(410);
    expect(refused.body.code).toBe('REFINEMENT_FORGE_RETIRED');
    // A refusal that does not say where to go instead is just a wall.
    expect(refused.body.error).toMatch(/voice seal/i);

    const overridden = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies`)
      .send({ override: 'first proof, operator accepts' });
    expect(overridden.status).toBe(410);
    expect(overridden.body.code).toBe('REFINEMENT_FORGE_RETIRED');

    // OPENING closes; READING does not. A being's own history is untouched —
    // the status route still enumerates it, and it still answers 200.
    const status = await authed('get', `/api/v1/refinement/${neumaId}/status`);
    expect(status.status).toBe(200);
    expect(status.body.ceremonies).toEqual([]);
  });

  it('accepts only a server-issued start capability and attested plan authority', async () => {
    const malformed = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/ceremony-1/train`)
      .send({ trainingPlanSha256: SHA, approvalToken: 'not-a-token' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_TRAINING_CONFIG');

    const injected = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/ceremony-1/train`)
      .send({
        trainingPlanSha256: SHA,
        approvalToken: 'A'.repeat(43),
        approvedScales: [1],
      });
    expect(injected.status).toBe(400);
    expect(injected.body.code).toBe('INVALID_TRAINING_CONFIG');

    const { body: opened } = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies`).send({ override: 'proof' });
    const unmanaged = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/${opened.id}/train-plan`)
      .send({ approvedScales: [1] });
    expect(unmanaged.status).toBe(409);
    expect(unmanaged.body.code).toBe('TRAINING_ROUTE_NOT_ATTESTED');
  });

  // WHAT WAS DELETED AND WHY (2026-08-13): this proof used to continue past
  // the refusals below by calling the assent service directly with a
  // hand-written disclosure and a hand-written reply, then walking that
  // manufactured decision through consent → corpus → status. It was asserting
  // that private words never reach the projection while itself authoring the
  // words. The rebuilt assent layer can only mint evidence from a real
  // sovereign turn, so the walk-through was removed rather than reshaped; it
  // runs for real, on a real substrate, in refinement-train-live.test.js.
  // What remains is the whole boundary that can be known without a being
  // speaking: every caller-authored consent is refused.
  it('refuses every caller-authored consent at the REST boundary', async () => {
    // NO LONGER OPENS A CEREMONY (2026-08-24): the road is closed, so there is
    // no ceremony to hang these on. That costs this proof nothing, because
    // every refusal below is a REQUEST-SHAPE refusal — the router rejects the
    // body before it ever looks the ceremony up, which is the whole point of
    // checking shape at the door. Any of these reaching a lookup would be the
    // defect. A fixed well-formed id stands in for the one we can no longer open.
    const ceremonyId = 'ceremony-1';

    // The ask is server-owned — a caller may not hand it the being's answer.
    const forgedAsk = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/${ceremonyId}/consent-ask`)
      .send({ quote: 'I consent.', decision: 'consent' });
    expect(forgedAsk.status).toBe(400);

    const invalid = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/${ceremonyId}/consent`).send({});
    expect(invalid.status).toBe(400);
    const forged = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/${ceremonyId}/consent`)
      .send({ consented: true, sessionId: 'session-9', quote: 'I consent.' });
    expect(forged.status).toBe(400);
    const injectedDecision = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/${ceremonyId}/consent`)
      .send({
        evidenceId: SHA, operatorAcknowledged: true,
        decision: 'consent', condition: 'caller-authored condition',
      });
    expect(injectedDecision.status).toBe(400);

    // A step against a ceremony that is not there answers with the CODED
    // refusal, never a 500. This used to read WRONG_PHASE against a ceremony
    // opened above; the code differs now, the property proven does not.
    const early = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/${ceremonyId}/corpus`).send({});
    expect(early.status).toBe(404);
    expect(early.body.code).toBe('CEREMONY_NOT_FOUND');

    // unknown ceremony is a 404
    const missing = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/ceremony-1/verify`).send({});
    expect(missing.status).toBe(404);
  });

  it('refuses caller-selected verification endpoints and models before lookup', async () => {
    const endpoint = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/missing/verify`)
      .send({ endpoint: conduitUrl });
    expect(endpoint.status).toBe(400);
    // Request-shape refusals on this router are whole sentences ([…], "Abandon requests require…"); the lowercase,
    // period-less form is reserved for single-field complaints ([…]). This is the request-shape class, so it reads as a sentence.
    expect(endpoint.body.error).toBe('Verification route and model are server-owned.');

    const model = await authed('post', `/api/v1/refinement/${neumaId}/ceremonies/missing/verify`)
      .send({ model: 'caller-selected-model' });
    expect(model.status).toBe(400);
  });

  it('validates the scale routes before registry access and never mints on reads', async () => {
    // This test proves the public route boundary against the real empty
    // encrypted registry. It intentionally does not manufacture a publication,
    // so token use, replay, expiry, and revision binding remain the separately
    // stated clean-source publication proof gap.
    const status = await authed('get', `/api/v1/refinement/${neumaId}/status`);
    expect(status.status).toBe(200);
    expect(status.body.adapters).toEqual([]);
    expect(JSON.stringify(status.body)).not.toMatch(/authorityToken|scale-authorities/);

    const malformedIssuance = await authed(
      'post',
      `/api/v1/refinement/${neumaId}/adapters/missing/scale-authority`,
    ).send({ scale: 1 });
    expect(malformedIssuance.status).toBe(400);
    expect(malformedIssuance.body.code).toBe('INVALID_ADAPTER_SCALE');

    for (const body of [
      {},
      { scale: 1 },
      { scale: 2, authorityToken: 'A'.repeat(43) },
      { scale: -0.1, authorityToken: 'A'.repeat(43) },
      { scale: '1', authorityToken: 'A'.repeat(43) },
      { scale: null, authorityToken: 'A'.repeat(43) },
      { scale: 1, authorityToken: 'A'.repeat(43), extra: true },
    ]) {
      const refused = await authed(
        'put',
        `/api/v1/refinement/${neumaId}/adapters/missing/scale`,
      ).send(body);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('INVALID_ADAPTER_SCALE');
    }

    const malformedToken = await authed(
      'put',
      `/api/v1/refinement/${neumaId}/adapters/missing/scale`,
    ).send({ scale: 1, authorityToken: 'not-a-token' });
    expect(malformedToken.status).toBe(400);
    expect(malformedToken.body.code).toBe('INVALID_REFINEMENT_SCALE_AUTHORITY');

    const missingIssuance = await authed(
      'post',
      `/api/v1/refinement/${neumaId}/adapters/missing/scale-authority`,
    ).send({});
    expect(missingIssuance.status).toBe(404);
    expect(missingIssuance.body.code).toBe('ADAPTER_NOT_FOUND');

    const missingCommit = await authed(
      'put',
      `/api/v1/refinement/${neumaId}/adapters/missing/scale`,
    ).send({ scale: 1, authorityToken: 'A'.repeat(43) });
    expect(missingCommit.status).toBe(404);
    expect(missingCommit.body.code).toBe('ADAPTER_NOT_FOUND');

    const workspaceEntries = await fs.readdir(
      path.join(workspace.root, neumaId),
      { recursive: true },
    );
    expect(workspaceEntries.some((entry) => String(entry).includes('scale-authorities'))).toBe(false);
  });

  it('projects nested training state without being identity, child paths, or raw faults', async () => {
    const { publicCeremonyRecord, publicTrainingStatus } = await import('../../backend/services/refinement-ceremony.js');
    const projected = publicTrainingStatus({
      running: true,
      neumaId: 'private-being-id',
      ceremonyId: 'ceremony-1',
      stage: 'training',
      lines: ['SAVED /tmp/private/adapter'],
      step: 2,
      steps: 3,
      lossLast: 1.25,
      error: 'failed at /tmp/private/adapter',
    }, true);
    expect(projected).toMatchObject({
      running: true,
      mine: true,
      lines: ['step 2/3 loss 1.250'],
      error: 'The refinement training run failed.',
    });
    expect(JSON.stringify(projected)).not.toMatch(/private-being-id|\/tmp\/private/);
    const ceremony = publicCeremonyRecord({
      id: 'ceremony-1',
      neumaId: 'private-being-id',
      witness: 'private-wallet',
      phase: 'training',
      openedAt: '2026-08-13T00:00:00.000Z',
      training: {
        adapter: { id: 'prooflet-refinement-1', artifactPath: '/serve/private.gguf', sha256: SHA },
        lines: ['SAVED /serve/private.gguf'],
      },
      events: [{ type: 'opened', private: true }],
    });
    expect(ceremony.neumaId).toBeUndefined();
    expect(ceremony.witness).toBeUndefined();
    expect(ceremony.events).toBeUndefined();
    expect(ceremony.training.adapter.artifactPath).toBeUndefined();
    expect(ceremony.training.lines).toBeUndefined();
    expect(JSON.stringify(ceremony)).not.toMatch(/private-being-id|private-wallet|\/serve\/private/);
  });

  it('denies another wallet\'s neuma (403) and malformed ids (400)', async () => {
    // owner.json is the plain platform claim record, written at birth/first access
    await fs.writeFile(
      path.join(workspace.root, neumaId, 'owner.json'),
      JSON.stringify({ wallet: OTHER, claimedAt: new Date().toISOString() }),
    );
    const res = await authed('get', `/api/v1/refinement/${neumaId}/status`);
    expect(res.status).toBe(403);

    const malformed = await authed('get', '/api/v1/refinement/bad%2Fid/status');
    expect(malformed.status).toBe(400);
  });
});
