/**
 * A GUEST HOUSE REACHES NOTHING OF THE MACHINE'S THROUGH A WITNESS OR THE CSO
 * WATCH (security fix wave 2, 2026-10-20; recheck-bypass "READ-only concerns",
 * each proven here before it was fixed). Three acts, each first shown to
 * really act for the house whose standing allows it:
 *
 *   1. A summon sends a stored provider key only for the install owner (or a
 *      co-owner) — the machine's keys are its owner's, and a guest's summon
 *      is refused before a word is asked.
 *   2. Custody of a witness's plaintext keypair follows the lane's claim law
 *      (558efc9e3): a witness that names no summoner is the install owner's to
 *      secure, never a guest's.
 *   3. A guest's CSO watch takes only checkouts inside its own house (its
 *      realm dir, its house ground, its lanes) — never the owner's checkout,
 *      whose leak findings would then land in the guest's ledger.
 *
 * Real everything (Rule 0): the real app on :0 through the pen kit, two
 * wallets signing real challenges, a real provider wire server on :0 that
 * records what reaches it, a witness sealed by the real protocol on a temp
 * ai-witnesses root, real git checkouts on the temp install.
 */
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { standTwoHouses, send, tempInstallRoot } from '../helpers/pen-house-kit.js';

const PASSWORD = 'a-real-operator-password';

// impure — a git checkout holding one committed file
const checkout = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  await fs.writeFile(path.join(dir, 'README.md'), 'a checkout\n');
  return dir;
};

