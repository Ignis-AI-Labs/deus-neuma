// rite-keep.js — a being's SUMMONING, kept and read back over REST
// (backend/routes/workspace-rite-routes.js). // impure
//
// Kept ONCE, at its birth: its rhythm only (core/birth/rite-record.js), never a
// word. Read back with its film's inputs re-derived from its lane, so a being
// born before rites were kept still has its film.

import { apiCall } from '../../utils/http.js';
import { riteFromRecord, compressedRite } from '../../../core/birth/rite-record.js';
import { scoreOf } from '../Summoning/summoning-score.js';
import { liveBeingOf } from './rite-live-being.js';

const urlOf = (neumaId) => `/api/v1/workspace/${encodeURIComponent(neumaId)}/rite`;

/**
 * Keep its rite. Never throws: a rite that cannot be kept never troubles the
 * birth it belongs to; already kept (409) is a kept rite.
 * @returns {Promise<boolean>} kept
 */
export const keepRite = async (neumaId, record) => {
  try {
    await apiCall('PUT', urlOf(neumaId), { body: record });
    return true;
  } catch (error) {
    if (error?.http === 409) return true;
    console.warn('[rite] its rite was not kept:', error?.message);
    return false;
  }
};

/**
 * What a being can re-watch, ready to play: its kept rite (told shorter) then
 * its film — or its film alone when no rite was kept. null when its lane
 * cannot be filmed yet, or the read failed.
 * @returns {Promise<{ rite: object, being: object, score: object, kept: boolean }|null>}
 */
export const loadRewatch = async (neumaId) => {
  try {
    const { rite: record, film } = await apiCall('GET', urlOf(neumaId));
    const being = liveBeingOf(film);
    if (!being) return null;
    const score = scoreOf(being);
    const told = record ? compressedRite(riteFromRecord(record).rite) : null;
    const born = told ? told.film.at : 0;
    const rite = told
      ? { ...told, film: { at: born, ms: score.lengthMs }, length: born + score.lengthMs }
      : { events: [{ type: 'birth:complete', at: 0, trueName: being.trueName }], film: { at: 0, ms: score.lengthMs }, length: score.lengthMs };
    return { rite, being, score, kept: Boolean(told) };
  } catch {
    return null;
  }
};
