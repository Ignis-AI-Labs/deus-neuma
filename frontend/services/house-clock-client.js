// house-clock-client.js — the operator's client for the house clock: the
// charter (read, write, approve the version on screen, pause, resume), the
// queue, the wake ledger, the asks house work filed (and the Optio's review
// packet), and the operator's answer to one. Every route reads and
// writes only the calling wallet's own house. Every failure throws with the
// route's honest reason — a window that could not act must never LOOK like
// it did.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/house-clock';

// impure — the single transport every export below rides.
const clockCall = async (method, path, { body, errorPrefix } = {}) => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

/** @returns {Promise<{charter: ?Object, standing: string, history: Object[]}>} impure */
export const getCharter = () => clockCall('GET', '/charter', { errorPrefix: 'Could not read the charter' });

/** Write a new version — it waits for the operator's approval. impure */
export const putCharter = (fields) => clockCall('PUT', '/charter', { body: fields, errorPrefix: 'Could not save the charter' });

/** Approve exactly the version the operator read. impure */
export const approveCharter = (version) =>
  clockCall('POST', '/charter/approve', { body: { version }, errorPrefix: 'Could not approve the charter' });

/** The master switch: nothing wakes while paused. impure */
export const pauseHouse = () => clockCall('POST', '/charter/pause', { errorPrefix: 'Could not pause the house' });

/** impure */
export const resumeHouse = () => clockCall('POST', '/charter/resume', { errorPrefix: 'Could not resume the house' });

/** @returns {Promise<{items: Object[], running: Object, today: Object, held: Array<{seat: string, why: string}>}>} impure */
export const getWakeQueue = () => clockCall('GET', '/queue', { errorPrefix: 'Could not read the wake queue' });

/** A page of wakes, newest first; seat / outcome filter before the page. @returns {Promise<{rows: Object[], total: number}>} impure */
export const getWakeLedger = ({ offset = 0, limit = 20, seat = '', outcome = '' } = {}) => {
  const q = new URLSearchParams({ offset: String(offset), limit: String(limit), ...(seat ? { seat } : {}), ...(outcome ? { outcome } : {}) });
  return clockCall('GET', `/ledger?${q}`, { errorPrefix: 'Could not read the wake ledger' });
};

/** Every ask, and the Optio's current review packet. @returns {Promise<{asks: Object[], packet: ?Object}>} impure */
export const getHouseAsks = () => clockCall('GET', '/asks', { errorPrefix: 'Could not read the asks' });

/**
 * The operator answers an ask: allow | deny an act (allow = once, exactly that act), approve | revise a
 * plan, reply to a decision. The seat is woken with it. @returns {Promise<{ask: Object, woken: {queued: boolean, why?: string}}>} impure
 */
export const answerHouseAsk = (id, answer) =>
  clockCall('POST', `/asks/${encodeURIComponent(id)}/answer`, { body: answer, errorPrefix: 'Could not answer the ask' });

/** Dismiss an ask without answering. Nothing runs. impure */
export const closeHouseAsk = (id, note) =>
  clockCall('POST', `/asks/${encodeURIComponent(id)}/close`, { body: note ? { note } : {}, errorPrefix: 'Could not close the ask' });
