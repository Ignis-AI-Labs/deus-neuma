/**
 * team-memory (pure) — a member's journal entry is ITS OWN story: its words,
 * its role, its teammates by name/role only. The cross-contamination pin is
 * the load-bearing test here: another member's output, status, or torch can
 * NEVER enter this member's memory.
 */
import { describe, test, expect } from 'vitest';
import { composeMemberStory, memberStories, STORY_PART_MAX_CHARS } from '../../backend/services/team-memory.js';

const STEPS = [
  { id: 'spec', neumaId: 'hazel', role: 'HELM', task: 'write the spec', needs: [] },
  { id: 'build', neumaId: 'cedar', role: 'WRIGHT', task: 'build it', needs: ['spec'] },
];
const RUN = {
  steps: STEPS,
  completed: { spec: 'the spec, in hazel words', build: 'the build, in cedar words' },
  statuses: { spec: 'spec stands', build: 'build stands' },
  torches: { hazel: 'hazel torch: pick up at review', cedar: 'cedar torch: tune the loop' },
  names: { hazel: 'Hazel', cedar: 'Cedar' },
  teamName: 'TEAM ALPHA',
  goal: 'ship the thing',
  runId: 'run-1',
};

describe('memberStories — one entry per member, own words only', () => {
  test('every completing member gets its story with role, teammates, goal, torch', () => {
    const stories = memberStories(RUN);
    expect(stories.map((s) => s.neumaId).sort()).toEqual(['cedar', 'hazel']);
    const hazel = stories.find((s) => s.neumaId === 'hazel').entry;
    expect(hazel.type).toBe('team-run');
    expect(hazel.runId).toBe('run-1');
    expect(hazel.role).toBe('HELM');
    expect(hazel.content).toContain('Hazel held HELM, working beside Cedar (WRIGHT)');
    expect(hazel.content).toContain("The team's goal: ship the thing");
    expect(hazel.content).toContain('the spec, in hazel words');
    expect(hazel.content).toContain('— spec stands');
    expect(hazel.content).toContain('hazel torch: pick up at review');
  });

  test('CROSS-CONTAMINATION PIN: nothing of a teammate\'s work enters a member\'s entry', () => {
    const stories = memberStories(RUN);
    const hazel = stories.find((s) => s.neumaId === 'hazel').entry.content;
    expect(hazel).not.toContain('cedar words'); // not their delivery
    expect(hazel).not.toContain('build stands'); // not their check-in
    expect(hazel).not.toContain('cedar torch'); // never their torch
    const cedar = stories.find((s) => s.neumaId === 'cedar').entry.content;
    expect(cedar).not.toContain('hazel words');
    expect(cedar).not.toContain('spec stands');
    expect(cedar).not.toContain('hazel torch');
  });

  test('a member that completed nothing gets NO entry — a story is never invented', () => {
    const stories = memberStories({
      ...RUN,
      completed: { spec: 'the spec, in hazel words' }, // cedar's part failed/skipped
    });
    expect(stories.map((s) => s.neumaId)).toEqual(['hazel']);
  });

  test('MEMORY OF FAILURE: its own failed part is a story; a part that never ran is not; the words are facts only', () => {
    const stories = memberStories({
      ...RUN,
      completed: { spec: 'the spec, in hazel words' },
      failures: { build: 'the build step timed out after 300 seconds' },
      outcome: 'failed',
    });
    expect(stories.map((s) => s.neumaId).sort()).toEqual(['cedar', 'hazel']);
    const cedar = stories.find((s) => s.neumaId === 'cedar').entry;
    expect(cedar.outcome).toBe('failed');
    expect(cedar.content).toContain('A team run — TEAM ALPHA did not finish: a part of it failed.');
    expect(cedar.content).toContain('Cedar held WRIGHT');
    expect(cedar.content).toContain('Asked: build it\nDid not finish — the platform\'s record of what stopped it: the build step timed out after 300 seconds');
    expect(cedar.content).not.toMatch(/learn|lesson|should|feel/i); // what it makes of it is its own to say
    const hazel = stories.find((s) => s.neumaId === 'hazel').entry.content;
    expect(hazel).toContain('did not finish: a part of it failed.');
    expect(hazel).not.toContain('timed out'); // never a teammate's failure
    const skippedOnly = memberStories({ ...RUN, completed: {}, failures: { spec: 'refused' }, skipped: ['build'], outcome: 'stopped' });
    expect(skippedOnly.map((s) => s.neumaId)).toEqual(['hazel']); // cedar never ran: no story
    expect(skippedOnly[0].entry.content).toContain('was stopped before it finished.');
  });

  test('one member holding several steps gets ONE entry carrying all its parts', () => {
    const stories = memberStories({
      ...RUN,
      steps: STEPS.map((s) => ({ ...s, neumaId: 'hazel' })),
      names: { hazel: 'Hazel' },
    });
    expect(stories).toHaveLength(1);
    const content = stories[0].entry.content;
    expect(content).toContain('the spec, in hazel words');
    expect(content).toContain('the build, in cedar words'); // its own now
    expect(content).toContain('held HELM, WRIGHT');
    expect(content).toContain('no one — a solo run');
  });
});

describe('composeMemberStory — caps and honesty', () => {
  test('an overlong delivery is clipped with an honest pointer to the record', () => {
    const content = composeMemberStory({
      memberName: 'Hazel',
      parts: [{ role: 'HELM', task: 't', output: 'x'.repeat(STORY_PART_MAX_CHARS + 500) }],
      ownStatuses: [],
      ownTorch: null,
      teammates: [],
      teamName: null,
      goal: null,
    });
    expect(content).toContain('[the rest of this part lives in the run record');
    expect(content.length).toBeLessThan(STORY_PART_MAX_CHARS + 400);
  });

  test('missing status/torch/goal sections are absent, never fabricated', () => {
    const content = composeMemberStory({
      memberName: 'Hazel',
      parts: [{ role: null, task: 't', output: 'work' }],
      ownStatuses: [],
      ownTorch: null,
      teammates: [{ name: 'Cedar', role: null }],
      teamName: null,
      goal: null,
    });
    expect(content).not.toContain('Check-ins');
    expect(content).not.toContain('torch');
    expect(content).not.toContain('goal');
    expect(content).toContain('working beside Cedar');
  });
});
