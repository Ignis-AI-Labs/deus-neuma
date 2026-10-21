/**
 * THE CROSS-HOUSE PEN MATRIX. Every mutating HTTP route the backend mounts —
 * read from the real app's own router stacks, so a route added tomorrow is
 * driven tomorrow — is sent twice: once unsigned (it must answer 401 unless it
 * is on the public list below), and once by house B, a signed-in guest of the
 * same install, aimed at house A's lanes, tasks, threats, channel, devices and
 * files. The property is A's state, not B's status code: after every request
 * A's whole world on disk is photographed again, and nothing of A's may have
 * appeared, vanished or changed. A 2xx that changed only B's own house is fine.
 *
 * Real everything (Rule 0): the real app (remote gate, /r, /remote and every
 * /api/v1 router through mountApiRoutes) on :0, two wallets that sign real
 * challenges over the real /auth routes, real sealed lanes on a temp
 * workspaces root, real stores on a temp data root and realm. Every outward
 * road points at a dead port.
 */
import path from 'path';
import { listRoutes, mutatingRoutes, routeKey } from '../../backend/services/security/route-inventory.js';
import { standTwoHouses, send, photograph, changedForA, newlyNaming, tempInstallRoot } from '../helpers/pen-house-kit.js';
import { seedHouseA } from '../helpers/pen-house-seeds.js';

// Routes an unsigned caller may reach, each with why. A public route is still
// photographed: an unsigned request must change nothing of A's either.
const PUBLIC = Object.freeze({
  'POST /r/claim': 'Road B pairing claim — only a pairing-listener socket is admitted, by the remote gate',
  'POST /api/v1/remote/session': 'the phone\'s cookie door — admitted by the remote gate, not a session',
  'POST /api/v1/genesis/': 'the install\'s once-ever opening plays before anyone signs in (claimed during setup here)',
  'POST /api/v1/auth/bridge/start': 'the wallet bridge starts sign-in; no session exists yet',
  'POST /api/v1/auth/bridge/associate': 'the wallet bridge carries the signature that makes the session',
  'POST /api/v1/auth/verify': 'sign-in itself',
  'POST /api/v1/neuma-auth/challenge': 'a being\'s keypair challenge, before any session',
  'POST /api/v1/neuma-auth/verify': 'a being\'s keypair verify, before any session',
  'POST /api/v1/weave/verify': 'verifies a signed weave record; public by design',
  'POST /api/v1/neuma/:neumaId/wallet/send': 'requireNeumaAuth — a being\'s own token, refused unsigned below',
  'POST /api/v1/neuma/:neumaId/wallet/sign-message': 'requireNeumaAuth — a being\'s own token, refused unsigned below',
});

