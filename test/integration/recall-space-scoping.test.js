/**
 * Production recall scoping — the WIRING proof (CORE-005).
 *
 * The recall engine's own suite proves getRelevantMemories filters by space
 * when called directly. This proves the PRODUCTION path: the exact function
 * streamConsciousness calls (gatherMemoryContext) threads the active space
 * into recall over a real encrypted sovereign workspace, so a project chat's
 * assembled memory context is scoped to its own space + general and never
 * another project. No mock on the claimed path (RULE 0) — real workspace,
 * real encrypted observations, real recall.
 */

import { createTempDir } from '../helpers/temp-fs.js';
import { neumaWorkspace, neumaRecall } from '../../core/index.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { gatherMemoryContext } = __test;

const PROJ_A = { id: 'proj-a', kind: 'project', label: 'Project A' };
const PROJ_B = { id: 'proj-b', kind: 'project', label: 'Project B' };

describe('production recall path is space-scoped (real workspace)', () => {
  const NEUMA = 'recall-wire';

  beforeAll(async () => {
    neumaWorkspace.root = await createTempDir('recall-space-wire');
    await neumaWorkspace.create(NEUMA);
    await neumaWorkspace.writeDNA(NEUMA, { identity: { name: 'Wire' } });
    // The same distinctive term in all three spaces — only the wired space
    // filter can separate them.
    await neumaWorkspace.addObservation(NEUMA, {
      type: 'exchange', userMessage: 'the beacon', response: 'in project A the beacon burns blue', significance: 0.9, space: PROJ_A,
    });
    await neumaWorkspace.addObservation(NEUMA, {
      type: 'exchange', userMessage: 'the beacon', response: 'in project B the beacon burns red', significance: 0.9, space: PROJ_B,
    });
    await neumaWorkspace.addObservation(NEUMA, {
      type: 'exchange', userMessage: 'the beacon', response: 'in general the beacon is a shared signal', significance: 0.9,
    });
    // Two more Project A episodes with NO term overlap with the query — they
    // never enter the relevant lane, so they prove the in-space RECENT lane
    // (CORE-005 B2) without disturbing the relevance assertions above.
    await neumaWorkspace.addObservation(NEUMA, {
      type: 'exchange', userMessage: 'q1', response: 'mortar mixed at dawn', significance: 0.9, space: PROJ_A, occurredAt: '2026-07-09T10:00:00Z',
    });
    await neumaWorkspace.addObservation(NEUMA, {
      type: 'exchange', userMessage: 'q2', response: 'lighthouse scaffold rose', significance: 0.9, space: PROJ_A, occurredAt: '2026-07-09T11:00:00Z',
    });
    neumaRecall.invalidate(NEUMA);
  });

  afterAll(() => vi.restoreAllMocks());

  const memText = (mem) => (mem.relevantMemories || []).map((m) => m.memory).join(' | ');

  it('a Project A turn recalls A + general through gatherMemoryContext, never B', async () => {
    const mem = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, PROJ_A);
    const text = memText(mem);
    expect(text).toContain('project A');
    expect(text).toContain('general');
    expect(text).not.toContain('project B');
  });

  it('a BENCHMARK sitting (blind) recalls nothing stored — Design note, 2026-10-06: memory benchmarking is its own infrastructure', async () => {
    const seeing = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, PROJ_A);
    expect(memText(seeing)).toContain('beacon'); // the memories are real and recallable…
    const blind = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, PROJ_A, null, true);
    expect(blind.relevantMemories).toBeUndefined(); // …and a benchmark sitting gets none of them
    expect(blind.spaceHistory).toBeUndefined();
    expect(blind.pinnedAnchors).toBeUndefined();
    expect(blind.memoryLinks).toBeUndefined();
  });

  it('a Project B turn is the mirror image — B + general, never A', async () => {
    const mem = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, PROJ_B);
    const text = memText(mem);
    expect(text).toContain('project B');
    expect(text).toContain('general');
    expect(text).not.toContain('project A');
  });

  it('a general turn (no space) sees general only, neither project bleeds in', async () => {
    const mem = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, null);
    const text = memText(mem);
    expect(text).toContain('general');
    expect(text).not.toContain('project A');
    expect(text).not.toContain('project B');
  });

  it('a Project A turn carries the in-space recent lane, deduped from relevant hits (B2)', async () => {
    const mem = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, PROJ_A);
    expect(mem.space.id).toBe('proj-a');
    const lane = (mem.spaceHistory || []).map((m) => m.memory).join(' | ');
    expect(lane).toContain('lighthouse scaffold');
    expect(lane).toContain('mortar mixed');
    // The beacon exchange is surfaced as a relevant hit — never rendered twice
    expect(lane).not.toContain('beacon');
    expect(lane).not.toContain('project B');
    // Newest-first: the scaffold (11:00) precedes the mortar (10:00)
    expect(mem.spaceHistory[0].memory).toContain('lighthouse scaffold');
  });

  it('a general turn carries no in-space lane', async () => {
    const mem = await gatherMemoryContext('tell me about the beacon', 'Wire', {}, NEUMA, null, null);
    expect(mem.spaceHistory ?? []).toHaveLength(0);
  });
});
