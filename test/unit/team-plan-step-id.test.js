// A plan's step id names files the platform writes itself — the team room's
// part (team-channel.js) and the part's work log (workspace-sessions.js) — so
// a being's step id is held to the part log's rule at intake, the engine's
// gate holds it again for a stored or composed plan, and the room never
// writes outside itself whatever id reaches it. Real functions, real disk.

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { normalizePlanArgs } from '../../backend/services/team-plan.js';
import { validatePlan } from '../../backend/services/team-coordinator.js';
import { createTeamRoom } from '../../backend/services/team-channel.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';

const plan = (id) => ({ goal: 'ship the offer', steps: [{ id, member: 'Keir', task: 'write it' }] });
const UNSAFE = ['../x', '../../../escaped/planted', 'a/b', 'a b', 'a:b', 'market research', '.hidden', 'x..y'];
const SAFE = ['build', 'build-2', 'market_research', 'v1.2'];

describe('a step id is one safe word, refused at intake with the fix named', () => {
  it.each(UNSAFE)('plan_submit refuses %j and says what an id may hold', (id) => {
    expect(() => normalizePlanArgs(plan(id))).toThrow(/must be one word of letters, digits, "\.", "_" or "-"/);
  });

  it.each(SAFE)('plan_submit takes %j, and the part log can be kept under it', (id) => {
    expect(normalizePlanArgs(plan(id)).steps[0].id).toBe(id);
    expect(() => neumaWorkspace._teamLogPath('lane-a', 'run-1', id)).not.toThrow();
  });

  it.each(UNSAFE)('the engine\'s gate refuses %j too (a stored or composed plan)', (id) => {
    expect(() => validatePlan([{ id, neumaId: 'lane-a', task: 't' }])).toThrow(/must be letters, digits/);
  });
});

describe('the team room never writes outside itself', () => {
  it('a traversal id writes nothing outside <root>/.team/; a plain id lands in parts/', async () => {
    const base = await createTempDir('team-room-id');
    const root = path.join(base, 'room');
    const room = createTeamRoom({ root });
    await room.part({ id: '../../../escaped/planted', member: 'Keir' }, 'planted text');
    await expect(fs.access(path.join(base, 'escaped', 'planted-keir.md'))).rejects.toThrow();
    await room.part({ id: 'build', member: 'Keir' }, 'the part');
    expect(await fs.readFile(path.join(root, '.team', 'parts', 'build-keir.md'), 'utf8')).toContain('the part');
  });
});
