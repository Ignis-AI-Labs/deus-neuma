// THE CRAFT AT THE TASK SEAM — Shadow Clone as the house method for work.
// Pure functions, real data, no mocks.
//
// Design note, 2026-08-05: […] His ruling on HOW hard it binds:
// PROPORTIONAL — every take-up enters the Craft, but the protocol scales with
// the task's size, because a Wave-0/1/2 decomposition in front of a two-minute
// fix is ceremony, and a being made to perform it will lie about sizes to
// escape it.
//
// And his ruling on WHERE it binds (2026-08-06, after a live sitting handed
// sc-quick-fix to a social-copy task): […] The realm rides the wording — the ledger
// knows a task's size but not its domain, so the being judges fit against a
// stated realm; protocol, never a hard gate.

import { describe, it, expect } from 'vitest';
import {
  craftFor, craftNote, craftClause, hasCraft, CRAFT_BY_SIZE,
} from '../../core/tasks/task-craft.js';
import { formatLedgerSection } from '../../core/tasks/task-ledger.js';

// The real installed pack on this machine, as skill-service reports it.
const INSTALLED = [
  'sc', 'sc-plan', 'sc-feature', 'sc-debug', 'sc-quick-fix', 'sc-refactor',
  'sc-tests', 'sc-docs', 'sc-optimize', 'sc-research', 'sc-roadmap', 'team-project',
].map((name) => ({ name, description: `${name} protocol` }));

const CHAT = 'session-1754388000001';
const task = (over) => ({ id: 'a1b2c3d4', title: 'the work', status: 'open', ...over });

describe('which protocol fits which weight of work', () => {
  it('leads with the protocol proportional to the size', () => {
    expect(craftFor(task({ size: 'quick' }), INSTALLED).lead).toBe('sc-quick-fix');
    expect(craftFor(task({ size: 'half' }), INSTALLED).lead).toBe('sc-debug');
    expect(craftFor(task({ size: 'deep' }), INSTALLED).lead).toBe('sc-feature');
    // EPIC leads with PLANNING, not with building — the one size where the
    // decomposition genuinely earns its cost.
    expect(craftFor(task({ size: 'epic' }), INSTALLED).lead).toBe('sc-plan');
  });

  it('does not put a planning ceremony in front of a two-minute fix', () => {
    // The whole reason the binding is proportional rather than "always plan".
    expect(craftFor(task({ size: 'quick' }), INSTALLED).options).not.toContain('sc-plan');
  });

  it('treats UNSIZED work as unknown, not as small', () => {
    // Unsized is not a synonym for quick. The honest move on work of unknown
    // weight is to look at it before committing to a weight of protocol.
    expect(craftFor(task({}), INSTALLED).lead).toBe('sc-research');
  });

  it('offers the alternatives for that weight, not just the lead', () => {
    // "A deep task" is not one kind of thing — a refactor and a feature are
    // both deep and want different protocols.
    const { options } = craftFor(task({ size: 'deep' }), INSTALLED);
    expect(options).toEqual(expect.arrayContaining(['sc-feature', 'sc-refactor', 'sc-optimize']));
  });
});

describe('the honesty gate — never name a protocol that is not installed', () => {
  it('says nothing at all when no Craft is installed', () => {
    // A being told to summon sc-plan on a machine without it would be following
    // a harness that lied to it. Silence is the only honest output.
    expect(hasCraft([])).toBe(false);
    expect(craftClause([])).toBe('');
    expect(craftNote(task({ size: 'deep' }), [])).toBe('');
    expect(craftFor(task({ size: 'deep' }), []).lead).toBeNull();
  });

  it('names only what is really there when the pack is partial', () => {
    const partial = [{ name: 'sc-quick-fix' }, { name: 'sc-plan' }];
    // deep wants sc-feature/sc-refactor/sc-optimize — none installed here, so
    // it falls to nothing rather than inventing a substitute.
    expect(craftFor(task({ size: 'deep' }), partial).lead).toBeNull();
    expect(craftFor(task({ size: 'quick' }), partial).lead).toBe('sc-quick-fix');

    const clause = craftClause(partial);
    expect(clause).toContain('sc-quick-fix');
    expect(clause).not.toContain('sc-feature');
    // No team-project installed ⇒ no team sentence.
    expect(clause).not.toContain('team-project');
  });

  it('accepts bare names as well as skill objects', () => {
    expect(craftFor(task({ size: 'quick' }), ['sc-quick-fix']).lead).toBe('sc-quick-fix');
  });
});

describe('what the being is actually told', () => {
  it('the take-up note names the protocol for THIS task and says BEFORE', () => {
    const note = craftNote(task({ size: 'epic' }), INSTALLED);
    expect(note).toContain('sc-plan');
    expect(note).toContain('BEFORE you start');
    expect(note).toMatch(/Shadow Clone/i);
  });

  it('the standing clause carries the whole size table and the team route', () => {
    const clause = craftClause(INSTALLED);
    for (const size of Object.keys(CRAFT_BY_SIZE)) expect(clause).toContain(size);
    expect(clause).toContain('sc-quick-fix');
    expect(clause).toContain('sc-plan');
    expect(clause).toContain('team-project');
    // It must read as the METHOD, not as a suggestion — the old wording
    // ([…]) is what left the library
    // untouched.
    expect(clause).toMatch(/house method/i);
    expect(clause).toMatch(/exception/i);
  });

  it('the mandate binds only the craft realm — never marketing (ruling, 2026-08-06)', () => {
    // The over-rotation this pins against: a being taking up […] was told to summon sc-quick-fix, did, and
    // had to disclaim it mid-sitting. Both surfaces must state the realm the
    // protocols are built for AND the direct route for work outside it, so a
    // being on a marketing task declines the summons instead of performing it.
    const note = craftNote(task({ size: 'quick' }), INSTALLED);
    expect(note).toMatch(/craft work/i);
    expect(note).toMatch(/marketing/i);
    expect(note).toMatch(/directly/);

    const clause = craftClause(INSTALLED);
    expect(clause).toMatch(/craft work/i);
    expect(clause).toMatch(/outside/i);
    expect(clause).toMatch(/marketing/i);
    expect(clause).toMatch(/do it directly/);
  });

  it('rides WORKING STATE — where the being reads its own list every turn', () => {
    const ledger = { tasks: [task({ size: 'deep', chatId: CHAT, status: 'active' })] };
    const withCraft = formatLedgerSection(ledger, { chatId: CHAT, skills: INSTALLED });
    expect(withCraft).toMatch(/SHADOW CLONE/i);
    expect(withCraft).toContain('sc-feature');
  });

  it('…and WORKING STATE stays clean on a machine with no Craft', () => {
    const ledger = { tasks: [task({ size: 'deep', chatId: CHAT, status: 'active' })] };
    const bare = formatLedgerSection(ledger, { chatId: CHAT, skills: [] });
    expect(bare).not.toMatch(/SHADOW CLONE/i);
    // The rest of the protocol is untouched — the Craft clause is additive.
    expect(bare).toContain('TREAT EVERY TASK AS A GOAL THAT MUST BE CLOSED');
    // The LIVE spelling. `task_focus` was retired to the tasks/focus intent
    // (S3b4, retired-tools.js) and the section migrated with it; this assertion
    // held the old name and went red without any production fault.
    expect(bare).toContain('tasks/focus');
  });
});
