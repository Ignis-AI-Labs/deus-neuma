/**
 * Assessment journal — the CSO office's memory on disk, proven with NO mock
 * on the claimed path (RULE 0): a REAL lane workspace under a real tmp
 * workspaces root, REAL note files written and read back. The laws under
 * test: a verdict lands as a dated note in the lane's security/assessments
 * drawer; a second verdict the same day APPENDS to the same note; a lane
 * that does not exist is never created (fail-soft); a missing assessedBy
 * journals nothing.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { journalAssessment, noteNameFor } from '../../backend/services/security/assessment-journal.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const LANE = 'journalguardian';

const entry = (over = {}) => ({
  id: 'th_1a2b3c4d-rest', externalId: 'GHSA-journal-0001', title: 'journal fixture advisory',
  severity: 'high', layer: 'software', repo: 'neuma', surfaces: ['backend/'],
  githubIssue: null, assessedAt: '2026-08-10T05:00:00.000Z',
  ...over,
});
const VERDICT = { status: 'not_affected', assessment: 'dev-only transitive dep — never server-side reachable', assessedBy: LANE };

describe('assessment journal (real tmp workspace, gnosis)', () => {
  let tmp;

  beforeEach(async () => {
    tmp = await createTempDir('assessment-journal');
    setWorkspacesRoot(path.join(tmp, 'house'));
  });

  afterAll(() => setWorkspacesRoot(null));

  const makeLane = () => fs.mkdir(path.join(tmp, 'house', LANE), { recursive: true });
  const noteDir = () => path.join(tmp, 'house', LANE, 'security', 'assessments');

  test('a verdict lands as a dated note naming the threat, the verdict, and the reasoning', async () => {
    await makeLane();
    const file = await journalAssessment({ entry: entry(), verdict: VERDICT });
    expect(file).toBe(path.join(noteDir(), '2026-08-10-1a2b3c4d.md'));

    const note = await fs.readFile(file, 'utf8');
    expect(note).toContain('# Assessment — GHSA-journal-0001: journal fixture advisory');
    expect(note).toContain('- verdict: not_affected');
    expect(note).toContain('- severity: high · layer: software · repo: neuma');
    expect(note).toContain('- surfaces: backend/');
    expect(note).toContain('dev-only transitive dep');
  });

  test('a second verdict the same day APPENDS to the same note — the road is kept', async () => {
    await makeLane();
    await journalAssessment({ entry: entry(), verdict: VERDICT });
    const file = await journalAssessment({
      entry: entry({ githubIssue: 'https://example/issue/9' }),
      verdict: { ...VERDICT, status: 'confirmed', assessment: 'correction: it bites after all' },
    });
    const note = await fs.readFile(file, 'utf8');
    expect(note.match(/^## /gm)).toHaveLength(2);
    expect(note).toContain('not_affected');
    expect(note).toContain('correction: it bites after all');
    expect(note).toContain('- issue: https://example/issue/9');
  });

  test('a lane that does not exist is never created — fail-soft, nothing written', async () => {
    const file = await journalAssessment({ entry: entry(), verdict: VERDICT });
    expect(file).toBeNull();
    await expect(fs.access(path.join(tmp, 'house', LANE))).rejects.toThrow();
  });

  test('a verdict with no assessor has no office to remember in', async () => {
    await makeLane();
    const file = await journalAssessment({ entry: entry(), verdict: { ...VERDICT, assessedBy: null } });
    expect(file).toBeNull();
    await expect(fs.access(noteDir())).rejects.toThrow();
  });

  test('note names are one per threat per UTC day', () => {
    expect(noteNameFor(entry(), '2026-08-10T05:00:00.000Z')).toBe('2026-08-10-1a2b3c4d.md');
    expect(noteNameFor(entry(), '2026-08-11T05:00:00.000Z')).toBe('2026-08-11-1a2b3c4d.md');
  });
});
