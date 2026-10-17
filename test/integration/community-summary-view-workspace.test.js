// Phase 3B community summary view — REAL encrypted workspace and continuity
// logs. The read path invokes no model or workspace write method; no test doubles.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { episodeFromObservation } from '../../core/continuity/integration/crystallize-bridge.js';
import { makeRecord } from '../../core/continuity/record.js';
import { deriveCommunitySummaryView } from '../../core/memory/community-summary-view.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import {
  COMMUNITY_SUMMARY_BASELINE_VARIANT,
  COMMUNITY_SUMMARY_VIEW_VARIANT,
  pageContextMapField,
  readContextMapField,
} from '../../backend/services/context-map.js';

const LANE_ID = 'p3b-community-summary';
const SPACE = 'project-constellation';
const T0 = '2026-08-12T09:00:00.000Z';
const T1 = '2026-08-12T10:00:00.000Z';
const T1_LATER = '2026-08-12T10:30:00.000Z';
const T2 = '2026-08-12T11:00:00.000Z';
const T3 = '2026-08-12T12:00:00.000Z';
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_VARIANT = process.env.NEUMA_COMMUNITY_SUMMARY_VARIANT;

const snapshotTree = async (root) => {
  const rows = [];
  const walk = async (directory, prefix = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else rows.push([relative, (await fs.readFile(absolute)).toString('base64')]);
    }
  };
  await walk(root);
  return rows;
};

const asEpisode = (
  observation,
  id,
  now = observation.occurredAt ?? T0,
) => makeRecord({
  ...episodeFromObservation(observation),
  occurredAt: now,
  validFrom: now,
}, { id, now });

const asSemantic = ({ id, memberIds, memberHash, content, now, supersedes }) => makeRecord({
  layer: 'semantic',
  content,
  space: SPACE,
  meta: { memberIds, memberHash, label: 'observatory resonance' },
  ...(supersedes ? { supersedes } : {}),
}, { id, now });

