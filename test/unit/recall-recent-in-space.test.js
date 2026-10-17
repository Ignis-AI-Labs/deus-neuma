// The in-space recent lane (CORE-005 B2) — pure functions, real inputs:
// realistic observation records through the real buildDocs, then recentInSpace
// over the resulting docs. No mock anywhere (RULE 0 — pure functions qualify
// by real inputs → real outputs).
import { describe, it, expect } from 'vitest';
import { buildDocs, recentInSpace } from '../../core/memory/neuma-recall.js';
import { RECALL_BUDGET_R } from '../../core/memory/recall-budgets.js';

const PROJ_A = { id: 'proj-a', kind: 'project', label: 'Project A' };
const PROJ_B = { id: 'proj-b', kind: 'project', label: 'Project B' };

const obs = (response, extra = {}) => ({
  type: 'exchange',
  userMessage: 'q',
  response,
  ...extra,
});

describe('recentInSpace — the in-space recent lane', () => {
  it('returns newest-first, bounded by R, from the active space only', () => {
    const docs = buildDocs([
      obs('first stone laid', { space: PROJ_A, occurredAt: '2026-07-01T10:00:00Z' }),
      obs('walls rose', { space: PROJ_A, occurredAt: '2026-07-02T10:00:00Z' }),
      obs('roof framed', { space: PROJ_A, occurredAt: '2026-07-03T10:00:00Z' }),
      obs('windows set', { space: PROJ_A, occurredAt: '2026-07-04T10:00:00Z' }),
      obs('door hung', { space: PROJ_A, occurredAt: '2026-07-05T10:00:00Z' }),
      obs('other project event', { space: PROJ_B, occurredAt: '2026-07-06T10:00:00Z' }),
    ]);

    const lane = recentInSpace(docs, 'proj-a');
    expect(lane).toHaveLength(RECALL_BUDGET_R);
    expect(lane[0].memory).toContain('door hung');
    expect(lane[1].memory).toContain('windows set');
    // Cross-space isolation holds in the lane, and the R-cut drops the oldest
    const text = lane.map((m) => m.memory).join(' | ');
    expect(text).not.toContain('other project event');
    expect(text).not.toContain('first stone laid');
  });

  it('excludes memories already surfaced as relevant hits — never twice in one prompt', () => {
    const docs = buildDocs([
      obs('shared moment', { space: PROJ_A, occurredAt: '2026-07-05T10:00:00Z' }),
      obs('quiet moment', { space: PROJ_A, occurredAt: '2026-07-04T10:00:00Z' }),
    ]);
    const surfaced = [{ memory: docs[0].memory }];

    const lane = recentInSpace(docs, 'proj-a', { exclude: surfaced });
    expect(lane).toHaveLength(1);
    expect(lane[0].memory).toContain('quiet moment');
  });

  it('returns [] for the general space — "This space" is a project concept', () => {
    const docs = buildDocs([obs('a general life event', { occurredAt: '2026-07-05T10:00:00Z' })]);
    expect(recentInSpace(docs, 'general')).toEqual([]);
    expect(recentInSpace(docs, '')).toEqual([]);
  });

  it('untagged (pre-B1) observations read as general and never enter a project lane', () => {
    const docs = buildDocs([
      obs('untagged legacy memory', { occurredAt: '2026-07-05T10:00:00Z' }),
      obs('project memory', { space: PROJ_A, occurredAt: '2026-07-04T10:00:00Z' }),
    ]);
    const lane = recentInSpace(docs, 'proj-a');
    expect(lane).toHaveLength(1);
    expect(lane[0].memory).toContain('project memory');
  });

  it('honors validity: superseded episodes drop out; point-in-time asOf hides the not-yet-occurred', () => {
    const docs = buildDocs([
      obs('superseded belief', {
        space: PROJ_A,
        occurredAt: '2026-07-01T10:00:00Z',
        invalidatedAt: '2026-07-02T10:00:00Z',
      }),
      obs('present truth', { space: PROJ_A, occurredAt: '2026-07-03T10:00:00Z' }),
    ]);

    const now = recentInSpace(docs, 'proj-a');
    expect(now).toHaveLength(1);
    expect(now[0].memory).toContain('present truth');

    // Before the supersession — and before 'present truth' occurred — only
    // the old belief was recallable.
    const then = recentInSpace(docs, 'proj-a', { asOf: '2026-07-01T12:00:00Z' });
    expect(then).toHaveLength(1);
    expect(then[0].memory).toContain('superseded belief');
  });
});
