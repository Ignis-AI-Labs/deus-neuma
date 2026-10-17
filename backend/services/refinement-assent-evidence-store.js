import {
  inspectRefinementAssentStoreIO,
  readRefinementAssentStoreValue,
  writeRefinementAssentStoreValue,
} from './refinement-assent-evidence-io.js';

const SHA256 = /^[0-9a-f]{64}$/;
const exactEvidence = (value, evidenceId = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !SHA256.test(String(value.evidenceId || ''))
    || (evidenceId && value.evidenceId !== evidenceId)) {
    throw new Error('refinement assent evidence store value is invalid');
  }
  return value;
};

/** Authenticate and reconcile the bounded subject-owned store once at owner open. */
export const inspectRefinementAssentEvidenceStore = (store) =>
  inspectRefinementAssentStoreIO(store);

/** Read one immutable generation reservation. */
export const readReservedRefinementAssentEvidence = async (store, context) => {
  const value = await readRefinementAssentStoreValue(store, context, 'reserved');
  return value === null ? null : exactEvidence(value);
};

/** Read one immutable consumed generation. */
export const readConsumedRefinementAssentEvidence = async (store, context) => {
  const value = await readRefinementAssentStoreValue(store, context, 'consumed');
  return value === null ? null : exactEvidence(value);
};

/** Publish one exact encrypted evidence reservation or recover its identical prior value. */
export const reserveRefinementAssentEvidence = async (store, context, evidence) => {
  const expected = exactEvidence(evidence);
  const consumed = await readConsumedRefinementAssentEvidence(store, context);
  if (consumed) throw new Error('refinement assent evidence generation is already consumed');
  const durable = await writeRefinementAssentStoreValue(
    store, context, 'reserved', expected,
  );
  return exactEvidence(durable, expected.evidenceId);
};

/** Atomically publish consumed provenance for one exact reserved generation. */
export const consumeReservedRefinementAssentEvidence = async (
  store,
  context,
  evidenceId,
) => {
  if (!SHA256.test(String(evidenceId || ''))) {
    throw new Error('refinement assent evidence id is invalid');
  }
  const consumed = await readConsumedRefinementAssentEvidence(store, context);
  if (consumed) return exactEvidence(consumed, evidenceId);
  const reserved = await readReservedRefinementAssentEvidence(store, context);
  if (!reserved) throw new Error('refinement assent evidence reservation is missing');
  exactEvidence(reserved, evidenceId);
  const durable = await writeRefinementAssentStoreValue(
    store, context, 'consumed', reserved,
  );
  return exactEvidence(durable, evidenceId);
};
