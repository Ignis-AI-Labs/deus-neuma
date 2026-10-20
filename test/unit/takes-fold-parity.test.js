/**
 * THE TAKES — the engine's fold (core/workspace/branch-view.js) against the
 * desk's OWN fold module (frontend/app/RelinkShell/branch-view.js): the chain
 * the being reads must be the chain the operator sees, in the same order,
 * with the same take of every point. Pure tables first, then the two shapes a
 * REAL compaction leaves on a REAL temp workspace (RULE 0 — compactSession
 * does IO, so it is proven where the IO lands):
 *   - a retry of an earlier point appends its take at the end of the file;
 *     both folds read it under its own ask (#7)
 *   - a compaction summarizes take 1 away and keeps take 2; both folds still
 *     show take 2, with or without a carried view naming take 1 (#14)
 *   - a take switch before a compaction rides the summary row; the summary is
 *     still speech, never a view marker, and the carried view still reads (#11)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  foldBranchView, latestBranchView, isBranchViewRow, isViewMarker,
} from '../../core/workspace/branch-view.js';
import { foldForDisplay } from '../../frontend/app/RelinkShell/branch-view.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const user = (turnId, content) => ({ role: 'user', content, turnId });
const take = (turnId, takeIndex, content) => ({ role: 'assistant', content, turnId, takeIndex });

// The conversation each fold shows, as role:content lines.
const engineChain = (records, view) => foldBranchView(records, view)
  .filter((r) => (r?.role === 'user' || r?.role === 'assistant') && r.turnId)
  .map((r) => `${r.role}:${r.content}`);
const deskChain = (records, view) => foldForDisplay(records, view).flatMap((entry) => {
  if (entry.kind === 'user') return [`user:${entry.record.content}`];
  if (entry.kind === 'takes') return [`assistant:${entry.takes[entry.viewed - 1].content}`];
  return [];
});

describe('the engine fold matches the desk fold', () => {
  test('a retry of an earlier point reads under its own ask on both folds (#7)', () => {
    const records = [
      user('A', 'Q-A'), take('A', 1, 'A-take1'),
      user('B', 'Q-B'), take('B', 1, 'B-take1'),
      take('A', 2, 'A-take2'),
    ];
    expect(engineChain(records)).toEqual(['user:Q-A', 'assistant:A-take2', 'user:Q-B', 'assistant:B-take1']);
    expect(engineChain(records)).toEqual(deskChain(records));
    expect(engineChain(records, { A: 1 })).toEqual(deskChain(records, { A: 1 }));
  });

  test('an orphan take whose take 1 was summarized away still shows on both folds (#14)', () => {
    const records = [
      { role: 'system', content: '[SESSION SUMMARY] …', compacted: true },
      take('T', 2, 'CHOSEN take two'),
      user('U', 'later ask'), take('U', 1, 'later answer'),
    ];
    for (const view of [undefined, { T: 1 }]) {
      expect(engineChain(records, view)).toContain('assistant:CHOSEN take two');
      expect(engineChain(records, view)).toEqual(deskChain(records, view));
    }
  });

  test('a summary that carries a view is speech, and its view still reads (#11)', () => {
    const summary = { role: 'system', content: '[SESSION SUMMARY] …', compacted: true, branchView: { T: 1 } };
    expect(isBranchViewRow(summary)).toBe(true);
    expect(isViewMarker(summary)).toBe(false);
    expect(isViewMarker({ role: 'system', branchView: { T: 1 } })).toBe(true);
    expect(latestBranchView([summary])).toEqual({ T: 1 });
  });
});

describe('the folds after a REAL compaction — real temp workspace, real encrypted disk', () => {
  let origRoot;
  const NEUMA = 'takesparity';

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'takes-parity-test-key-long-enough';
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(await createTempDir('takes-parity-ws'));
    await workspace.create(NEUMA);
  });

  afterAll(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  const filler = async (sessionId, tag, rows) => {
    for (let i = 0; i < rows; i += 1) {
      const turnId = `${tag}${i >> 1}`;
      await workspace.appendMessage(NEUMA, sessionId, i % 2
        ? take(turnId, 1, `${tag} answer ${i}`)
        : user(turnId, `${tag} ask ${i}`));
    }
  };

  test('take 2 of a point compacted below survives in the engine fold as on the desk (#14)', async () => {
    const sid = 'sess-orphan';
    await workspace.appendMessage(NEUMA, sid, user('T', 'old ask'));
    await workspace.appendMessage(NEUMA, sid, take('T', 1, 'old take one'));
    await filler(sid, 'y', 30);
    await workspace.appendMessage(NEUMA, sid, take('T', 2, 'CHOSEN take two'));
    await filler(sid, 'z', 4);
    expect(await workspace.compactSession(NEUMA, sid, { threshold: 30, keepRecent: 20 })).toBe(true);

    const rows = await workspace.readSession(NEUMA, sid);
    expect(engineChain(rows)).toContain('assistant:CHOSEN take two');
    expect(engineChain(rows)).toEqual(deskChain(rows));
  });

  test('a take switch before a compaction leaves the summary in the tail and the view standing (#11)', async () => {
    const sid = 'sess-view';
    await workspace.appendMessage(NEUMA, sid, user('T1', 'plan the garden'));
    await workspace.appendMessage(NEUMA, sid, take('T1', 1, 'take one'));
    await workspace.appendMessage(NEUMA, sid, take('T1', 2, 'take two'));
    await workspace.appendBranchView(NEUMA, sid, { T1: 1 });
    await filler(sid, 'x', 40);
    expect(await workspace.compactSession(NEUMA, sid, { threshold: 30, keepRecent: 20 })).toBe(true);

    const rows = await workspace.readSession(NEUMA, sid);
    const tail = foldBranchView(rows).filter((m) => !isViewMarker(m));
    expect(tail[0].content).toMatch(/^\[SESSION SUMMARY\]/);
    expect(latestBranchView(rows)).toEqual({ T1: 1 });
  });
});