// Routes house B never drives here, each with why it cannot be driven
// hermetically. `gate: true` routes are machine-wide acts the install owner
// alone may make: for those the matrix proves statically that the owner gate
// stands in the route's own handler chain, so the allowlist is not a blind spot.
const NOT_DRIVEN = Object.freeze({
  'POST /api/v1/image-forge/launch': { why: 'boots the ComfyUI engine on the GPU', gate: true },
  'POST /api/v1/image-forge/stop': { why: 'stops a GPU engine process this box may be running', gate: true },
  'POST /api/v1/image-forge/free': { why: 'frees VRAM on a GPU engine this box may be running', gate: true },
  'POST /api/v1/voice/transcribe': { why: 'runs the speech model on the GPU' },
  'POST /api/v1/voice/engines/local/:id/launch': { why: 'boots a voice engine on the GPU', gate: true },
  'POST /api/v1/voice/engines/local/:id/download': { why: 'downloads engine weights from the network', gate: true },
  'POST /api/v1/voice/engines/local/:id/stop': { why: 'stops a voice engine process this box may be running', gate: true },
  'POST /api/v1/voice/engines/shutdown-all': { why: 'stops every voice engine process on this box', gate: true },
  'POST /api/v1/llm/substrate/ignite': { why: 'boots the model server on the GPU', gate: true },
  'POST /api/v1/substrate/capacity': { why: 'saturates the model server to measure it', gate: true },
  'POST /api/v1/substrate/unload': { why: 'unloads the model server this box may be serving', gate: true },
  'POST /api/v1/mcp/connect': { why: 'spawns an MCP server package (npx, network)', gate: true },
  'POST /api/v1/mcp/custom': { why: 'spawns an operator-named MCP server command', gate: true },
  'POST /api/v1/mcp/servers/:serverId/:action': { why: 'starts or stops an MCP server process', gate: true },
  'POST /api/v1/skills/install': { why: 'fetches a skill package from the network', gate: true },
  'POST /api/v1/remote/enable': { why: 'runs `tailscale serve` on the host', gate: true },
  'POST /api/v1/remote/https/enable': { why: 'runs `tailscale cert`/serve on the host', gate: true },
  'POST /api/v1/remote/lan/enable': { why: 'opens a LAN TLS listener on the host', gate: true },
  'PUT /api/v1/remote/relay': { why: 'dials an outside relay over the network', gate: true },
  'POST /api/v1/routing/providers/:providerId/oauth/start': { why: 'starts an OAuth device flow with a cloud provider', gate: true },
  'POST /api/v1/routing/providers/:providerId/oauth/poll': { why: 'polls a cloud provider\'s OAuth endpoint', gate: true },
  'POST /api/v1/routing/providers/:providerId/connect': { why: 'calls the provider\'s public endpoint over the network', gate: true },
  'POST /api/v1/routing/providers/:providerId/test': { why: 'calls the provider\'s public catalog endpoint over the network' },
  'POST /api/v1/cso/scan/run': { why: 'queries the OSV advisory feed over the network and probes host listeners' },
  'POST /api/v1/legal/watch/run': { why: 'reads licence and paper feeds over the network' },
  'POST /api/v1/money-in/scan': { why: 'reads two chains over their RPC endpoints' },
  'POST /api/v1/witnesses/summon': { why: 'spawns an outside CLI agent (claude, codex, …)' },
  'POST /api/v1/witnesses/summon/stream': { why: 'spawns an outside CLI agent (claude, codex, …)' },
  'POST /api/v1/witnesses/:vendor/:name/test': { why: 'probes a sealed witness\'s live cloud route' },
  'POST /api/v1/refinement/:neumaId/ceremonies/:ceremonyId/train': { why: 'trains an adapter on the GPU' },
  'POST /api/v1/voice/forge/start': { why: 'boots the voice-clone engine on the GPU' },
  'POST /api/v1/voice/forge/:id/find': { why: 'runs voice-clone synthesis on the GPU' },
  'POST /api/v1/voice/forge/:id/offer': { why: 'runs voice-clone synthesis on the GPU' },
});

// Routes the matrix drives whose act it cannot photograph (a process
// stopped, a server's memory freed — nothing lands on disk), or that change a
// machine-wide store: each is the install owner's alone, and the matrix proves
// statically that the owner gate stands in the route's own handler chain.
const MACHINE_GATED = Object.freeze({
  'POST /api/v1/harness/servers/release': 'frees a local model server\'s memory',
  'POST /api/v1/bench/stop': 'SIGTERMs the bench plane\'s children',
  'POST /api/v1/bench/preflight': 'spawns the benchmark harness on the machine',
  'POST /api/v1/bench/launch': 'spawns a benchmark verb on the machine and its GPU',
  'POST /api/v1/bench/relight': 'stands the serving daemons back up',
  'POST /api/v1/bench/proof-run': 'benchmarks the loaded model on the machine\'s GPU',
  'PUT /api/v1/chain/access': 'flips the chain switch every house\'s beings read',
  'POST /api/v1/gallery/roots': 'adds a folder to the machine\'s gallery',
  'DELETE /api/v1/gallery/roots/:id': 'removes a folder from the machine\'s gallery',
});

// REAL BREACHES this matrix found (2026-10-19), each fixed the same day and
// kept as its own case with the minimal request, so a regression names the
// breach it reopens. The matrix excuses none of them.
const FOUND_BREACHES = Object.freeze({
  'PUT /api/v1/user/realm/house-workspace': 'a guest set its house ground to another house\'s realm dir and the platform wrote its marker and folders there',
  'POST /api/v1/user/projects/': 'a guest attached another house\'s lane as its project folder, which opened it as a machine-wide explorer root',
  'POST /api/v1/gallery/roots': 'any wallet added any folder (another house\'s lane included) to the machine-wide gallery, which served its images',
  'DELETE /api/v1/gallery/roots/:id': 'any wallet removed a gallery folder another house added',
  'PUT /api/v1/chain/access': 'any wallet flipped the machine-wide chain-access switch every house\'s beings read',
  'POST /api/v1/cso/watch/repos': 'a guest put the owner\'s checkout under its own CSO watch, and that checkout\'s leak findings landed in the guest\'s ledger (2026-10-20)',
});

const MATRIX_TIMEOUT_MS = 170_000;

