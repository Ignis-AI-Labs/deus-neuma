// project-space.js — the pure logic tying a chat to a project.
//
// Kept free of React and browser globals so it is node-testable on its own:
// the consciousness hook (impure, window-bound) imports these to stamp the
// active project onto portal frames and to decide when a fresh chat announces
// itself to the projects view.

// A project IS an episodic space (kind: 'project'): the turn's space id is the
// project id, its label the project name. Spread onto a portal frame so the
// neuma's memory scopes to the project and a fresh chat pins to it server-side.
// No active project → an empty object (no space field): the chat stays general,
// and older clients that never speak of projects are unaffected.
//
// Semantics (deliberate): the ACTIVE project is the working lens for the turns
// you send RIGHT NOW — memory scope follows it per turn. A chat's PIN, by
// contrast, is fixed at birth (the project it was started under). So resuming a
// chat while a different project is active scopes its new turns to the active
// project, not its birth project; the pin does not move. This keeps […] coherent. (A future refinement could make resume adopt the
// chat's own birth project once sessions carry an authoritative project tag —
// today they don't, so the active-project lens is the honest, single source.)
export const projectSpaceFrame = (project) =>
  (project ? { space: { id: project.id, kind: 'project', label: project.name } } : {});

// Should a completed turn announce a newly-born project chat? True only when a
// project is active AND this is a session id we haven't accounted for yet.
// Every resume entry point pre-seeds the seen-id, so a resumed chat's completes
// return false; a fresh mint (seen-id null/stale) returns true exactly once,
// then the caller records the id.
export const isNewProjectChat = (activeProject, sessionId, seenId) =>
  Boolean(activeProject) && Boolean(sessionId) && sessionId !== seenId;

// What opening a folder does (D5): opening is a FOCUS gesture — it never
// mutates the project store. The decision always lands on the same arm; what
// it carries is WHO already owns the folder (the owning project binding, or
// null), so the impure hook sets this window's focus and callers can offer
// the widen-to-project affordance. The old attach/cd/prompt arms live on only
// in folderAttachAction below — ProjectsApp's explicit attach action.
export const folderOpenAction = (binding) =>
  Object.freeze({ action: 'focus-folder', owner: binding ?? null });

// What explicitly ATTACHING a folder to a project should do, given the project
// (if any) that already owns it. This is ProjectsApp's switch-vs-reconnect
// decision — the open gesture no longer takes these arms — kept pure so the
// collision flow is testable without a backend:
//   no binding            → 'attach'  (attach here, make it the working folder)
//   bound to THIS project → 'cd'      (already ours — just switch the cwd)
//   bound to ANOTHER      → 'prompt'  (ask: switch to it, or reconnect it here)
export const folderAttachAction = (binding, projectId) => {
  if (!binding) return { action: 'attach' };
  if (binding.id === projectId) return { action: 'cd' };
  return { action: 'prompt', binding };
};

// Whose sovereign lane the focus view's MEMORY panel reads for a project.
// A being's project reads THAT being's lane — the project knows its own
// neuma. A house project has no single lane, so it is read through the
// window's active companion (the lens you are looking through), and 'none'
// when no being is selected — the panel then asks for one instead of
// guessing. Never a union: memory stays per-sovereign-lane by law.
export const projectMemoryLane = (project, activeNeumaId) => {
  if (project?.channel === 'neuma' && project.neumaId) {
    return { neumaId: project.neumaId, through: 'project' };
  }
  if (activeNeumaId) return { neumaId: activeNeumaId, through: 'companion' };
  return { neumaId: null, through: 'none' };
};

// Where the create-form's BROWSE opens (Design note, 2026-07-24: defaults set up
// ahead of time so no one disorganizes themselves). The witness's typed
// path always wins; otherwise the register's own ground — a being's
// working ground on their channel for the NEUMA tab, the house's
// collective repos for HOUSE — and undefined (the picker's home default)
// only when no ground stands. A being missing its own ground falls to the
// house repos before home: still inside the organization.
export const createBrowseStart = ({ draft, tab, beingGround, houseRepos }) =>
  (draft || '').trim()
    || (tab === 'neuma' ? beingGround || houseRepos : houseRepos)
    || undefined;