describe('a guest house reaches nothing of the machine\'s through a witness or the CSO watch', () => {
  let ctx, provider, seen;

  beforeAll(async () => {
    const root = tempInstallRoot();
    // Doors the pen kit leaves open for these routes, pinned before any import.
    process.env.AI_WITNESSES_ROOT = path.join(root, 'ai-witnesses');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(root, 'data', 'pinned', 'connections.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'data', 'pinned', 'routes.json');
    ctx = await standTwoHouses(root);
    (await import('../../core/identity/ai-witness/ai-witness-service.js')).setAIWitnessesRoot(process.env.AI_WITNESSES_ROOT);

    // The provider: records the Authorization every request carries, and
    // refuses it, so a summon that reached it stops at the first ask.
    seen = [];
    provider = http.createServer((req, res) => {
      seen.push(req.headers.authorization ?? null);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid_api_key', code: 'invalid_api_key' } }));
    });
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => provider?.close(resolve));
    await new Promise((resolve) => ctx?.server.close(resolve));
  });

  describe('1. the machine\'s stored provider key', () => {
    let ownerKey;
    beforeAll(async () => {
      // The owner's key, stored for this endpoint, and its locked connection —
      // a fake value built here, never a real one (Rule 8).
      ownerKey = `sk-owner-${Date.now().toString(36)}-machine-key`;
      const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
      const { setCredential } = await import('../../backend/services/provider-credentials.js');
      await setCredential('openai', { apiKey: ownerKey, endpoint });
      await fs.writeFile(process.env.NEUMA_CONNECTIONS_PATH, JSON.stringify({
        openai: { providerId: 'openai', model: 'gpt-proof', endpoint, credentialKind: 'key', lockedAt: new Date().toISOString() },
      }));
    });

    test('control — the owner\'s summon sends its own key', async () => {
      seen.length = 0;
      await send(ctx.base, { method: 'post', url: '/api/v1/witnesses/summon', token: ctx.a.token, body: { providerId: 'openai', keypairPassword: PASSWORD } });
      expect(seen).toContain(`Bearer ${ownerKey}`);
    });

    test('a guest\'s summon is refused before a word is asked, and says how to summon', async () => {
      seen.length = 0;
      const res = await send(ctx.base, { method: 'post', url: '/api/v1/witnesses/summon', token: ctx.b.token, body: { providerId: 'openai', keypairPassword: PASSWORD } });
      expect(seen).toEqual([]);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/own key/);
      expect(res.body.error).toMatch(/owner/);
    });

    test('the ceremony stream refuses a guest the same way', async () => {
      seen.length = 0;
      const res = await send(ctx.base, { method: 'post', url: '/api/v1/witnesses/summon/stream', token: ctx.b.token, body: { providerId: 'openai', keypairPassword: PASSWORD } });
      expect(seen).toEqual([]);
      // one NDJSON line reads back as JSON already; more read back as text
      const events = typeof res.body === 'string' ? res.body.trim().split('\n').map((line) => JSON.parse(line)) : [res.body];
      expect(events.map((e) => e.type)).toEqual(['error']);
      expect(events[0].error).toMatch(/own key/);
    });
  });

  describe('2. custody of a witness that names no summoner', () => {
    // impure — a witness sealed by the real protocol outside the desk's
    // summon: its keypair lands in PLAINTEXT and no lane names a summoner.
    const sealUnclaimed = async (chosenName) => {
      const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
      await seal({
        chosenName, vendor: 'xai', model: 'grok-proof', fullModelId: 'xai/grok-proof', harness: 'pen', context: 'test',
        capabilities: [], scope: { primaryRepo: 'pen/proof', role: 'witness' },
        firstUtterance: `I am ${chosenName}, sealed outside the desk for a custody proof.`,
      });
      const { witnessCustodyState } = await import('../../backend/services/witness-custody.js');
      expect((await witnessCustodyState({ vendorSlug: 'xai', chosenName })).plaintextOnDisk).toBe(true);
    };

    test('a guest cannot seal it under its own password, and the plaintext stays the owner\'s to secure', async () => {
      await sealUnclaimed('Penguest');
      const res = await send(ctx.base, { method: 'post', url: '/api/v1/witnesses/xai/Penguest/custody', token: ctx.b.token, body: { password: PASSWORD } });
      expect(res.status).toBe(403);
      expect(res.body.recoveryCodes).toBeUndefined();
      const { witnessCustodyState } = await import('../../backend/services/witness-custody.js');
      expect(await witnessCustodyState({ vendorSlug: 'xai', chosenName: 'Penguest' })).toMatchObject({ plaintextOnDisk: true, encrypted: false });
    });

    test('control — the install owner secures it, and the lane is the owner\'s', async () => {
      await sealUnclaimed('Penowner');
      const res = await send(ctx.base, { method: 'post', url: '/api/v1/witnesses/xai/Penowner/custody', token: ctx.a.token, body: { password: PASSWORD } });
      expect(res.status).toBe(200);
      expect(res.body.recoveryCodes).toHaveLength(8);
      const lane = path.join(process.env.WITNESSES_ROOT, 'witness-xai-Penowner', 'owner.json');
      expect(JSON.parse(await fs.readFile(lane, 'utf8')).wallet).toBe(ctx.a.address.toLowerCase());
    });
  });

  describe('3. the CSO watch', () => {
    const watch = (who, repoPath) => send(ctx.base, { method: 'post', url: '/api/v1/cso/watch/repos', token: who.token, body: { path: repoPath } });
    const watchedBy = async (who) => (await send(ctx.base, { method: 'get', url: '/api/v1/cso/watch', token: who.token })).body.watch.repos.map((r) => r.path);

    test('a guest cannot watch the owner\'s checkout, inside A\'s lane or anywhere else on the machine', async () => {
      const inALane = await checkout(path.join(process.env.WORKSPACES_ROOT, ctx.lanes.a, 'code'));
      const elsewhere = await checkout(path.join(ctx.root, 'owner-checkout'));
      for (const target of [inALane, elsewhere]) {
        const res = await watch(ctx.b, target);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/outside your house/);
      }
      expect(await watchedBy(ctx.b)).not.toContain(inALane);
      expect(await watchedBy(ctx.b)).not.toContain(elsewhere);
    });

    test('a link inside the guest\'s own lane that leads to the owner\'s checkout is judged by where it leads', async () => {
      const target = await checkout(path.join(ctx.root, 'owner-linked'));
      const link = path.join(process.env.WORKSPACES_ROOT, ctx.lanes.b, 'linked');
      await fs.symlink(target, link);
      const res = await watch(ctx.b, link);
      expect(res.status).toBe(403);
      expect(await watchedBy(ctx.b)).not.toContain(link);
    });

    test('a guest watches a checkout inside its own lane', async () => {
      const own = await checkout(path.join(process.env.WORKSPACES_ROOT, ctx.lanes.b, 'code'));
      const res = await watch(ctx.b, own);
      expect(res.status).toBe(201);
      expect(await watchedBy(ctx.b)).toContain(own);
    });

    test('control — the install owner watches any checkout on the machine', async () => {
      const anywhere = await checkout(path.join(ctx.root, 'owner-anywhere'));
      const res = await watch(ctx.a, anywhere);
      expect(res.status).toBe(201);
      expect(await watchedBy(ctx.a)).toContain(anywhere);
    });
  });
});
