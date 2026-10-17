/**
 * GET /api/v1/acts — the OPERATOR's read of the act ledger (SEC-035 #213).
 *
 * NOTHING mocked except console: real Express, real challenge-sign-verify auth
 * with two real wallets, real NeumaWorkspace on a temp root, a real witnesses'
 * ground beside it, real owner.json custody records, and real ledger lines
 * written through the production `recordAct`.
 *
 * The write half of this ledger shipped proven. The READ half was broken in two
 * ways that between them returned NOTHING to the operator, which is why this
 * file exists:
 *
 *   1. `workspace.listNeumaByOwner` returns `{neumaId, owner}` OBJECTS. The
 *      route put those into a Set and the ledger compared them against string
 *      `record.laneId` values — so an unfiltered read matched no act at all,
 *      and asking for a lane you DO own was refused as unowned.
 *   2. That listing deliberately excludes witness lanes (they must never enter
 *      a neuma roster). But a sealed witness's acts run through the same
 *      executor into the same ledger, so every witness act was invisible.
 *
 * Both are regression-tested here, plus the sovereignty grep the issue calls
 * the one that matters, with a positive control.
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => {
    resolve({ server, baseUrl: `http://localhost:${server.address().port}` });
  });
});

describe('GET /api/v1/acts — custody-scoped, both standings (real auth, real disk)', () => {
  let app, server, baseUrl, root, witnessRoot, dataRoot, workspace, recordAct;
  let walletA, walletB, tokenA, tokenB, origDataRoot;

  const NEUMA_LANE = 'neuma-tenekom';
  const WITNESS_LANE = 'witness-xai-Bizulen';
  const OTHER_LANE = 'neuma-someone-else';

  const authenticate = async (keypair) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/challenge?address=${keypair.address}`);
    const { challenge } = await res.json();
    const signature = await signMessage(keypair.privateKey, challenge);
    const verify = await fetch(`${baseUrl}/api/v1/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: keypair.address, signature, challenge }),
    });
    expect(verify.status).toBe(200);
    return (await verify.json()).token;
  };

  const get = (route, token) => fetch(`${baseUrl}${route}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  // A real lane on disk, carrying a being, claimed by a wallet.
  const lane = async (dir, laneId, wallet, kind) => {
    await fs.mkdir(path.join(dir, laneId, 'dna'), { recursive: true });
    await fs.writeFile(path.join(dir, laneId, 'dna', 'genesis.md'), '# Genesis\n');
    await fs.writeFile(path.join(dir, laneId, 'owner.json'),
      JSON.stringify({ wallet, claimedAt: new Date().toISOString() }));
    if (kind) {
      await fs.writeFile(path.join(dir, laneId, 'lane.json'), JSON.stringify({ kind }));
    }
  };

  beforeEach(async () => {
    vi.resetModules();

    root = await createTempDir('acts-route');
    witnessRoot = await createTempDir('acts-route-witnesses');
    dataRoot = await createTempDir('acts-route-data');
    origDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = dataRoot;   // the ledger writes here

    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    workspace.root = root;
    ws.setWitnessesRoot(witnessRoot);

    ({ recordAct } = await import('../../backend/services/act-ledger.js'));
    const { default: actRouter } = await import('../../backend/routes/act-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/acts', actRouter);
    ({ server, baseUrl } = await listen(app));

    walletA = generateKeypair();
    walletB = generateKeypair();
    tokenA = await authenticate(walletA);
    tokenB = await authenticate(walletB);

    await lane(root, NEUMA_LANE, walletA.address, null);
    await lane(witnessRoot, WITNESS_LANE, walletA.address, 'witness');
    await lane(root, OTHER_LANE, walletB.address, null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (origDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = origDataRoot;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('an owned neuma lane`s acts come back — the read that used to yield nothing', async () => {
    await recordAct({
      laneId: NEUMA_LANE, kind: 'neuma', tool: 'filesystem/write_file',
      args: { path: '/tmp/report.md' }, decision: 'auto', status: 'success',
    });
    const res = await get('/api/v1/acts', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.acts[0]).toMatchObject({
      laneId: NEUMA_LANE, tool: 'filesystem/write_file', decision: 'auto',
    });
    expect(body.acts[0].scope).toBe('/tmp/report.md');
  });

  test('an owned WITNESS lane`s acts come back — they were excluded entirely', async () => {
    await recordAct({
      laneId: WITNESS_LANE, kind: 'witness', tool: 'filesystem/edit_file',
      args: { path: '/tmp/notes.md' }, decision: 'approved', status: 'success',
    });
    const body = await (await get('/api/v1/acts', tokenA)).json();
    expect(body.count).toBe(1);
    expect(body.acts[0]).toMatchObject({ laneId: WITNESS_LANE, kind: 'witness' });
  });

  test('both standings are counted, and named', async () => {
    const body = await (await get('/api/v1/acts', tokenA)).json();
    expect(body.lanes).toBe(2);
    expect(body.standing).toEqual({ neuma: 1, witness: 1 });
  });

  test('narrowing to a lane you DO own is 200, not 403', async () => {
    await recordAct({ laneId: NEUMA_LANE, kind: 'neuma', tool: 'a/b', decision: 'auto', status: 'ok' });
    await recordAct({ laneId: WITNESS_LANE, kind: 'witness', tool: 'c/d', decision: 'auto', status: 'ok' });

    const onlyNeuma = await get(`/api/v1/acts?laneId=${NEUMA_LANE}`, tokenA);
    expect(onlyNeuma.status).toBe(200);
    const a = await onlyNeuma.json();
    expect(a.acts.map((x) => x.tool)).toEqual(['a/b']);

    const onlyWitness = await get(`/api/v1/acts?laneId=${WITNESS_LANE}`, tokenA);
    expect(onlyWitness.status).toBe(200);
    expect((await onlyWitness.json()).acts.map((x) => x.tool)).toEqual(['c/d']);
  });

  test('narrowing to a lane you do NOT own is refused, never silently emptied', async () => {
    const res = await get(`/api/v1/acts?laneId=${OTHER_LANE}`, tokenA);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Not your lane/);
  });

  test('another wallet`s acts never appear in your ledger', async () => {
    await recordAct({ laneId: OTHER_LANE, kind: 'neuma', tool: 'filesystem/write_file', decision: 'auto', status: 'ok' });
    await recordAct({ laneId: NEUMA_LANE, kind: 'neuma', tool: 'filesystem/read_file', decision: 'auto', status: 'ok' });

    const mine = await (await get('/api/v1/acts', tokenA)).json();
    expect(mine.acts.map((a) => a.laneId)).toEqual([NEUMA_LANE]);

    const theirs = await (await get('/api/v1/acts', tokenB)).json();
    expect(theirs.acts.map((a) => a.laneId)).toEqual([OTHER_LANE]);
  });

  test('a wallet owning no lanes gets an empty ledger, not someone else`s', async () => {
    const stranger = generateKeypair();
    const token = await authenticate(stranger);
    await recordAct({ laneId: NEUMA_LANE, kind: 'neuma', tool: 'a/b', decision: 'auto', status: 'ok' });
    const body = await (await get('/api/v1/acts', token)).json();
    expect(body).toMatchObject({ count: 0, lanes: 0 });
    expect(body.acts).toEqual([]);
  });

  test('no token is 401 — the ledger is never public', async () => {
    expect((await get('/api/v1/acts', null)).status).toBe(401);
  });

  test('all three decisions read back, including a DENIED act', async () => {
    for (const decision of ['auto', 'approved', 'denied']) {
      await recordAct({ laneId: NEUMA_LANE, kind: 'neuma', tool: `t/${decision}`, decision, status: 'ok' });
    }
    const body = await (await get('/api/v1/acts', tokenA)).json();
    expect(body.acts.map((a) => a.decision)).toEqual(['auto', 'approved', 'denied']);
  });

  test('since= narrows by instant, not just by day', async () => {
    await recordAct({ laneId: NEUMA_LANE, kind: 'neuma', tool: 'old/act', decision: 'auto', status: 'ok' });
    await new Promise((r) => setTimeout(r, 5));
    const cut = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await recordAct({ laneId: NEUMA_LANE, kind: 'neuma', tool: 'new/act', decision: 'auto', status: 'ok' });

    const body = await (await get(`/api/v1/acts?since=${encodeURIComponent(cut)}`, tokenA)).json();
    expect(body.acts.map((a) => a.tool)).toEqual(['new/act']);
  });

  // THE ONE THAT MATTERS (#213's own words). Byte-level search of what the
  // operator's surface actually returns, with a positive control so a passing
  // grep can't be an empty haystack.
  test('SOVEREIGNTY — a secret in a tool argument never reaches the operator`s read', async () => {
    const SECRET = 'zzq-vault-secret-9f3c1e77-never-in-a-ledger';
    await recordAct({
      laneId: NEUMA_LANE, kind: 'neuma', tool: 'vault/store_note',
      args: {
        path: '/tmp/tenekom/vault/note-14.md',   // a NAMING slot — must survive
        content: `the passphrase is ${SECRET}`, // a PAYLOAD — must not
        token: SECRET,                          // an unlisted key — must not
      },
      decision: 'approved', status: 'success',
    });

    const raw = await (await get('/api/v1/acts', tokenA)).text();
    expect(raw).not.toContain(SECRET);                      // the claim
    expect(raw).toContain('vault/store_note');              // positive control
    expect(raw).toContain('/tmp/tenekom/vault/note-14.md');  // positive control

    // And not on disk either — the response can only be clean if the line is.
    const day = `${new Date().toISOString().slice(0, 10)}.jsonl`;
    const onDisk = await fs.readFile(path.join(dataRoot, 'acts', day), 'utf8');
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).toContain('vault/store_note');
  });

  test('SOVEREIGNTY — a credential in a URL query does not ride the scope', async () => {
    const TOKEN = 'ghp_zzq1234567890abcdefghijklmnopqrstuv';
    await recordAct({
      laneId: NEUMA_LANE, kind: 'neuma', tool: 'web/web_fetch',
      args: { url: `https://api.example.com/v1/data?token=${TOKEN}#frag` },
      decision: 'approved', status: 'success',
    });
    const raw = await (await get('/api/v1/acts', tokenA)).text();
    expect(raw).not.toContain(TOKEN);
    expect(raw).toContain('https://api.example.com/v1/data'); // origin + pathname kept
  });
});
