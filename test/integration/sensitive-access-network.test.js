/**
 * The shell network gate (RULE 0): REAL bwrap shell, REAL host listeners,
 * REAL approval broker over a REAL WebSocket. Offline is the default — the
 * kernel unshares the network namespace. The operator's card opens it, once:
 * allow runs this shell networked, ALWAYS persists to the lane's policy, and
 * a deny runs offline without re-asking every command. Networked means
 * OUTWARD: the internet, never this machine's own services or its home network.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { dispatchPlatformTool } from '../../backend/services/portal-tool-dispatch.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { shellNetworkSessionHeld } from '../../backend/services/shell-network-grants.js';
import {
  ensureWitnessCodingSandbox,
  runWitnessCommand,
} from '../../backend/services/witness-coding-sandbox.js';

const LANE = 'network-gate-lane';
const PROBE = (port, host = '127.0.0.1') => `node -e "fetch('http://${host}:${port}', {signal: AbortSignal.timeout(5000)}).then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(2))"`;
const PUBLIC = 'https://example.com/';
const FETCH = (url) => `node -e "fetch('${url}', {signal: AbortSignal.timeout(10000)}).then(r=>console.log('status', r.status)).catch(()=>process.exit(2))"`;
// Networked = a real interface with a default route (the host itself is never reachable).
const NETWORKED = `node -e "const up=require('fs').readFileSync('/proc/net/route','utf8').split('\\n').some(l=>l.split(/\\s+/)[1]==='00000000');console.log(up?'NETWORK-PROOF':'offline');process.exit(up?0:2)"`;
const lanAddress = () => Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address ?? null;

describe('the shell network gate — real bwrap, real listener, real card', () => {
  let root, source, listener, listenerPort, prevKey;

  beforeEach(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-shell-network-key-long-ok';
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-shell-network-'));
    source = path.join(root, 'ground');
    await fs.mkdir(source);
    setWorkspacesRoot(path.join(root, 'workspaces'));
    await neumaWorkspace.create(LANE);
    listener = http.createServer((req, res) => res.end('NETWORK-PROOF'));
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    listenerPort = listener.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => listener.close(resolve));
    setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    await fs.rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('offline by default; the granted mode is a real network that cannot reach this machine', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    const offline = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: PROBE(listenerPort) });
    expect(offline.exitCode).toBe(2); // no interfaces — kernel truth, not a firewall rule
    const run = (command) => runWitnessCommand({ ...sandbox, mode: 'inspect', command, network: true });
    // A real interface with a default route: the grant is a network, not a stub.
    const routes = await run('cat /proc/net/route');
    expect(routes.exitCode).toBe(0);
    expect(routes.stdout.split('\n').some((line) => line.split(/\s+/)[1] === '00000000')).toBe(true);
    // This machine's own services stay out of reach: loopback, and the host's LAN address.
    const wide = http.createServer((req, res) => res.end('NETWORK-PROOF'));
    await new Promise((resolve) => wide.listen(0, '::', resolve));
    try {
      expect((await run(PROBE(listenerPort))).exitCode).toBe(2);
      expect((await run(PROBE(wide.address().port))).exitCode).toBe(2);
      expect((await run(PROBE(wide.address().port, '[::1]'))).exitCode).toBe(2);
      const lan = lanAddress();
      if (lan) expect((await run(PROBE(wide.address().port, lan))).exitCode).toBe(2);
    } finally { await new Promise((resolve) => wide.close(resolve)); }
    // The shell's own loopback is its own: a server it starts itself answers it.
    const own = await run(`node -e "const s=require('http').createServer((q,r)=>r.end('OWN-LOOPBACK')).listen(0,'127.0.0.1',()=>fetch('http://127.0.0.1:'+s.address().port).then(r=>r.text()).then(t=>{console.log(t);s.close()}))"`);
    expect(own.stdout).toContain('OWN-LOOPBACK');
    // Outward works whenever the host itself is online: same target, judged from both sides.
    const hostOnline = await fetch(PUBLIC, { signal: AbortSignal.timeout(10000) }).then(() => true, () => false);
    const outward = await run(FETCH(PUBLIC));
    if (hostOnline) {
      expect(outward.exitCode).toBe(0);
      expect(outward.stdout).toMatch(/status \d{3}/);
    } else {
      console.warn('host offline — the outward reach half of this proof did not run');
    }
  }, 120_000);

  describe('the card flow', () => {
    let server, wss, serverWs, client, frames, connection, decide, currentConnection;
    const match = (command) => ({ server: 'coding', toolName: 'execute', tool: 'coding/execute', args: { command } });
    const untilFrame = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const started = Date.now();
      const inspect = () => {
        const frame = frames.find(predicate);
        if (frame) resolve(frame);
        else if (Date.now() - started >= timeoutMs) reject(new Error('frame never arrived'));
        else setTimeout(inspect, 10);
      };
      inspect();
    });
    const dispatch = (call) => dispatchPlatformTool(call, {
      ws: serverWs, connection, companion: connection.companion, policy: null, toolMode: 'ask', args: call.args,
    });

    beforeEach(async () => {
      decide = null;
      server = http.createServer();
      wss = new WebSocketServer({ server });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const linked = new Promise((resolve) => { wss.once('connection', (s) => { serverWs = s; resolve(); }); });
      client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
      const opened = new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
      frames = [];
      client.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        if (frame.type === 'tool:approval_request' && decide) {
          client.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: decide(frame) }));
        }
      });
      await Promise.all([linked, opened]);
      connection = {
        ws: serverWs, walletAddress: '0xoperator', toolMode: 'ask', toolWorkspace: source,
        activeTurn: new AbortController(), companion: { name: 'NetGate', neumaId: LANE, participantKind: 'neuma' },
      };
      serverWs.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.type === 'tool:approval_response' && currentConnection) {
          resolveToolApproval(currentConnection, frame.id, frame.decision);
        }
      });
      currentConnection = connection;
      const tools = await beingCodingToolsFor(connection); // prepares connection._turnSandbox
      await stashBeingTurnCatalog(connection, tools, []);   // and the catalog the dispatch judges against
    });

    afterEach(async () => {
      client?.terminate(); serverWs?.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    });

    test('allow opens the network for the session and does not persist', async () => {
      decide = () => 'allow';
      const result = await dispatch(match(NETWORKED));
      expect(result.status).toBe('ok');
      expect(String(result.content)).toContain('NETWORK-PROOF');
      const request = await untilFrame((f) => f.type === 'tool:approval_request' && f.tool === 'coding/shell_network');
      // Since a437e530f the consent lives in shell-network-grants.js's own
      // binding-keyed state, not on connection flags; the session hold is read
      // through the same seam the PERMISSIONS ledger reads.
      expect(request.scope).toContain(`Internet (outward only) for lane ${LANE}`);
      expect(shellNetworkSessionHeld(LANE)).toBe(true);
      expect((await neumaWorkspace.readToolPolicy(LANE))?.shellNetwork).toBeUndefined();
    }, 60_000);

    test('ALWAYS persists — a fresh connection rides networked with no new card', async () => {
      decide = () => 'always';
      const result = await dispatch(match(NETWORKED));
      expect(result.status).toBe('ok');
      expect(String(result.content)).toContain('NETWORK-PROOF');
      const persisted = await neumaWorkspace.readToolPolicy(LANE);
      expect(persisted?.shellNetwork).toBe(true);

      // A fresh connection hydrates the grant (the _hydratePathGrants shape):
      // the execute tier re-asks (tier grants are their own axis); the NETWORK
      // grant must ride with no new card.
      decide = (frame) => (frame.tool === 'coding/shell_network' ? 'deny' : 'allow');
      const fresh = {
        ws: serverWs, walletAddress: '0xoperator', toolMode: 'ask', toolWorkspace: source,
        activeTurn: new AbortController(), companion: connection.companion,
      };
      fresh._shellNetwork = persisted.shellNetwork === true;
      const tools = await beingCodingToolsFor(fresh);
      await stashBeingTurnCatalog(fresh, tools, []);
      currentConnection = fresh;
      const cardsBefore = frames.filter((f) => f.type === 'tool:approval_request' && f.tool === 'coding/shell_network').length;
      const again = await dispatchPlatformTool(
        { server: 'coding', toolName: 'execute', tool: 'coding/execute', args: { command: NETWORKED } },
        { ws: serverWs, connection: fresh, companion: fresh.companion, policy: null, toolMode: 'ask', args: { command: NETWORKED } },
      );
      expect(String(again.content)).toContain('NETWORK-PROOF');
      expect(frames.filter((f) => f.type === 'tool:approval_request' && f.tool === 'coding/shell_network').length).toBe(cardsBefore);
    }, 60_000);

    test('deny runs offline and never re-asks within the session', async () => {
      decide = (frame) => (frame.tool === 'coding/shell_network' ? 'deny' : 'allow');
      const first = await dispatch(match(NETWORKED));
      expect(shellNetworkSessionHeld(LANE)).toBe(false);
      expect(first.status).not.toBe('ok');
      const cardsBefore = frames.filter((f) => f.type === 'tool:approval_request' && f.tool === 'coding/shell_network').length;
      expect(cardsBefore).toBe(1);
      decide = () => 'allow'; // a later yes must not be asked — the no stands for the session
      await dispatch(match(NETWORKED));
      const cardsAfter = frames.filter((f) => f.type === 'tool:approval_request' && f.tool === 'coding/shell_network').length;
      expect(cardsAfter).toBe(1);
    }, 60_000);
  });
});
