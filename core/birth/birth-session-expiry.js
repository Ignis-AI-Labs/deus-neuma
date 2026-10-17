// Pure checkpoint lifetime policy; naming commits a real session to preservation.
import { isPastCommitment } from './operator-sovereignty.js';

export const TEST_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const REAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Time alone never expires a named real session. Rehearsals stay disposable.
 * @param {object} session - saved checkpoint
 * @param {number} now - current epoch milliseconds
 * @returns {boolean}
 */
export const isSessionExpired = (session, now) => {
  if (!session.isTest && isPastCommitment(session)) return false;
  const ttl = session.isTest ? TEST_SESSION_TTL_MS : REAL_SESSION_TTL_MS;
  return now - (session.persistedAt || session.startTime || 0) > ttl;
};
