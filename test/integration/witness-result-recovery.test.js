/** Real witness tools, encrypted persistence, authenticated approvals and exact recovery. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { toolsForWitness, formatWitnessToolResult } from '../../backend/services/witness-tools.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { createTurnToolEpochs } from '../../backend/services/portal-tool-epochs.js';
import { nativeToolExchange } from '../../backend/services/witness-turn-record.js';

let kit;
let runtime;
let turn;
const call = (server, toolName, args) => ({ server, toolName, args, tool: `${server}/${toolName}` });
const execute = (entry) => processWitnessToolBatch({ ws: kit.ws, connection: kit.connection, calls: [entry], runtime, turn });

beforeEach(async () => {
  kit = await createHarnessTurnKit('witness-test-ResultRecovery');
  await connectFilesystemServer();
  runtime = await toolsForWitness(kit.connection, null);
  turn = createTurnToolEpochs();
  kit.client.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type === 'tool:approval_request') kit.decide(frame, 'allow');
  });
});
afterEach(async () => { await mcpService.disconnect('filesystem'); await kit?.close(); });

const readLarge = async () => {
  const content = 'α😀中文 — source line\n'.repeat(3500);
  const target = path.join(workspace.pathFor(kit.laneId), 'large.txt');
  await fs.writeFile(target, content);
  const entry = { ...call('fs', 'read', { path: target }), callId: 'native-read' };
  const [result] = await execute(entry);
  expect(result.status, JSON.stringify(result)).toBe('ok');
  return { content, entry, result };
};

test('first large result persists, advertises retrieval immediately, and reconstructs exactly through real tool pages', async () => {
  expect(runtime.tools.some((tool) => tool.server === 'record' && tool.name === 'retrieve_result')).toBe(true);
  const { content, entry, result } = await readLarge();
  expect(result.ref).toMatch(/^tr_/);
  expect((await workspace.readToolResult(kit.laneId, kit.connection.sessionId, result.ref)).content).toBe(content);
  const formatted = formatWitnessToolResult(result);
  expect(formatted.length).toBeLessThan(60100);
  expect(formatted).toContain(`"ref":"${result.ref}","offset":0`);
  const exchange = nativeToolExchange('', [entry], [result], 0);
  expect(exchange.find((message) => message.role === 'tool').content).toContain(result.ref);

  let offset = 0;
  let recovered = '';
  do {
    const [page] = await execute(call('record', 'retrieve_result', { ref: result.ref, offset, pageChars: 3000 }));
    expect(page.status, JSON.stringify(page)).toBe('ok');
    expect(page.content.length).toBeLessThanOrEqual(4000);
    const split = page.content.indexOf('\n');
    recovered += page.content.slice(split + 1);
    const cursor = page.content.slice(0, split).match(/next_offset: (\d+|end)/)?.[1];
    expect(cursor).toBeDefined();
    offset = cursor === 'end' ? null : Number(cursor);
  } while (offset !== null);
  expect(recovered).toBe(content);
  expect(kit.connection.toolResultSeq).toBe(1);
  expect(kit.connection.toolResultBytes).toBe(Buffer.byteLength(content));
});

test('a fresh catalog can retrieve an old ref; foreign sessions and lanes cannot', async () => {
  const { result } = await readLarge();
  kit.connection.toolResultSeq = 0;
  runtime = await toolsForWitness(kit.connection, null);
  const retrieve = call('record', 'retrieve_result', { ref: result.ref, offset: 0 });
  expect((await execute(retrieve))[0].status).toBe('ok');

  kit.connection.sessionId = 'different-session';
  turn = createTurnToolEpochs();
  expect((await execute(retrieve))[0]).toMatchObject({ status: 'error', error: expect.stringContaining('no such result this session') });

  kit.connection.sessionId = 'session-harness-origin';
  const otherLane = 'witness-test-OtherResultRecovery';
  await workspace.create(otherLane);
  kit.connection.companion = { ...kit.connection.companion, neumaId: otherLane };
  turn = createTurnToolEpochs();
  expect((await execute(retrieve))[0]).toMatchObject({ status: 'error', error: expect.stringContaining('no such result this session') });
});

test('quota refusal does not invent a recoverable ref or claim the result was stored', async () => {
  kit.connection.toolResultByteCap = 1;
  const { result } = await readLarge();
  expect(result.ref).toBeUndefined();
  const formatted = formatWitnessToolResult(result);
  expect(formatted).toContain('[truncated');
  expect(formatted).not.toContain('record/retrieve_result');
  expect(await workspace.readToolResults(kit.laneId, kit.connection.sessionId)).toEqual([]);
});
