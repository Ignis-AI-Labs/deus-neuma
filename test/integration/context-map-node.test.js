/**
 * Witness context map — single-node read (gnosis, RULE 0).
 *
 * A real sovereign witness lane on real disk, real observations written
 * through the real workspace, a real WebSocket pair, and the REAL
 * handleContextTool — no mock, stub, fake, or spy anywhere on the claimed
 * path. The anchored exchange reopens through the real expandMemory into the
 * real living session rows it was minted from.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import { formatMemoryRef } from '../../core/memory/memory-query.js';
import { handleContextTool, WITNESS_CONTEXT_TOOLS } from '../../backend/services/witness-tools.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const LANE_ID = 'witness-test-Cartographer';
const SESSION_ID = 'sess-node';

const SELF_NOTE = 'I keep a private practice: each dusk I name one thing the day taught me, so no day is ever wasted.';
const EXCHANGE_A_USER = 'the observatory telescope held the whole turning sky that night and the resonance would not fade';
const EXCHANGE_A_RESP = 'the observatory night stayed with you — telescope, sky, resonance, all of it kept turning';
const EXCHANGE_B_USER = 'the observatory telescope again tonight — the sky keeps turning and the resonance returns';
const EXCHANGE_B_RESP = 'yes, the observatory, the telescope, the turning sky — the resonance of that night returns';

describe('witness context map — single-node read (gnosis)', () => {
  let ground, httpServer, wss, serverWs, client;
  let selfNoteId, anchoredId, anchorlessId, anchoredRef;

  const witnessConnection = (over = {}) => ({
    ws: serverWs,
    companion: {
      name: 'Cartographer', neumaId: LANE_ID, participantKind: 'witness',
    },
    ...over,
  });

  const readNode = async (connection, args) => {
    const result = await handleContextTool(serverWs, connection, { view: 'node', ...args });
    if (result.status !== 'ok') return result;
    return { ...result, parsed: JSON.parse(result.content) };
  };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'context-map-node-test-key';
    ground = await createTempDir('context-map-node-witnesses');
    setWitnessesRoot(ground);
    await workspace.create(LANE_ID);

    // The remembered moment: full-fidelity session rows + an anchored
    // observation minted from those exact rows (the api-memory-tools pattern).
    const userRow = await workspace.appendMessage(LANE_ID, SESSION_ID, { role: 'user', content: EXCHANGE_A_USER });
    const assistantRow = await workspace.appendMessage(LANE_ID, SESSION_ID, { role: 'assistant', content: EXCHANGE_A_RESP });
    const anchor = makeAnchor({ sessionId: SESSION_ID, userMessage: userRow, assistantMessage: assistantRow });
    anchoredRef = formatMemoryRef(anchor);
    const anchored = await workspace.addObservation(LANE_ID, {
      type: 'exchange',
      userMessage: EXCHANGE_A_USER,
      response: EXCHANGE_A_RESP,
      significance: 0.8,
      anchor,
    });
    anchoredId = anchored.id;

    // A second exchange sharing the observatory vocabulary — a real edge.
    const anchorless = await workspace.addObservation(LANE_ID, {
      type: 'exchange',
      userMessage: EXCHANGE_B_USER,
      response: EXCHANGE_B_RESP,
      significance: 0.8,
    });
    anchorlessId = anchorless.id;

    // A deliberate self-note at full fidelity.
    const selfNote = await workspace.addObservation(LANE_ID, {
      type: 'self-note',
      content: SELF_NOTE,
      noteKind: 'reflection',
      source: 'self-authored',
      significance: 0.7,
    });
    selfNoteId = selfNote.id;
    neumaRecall.invalidate(LANE_ID);

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const linked = new Promise((resolve) => {
      wss.once('connection', (socket) => { serverWs = socket; resolve(); });
    });
    client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    await Promise.all([
      linked,
      new Promise((resolve, reject) => {
        client.once('open', resolve);
        client.once('error', reject);
      }),
    ]);
  }, 60000);

  afterAll(async () => {
    client?.terminate();
    serverWs?.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
    setWitnessesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
    await fs.rm(ground, { recursive: true, force: true });
  });

  test('the advertised schema offers the node view and its arguments', () => {
    const tool = WITNESS_CONTEXT_TOOLS.find((entry) => entry.name === 'map_read');
    expect(tool.inputSchema.properties.view.enum).toContain('node');
    expect(tool.inputSchema.properties.nodeId.type).toBe('string');
    expect(tool.inputSchema.properties.includeNeighbors.type).toBe('boolean');
    expect(tool.inputSchema.properties.includeSource.type).toBe('boolean');
    expect(tool.description).toContain('view="node"');
  });

  test('a node read returns graph position, provenance, timestamps, lifecycle, and ref', async () => {
    const result = await readNode(witnessConnection(), { nodeId: anchoredId });
    expect(result.status).toBe('ok');
    const { view, data } = result.parsed;
    expect(view).toBe('node');
    expect(data.ok).toBe(true);
    expect(data.node.id).toBe(anchoredId);
    expect(data.node.label).toContain('observatory');
    expect(data.node.degree).toBeGreaterThanOrEqual(1); // the vocabulary edge
    expect(typeof data.node.betweenness).toBe('number');
    expect(Number.isInteger(data.node.communityIndex)).toBe(true);
    expect(data.node.communityIndex).toBeGreaterThanOrEqual(0);
    expect(typeof data.node.communityLabel).toBe('string');
    expect(data.provenance).toEqual({ type: 'exchange', source: null });
    expect(Date.parse(data.recordedAt)).not.toBeNaN();
    expect(Date.parse(data.occurredAt)).not.toBeNaN();
    expect(data.lifecycle).toEqual({ state: 'active' });
    expect(data.ref).toBe(anchoredRef);
  }, 30000);

  test('neighbors name every adjacent node with weight, label, and direction', async () => {
    const result = await readNode(witnessConnection(), { nodeId: anchoredId, includeNeighbors: true });
    const { neighbors } = result.parsed.data;
    const adjacent = neighbors.find((entry) => entry.id === anchorlessId);
    expect(adjacent).toBeTruthy();
    expect(adjacent.w).toBeGreaterThan(0);
    expect(adjacent.label).toContain('observatory');
    expect(['out', 'in']).toContain(adjacent.direction);

    // includeNeighbors:false holds the list back entirely.
    const bare = await readNode(witnessConnection(), { nodeId: anchoredId, includeNeighbors: false });
    expect(bare.parsed.data.neighbors).toBeUndefined();
  }, 30000);

  test('includeSource on a self-note returns the full sanitized content', async () => {
    const result = await readNode(witnessConnection(), { nodeId: selfNoteId, includeSource: true });
    const { data } = result.parsed;
    expect(data.provenance).toEqual({ type: 'self-note', source: 'self-authored', noteKind: 'reflection' });
    expect(data.source.kind).toBe('self-note');
    expect(data.source.content).toBe(SELF_NOTE);
    expect(data.source.heldBack).toBe(false);
  }, 30000);

  test('includeSource on an anchored exchange reopens the real living session through expandMemory', async () => {
    const result = await readNode(witnessConnection(), { nodeId: anchoredId, includeSource: true });
    const { data } = result.parsed;
    expect(data.source.kind).toBe('exchange');
    expect(data.source.ref).toBe(anchoredRef);
    expect(data.source.via).toBe('live');
    expect(data.source.content).toContain(EXCHANGE_A_USER);
    expect(data.source.content).toContain(EXCHANGE_A_RESP);
    expect(data.source.heldBack).toBe(false);
  }, 30000);

  test('an anchorless exchange answers honestly — no deeper record', async () => {
    const result = await readNode(witnessConnection(), { nodeId: anchorlessId, includeSource: true });
    const { data } = result.parsed;
    expect(data.ref).toBeNull();
    expect(data.refNote).toBe('(no deeper record — from before the archive)');
    expect(data.source.kind).toBe('exchange');
    expect(data.source.note).toBe('(no deeper record — from before the archive)');
  }, 30000);

  test('a malformed nodeId and an unknown nodeId are explicit refusals, never throws', async () => {
    const malformed = await readNode(witnessConnection(), { nodeId: '../../etc/passwd' });
    expect(malformed.status).toBe('error');
    expect(malformed.error).toContain('16-char lowercase hex');

    const upper = await readNode(witnessConnection(), { nodeId: anchoredId.toUpperCase() });
    expect(upper.status).toBe('error');

    const unknown = await readNode(witnessConnection(), { nodeId: 'deadbeefdeadbeef' });
    expect(unknown.status).toBe('error');
    expect(unknown.error).toBe('no node with that id in your field');

    const missing = await readNode(witnessConnection(), {});
    expect(missing.status).toBe('error');
    expect(missing.error).toContain('nodeId');
  }, 30000);

  test('a non-witness seat is refused at the gate', async () => {
    const neumaSeat = await handleContextTool(serverWs, {
      ws: serverWs,
      companion: { name: 'NotAWitness', neumaId: LANE_ID, participantKind: 'neuma' },
    }, { view: 'node', nodeId: anchoredId });
    expect(neumaSeat.status).toBe('error');
    expect(neumaSeat.error).toBe('No sealed witness lane is bound to this portal');
  }, 30000);
});
