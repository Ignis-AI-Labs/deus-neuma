import { refinementSha256 } from '../../core/refinement/training-contract.js';

const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{7,64}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const GPU_UUID = /^GPU-[A-F0-9-]{8,80}$/u;

export const SERVING_LAUNCH_REFUSAL = Object.freeze({
  NO_ACTIVE_LAUNCH: 'NO_ACTIVE_SUPERVISED_LAUNCH',
  ROUTE_MISMATCH: 'SUPERVISED_LAUNCH_ROUTE_MISMATCH',
  INVALID_EXPECTED: 'INVALID_EXPECTED_SERVING_LAUNCH',
  IDENTITY_MISMATCH: 'SUPERVISED_LAUNCH_IDENTITY_MISMATCH',
  UNREACHABLE: 'SUPERVISED_LAUNCH_UNREACHABLE',
  INTEGRITY_FAILED: 'SUPERVISED_LAUNCH_INTEGRITY_FAILED',
  CHANGED: 'SUPERVISED_LAUNCH_CHANGED',
  // The claimed-server contract (#506): a claim that never published its
  // spawner-witnessed authority (a pre-contract boot) cannot attest artifacts.
  AUTHORITY_UNAVAILABLE: 'SERVED_CLAIM_AUTHORITY_UNAVAILABLE',
});

const refusal = (code) => Object.freeze({ ok: false, code });
const success = (authority) => Object.freeze({
  ok: true,
  authority,
  authoritySha256: refinementSha256(authority),
});

export const routeIdentity = (route) => {  if (!route || route.provider !== 'llama-server'
    || typeof route.model !== 'string' || !route.model.trim()
    || route.model !== route.model.trim() || route.model.length > 256) {
    throw new Error('serving route identity is invalid');
  }
  const endpoint = /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{0,4})\/?$/u
    .exec(route.endpoint);
  const port = Number(endpoint?.[1]);
  if (!endpoint || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('serving route endpoint is invalid');
  }
  return Object.freeze({
    provider: 'llama-server',
    host: '127.0.0.1',
    port,
    model: route.model,
  });
};

export const servingRouteIdentitySha256 = (route) => refinementSha256(routeIdentity(route));

