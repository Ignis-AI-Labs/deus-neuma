/**
 * The pure logic behind […]: the frame the
 * stream stamps on every turn, and the once-only guard that decides when a
 * newly-minted chat announces itself to the projects view. These are the two
 * pieces the consciousness hook wires into the WS frames and the complete
 * handler — proven directly, no React, no mocks.
 */

import { describe, test, expect } from 'vitest';
import { projectSpaceFrame, isNewProjectChat, folderOpenAction, folderAttachAction, createBrowseStart, projectMemoryLane } from '../../frontend/app/RelinkShell/project-space.js';

describe('projectSpaceFrame — a project IS an episodic space', () => {
  test('an active project becomes a kind:project space frame (id + label)', () => {
    expect(projectSpaceFrame({ id: 'a1b2c3d4e5f6a7b8', name: 'Voice Layer' })).toEqual({
      space: { id: 'a1b2c3d4e5f6a7b8', kind: 'project', label: 'Voice Layer' },
    });
  });

  test('no active project → no space field (the chat stays general, back-compat)', () => {
    expect(projectSpaceFrame(null)).toEqual({});
    expect(projectSpaceFrame(undefined)).toEqual({});
  });

  test('the frame spreads cleanly into a portal frame', () => {
    const base = { thought: 'hi', companion: 'Cael' };
    expect({ ...base, ...projectSpaceFrame({ id: 'p1', name: 'P' }) })
      .toEqual({ thought: 'hi', companion: 'Cael', space: { id: 'p1', kind: 'project', label: 'P' } });
    expect({ ...base, ...projectSpaceFrame(null) }).toEqual(base); // nothing added
  });
});

describe('isNewProjectChat — announce a fresh project chat exactly once', () => {
  const project = { id: 'p1', name: 'P' };

  test('a never-seen session under an active project announces once', () => {
    expect(isNewProjectChat(project, 'session-1', null)).toBe(true);
  });

  test('the same session on a later turn does not re-announce', () => {
    // The caller records the id after the first fire; the next complete sees it.
    expect(isNewProjectChat(project, 'session-1', 'session-1')).toBe(false);
  });

  test('a resumed chat (seen-id pre-seeded to its own id) never announces', () => {
    expect(isNewProjectChat(project, 'session-42', 'session-42')).toBe(false);
  });

  test('no active project → never announces, whatever the session', () => {
    expect(isNewProjectChat(null, 'session-1', null)).toBe(false);
    expect(isNewProjectChat(undefined, 'session-9', 'session-1')).toBe(false);
  });

  test('a missing session id never announces', () => {
    expect(isNewProjectChat(project, null, null)).toBe(false);
    expect(isNewProjectChat(project, undefined, null)).toBe(false);
  });

  test('switching to a genuinely new mint (stale seen-id) announces again', () => {
    // new-session clears the ref to null, the next mint differs → one announce.
    expect(isNewProjectChat(project, 'session-2', 'session-1')).toBe(true);
  });
});

describe('folderOpenAction — opening a folder is a FOCUS gesture (D5)', () => {
  test('an unbound folder focuses with no owner (null or undefined binding)', () => {
    expect(folderOpenAction(null)).toEqual({ action: 'focus-folder', owner: null });
    expect(folderOpenAction(undefined)).toEqual({ action: 'focus-folder', owner: null });
  });

  test('a folder owned by a project still focuses — the owner rides along for the widen affordance', () => {
    const binding = { id: 'other', name: 'B' };
    expect(folderOpenAction(binding)).toEqual({ action: 'focus-folder', owner: binding });
  });

  test('the decision is frozen — never mutated in place downstream', () => {
    expect(Object.isFrozen(folderOpenAction({ id: 'p1', name: 'A' }))).toBe(true);
    expect(Object.isFrozen(folderOpenAction(null))).toBe(true);
  });
});