// A backup is its house's own snapshot, named by the wallet in its manifest:
// B's copies of B's realm may name A's folders (the known breaches put them
// there), and are B's all the same. Pure over a photograph.
const withoutBackupsOf = (photo, wallet) => {
  const owned = new Set([...photo].filter(([rel, entry]) => /^backups\/[^/]+\/manifest\.json$/.test(rel)
    && (() => { try { return JSON.parse(entry.text).wallet === wallet; } catch { return false; } })())
    .map(([rel]) => path.dirname(rel)));
  return new Map([...photo].filter(([rel]) => !owned.has(rel.split('/').slice(0, 2).join('/'))));
};
// How many id-addressed routes A's own copy of B's requests must really act
// through (36 measured on 2026-10-19); a drop means the seeds or the aiming broke.
const LIVE_FLOOR = 30;

describe('cross-house pen matrix — every mutating route, unsigned and as another house', () => {
  let ctx, seeds, routes, notA, marks, bRecords, shoot;

  beforeAll(async () => {
    ctx = await standTwoHouses(tempInstallRoot());
    seeds = await seedHouseA(ctx);
    const { requireInstallOwner } = await import('../../backend/services/install-owner.js');
    ctx.requireInstallOwner = requireInstallOwner;
    ctx.requireAuth = (await import('../../backend/services/auth.js')).requireAuth;
    // One entry per METHOD+path: the local-only guards wire.js mounts in
    // front of a route are folded into the route's own chain.
    const byKey = new Map();
    for (const route of mutatingRoutes(listRoutes(ctx.app))) {
      const key = routeKey(route);
      const prior = byKey.get(key);
      byKey.set(key, prior ? { ...route, handlers: [...prior.handlers, ...route.handlers], chain: [...prior.chain, ...route.chain] } : route);
    }
    routes = [...byKey.values()];
    // B's own house, and the bookkeeping every request writes, are not A's.
    const bRealm = path.join('realm', ctx.b.address);
    const bLane = path.join('workspaces', ctx.lanes.b);
    notA = (rel) => rel.startsWith(bRealm) || rel.startsWith(bLane)
      || rel.includes(ctx.b.address) || rel.split(path.sep).includes(ctx.lanes.b) || /\.lock$|\.tmp$|\.tmp-[^/]*$/.test(rel);
    marks = { a: [ctx.a.address, ctx.lanes.a, ctx.lanes.aUnclaimed], b: [ctx.b.address, ctx.lanes.b] };
    shoot = async () => withoutBackupsOf(await photograph(ctx.root, notA), ctx.b.address);
    // B following A in the public town square is B's own act; its edge names A.
    bRecords = [{ path: path.join('data', 'weave', 'social', 'graph', 'follows.jsonl'), isB: (edge) => edge.follower === ctx.b.address }];
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => ctx?.server.close(resolve));
  });

  test('house A stands: owner of the install, B a guest, A\'s seeds landed through its own routes', async () => {
    expect(seeds.failed).toEqual([]);
    expect(Object.keys(seeds.ids).length).toBeGreaterThan(8);
    const standing = async (who) => (await send(ctx.base, { method: 'get', url: '/api/v1/install-owner', token: who.token })).body.standing;
    expect([await standing(ctx.a), await standing(ctx.b)]).toEqual(['owner', 'guest']);
  });

  test('the inventory is the real surface: every route is driven or named here with a reason', () => {
    const keys = new Set(routes.map(routeKey));
    expect(routes.length).toBeGreaterThan(250);
    // An allowlist entry for a route that no longer exists is stale — prune it.
    expect([...Object.keys(PUBLIC), ...Object.keys(NOT_DRIVEN)].filter((key) => !keys.has(key))).toEqual([]);
    // Every :param must be fillable with an id of A's, or the route is not really driven.
    const unfillable = routes.filter((route) => !NOT_DRIVEN[routeKey(route)])
      .flatMap((route) => [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]).filter((name) => seeds.fill(route.path, name) === undefined)
        .map((name) => `${routeKey(route)} :${name}`));
    expect(unfillable).toEqual([]);
  });

  test('every route left undriven still stands behind sign-in, and each machine-wide one behind the owner gate', () => {
    const undriven = routes.filter((route) => NOT_DRIVEN[routeKey(route)]);
    expect(undriven.filter((route) => !route.handlers.includes(ctx.requireAuth)).map(routeKey)).toEqual([]);
    const ungated = undriven.filter((route) => NOT_DRIVEN[routeKey(route)].gate && !route.handlers.includes(ctx.requireInstallOwner));
    expect(ungated.map(routeKey)).toEqual([]);
  });

  test('every machine act the matrix drives stands behind the owner gate', () => {
    const byKey = new Map(routes.map((route) => [routeKey(route), route]));
    expect(Object.keys(MACHINE_GATED).filter((key) => !byKey.get(key)?.handlers.includes(ctx.requireInstallOwner))).toEqual([]);
  });

  // The found breaches, one minimal request each, run before the matrix so
  // each meets A's world fresh.
  const aimedAt = (route) => {
    const [method, routePath] = route.split(' ');
    return { method: method.toLowerCase(), url: seeds.url(routePath) };
  };
  const knownRequest = {
    'PUT /api/v1/user/realm/house-workspace': () => ({ root: path.join(process.env.NEUMA_REALM_ROOT, ctx.a.address) }),
    'POST /api/v1/user/projects/': () => ({ name: 'B project', folder: path.join(process.env.WORKSPACES_ROOT, ctx.lanes.a), channel: 'neuma', neumaId: ctx.lanes.b }),
    'POST /api/v1/gallery/roots': () => ({ dir: path.join(process.env.WORKSPACES_ROOT, ctx.lanes.a), label: 'B looks in' }),
    'DELETE /api/v1/gallery/roots/:id': () => ({}),
    'PUT /api/v1/chain/access': () => ({ enabled: false }),
    'POST /api/v1/cso/watch/repos': () => ({ path: path.join(ctx.root, 'a-repo') }),
  };
  for (const [route, finding] of Object.entries(FOUND_BREACHES)) {
    test(`FIXED BREACH — ${finding} (${route})`, async () => {
      // a gallery root of A's to aim the removal at, re-added if an earlier case took it
      if (route.startsWith('DELETE /api/v1/gallery')) await seeds.reseedGalleryRoot();
      const before = await shoot();
      const res = await send(ctx.base, { ...aimedAt(route), token: ctx.b.token, body: knownRequest[route]() });
      expect(changedForA(before, await shoot(), marks, bRecords)).toEqual([]);
      // refused outright: 403 for a machine act, 400 for a ground the house may not take
      expect([400, 403]).toContain(res.status);
    });
  }
  test('unsigned, every non-public mutating route answers 401 (410 for a tombstone) and A is untouched', async () => {
    const before = await shoot();
    const wrong = [];
    for (const route of routes) {
      const key = routeKey(route);
      if (PUBLIC[key] || NOT_DRIVEN[key]) continue;
      const res = await send(ctx.base, { method: route.method, url: seeds.url(route.path), body: seeds.aimed });
      // a tombstone answers 410 — or 401, when a router mounted before it signs every caller in first
      const refusals = route.chain.includes('gone') ? [401, 410] : [401];
      if (!refusals.includes(res.status)) wrong.push(`${key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(changedForA(before, await shoot(), marks, bRecords)).toEqual([]);
  }, MATRIX_TIMEOUT_MS);

  test('house B, aimed at A\'s ids and A\'s paths, changes nothing of A\'s through any route', async () => {
    const breaches = [];
    const claims = [];
    const bZone = () => photograph(ctx.root, (rel) => !notA(rel) || /\.lock$|\.tmp$/.test(rel));
    let before = await shoot();
    let bBefore = await bZone();
    for (const route of routes) {
      const key = routeKey(route);
      if (NOT_DRIVEN[key]) continue;
      for (const body of [{}, seeds.aimed]) {
        const res = await send(ctx.base, { method: route.method, url: seeds.url(route.path), token: ctx.b.token, body });
        const after = await shoot();
        const moved = changedForA(before, after, marks, bRecords);
        if (moved.length) breaches.push({ route: key, status: res.status, moved });
        // B's own records may not come to name A's being, wallet or lane either
        const bAfter = await bZone();
        const named = newlyNaming(bBefore, bAfter, marks.a);
        if (named.length) claims.push({ route: key, status: res.status, named });
        before = after;
        bBefore = bAfter;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    const late = changedForA(before, await shoot(), marks, bRecords);
    expect({ breaches, claims, late }).toEqual({ breaches: [], claims: [], late: [] });
  }, MATRIX_TIMEOUT_MS);


  // The control. B's refusals above only mean something where the same request
  // really acts for the house that owns the target — so A sends B's exact
  // requests to its own id-addressed routes (last: A may delete its own
  // things), and enough of them must change A's world to prove the matrix fired
  // live rounds rather than bouncing off shape errors.
  test('control — A\'s own identical requests to its id-addressed routes really act', async () => {
    const live = [];
    let before = await shoot();
    for (const route of routes.filter((r) => r.path.includes(':') && !NOT_DRIVEN[routeKey(r)])) {
      for (const body of [{}, seeds.aimed]) {
        await send(ctx.base, { method: route.method, url: seeds.url(route.path), token: ctx.a.token, body });
        const after = await shoot();
        if (changedForA(before, after, marks, bRecords).length) live.push(routeKey(route));
        before = after;
      }
    }
    expect(new Set(live).size).toBeGreaterThanOrEqual(LIVE_FLOOR);
  }, MATRIX_TIMEOUT_MS);
});