describe('community summary view over the real encrypted workspace', () => {
  let root;
  let workspacesRoot;
  let adapter;
  let observationIds;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'p3b-community-summary-real-disk-key';
    delete process.env.NEUMA_COMMUNITY_SUMMARY_VARIANT;
    root = await createTempDir('community-summary-view-workspace');
    workspacesRoot = path.join(root, 'workspaces');
    setWorkspacesRoot(workspacesRoot);
    await workspace.create(LANE_ID);

    const texts = [
      'observatory telescope constellation resonance under the turning night sky',
      'observatory telescope resonance follows the constellation across the night sky',
      'observatory constellation returns through telescope resonance in the turning sky',
    ];
    const observations = [];
    for (const [index, text] of texts.entries()) {
      const occurredAt = index === 2 ? T1_LATER : T0;
      observations.push(await workspace.addObservation(LANE_ID, {
        type: 'exchange',
        userMessage: text,
        response: `${text} remembered`,
        significance: 0.8,
        timestamp: occurredAt,
        occurredAt,
        space: { id: SPACE, kind: 'project', label: 'Constellation' },
      }));
    }
    observationIds = observations.map((observation) => observation.id);

    adapter = new WorkspaceAdapter(LANE_ID, { workspace });
    await adapter.append(asEpisode(observations[0], 'ep-a'));
    await adapter.append(asEpisode(observations[1], 'ep-b'));
    await adapter.append(asEpisode(observations[2], 'ep-c'));
    await adapter.append(asSemantic({
      id: 'sem-before',
      memberIds: ['ep-a', 'ep-b'],
      memberHash: 'hash-before',
      content: 'Two observatory moments formed the first through-line.',
      now: T1,
    }));
    await adapter.append(asSemantic({
      id: 'sem-current',
      memberIds: ['ep-a', 'ep-b', 'ep-c'],
      memberHash: 'hash-current',
      content: 'The observatory resonance became a three-moment through-line.',
      now: T2,
      supersedes: 'sem-before',
    }));

    const persisted = await neumaRecall.compact(LANE_ID);
    expect(persisted).toHaveLength(1);
    expect([...persisted[0].memberIds].sort()).toEqual([...observationIds].sort());
    neumaRecall.invalidate(LANE_ID);
  });

  afterAll(async () => {
    neumaRecall.invalidate(LANE_ID);
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
    if (PRIOR_VARIANT === undefined) delete process.env.NEUMA_COMMUNITY_SUMMARY_VARIANT;
    else process.env.NEUMA_COMMUNITY_SUMMARY_VARIANT = PRIOR_VARIANT;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('uses one historical snapshot before drift and the current successor without writes', async () => {
    const diskBefore = await snapshotTree(workspacesRoot);
    const historical = await readContextMapField(LANE_ID, {
      communitySummaryVariant: COMMUNITY_SUMMARY_VIEW_VARIANT,
      asOf: T1,
    });
    expect(historical.nodes.map((node) => node.id).sort())
      .toEqual(observationIds.slice(0, 2).sort());
    expect(historical.communities).toHaveLength(1);
    expect(historical.communities[0]).toMatchObject({
      summary: 'Two observatory moments formed the first through-line.',
      semanticRecordId: 'sem-before',
      memberHash: 'hash-before',
      unmatchedReason: null,
    });
    expect(historical.communities[0].sourceObservationIds)
      .toEqual(observationIds.slice(0, 2).sort());

    const drifted = await readContextMapField(LANE_ID, {
      communitySummaryVariant: COMMUNITY_SUMMARY_VIEW_VARIANT,
      asOf: T1_LATER,
    });
    expect(drifted.nodes).toHaveLength(3);
    expect(drifted.communities[0]).toMatchObject({
      summary: null,
      semanticRecordId: null,
      memberHash: null,
      unmatchedReason: 'membership-drift',
    });

    const current = await readContextMapField(LANE_ID, {
      communitySummaryVariant: COMMUNITY_SUMMARY_VIEW_VARIANT,
    });
    expect(current.nodes).toHaveLength(3);
    expect(current.communities[0]).toMatchObject({
      summary: 'The observatory resonance became a three-moment through-line.',
      semanticRecordId: 'sem-current',
      memberHash: 'hash-current',
      unmatchedReason: null,
    });
    expect(current.communities[0].sourceObservationIds)
      .toEqual([...observationIds].sort());

    const page = pageContextMapField(current);
    expect(page.communities[0]).toMatchObject({
      summary: 'The observatory resonance became a three-moment through-line.',
      semanticRecordId: 'sem-current',
      memberHash: 'hash-current',
      unmatchedReason: null,
    });
    expect(await snapshotTree(workspacesRoot)).toEqual(diskBefore);
  });

  it('folds predecessor and successor at one asOf before deriving the exact view', async () => {
    const before = deriveCommunitySummaryView({
      communities: [{ label: 'before', memberIds: observationIds.slice(0, 2) }],
      episodicRecords: await adapter.list('episodic', { asOf: T1 }),
      semanticRecords: await adapter.list('semantic', { asOf: T1 }),
    });
    expect(before[0]).toMatchObject({
      summary: 'Two observatory moments formed the first through-line.',
      semanticRecordId: 'sem-before',
      memberHash: 'hash-before',
    });

    const after = deriveCommunitySummaryView({
      communities: [{ label: 'after', memberIds: observationIds }],
      episodicRecords: await adapter.list('episodic', { asOf: T2 }),
      semanticRecords: await adapter.list('semantic', { asOf: T2 }),
    });
    expect(after[0]).toMatchObject({
      summary: 'The observatory resonance became a three-moment through-line.',
      semanticRecordId: 'sem-current',
      memberHash: 'hash-current',
    });
  });

  it('returns an explicit null when a current episodic mapping has expired', async () => {
    await adapter.expire('episodic', 'ep-c', { at: T3 });
    const field = await readContextMapField(LANE_ID, {
      communitySummaryVariant: COMMUNITY_SUMMARY_VIEW_VARIANT,
      asOf: T3,
    });
    expect(field.communities[0]).toMatchObject({
      summary: null,
      semanticRecordId: null,
      memberHash: null,
      sourceObservationIds: [],
      unmatchedReason: 'unmapped-member',
    });
  });

  it('keeps baseline bytes on the baseline variant and candidate reads write nothing', async () => {
    const baseline = await readContextMapField(LANE_ID, {
      communitySummaryVariant: COMMUNITY_SUMMARY_BASELINE_VARIANT,
      asOf: T2,
    });
    expect(Object.keys(baseline.communities[0]).sort()).toEqual(['label', 'memberIds']);

    const defaultField = await readContextMapField(LANE_ID, { asOf: T2 });
    const invalidVariantField = await readContextMapField(LANE_ID, {
      communitySummaryVariant: 'not-a-catalog-variant',
      asOf: T2,
    });
    expect({ ...defaultField, computedAt: baseline.computedAt }).toEqual(baseline);
    expect({ ...invalidVariantField, computedAt: baseline.computedAt }).toEqual(baseline);

    const recallBefore = await neumaRecall.getContextForResponse(
      LANE_ID,
      'observatory constellation resonance',
      { space: { id: SPACE, kind: 'project', label: 'Constellation' } },
    );
    const diskBefore = await snapshotTree(workspacesRoot);
    await readContextMapField(LANE_ID, {
      communitySummaryVariant: COMMUNITY_SUMMARY_VIEW_VARIANT,
      asOf: T2,
    });
    const diskAfter = await snapshotTree(workspacesRoot);
    neumaRecall.invalidate(LANE_ID);
    const recallAfter = await neumaRecall.getContextForResponse(
      LANE_ID,
      'observatory constellation resonance',
      { space: { id: SPACE, kind: 'project', label: 'Constellation' } },
    );

    expect(diskAfter).toEqual(diskBefore);
    expect(recallAfter).toEqual(recallBefore);
  });
});
