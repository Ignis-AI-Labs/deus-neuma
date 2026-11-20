// pure — one canonical, fixed-order AAD representation for workspace envelopes.
export const normalizeEnvelopeAad = (aad) => {
  if (!aad || typeof aad !== 'object' || Array.isArray(aad)
      || typeof aad.purpose !== 'string' || !aad.purpose
      || typeof aad.laneId !== 'string' || !aad.laneId
      || typeof aad.file !== 'string' || !aad.file
      || !Number.isSafeInteger(aad.seq) || aad.seq < 0) {
    throw new Error('workspace envelope AAD requires purpose, laneId, file and a nonnegative safe-integer seq');
  }
  return Object.freeze({ purpose: aad.purpose, laneId: aad.laneId, file: aad.file, seq: aad.seq });
};

export const canonicalEnvelopeAad = (aad) => JSON.stringify(normalizeEnvelopeAad(aad));
export const sameEnvelopeAad = (a, b) => canonicalEnvelopeAad(a) === canonicalEnvelopeAad(b);
