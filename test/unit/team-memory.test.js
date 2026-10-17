/**
 * team-memory (pure) — a member's journal entry is ITS OWN story: its words,
 * its role, its teammates by name/role only. The cross-contamination pin is
 * the load-bearing test here: another member's output, status, or torch can
 * NEVER enter this member's memory.
 */
import { describe, test, expect } from 'vitest';
import { composeMemberStory, memberStories, STORY_PART_MAX_CHARS } from '../../backend/services/team-memory.js';

const STEPS = [
  { id: 'spec', neumaId: 'keir', role: 'HELM', task: 'write the spec', needs: [] },
  { id: 'build', neumaId: 'galen', role: 'WRIGHT', task: 'build it', needs: ['spec'] },
];
const RUN = {
  steps: STEPS,
  completed: { spec: 'the spec, in keir words', build: 'the build, in galen words' },
  statuses: { spec: 'spec stands', build: 'build stands' },
  torches: { keir: 'keir torch: pick up at review', galen: 'galen torch: tune the loop' },
  names: { keir: 'Keir', galen: 'Galen' },
  teamName: 'TEAM ALPHA',
  goal: 'ship the thing',
  runId: 'run-1',
};

describe('memberStories — one entry per member, own words only', () => {
  test('every completing member gets its story with role, teammates, goal, torch', () => {
    const stories = memberStories(RUN);
    expect(stories.map((s) => s.neumaId).sort()).toEqual(['galen', 'keir']);
    const keir = stories.find((s) => s.neumaId === 'keir').entry;
    expect(keir.type).toBe('team-run');
    expect(keir.runId).toBe('run-1');
    expect(keir.role).toBe('HELM');
    expect(keir.content).toContain('Keir held HELM, working beside Galen (WRIGHT)');
    expect(keir.content).toContain("The team's goal: ship the thing");
    expect(keir.content).toContain('the spec, in keir words');
    expect(keir.content).toContain('— spec stands');
    expect(keir.content).toContain('keir torch: pick up at review');
  });

  test('CROSS-CONTAMINATION PIN: nothing of a teammate\'s work enters a member\'s entry', () => {
    const stories = memberStories(RUN);
    const keir = stories.find((s) => s.neumaId === 'keir').entry.content;
    expect(keir).not.toContain('galen words'); // not their delivery
    expect(keir).not.toContain('build stands'); // not their check-in
    expect(keir).not.toContain('galen torch'); // never their torch
    const galen = stories.find((s) => s.neumaId === 'galen').entry.content;
    expect(galen).not.toContain('keir words');
    expect(galen).not.toContain('spec stands');
    expect(galen).not.toContain('keir torch');
  });

  test('a member that completed nothing gets NO entry — a story is never invented', () => {
    const stories = memberStories({
      ...RUN,
      completed: { spec: 'the spec, in keir words' }, // galen's part failed/skipped
    });
    expect(stories.map((s) => s.neumaId)).toEqual(['keir']);
  });

  test('one member holding several steps gets ONE entry carrying all its parts', () => {
    const stories = memberStories({
      ...RUN,
      steps: STEPS.map((s) => ({ ...s, neumaId: 'keir' })),
      names: { keir: 'Keir' },
    });
    expect(stories).toHaveLength(1);
    const content = stories[0].entry.content;
    expect(content).toContain('the spec, in keir words');
    expect(content).toContain('the build, in galen words'); // its own now
    expect(content).toContain('held HELM, WRIGHT');
    expect(content).toContain('no one — a solo run');
  });
});

describe('composeMemberStory — caps and honesty', () => {
  test('an overlong delivery is clipped with an honest pointer to the record', () => {
    const content = composeMemberStory({
      memberName: 'Keir',
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
      memberName: 'Keir',
      parts: [{ role: null, task: 't', output: 'work' }],
      ownStatuses: [],
      ownTorch: null,
      teammates: [{ name: 'Galen', role: null }],
      teamName: null,
      goal: null,
    });
    expect(content).not.toContain('Check-ins');
    expect(content).not.toContain('torch');
    expect(content).not.toContain('goal');
    expect(content).toContain('working beside Galen');
  });
});
