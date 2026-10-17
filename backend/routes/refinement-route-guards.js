/**
 * What a refinement request must satisfy before any handler runs: bounded route
 * ids, proven neuma ownership, and an exact caller-supplied field set.
 */
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import {
  assertRefinementAdapterId,
  assertRefinementCeremonyId,
  assertRefinementSubjectId,
} from '../services/refinement-registry-authority.js';

export const SHA256 = /^[0-9a-f]{64}$/;
export const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const boundedRouteId = (assertId, label) => (req, res, next, value) => {
  try {
    assertId(value);
    next();
  } catch {
    res.status(400).json({ error: `Invalid ${label} format` });
  }
};
/** Bind every bounded refinement route id on one router. Impure — mutates the router. */
export const bindRefinementRouteParams = (router) => {
  router.param('neumaId', boundedRouteId(assertRefinementSubjectId, 'neumaId'));
  router.param('ceremonyId', boundedRouteId(assertRefinementCeremonyId, 'ceremonyId'));
  router.param('adapterId', boundedRouteId(assertRefinementAdapterId, 'adapterId'));
};
// Fail-closed by arity: refinement routes can never reach assertNeumaOwner's
// allowMissing escape hatch, which belongs to workspace claim paths alone.
export const verifyOwnership = (req, res, neumaId) => assertNeumaOwner(req, res, neumaId);
/** Does the body carry exactly these own data fields and nothing else? Pure. */
export const hasExactRequestFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return keys.length === fields.length
    && keys.every((field) => typeof field === 'string'
      && fields.includes(field)
      && Object.hasOwn(descriptors[field], 'value'))
    && fields.every((field) => Object.hasOwn(descriptors, field));
};
