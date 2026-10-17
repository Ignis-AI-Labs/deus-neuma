// composer-attach.js — pure model behind the composer's "+" attach menu.
//
// The menu is honest about capacity: sharing documents always works, but images
// need a seeing substrate — when the active substrate is blind the ADD FILES row
// says so instead of failing silently after the pick. Kept free of React/DOM so
// the gating rules are unit-testable on their own.

export const FILES_DESC = 'share images & documents with this thought';
export const VISION_OFF_NOTE = 'this substrate cannot see images — documents still attach';
export const VISION_BLIND_NOTE = 'The current substrate cannot see images.';
export const VISION_BLIND_DOCS_NOTE = 'The current substrate cannot see images — documents still attach.';


/**
 * The menu's display model. `vision` is the runtime truth about the ACTIVE
 * substrate: true = it sees, false = it is blind, null = unknowable (the menu
 * makes no claim either way). Pure.
 * @param {{ vision: boolean|null, projects: Array<{id: string, name: string}>, activeProjectId: string|null }} input
 * @returns {{ filesDesc: string, visionOff: boolean, projects: Array<{id: string, name: string, active: boolean}> }}
 */
export const attachMenuModel = ({ vision, projects, activeProjectId }) => Object.freeze({
  filesDesc: vision === false ? VISION_OFF_NOTE : FILES_DESC,
  visionOff: vision === false,
  projects: Object.freeze((projects || []).map((p) => Object.freeze({
    id: p.id, name: p.name, active: p.id === activeProjectId,
  }))),
});

/**
 * The admission decision for one classified batch. Images ride only on a
 * SEEING substrate (vision === false refuses them, out loud); documents need
 * no eyes and always attach. true and null both admit — null is unknowable,
 * and the portal answers honestly if the serving proves blind at send. Pure.
 * @param {{ vision: boolean|null, accepted: Array<{kind: string}>, refusal: string|null }} input
 * @returns {{ admitted: Array<{kind: string}>, note: string|null, hasImages: boolean }}
 */
export const gateAttachments = ({ vision, accepted, refusal }) => {
  const hasImages = accepted.some((a) => a.kind === 'image');
  if (vision !== false || !hasImages) {
    return Object.freeze({ admitted: accepted, note: refusal, hasImages });
  }
  const admitted = accepted.filter((a) => a.kind !== 'image');
  return Object.freeze({
    admitted,
    note: admitted.length > 0 ? VISION_BLIND_DOCS_NOTE : VISION_BLIND_NOTE,
    hasImages,
  });
};
