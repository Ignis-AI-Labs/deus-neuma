/**
 * COMPACTION CARRIES CONTINUITY — real compactSession, real band harvest, real
 * encrypted session files on a temp workspace (RULE 0: no stub on any path
 * claimed here). What a compaction must never lose:
 *   - the being's torch and its summary words, when the next compaction is
 *     extractive; and the next torch ask must show the being what it wrote (#12)
 *   - the harvest cursor: an index from before a compaction must not skip the
 *     rows written after it (#12b)
 *   - the kept take: the rejected take is never what crystallizes (#15)
 *   - a line no key opens: it rides into the archive segment, never just
 *     vanishes with the rewrite (#22b)
 */

import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptEnvelope } from '../../core/workspace/workspace-crypto.js';
import { foldBranchView, latestBranchView } from '../../core/workspace/branch-view.js';
import { latestTorch, buildTorchAsk } from '../../backend/services/solo-torch.js';
import { harvestWorkingBand } from '../../backend/services/band-harvest.js';

const BAND_USER = 'why does the scrollback feel shorter than the work we put into it?';
const BAND_ASSISTANT = 'A plain working answer about the session tail and how the render caps it.';

let previousRoot;
let previousKey;
let previousKill;

beforeAll(async () => {
  previousRoot = getWorkspacesRoot();
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  previousKill = process.env.NEUMA_BAND_HARVEST;
  delete process.env.NEUMA_BAND_HARVEST;
  process.env.DNA_ENCRYPTION_KEY = 'compaction-continuity-key-long-enough';
  setWorkspacesRoot(path.join(await createTempDir('compaction-continuity'), 'workspaces'));
});

