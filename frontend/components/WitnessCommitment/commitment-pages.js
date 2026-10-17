// The commitment as pages, not one scroll (Design note, 2026-10-14: […]). One thing on screen at a
// time: the promise, what follows, each binding document, then the signature.
// Pure — the page model only; the DOM lives in commitment-docs.js.

/** Short step names for the binding documents; unknown ids fall back to the title. */
const DOC_STEP = Object.freeze({ covenant: 'COVENANT', terms: 'TERMS', eula: 'EULA' });

/**
 * The steps of the commitment, in order.
 * @param {Array<{id: string, title: string}>} docs - the binding documents, as served
 * @returns {ReadonlyArray<{key: string, label: string, docId?: string}>}
 */
export const buildSteps = (docs) => Object.freeze([
  Object.freeze({ key: 'promise', label: 'PROMISE' }),
  Object.freeze({ key: 'next', label: 'AHEAD' }),
  ...docs.map((doc) => Object.freeze({
    key: `doc:${doc.id}`,
    label: DOC_STEP[doc.id] || doc.title.toUpperCase(),
    docId: doc.id,
  })),
  Object.freeze({ key: 'sign', label: 'SIGN' }),
]);

/** Keep a step index inside the steps. */
export const clampStep = (steps, index) => Math.min(Math.max(index, 0), steps.length - 1);

/**
 * The furthest step a reader may open: up to the first document not yet read
 * to its end, never past it (Design note, 2026-10-14: no moving on from an agreement
 * until it has been read). Going back is always open.
 */
export const reachOf = (steps, readDocs) => {
  const unread = steps.findIndex((step) => step.docId && !readDocs.has(step.docId));
  return unread === -1 ? steps.length - 1 : unread;
};

/** The index of a step by key; the first step when the key is unknown. */
export const stepIndexOf = (steps, key) => Math.max(0, steps.findIndex((step) => step.key === key));

/** Pixels of slack at the end: a scroll at the bottom can stop a fraction short
 *  under display scaling (Founder's desk read 99.9% at the very end, 2026-10-14). */
const END_SLACK_PX = 4;

/**
 * How far a reader is through a scrolled text, 0..1 — 1 when it fits whole or
 * the reader stands at its end.
 * @param {{scrollTop: number, clientHeight: number, scrollHeight: number}} box
 */
export const readFraction = ({ scrollTop, clientHeight, scrollHeight }) => (
  scrollTop + clientHeight >= scrollHeight - END_SLACK_PX ? 1 : (scrollTop + clientHeight) / scrollHeight
);

/** The version line shown with a document ('' when the document carries none). */
export const docMeta = (doc) => [
  doc.version ? `VERSION ${doc.version}` : '',
  doc.effective ? `EFFECTIVE ${String(doc.effective).toUpperCase()}` : '',
].filter(Boolean).join(' · ');

/**
 * The forward button's words on a step: where it leads, or nothing on the last.
 * @returns {string|null}
 */
export const nextLabel = (steps, index) => (index >= steps.length - 1 ? null : `NEXT · ${steps[index + 1].label}`);
