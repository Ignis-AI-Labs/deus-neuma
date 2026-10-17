import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { assertBoundedPlainData } from '../../core/shared/plain-data-canonical.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const GPU_UUID = /^GPU-[A-F0-9-]{8,80}$/u;
const GPU_LEASE_FIELDS = Object.freeze([
  'cudaVisibleDevices', 'deviceDescriptorsSha256', 'expiresAt', 'generation',
  'gpuBindingSha256', 'gpuLeaseSha256', 'gpuUuid', 'issuedAt', 'jobSha256',
  'nvidiaVisibleDevices', 'schemaVersion', 'trainingPlanSha256',
]);

const canonicalInstant = (value) => {
  if (typeof value !== 'string') return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value
    ? instant.getTime()
    : null;
};

/** Canonicalize one server-reserved portable trainer GPU lease. Pure. */
export const refinementGpuLease = (value) => {
  assertBoundedPlainData(value, {
    field: 'trainer GPU lease',
    maxDepth: 2,
    maxNodes: 32,
    maxStringBytes: 512,
    maxKeyBytes: 64,
    maxOutputBytes: 8 * 1024,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== GPU_LEASE_FIELDS.join('\0')
    || value.schemaVersion !== 1 || !GPU_UUID.test(String(value.gpuUuid || ''))
    || value.cudaVisibleDevices !== value.gpuUuid
    || value.nvidiaVisibleDevices !== value.gpuUuid
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || canonicalInstant(value.issuedAt) === null
    || canonicalInstant(value.expiresAt) === null
    || canonicalInstant(value.expiresAt) <= canonicalInstant(value.issuedAt)) {
    throw new Error('trainer GPU lease shape is invalid');
  }
  for (const field of [
    'deviceDescriptorsSha256', 'gpuBindingSha256', 'gpuLeaseSha256',
    'jobSha256', 'trainingPlanSha256',
  ]) {
    if (!SHA256.test(String(value[field] || ''))) throw new Error(`${field} must be sha256`);
  }
  const projection = Object.freeze(Object.fromEntries(
    GPU_LEASE_FIELDS.map((field) => [field, value[field]]),
  ));
  const portable = Object.fromEntries(
    GPU_LEASE_FIELDS.filter((field) => field !== 'gpuLeaseSha256')
      .map((field) => [field, projection[field]]),
  );
  if (refinementSha256({
    kind: 'refinement-gpu-lease-v1',
    lease: portable,
  }) !== projection.gpuLeaseSha256) {
    throw new Error('trainer GPU lease digest mismatch');
  }
  return projection;
};

/** Validate a portable lease and optionally refuse an expired pre-spawn authority. Pure. */
export const validateRefinementGpuLease = (value, nowMs = null) => {
  const lease = refinementGpuLease(value);
  if (nowMs !== null && (!Number.isSafeInteger(nowMs) || nowMs < 0
    || canonicalInstant(lease.expiresAt) <= nowMs)) {
    throw new Error('trainer GPU lease is expired');
  }
  return lease;
};
