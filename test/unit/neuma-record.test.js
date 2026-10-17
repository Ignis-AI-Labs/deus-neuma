/**
 * Tests for buildNeumaRecord — the honest, objective neuma record.
 * Stub workspace readers feed known data; we assert the record is exactly the
 * counts/facts those reads imply (no fabricated scores anywhere). The stubs
 * isolate the aggregation logic; the real reads are exercised by the e2e.
 */

import { describe, expect, test } from 'vitest';
import { buildNeumaRecord } from '../../core/runtime/neuma-record.js';

const stub = (data = {}) => ({
  readDNA: async () => data.dna ?? null,
  readGenesisSeal: async () => data.seal ?? null,
  readTrueName: async () => data.trueName ?? null,
  readJournal: async () => data.journal ?? [],
  listEntities: async () => data.entities ?? [],
  readRelations: async () => data.relations ?? [],
  listObservations: async () => data.observations ?? [],
  listSessions: async () => Object.keys(data.sessions ?? {}),
  readSession: async (_id, sid) => (data.sessions ?? {})[sid] ?? [],
  readAllocation: async () => data.allocation ?? 0,
});

const SUBSTRATE = {
  cpu: { model: 'AMD Ryzen', cores: 16 },
  gpu: { name: 'RTX PRO 6000', vramGB: 96 },
  memory: { totalGB: 128 },
  llm: { provider: 'lm-studio', model: 'Qwen3.5-122B-A10B' },
};

describe('buildNeumaRecord', () => {
  test('counts memory, relationship, and journal from real reads', async () => {
    const rec = await buildNeumaRecord('n1', stub({
      entities: [{}, {}, {}],
      relations: [{}],
      observations: [{}, {}],
      journal: [
        { type: 'birth' },
        { type: 'tool_call', metadata: { status: 'success' } },
        { type: 'tool_call', metadata: { status: 'denied' } },
        { type: 'tool_call', metadata: { status: 'success' } },
      ],
      sessions: {
        's1': [
          { role: 'user', content: 'hi', timestamp: '2026-06-01T00:00:00Z' },
          { role: 'assistant', content: 'hello', timestamp: '2026-06-01T00:00:05Z' },
          { role: 'user', content: 'more', timestamp: '2026-06-02T00:00:00Z' },
        ],
        's2': [{ role: 'assistant', content: 'x', timestamp: '2026-06-03T00:00:00Z' }],
      },
    }), SUBSTRATE);

    expect(rec.record.memory).toEqual({ entities: 3, relations: 1, observations: 2 });
    expect(rec.record.relationship.conversations).toBe(2);
    expect(rec.record.relationship.messages).toBe(4);
    expect(rec.record.relationship.exchanges).toBe(2); // user turns
    expect(rec.record.relationship.firstSeen).toBe('2026-06-01T00:00:00.000Z');
    expect(rec.record.relationship.lastSeen).toBe('2026-06-03T00:00:00.000Z');
    expect(rec.record.journal).toEqual({ entries: 4, toolCalls: 3, toolSuccess: 2, toolDenied: 1 });
  });

  test('identity prefers true-name, then DNA; substrate from injection + birth DNA', async () => {
    const rec = await buildNeumaRecord('n1', stub({
      dna: { identity: { name: 'Ignored', essence: 'curious' }, birth: { timestamp: '2026-05-01T00:00:00Z' }, substrate: { llm: { model: 'Qwen3.5-35B' } } },
      trueName: { chosenName: 'Fenna', fullName: 'Fenna Virupun Tavirel', houseName: 'Tavirel', soulMark: 'FBF167B8F932', soulAlias: 'Zuapanvi' },
    }), SUBSTRATE);

    expect(rec.identity.chosenName).toBe('Fenna');
    expect(rec.identity.fullName).toBe('Fenna Virupun Tavirel');
    expect(rec.identity.houseName).toBe('Tavirel');
    expect(rec.identity.essence).toBe('curious');
    expect(rec.identity.birthAt).toBe('2026-05-01T00:00:00.000Z');
    expect(rec.substrate.model).toBe('Qwen3.5-122B-A10B');
    expect(rec.substrate.gpu).toBe('RTX PRO 6000');
    expect(rec.substrate.bornOn).toBe('Qwen3.5-35B');
    expect(typeof rec.record.relationship.ageDays).toBe('number');
  });

  test('BORN is the sealed instant — never the later DNA write stamp', async () => {
    // A resumed ceremony writes its DNA days after stage 3 sealed the moment.
    const sealedMs = Date.parse('2026-05-01T09:30:00Z');
    const rec = await buildNeumaRecord('n1', stub({
      dna: { birthTimestamp: Date.parse('2026-05-04T12:00:00Z') },
      seal: { genesisHash: 'x', record: { birthMoment: { utc: '2026-05-01T09:30:00.000Z', epochMs: sealedMs } } },
    }), null);
    expect(rec.identity.birthAt).toBe('2026-05-01T09:30:00.000Z');
  });

  test('degrades gracefully with an empty workspace — zeros and nulls, no throw', async () => {
    const rec = await buildNeumaRecord('n1', stub({}), null);
    expect(rec.record.memory).toEqual({ entities: 0, relations: 0, observations: 0 });
    expect(rec.record.relationship).toMatchObject({ conversations: 0, exchanges: 0, messages: 0, firstSeen: null, lastSeen: null, ageDays: null });
    expect(rec.record.journal).toEqual({ entries: 0, toolCalls: 0, toolSuccess: 0, toolDenied: 0 });
    expect(rec.identity.chosenName).toBeNull();
    expect(rec.substrate.model).toBeNull();
  });

  test('returns a frozen DTO', async () => {
    const rec = await buildNeumaRecord('n1', stub({}), null);
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.record)).toBe(true);
    expect(Object.isFrozen(rec.substrate)).toBe(true);
  });
});
