/** Real temporary lanes, signed sockets and production catalogs; no inference. */
import { afterEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { toolsForWitness } from '../../backend/services/witness-tools.js';
import { memoryToolsFor } from '../../backend/services/portal-tools/memory-being-tools.js';
import { handleMeditateTool } from '../../backend/services/meditation/meditation-being-tool.js';
import { sendToolEvent } from '../../backend/services/portal-tools/tool-events.js';

let kit;
afterEach(async () => { await kit?.close(); kit = null; });
const idsOf = tools => tools.map(tool => `${tool.server}/${tool.name}`);
const seats = [
  { lane: 'witness-test-MindCatalog', kind: undefined, seat: 'witness' },
  { lane: 'marked-witness-catalog', kind: 'witness', seat: 'witness' },
  { lane: 'neuma-mind-catalog', kind: 'neuma', seat: 'neuma' },
];

describe.each(seats)('$lane mind catalog', ({ lane, kind, seat }) => {
  test.each([false, true])('keeps memory authoring with existing observations = %s', async hasMemory => {
    kit = await createHarnessTurnKit(lane);
    kit.connection.companion.participantKind = kind;
    if (hasMemory) await workspace.addObservation(lane, { content: 'An existing memory.', significance: 0.9 });
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const { tools } = await platformToolsFor(kit.connection, { seat });
      const ids = idsOf(tools);
      expect(ids).toContain('memory/memory_note');
      expect(ids).toContain('memory/mind_note');
      expect(ids.includes('meditation/meditate')).toBe(seat === 'neuma');
    }
    if (seat === 'witness') {
      const { tools } = await toolsForWitness(kit.connection, null);
      expect(idsOf(tools)).toContain('memory/mind_note');
      expect(idsOf(tools)).not.toContain('meditation/meditate');
    }
  });
});

test.each(seats.filter(({ seat }) => seat === 'witness'))('$lane stale meditation call still refuses on the real socket', async ({ lane, kind }) => {
  kit = await createHarnessTurnKit(lane);
  kit.connection.companion.participantKind = kind;
  const result = await handleMeditateTool(kit.ws, kit.connection, {}, 'ask', {}, { sendToolEvent });
  expect(result.status).toBe('error');
  expect(result.error).toContain('only the being itself');
  const frame = await untilHarness(() => kit.frames.find(event => event.type === 'tool:usage' && event.tool === 'meditation/meditate'));
  expect(frame.status).toBe('error');
  expect(kit.frames.some(event => event.type === 'tool:approval_request')).toBe(false);
});

test('an unbound connection advertises no memory or meditation', async () => {
  expect(await memoryToolsFor({})).toEqual([]);
});
