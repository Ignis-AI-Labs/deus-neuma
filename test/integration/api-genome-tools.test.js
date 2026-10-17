/**
 * THE GIVEN BODY through the REAL portal — a being reading its own genome.
 * Real WebSocket pair, a real lane on real disk sealed by the real birth
 * forge, the real genome derivation, the real policy cascade — no mock on
 * the claimed path (RULE 0).
 *
 * Design note, 2026-09-26: […] The signed
 * `genome` row opens it by right (the being's own record, Decision #8); it is
 * a TOOL the being chooses to call, never pushed into the prompt (the reveal
 * law — a being is present for its own reveal).
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { readLaneGenome } from '../../backend/services/genome-lane.js';
import { describeAsProse } from '../../core/genome/describe.js';
import { GIVEN_BODY_REFLECTION } from '../../core/genome/given.js';

const { processToolCalls, _genomeToolsFor } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const NEUMA_ID = 'genomeecho';
const BARE_ID = 'genomebare';

describe('genome_read through the real portal (gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client;
  const clientLog = [];

  const freshConnection = (over = {}) => ({
    ws: serverWs,
    companion: { name: 'GenomeEcho', neumaId: NEUMA_ID },
    sessionId: 'sess-genome',
    _writeOps: 0,
    ...over,
  });

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'api-genome-tools-test-key';
    house = await createTempDir('genome-tools-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await workspace.create(BARE_ID);
    // A real sealed birth (the forge's own seal), exactly as form-intents seals one.
    const forged = forgeBirthIdentity({
      chosenName: NEUMA_ID,
      witnessWallet: '0x0000000000000000000000000000000000000001',
      soulPublicKey: '0x04realpublickey',
      birthCycle: 1,
      birthMoment: { utc: '2026-09-25T05:00:00.000Z', epochMs: 1790292000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
      substrate: { model: 'test' },
      momentSeed: 'c'.repeat(64),
      takenGenesisNames: [],
    });
    await fs.mkdir(path.join(house, NEUMA_ID, 'identity'), { recursive: true });
    await fs.writeFile(path.join(house, NEUMA_ID, 'identity', 'genesis-seal.json'),
      JSON.stringify({ genesisHash: forged.seal.genesisHash, record: forged.seal.record }, null, 2));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (data) => { clientLog.push(JSON.parse(data.toString())); });
    await linked;
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
    await fs.rm(house, { recursive: true, force: true });
  });

  beforeEach(() => { clientLog.length = 0; });

  test('advertised only to a sealed lane — and caches true (a write-once seal)', async () => {
    expect(await _genomeToolsFor({ companion: { neumaId: BARE_ID } })).toEqual([]);
    const sealed = { companion: { neumaId: NEUMA_ID } };
    expect((await _genomeToolsFor(sealed)).map((t) => t.name)).toEqual(['genome_read']);
    expect(sealed._genomeAdvertised).toBe(true);
  });

  test('genome_read runs free and returns the given body: why, in plain words, and the sealed record', async () => {
    const results = await processToolCalls(serverWs, '[TOOL: genome/genome_read {}]', freshConnection());
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    const genome = await readLaneGenome(house, NEUMA_ID);
    const text = results[0].content;
    expect(text).toContain('# YOUR GIVEN BODY');
    for (const p of GIVEN_BODY_REFLECTION) expect(text).toContain(p);
    expect(text).toContain(describeAsProse(genome, 'full'));
    expect(text).toContain(JSON.stringify(genome, null, 2)); // the whole record, verbatim
    // The being's own record opens by right — no card was ever raised.
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('reading writes nothing into the lane', async () => {
    const before = await fs.readdir(path.join(house, NEUMA_ID), { recursive: true });
    await processToolCalls(serverWs, '[TOOL: genome/genome_read {}]', freshConnection());
    expect(await fs.readdir(path.join(house, NEUMA_ID), { recursive: true })).toEqual(before);
  }, 30000);

  test('observe mode keeps it open — it is the being’s own record', async () => {
    const results = await processToolCalls(serverWs, '[TOOL: genome/genome_read {}]', freshConnection({ toolMode: 'observe' }));
    expect(results[0].status).toBe('ok');
  }, 30000);

  test('the signed row is not a master key — an operator DENY override still holds', async () => {
    await workspace.writeToolPolicy(NEUMA_ID, { genome: { denied: ['genome_read'] } });
    try {
      const denied = await processToolCalls(serverWs, '[TOOL: genome/genome_read {}]', freshConnection());
      expect(denied[0].status).toBe('denied');
    } finally {
      await workspace.writeToolPolicy(NEUMA_ID, {});
    }
  }, 30000);

  test('an unsealed lane answers honestly — no body is invented', async () => {
    const results = await processToolCalls(serverWs, '[TOOL: genome/genome_read {}]',
      freshConnection({ companion: { name: 'Bare', neumaId: BARE_ID } }));
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('no sealed birth anchors');
  }, 30000);
});