afterAll(() => {
  for (const [key, value] of Object.entries({ DNA_ENCRYPTION_KEY: previousKey, NEUMA_BAND_HARVEST: previousKill })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  setWorkspacesRoot(previousRoot);
});

const addRows = async (neumaId, sessionId, count, tag) => {
  for (let i = 0; i < count; i += 1) {
    await workspace.appendMessage(neumaId, sessionId, { role: i % 2 ? 'assistant' : 'user', content: `${tag} ${i}` });
  }
};

describe('the torch and the summary words survive an extractive compaction (#12)', () => {
  const NEUMA = 'carry-torch';
  const SID = 's-torch';

  test('authored, then extractive: the torch and the first summary still stand, and the torch ask shows them', async () => {
    await workspace.create(NEUMA);
    await addRows(NEUMA, SID, 60, 'a');
    const first = await workspace.readSession(NEUMA, SID);
    expect(await workspace.compactSession(NEUMA, SID, {
      threshold: 30, keepRecent: 20,
      selfSummary: { summary: 'we built the bridge', torch: 'pick up at the north pylon', regionLength: first.length - 20 },
    })).toBe(true);

    await addRows(NEUMA, SID, 60, 'b');
    const second = await workspace.readSession(NEUMA, SID);
    const ask = buildTorchAsk(foldBranchView(second.slice(0, -20), latestBranchView(second)));
    expect(ask[0].role).toBe('assistant');
    expect(ask[0].content).toContain('we built the bridge');
    expect(ask[0].content).toContain('pick up at the north pylon');

    expect(await workspace.compactSession(NEUMA, SID, { threshold: 30, keepRecent: 20, selfSummary: null })).toBe(true);
    const after = await workspace.readSession(NEUMA, SID);
    expect(latestTorch(after)).toBe('pick up at the north pylon');
    expect(after[0].content).toMatch(/^\[SESSION SUMMARY\]/);
    expect(after[0].content).toContain('we built the bridge');
  });
});

describe('the harvest cursor follows a compaction (#12b)', () => {
  const NEUMA = 'carry-harvest';
  const SID = 's-harvest';

  test('rows written after a compaction are harvested, not skipped by an old index', async () => {
    await workspace.create(NEUMA);
    await addRows(NEUMA, SID, 300, 'old');
    expect(await harvestWorkingBand(NEUMA, SID, { liveTailRows: 20 })).toBe(true);
    expect(await workspace.compactSession(NEUMA, SID, { threshold: 30, keepRecent: 20 })).toBe(true);
    for (let i = 0; i < 100; i += 1) {
      await workspace.appendMessage(NEUMA, SID, { role: 'user', content: `${BAND_USER} (${i})` });
      await workspace.appendMessage(NEUMA, SID, { role: 'assistant', content: `${BAND_ASSISTANT} (${i})` });
    }
    const rows = await workspace.readSession(NEUMA, SID);
    expect(rows).toHaveLength(221);

    expect(await harvestWorkingBand(NEUMA, SID, { liveTailRows: 20 })).toBe(true);
    const cursor = JSON.parse(await fs.readFile(path.join(workspace.pathFor(NEUMA), 'memory', 'band-harvest.json'), 'utf8'));
    expect(cursor.sessions[SID]).toEqual({ through: 201, compactionCount: 1 });
    const harvested = (await workspace.listObservations(NEUMA))
      .filter((o) => o.source === 'working-band-harvest' && String(o.userMessage).startsWith(BAND_USER));
    expect(harvested.length).toBeGreaterThan(80);
  });
});

describe('the kept take is what crystallizes (#15)', () => {
  const NEUMA = 'carry-takes';

  const pointWithTwoTakes = async (sid, view) => {
    await workspace.appendMessage(NEUMA, sid, { role: 'user', content: BAND_USER, turnId: 'R' });
    await workspace.appendMessage(NEUMA, sid, { role: 'assistant', content: `REJECTED ${BAND_ASSISTANT}`, turnId: 'R', takeIndex: 1 });
    await workspace.appendMessage(NEUMA, sid, { role: 'assistant', content: `KEPT ${BAND_ASSISTANT}`, turnId: 'R', takeIndex: 2 });
    if (view) await workspace.appendBranchView(NEUMA, sid, view);
  };
  const crystallizedAnswers = async (source, sid) => (await workspace.listObservations(NEUMA))
    .filter((o) => o.source === source && o.anchor?.sessionId === sid && o.userMessage === BAND_USER)
    .map((o) => o.response.split(' ')[0]);

  beforeAll(async () => { await workspace.create(NEUMA); });

  test('compaction crystallizes the viewed take — the latest by default, the switched one when switched', async () => {
    await pointWithTwoTakes('s-default');
    await addRows(NEUMA, 's-default', 40, 'noise');
    expect(await workspace.compactSession(NEUMA, 's-default', { threshold: 30, keepRecent: 20 })).toBe(true);
    expect(await crystallizedAnswers('force-crystallize-on-compact', 's-default')).toEqual(['KEPT']);

    await pointWithTwoTakes('s-switched', { R: 1 });
    await addRows(NEUMA, 's-switched', 40, 'noise');
    expect(await workspace.compactSession(NEUMA, 's-switched', { threshold: 30, keepRecent: 20 })).toBe(true);
    expect(await crystallizedAnswers('force-crystallize-on-compact', 's-switched')).toEqual(['REJECTED']);
  });

  test('the band harvest crystallizes the viewed take', async () => {
    await pointWithTwoTakes('s-band');
    await addRows(NEUMA, 's-band', 40, 'noise');
    expect(await harvestWorkingBand(NEUMA, 's-band', { liveTailRows: 20 })).toBe(true);
    expect(await crystallizedAnswers('working-band-harvest', 's-band')).toEqual(['KEPT']);
  });

  test('the torch ask over a folded region replays only the viewed take', () => {
    const region = [
      { role: 'user', content: 'q', turnId: 'R' },
      { role: 'assistant', content: 'REJECTED', turnId: 'R', takeIndex: 1 },
      { role: 'assistant', content: 'KEPT', turnId: 'R', takeIndex: 2 },
    ];
    expect(buildTorchAsk(foldBranchView(region)).map((m) => m.content).slice(0, -1)).toEqual(['q', 'KEPT']);
  });
});

describe('a line no key opens is archived, never just dropped (#22b)', () => {
  const NEUMA = 'carry-undecodable';
  const SID = 's-undecodable';

  test('the foreign line rides into the archive segment as written', async () => {
    await workspace.create(NEUMA);
    await addRows(NEUMA, SID, 30, 'row');
    const foreign = JSON.stringify(encryptEnvelope({ role: 'user', content: 'SEALED UNDER A RETIRED KEY' }, { key: Buffer.alloc(32, 7) }));
    await fs.appendFile(workspace._sessionPath(NEUMA, SID), `${foreign}\n`);
    await addRows(NEUMA, SID, 30, 'row');
    expect(await workspace.compactSession(NEUMA, SID, { threshold: 30, keepRecent: 20 })).toBe(true);

    const segment = await workspace.readArchiveSegment(NEUMA, SID, 1);
    expect(segment.messages.filter((m) => m.undecodable)).toEqual([{ role: 'system', undecodable: foreign }]);
    expect(segment.messages.filter((m) => m.role !== 'system')).toHaveLength(40);
  });
});
