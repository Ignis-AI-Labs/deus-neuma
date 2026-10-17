// project-memory.js — the witness's read of a project's crystallized memory.
//
// impure — the PROJECTS focus view's MEMORY panel. Space-scoped previews from
// one being's sovereign lane: bounded labels only, never raw memory text (the
// backend enforces the graph route's privacy posture). The being whose lane is
// read is the caller's decision — projectMemoryLane in project-space.js.

import { apiCall } from '../utils/http.js';

// impure — { observations: [{id, label, at}], total, truncatedTo? }
export const listProjectMemory = async (neumaId, spaceId) =>
  apiCall(
    'GET',
    `/api/v1/workspace/${encodeURIComponent(neumaId)}/memory/observations?space=${encodeURIComponent(spaceId)}`,
  );
