import { describe, expect, it } from 'vitest';
import { deriveCommunitySummaryView } from '../../core/memory/community-summary-view.js';

const community = (memberIds, label = 'shared motif') => ({
  id: 0,
  label,
  memberIds,
  size: memberIds.length,
});

const episode = (id, observationId, space = 'project-a') => ({
  id,
  space,
  meta: { observationId },
});

const semantic = ({
  id = 'sem-current',
  memberIds = ['ep-a', 'ep-b'],
  memberHash = 'hash-current',
  content = 'The same motif keeps returning.',
  space = 'project-a',
  recordedAt = '2026-08-12T10:00:00.000Z',
  supersedes = null,
} = {}) => ({
  id,
  layer: 'semantic',
  content,
  space,
  recordedAt,
  supersedes,
  meta: { memberIds, memberHash },
});

const derive = ({
  communities = [community(['obs-b', 'obs-a'])],
  episodicRecords = [episode('ep-b', 'obs-b'), episode('ep-a', 'obs-a')],
  semanticRecords = [semantic()],
} = {}) => deriveCommunitySummaryView({ communities, episodicRecords, semanticRecords });

describe('deriveCommunitySummaryView', () => {
  it('maps episodic ids through meta.observationId and joins one exact sorted member set', () => {
    const inputCommunity = community(['obs-b', 'obs-a']);
    const view = derive({ communities: [inputCommunity] });

    expect(view).toEqual([{
      id: 0,
      label: 'shared motif',
      memberIds: ['obs-a', 'obs-b'],
      size: 2,
      summary: 'The same motif keeps returning.',
      semanticRecordId: 'sem-current',
      memberHash: 'hash-current',
      sourceObservationIds: ['obs-a', 'obs-b'],
      unmatchedReason: null,
    }]);
    expect(inputCommunity.memberIds).toEqual(['obs-b', 'obs-a']);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view[0])).toBe(true);
    expect(Object.isFrozen(view[0].sourceObservationIds)).toBe(true);
  });

  it('is independent of record and member ordering and canonicalizes duplicate ids', () => {
    const first = derive();
    const second = derive({
      communities: [community(['obs-a', 'obs-b', 'obs-a'])],
      episodicRecords: [episode('ep-a', 'obs-a'), episode('ep-b', 'obs-b')],
      semanticRecords: [semantic({ memberIds: ['ep-b', 'ep-a', 'ep-b'] })],
    });
    expect(second).toEqual(first);
  });

  it('returns no-semantic when no current semantic producer record can describe the community', () => {
    expect(derive({ semanticRecords: [] })[0]).toMatchObject({
      summary: null,
      semanticRecordId: null,
      memberHash: null,
      sourceObservationIds: [],
      unmatchedReason: 'no-semantic',
    });

    expect(derive({ semanticRecords: [semantic({ memberIds: null })] })[0].unmatchedReason)
      .toBe('no-semantic');
  });

  it('returns unmapped-member when an overlapping semantic set cannot fully map', () => {
    const row = derive({
      semanticRecords: [semantic({ memberIds: ['ep-a', 'ep-without-observation'] })],
    })[0];
    expect(row.summary).toBeNull();
    expect(row.unmatchedReason).toBe('unmapped-member');
  });

  it('uses only meta.observationId as the bridge key', () => {
    const topLevelOnly = { id: 'ep-b', space: 'project-a', observationId: 'obs-b', meta: {} };
    const row = derive({
      episodicRecords: [episode('ep-a', 'obs-a'), topLevelOnly],
    })[0];
    expect(row.unmatchedReason).toBe('unmapped-member');
  });

  it('returns membership-drift rather than attaching a majority-overlap summary', () => {
    const row = derive({
      communities: [community(['obs-a', 'obs-b', 'obs-c'])],
      episodicRecords: [
        episode('ep-a', 'obs-a'),
        episode('ep-b', 'obs-b'),
        episode('ep-c', 'obs-c'),
      ],
    })[0];
    expect(row.summary).toBeNull();
    expect(row.unmatchedReason).toBe('membership-drift');
  });

  it('reports unmapped-member before a separate fully mapped drift candidate', () => {
    const row = derive({
      episodicRecords: [
        episode('ep-a', 'obs-a'),
        episode('ep-b', 'obs-b'),
        episode('ep-c', 'obs-c'),
      ],
      semanticRecords: [
        semantic({ id: 'sem-drift', memberIds: ['ep-a', 'ep-c'], memberHash: 'drift' }),
        semantic({ id: 'sem-unmapped', memberIds: ['ep-a', 'ep-missing'], memberHash: 'unmapped' }),
      ],
    })[0];
    expect(row.unmatchedReason).toBe('unmapped-member');
  });

  it('refuses an otherwise exact set when observation mappings cross spaces', () => {
    const row = derive({
      communities: [community(['obs-a'])],
      episodicRecords: [
        episode('ep-alpha', 'obs-a', 'alpha'),
        episode('ep-beta', 'obs-a', 'beta'),
      ],
      semanticRecords: [
        semantic({ id: 'sem-alpha', memberIds: ['ep-alpha'], memberHash: 'alpha', space: 'alpha' }),
        semantic({ id: 'sem-beta', memberIds: ['ep-beta'], memberHash: 'beta', space: 'beta' }),
      ],
    })[0];
    expect(row.summary).toBeNull();
    expect(row.unmatchedReason).toBe('membership-drift');
  });

  it('defensively chooses the current successor when both semantic versions are supplied', () => {
    const predecessor = semantic({
      id: 'sem-old',
      memberHash: 'old-hash',
      content: 'Old through-line.',
      recordedAt: '2026-08-12T09:00:00.000Z',
    });
    const successor = semantic({
      id: 'sem-new',
      memberHash: 'new-hash',
      content: 'Current through-line.',
      recordedAt: '2026-08-12T10:00:00.000Z',
      supersedes: 'sem-old',
    });

    expect(derive({ semanticRecords: [successor, predecessor] })[0]).toMatchObject({
      summary: 'Current through-line.',
      semanticRecordId: 'sem-new',
      memberHash: 'new-hash',
    });
  });
});