const authorityAdapters = (adapters) => {
  if (!Array.isArray(adapters) || adapters.length > 64) {
    throw new Error('serving launch adapter authority is invalid');
  }
  const fields = [
    'neumaId',
    'adapterId',
    'artifactSha256',
    'artifactBytes',
    'scale',
    'authorizationSha256',
    'publicationTransactionSha256',
    'registryGeneration',
    'registryAppendRevision',
    'registrySha256',
    'registryCurrentSelectionSha256',
    'operatorDecisionSha256',
  ];
  const projected = adapters.map((adapter) => {
    if (!adapter || Object.keys(adapter).some((field) => !fields.includes(field))
      || !SAFE_ID.test(String(adapter.neumaId || ''))
      || !SAFE_ID.test(String(adapter.adapterId || ''))
      || !Number.isSafeInteger(adapter.artifactBytes) || adapter.artifactBytes < 1
      || !Number.isFinite(adapter.scale) || adapter.scale < 0 || adapter.scale > 1
      || !Number.isSafeInteger(adapter.registryGeneration) || adapter.registryGeneration < 1
      || !Number.isSafeInteger(adapter.registryAppendRevision) || adapter.registryAppendRevision < 1) {
      throw new Error('serving launch adapter identity is invalid');
    }
    for (const field of [
      'artifactSha256',
      'authorizationSha256',
      'publicationTransactionSha256',
      'registrySha256',
      'registryCurrentSelectionSha256',
      'operatorDecisionSha256',
    ]) {
      if (!SHA256.test(String(adapter[field] || ''))) {
        throw new Error(`serving launch adapter ${field} is invalid`);
      }
    }
    return Object.freeze(Object.fromEntries(fields.map((field) => [field, adapter[field]])));
  });
  const identities = projected.map(({ neumaId, adapterId }) => `${neumaId}\0${adapterId}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error('serving launch adapter identities must be unique');
  }
  return Object.freeze(projected);
};

/** Build the exact public, path-free authority for one live process generation. Pure. */
export const servingLaunchAuthority = ({
  launchInstanceSha256,
  processIdentitySha256,
  launchConfigurationSha256,
  serverExecutableSha256,
  routeIdentitySha256 = null,
  servingModel,
  servingArtifactSha256,
  servingArtifactBytes,
  lineageConfigSha256 = null,
  lineageConfigSourceCommit = null,
  lineageConfigSourceMode = null,
  lineageConfigObjectId = null,
  lineageConfigSourceIdentitySha256 = null,
  lineageConfigSourceCustodySha256 = null,
  gpuUuid,
  gpuBindingSha256,
  adapters,
}) => {
  for (const [field, digest] of Object.entries({
    launchInstanceSha256,
    processIdentitySha256,
    launchConfigurationSha256,
    serverExecutableSha256,
    servingArtifactSha256,
    gpuBindingSha256,
  })) {
    if (!SHA256.test(String(digest || ''))) throw new Error(`${field} must be sha256`);
  }
  if (!Number.isSafeInteger(servingArtifactBytes) || servingArtifactBytes < 1
    || !GPU_UUID.test(String(gpuUuid || ''))) {
    throw new Error('serving launch artifact or GPU identity is invalid');
  }
  const lineageFields = {
    lineageConfigSha256,
    lineageConfigSourceCommit,
    lineageConfigSourceMode,
    lineageConfigObjectId,
    lineageConfigSourceIdentitySha256,
    lineageConfigSourceCustodySha256,
  };
  // A REFINED serving names its lineage id and proves the lineage evidence
  // chain; a BASE-ONLY serving has none — its identity is the artifact hash
  // itself, every lineage field is null, and it carries no route pin (#506
  // claimed-server contract: the benchmark's base-weight serving attests on
  // port + artifact, never on an alias).
  if (servingModel === null) {
    if (routeIdentitySha256 !== null) throw new Error('a base-only serving carries no route identity');
    for (const [field, value] of Object.entries(lineageFields)) {
      if (value !== null) throw new Error(`${field} must be null on a base-only serving`);
    }
  } else {
    if (typeof servingModel !== 'string' || !servingModel.trim()
      || servingModel !== servingModel.trim() || servingModel.length > 256
      || !SHA256.test(String(routeIdentitySha256 || ''))
      || !SHA256.test(String(lineageConfigSha256 || ''))
      || !SHA256.test(String(lineageConfigSourceIdentitySha256 || ''))
      || !REVISION.test(String(lineageConfigSourceCommit || ''))
      || lineageConfigSourceMode !== '100644'
      || !OBJECT_ID.test(String(lineageConfigObjectId || ''))) {
      throw new Error('serving launch model, route, or lineage identity is invalid');
    }
  }
  // Custody evidence rides when a source provides it — no producer emits it
  // today, so null is the honest standing value, never a required field.
  if (lineageConfigSourceCustodySha256 !== null
    && !SHA256.test(String(lineageConfigSourceCustodySha256))) {
    throw new Error('lineageConfigSourceCustodySha256 must be sha256 when present');
  }
  const projectedAdapters = authorityAdapters(adapters);
  return Object.freeze({
    schemaVersion: 2,
    launchInstanceSha256,
    processIdentitySha256,
    launchConfigurationSha256,
    serverExecutableSha256,
    routeIdentitySha256,
    servingModel,
    servingArtifactSha256,
    servingArtifactBytes,
    ...lineageFields,
    gpuUuid,
    gpuBindingSha256,
    adapters: projectedAdapters,
    adapterSetSha256: refinementSha256(projectedAdapters),
  });
};

export const expectedMatches = (authority, expected) => {
  if (expected == null) return true;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  const allowed = new Set([
    'servingModel', 'servingArtifactSha256', 'adapterArtifactSha256',
    'adapterScale', 'adapterSetSha256',
  ]);
  if (Object.keys(expected).some((field) => !allowed.has(field))
    || !SHA256.test(String(expected.servingArtifactSha256 || ''))
    || expected.servingArtifactSha256 !== authority.servingArtifactSha256) {
    return false;
  }
  // A base-only serving's identity IS the artifact hash — expected pins that
  // and names no serving model. A refined serving must match its lineage id.
  if (authority.servingModel === null
    ? expected.servingModel != null
    : expected.servingModel !== authority.servingModel) {
    return false;
  }
  if (expected.adapterSetSha256 != null
    && expected.adapterSetSha256 !== authority.adapterSetSha256) return false;
  if (expected.adapterArtifactSha256 == null) return expected.adapterScale == null;
  if (!SHA256.test(String(expected.adapterArtifactSha256))
    || (expected.adapterScale != null && (!Number.isFinite(expected.adapterScale)
      || expected.adapterScale < 0 || expected.adapterScale > 1))) return false;
  return authority.adapters.filter(({ artifactSha256, scale }) =>
    artifactSha256 === expected.adapterArtifactSha256
      && (expected.adapterScale == null || scale === expected.adapterScale)).length === 1;
};

/** Attest one caller route against supervisor-owned process and held-handle state. */
export const attestServingLaunch = async ({
  route,
  expected = null,
  launch,
  verifyLaunch,
  ownsLaunch,
  routeMatchesLaunch,
  isReachable,
}) => {
  if (!launch || !ownsLaunch()) return refusal(SERVING_LAUNCH_REFUSAL.NO_ACTIVE_LAUNCH);
  if (!routeMatchesLaunch() || route?.model !== launch.servingModel) {
    return refusal(SERVING_LAUNCH_REFUSAL.ROUTE_MISMATCH);
  }
  let projected;
  try {
    projected = servingLaunchAuthority({
      ...launch,
      routeIdentitySha256: servingRouteIdentitySha256(route),
    });
  } catch {
    return refusal(SERVING_LAUNCH_REFUSAL.IDENTITY_MISMATCH);
  }
  if (!expectedMatches(projected, expected)) {
    return refusal(SERVING_LAUNCH_REFUSAL.INVALID_EXPECTED);
  }
  try {
    if (typeof verifyLaunch !== 'function') throw new Error('launch verifier is unavailable');
    await verifyLaunch();
  } catch {
    return refusal(SERVING_LAUNCH_REFUSAL.INTEGRITY_FAILED);
  }
  let reachable;
  try { reachable = await isReachable(); } catch { reachable = false; }
  if (!reachable) return refusal(SERVING_LAUNCH_REFUSAL.UNREACHABLE);
  if (!ownsLaunch()) return refusal(SERVING_LAUNCH_REFUSAL.CHANGED);
  try {
    await verifyLaunch();
  } catch {
    return refusal(SERVING_LAUNCH_REFUSAL.INTEGRITY_FAILED);
  }
  return ownsLaunch()
    ? success(projected)
    : refusal(SERVING_LAUNCH_REFUSAL.CHANGED);
};
