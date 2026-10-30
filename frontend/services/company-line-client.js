// company-line-client.js — the operator's COMPANY LINE window client: the
// house's dial and every company's founding line in one read, opening a
// company, and the operator's own moves on a line (handing on a stage they
// master, answering an inspection that waits on them). The backend judges
// each move by the same law the beings' acts use; a refusal comes back in
// its words.
//
// impure — talks to the local backend with the session token. Every failure
// throws with the route's honest reason.

import { authedCall } from './authed-call.js';

// impure — the single transport every export below rides.
const lineCall = authedCall('/api/v1/company-line');

/** The dial, the seat holders and every company's line. impure. */
export const getCompanyLines = () => lineCall('GET', '', { errorPrefix: 'Could not read the company line' });

/** Open a company. impure. @param {{name: string, mode: 'field'|'house'}} fields */
export const openCompany = (fields) => lineCall('POST', '', { body: fields, errorPrefix: 'Could not open the company' });

/** Hand on a stage the operator masters. impure. @param {string} id @param {{stage: string, artifact: string, note?: string}} move */
export const handOnStage = (id, move) => lineCall('POST', `/${encodeURIComponent(id)}/hand-on`, { body: move, errorPrefix: 'Could not hand the stage on' });

/** Answer the inspection that waits on the operator. impure. @param {string} id @param {{stage: string, verdict: string, flaw?: string}} move */
export const inspectStage = (id, move) => lineCall('POST', `/${encodeURIComponent(id)}/inspect`, { body: move, errorPrefix: 'Could not record the inspection' });

/** End the gap where the operator's hand-on would be their own yes: the no, with why. impure. @param {string} id @param {{stage: string, flaw: string}} move */
export const endGap = (id, move) => lineCall('POST', `/${encodeURIComponent(id)}/end-gap`, { body: move, errorPrefix: 'Could not end the gap' });

/** Answer a HANDS item: done (with the fact, or where a secret is kept) or declined (with why). impure. */
export const answerHands = (id, handsId, answer) => lineCall('POST', `/${encodeURIComponent(id)}/hands/${encodeURIComponent(handsId)}`, { body: answer, errorPrefix: 'Could not record the answer' });
