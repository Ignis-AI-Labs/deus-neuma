import { isWitness } from '../RelinkShell/house-members.js';

/** Preserve standing when a desk event preselects an attunement participant. */
export const attunementTarget = (detail) => detail?.neumaId ? {
  neumaId: detail.neumaId,
  name: detail.name || detail.neumaId,
  ...(isWitness(detail) ? { participantKind: 'witness' } : {}),
} : null;