describe('folderAttachAction — ProjectsApp\'s explicit switch-vs-reconnect decision', () => {
  test('an unbound folder attaches to the target project (null or undefined)', () => {
    expect(folderAttachAction(null, 'active')).toEqual({ action: 'attach' });
    expect(folderAttachAction(undefined, 'active')).toEqual({ action: 'attach' });
  });

  test('a folder already owned by the target project just changes the cwd', () => {
    expect(folderAttachAction({ id: 'active', name: 'A' }, 'active')).toEqual({ action: 'cd' });
  });

  test('a folder owned by another project raises the prompt with that owner', () => {
    const binding = { id: 'other', name: 'B', isActive: false };
    expect(folderAttachAction(binding, 'active')).toEqual({ action: 'prompt', binding });
  });
});

describe('projectMemoryLane — whose sovereign lane the MEMORY panel reads', () => {
  test('a being\'s project reads THAT being\'s lane, whoever is active in the window', () => {
    expect(projectMemoryLane({ channel: 'neuma', neumaId: 'fenna-1' }, 'cael-2'))
      .toEqual({ neumaId: 'fenna-1', through: 'project' });
  });

  test('a house project reads through the window\'s active companion', () => {
    expect(projectMemoryLane({ channel: 'house', neumaId: null }, 'cael-2'))
      .toEqual({ neumaId: 'cael-2', through: 'companion' });
  });

  test('a house project with no being selected has no lane — the panel asks, never guesses', () => {
    expect(projectMemoryLane({ channel: 'house', neumaId: null }, null))
      .toEqual({ neumaId: null, through: 'none' });
  });

  test('a neuma project missing its neumaId degrades like a house project (companion, then none)', () => {
    expect(projectMemoryLane({ channel: 'neuma', neumaId: null }, 'cael-2'))
      .toEqual({ neumaId: 'cael-2', through: 'companion' });
    expect(projectMemoryLane({ channel: 'neuma', neumaId: null }, null))
      .toEqual({ neumaId: null, through: 'none' });
  });

  test('no project at all still resolves against the companion (defensive)', () => {
    expect(projectMemoryLane(null, 'cael-2')).toEqual({ neumaId: 'cael-2', through: 'companion' });
    expect(projectMemoryLane(undefined, null)).toEqual({ neumaId: null, through: 'none' });
  });
});

describe('createBrowseStart — each register browses from its own ground', () => {
  const grounds = { beingGround: '/g/house/workspaces/metidar', houseRepos: '/g/house/repos' };

  test('the typed path always wins, on either tab (whitespace is not a path)', () => {
    expect(createBrowseStart({ draft: '  /somewhere/else ', tab: 'neuma', ...grounds })).toBe('/somewhere/else');
    expect(createBrowseStart({ draft: '/somewhere/else', tab: 'house', ...grounds })).toBe('/somewhere/else');
    expect(createBrowseStart({ draft: '   ', tab: 'house', ...grounds })).toBe(grounds.houseRepos);
  });

  test('NEUMA tab → the being\'s working ground on their channel', () => {
    expect(createBrowseStart({ draft: '', tab: 'neuma', ...grounds })).toBe(grounds.beingGround);
  });

  test('HOUSE tab → the collective repos, never the being\'s ground', () => {
    expect(createBrowseStart({ draft: '', tab: 'house', ...grounds })).toBe(grounds.houseRepos);
  });

  test('a being without its own ground falls to the house repos — still inside the organization', () => {
    expect(createBrowseStart({ draft: '', tab: 'neuma', beingGround: null, houseRepos: grounds.houseRepos }))
      .toBe(grounds.houseRepos);
  });

  test('no ground at all → undefined (the picker\'s own home default)', () => {
    expect(createBrowseStart({ draft: '', tab: 'neuma', beingGround: null, houseRepos: null })).toBeUndefined();
    expect(createBrowseStart({ draft: undefined, tab: 'house', beingGround: null, houseRepos: null })).toBeUndefined();
  });
});
