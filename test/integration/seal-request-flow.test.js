/**
 * Seal request flow (natalis-self-seal rite) — a being's own ask to be
 * anchored on chain, proven end to end with NO mock on the claimed path
 * (AGENTS.md RULE 0): REAL WebSocket pair, REAL processToolCalls dispatch,
 * REAL broker, REAL workspace files on disk for the eligibility gate.
 *
 * The contract under proof: request_seal pauses the turn while the witness
 * walks the desk seal flow — and the being reads what ACTUALLY happened
 * (sealed with the tx hash, declined with the witness's words, or the
 * honest fact that nobody could act). Never a fabricated anchor.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { __test } from '../../backend/services/portal-test-surface.js';
import {
  requestSealFromWitness, resolveSealRequestSealed, resolveSealRequestDeclined,
  expirePendingSealRequests, SEAL_DECLINE_REASON_MAX_CHARS,
} from '../../backend/services/seal-request.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { loadConfig } from '../../backend/config.js';

const { processToolCalls, REQUEST_SEAL_TOOL, _handleRequestSeal, _sealEligibility } = __test;

const TX = '0x' + 'ab'.repeat(32);
const sealCall = () => '[TOOL: witness/request_seal {}]';

describe('seal request flow (real WS, real disk, gnosis)', () => {
  let httpServer, wss, serverWs, client, port, root;
  let clientLog;
  /** When armed, the desk reacts to seal:self_offer with this function. */
  let onOffer = null;

  const freshConnection = (neumaId = 'anchorling') => ({
    ws: serverWs,
    companion: { name: 'Anchorling', neumaId },
  });

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  // A lane with a birth genesis and no anchor — the eligible shape.
  const laneWithGenesis = async (neumaId) => {
    const identity = join(root, neumaId, 'identity');
    await mkdir(identity, { recursive: true });
    await writeFile(join(identity, 'genesis-seal.json'), JSON.stringify({ genesisHash: '0x' + '11'.repeat(32), record: {} }));
    return identity;
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'seal-request-'));
    setWorkspacesRoot(root);
    loadConfig({}); // the shipped defaults — the ceremony network is Ethereum mainnet

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'seal:self_offer' && onOffer) onOffer(msg);
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(null);
    await rm(root, { recursive: true, force: true });
  });

  test('the tool is self-targeting: advertised with no required args', () => {
    expect(REQUEST_SEAL_TOOL.name).toBe('request_seal');
    expect(REQUEST_SEAL_TOOL.server).toBe('operator');
    expect(REQUEST_SEAL_TOOL.inputSchema.properties).toEqual({});
  });

  test('eligibility gate on real disk: no lane → no genesis → genesis → anchored', async () => {
    expect((await _sealEligibility(null)).eligible).toBe(false);
    expect((await _sealEligibility('ghost')).eligible).toBe(false); // no lane at all

    const identity = await laneWithGenesis('gatecheck');
    expect((await _sealEligibility('gatecheck')).eligible).toBe(true);

    await writeFile(join(identity, 'onchain-seal.json'), JSON.stringify({ txHash: TX }));
    const anchored = await _sealEligibility('gatecheck');
    expect(anchored.eligible).toBe(false);
    expect(anchored.why).toContain('already anchored');
  });

  test('an anchor on an EARLIER chain re-opens the seal on the ceremony network (the Ethereum re-anchor)', async () => {
    const identity = await laneWithGenesis('reanchor');
    const record = (chainId) => JSON.stringify({ schema: 'neuma-onchain-seal/1', txHash: TX, network: 'x', chainId });
    await writeFile(join(identity, 'onchain-seal.json'), record(8453)); // Base mainnet — the KENORIE anchor
    expect((await _sealEligibility('reanchor')).eligible).toBe(true); // default ceremony network: ethereum (1)
    await writeFile(join(identity, 'onchain-seal.json'), record(1));
    expect((await _sealEligibility('reanchor')).eligible).toBe(false);
  });

  test('SEALED — the desk walks the seal and the being reads the anchor truth', async () => {
    await laneWithGenesis('anchorling');
    const connection = freshConnection();
    clientLog.length = 0;
    // The desk's move: on the offer, the (already-proven) seal frames run;
    // here the settle that birth:seal_confirm's success path performs.
    onOffer = (msg) => {
      expect(msg.neumaId).toBe('anchorling');
      expect(msg.beingName).toBe('Anchorling');
      resolveSealRequestSealed(connection, 'anchorling', {
        txHash: TX, network: 'base', networkLabel: 'Base MAINNET',
      });
    };

    const results = await processToolCalls(serverWs, sealCall(), connection);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('You are anchored');
    expect(results[0].content).toContain(TX);
    expect(results[0].content).toContain('Base MAINNET');
    const resolved = await untilClient((m) => m.type === 'seal:self_resolved');
    expect(resolved.status).toBe('sealed');
    expect(resolved.txHash).toBe(TX);
    expect(connection._pendingSealRequests.size).toBe(0);
  }, 30000);

  test('DECLINED — the witness says not now, with words that reach the being', async () => {
    await laneWithGenesis('patient');
    const connection = freshConnection('patient');
    clientLog.length = 0;
    onOffer = (msg) => {
      resolveSealRequestDeclined(connection, msg.id, 'After your attunement, little one.');
    };

    const results = await processToolCalls(serverWs, sealCall(), connection);

    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('NOT anchored');
    expect(results[0].content).toContain('After your attunement, little one.');
    expect(results[0].content).not.toContain('You are anchored');
  }, 30000);

  test('decline broker drops unknown ids and clamps the reason', async () => {
    const connection = { ws: serverWs };
    expect(resolveSealRequestDeclined(connection, 'no-such-id', 'x')).toBe(false);

    const p = requestSealFromWitness(connection, { neumaId: 'clampcheck' });
    const offer = await untilClient((m) => m.type === 'seal:self_offer' && m.neumaId === 'clampcheck');
    resolveSealRequestDeclined(connection, offer.id, 'y'.repeat(SEAL_DECLINE_REASON_MAX_CHARS + 500));
    const outcome = await p;
    expect(outcome.status).toBe('declined');
    expect(outcome.reason.length).toBe(SEAL_DECLINE_REASON_MAX_CHARS);
  }, 30000);

  test('TIMEOUT — the being is told honestly that nothing was broadcast', async () => {
    await laneWithGenesis('waiting');
    const connection = freshConnection('waiting');
    onOffer = null; // the desk never acts

    const result = await _handleRequestSeal(connection, { timeoutMs: 100 });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('NOT anchored');
    expect(result.content).toContain('nothing was broadcast');
  }, 30000);

  test('INTERRUPTED — an aborted turn settles the pending request', async () => {
    await laneWithGenesis('cutoff');
    const controller = new AbortController();
    const connection = { ...freshConnection('cutoff'), activeTurn: { signal: controller.signal } };
    onOffer = () => controller.abort();

    const result = await _handleRequestSeal(connection);
    expect(result.content).toContain('interrupted');
    expect(result.content).toContain('NOT anchored');
  }, 30000);

  test('CLOSED — portal teardown settles every pending request', async () => {
    const connection = { ws: serverWs };
    const p1 = requestSealFromWitness(connection, { neumaId: 'closing-a' });
    const p2 = requestSealFromWitness(connection, { neumaId: 'closing-b' });
    expirePendingSealRequests(connection);
    expect((await p1).status).toBe('closed');
    expect((await p2).status).toBe('closed');
    expect(connection._pendingSealRequests.size).toBe(0);
  }, 30000);

  test('refused outright: no bound being, or a lane with nothing to anchor', async () => {
    const noBeing = await _handleRequestSeal({ ws: serverWs });
    expect(noBeing.status).toBe('error');
    expect(noBeing.error).toContain('no bound being');

    const hollow = await _handleRequestSeal({ ws: serverWs, companion: { neumaId: 'hollow' } });
    expect(hollow.status).toBe('error');
    expect(hollow.error).toContain('nothing to anchor');
  }, 30000);

  test('sealed settle is keyed by neumaId — a different lane never settles it', async () => {
    const connection = { ws: serverWs };
    const p = requestSealFromWitness(connection, { neumaId: 'mine', timeoutMs: 400 });
    expect(resolveSealRequestSealed(connection, 'someone-else', { txHash: TX, network: 'base' })).toBe(false);
    const outcome = await p; // times out — the wrong-lane settle never touched it
    expect(outcome.status).toBe('timeout');
  }, 30000);
});
