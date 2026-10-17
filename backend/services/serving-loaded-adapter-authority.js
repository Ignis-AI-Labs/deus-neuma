import { refinementSha256 } from '../../core/refinement/training-contract.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const authorities = new WeakMap();
let activeAuthority = null;

const assertLaunchInstance = (value) => {
  if (!SHA256.test(String(value || ''))) {
    throw new Error('loaded adapter launch instance is invalid');
  }
  return value;
};

const expectedEntries = (adapters, childFds) => {
  if (!Array.isArray(adapters) || !Array.isArray(childFds)
    || adapters.length !== childFds.length || adapters.length > 64) {
    throw new Error('loaded adapter expectation is invalid');
  }
  const entries = adapters.map((adapter, index) => {
    const artifactSha256 = adapter?.artifactSha256;
    const childFd = childFds[index];
    if (!SHA256.test(String(artifactSha256 || ''))
      || !Number.isSafeInteger(childFd) || childFd < 4 || childFd > 68) {
      throw new Error('loaded adapter expectation contains an invalid entry');
    }
    return Object.freeze({
      artifactSha256,
      childPath: `/proc/self/fd/${childFd}`,
    });
  });
  if (new Set(entries.map(({ artifactSha256 }) => artifactSha256)).size !== entries.length
    || new Set(entries.map(({ childPath }) => childPath)).size !== entries.length) {
    throw new Error('loaded adapter expectation contains duplicate identity');
  }
  return Object.freeze(entries);
};

const observedEntries = (value, expected) => {
  if (!Array.isArray(value) || value.length !== expected.length || value.length > 64) {
    throw new Error('live loaded adapter cardinality differs from launch authority');
  }
  const byPath = new Map();
  for (const adapter of value) {
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)
      || !Number.isSafeInteger(adapter.id) || adapter.id < 0
      || typeof adapter.path !== 'string' || !adapter.path
      || byPath.has(adapter.path)) {
      throw new Error('live loaded adapter probe is malformed');
    }
    byPath.set(adapter.path, adapter.id);
  }
  if (new Set(byPath.values()).size !== byPath.size) {
    throw new Error('live loaded adapter probe contains duplicate IDs');
  }
  return Object.freeze(expected.map(({ artifactSha256, childPath }) => {
    const serverAdapterId = byPath.get(childPath);
    if (!Number.isSafeInteger(serverAdapterId)) {
      throw new Error('live loaded adapter paths differ from inherited launch descriptors');
    }
    return Object.freeze({ artifactSha256, serverAdapterId });
  }));
};

/** Bind inherited adapter descriptor order to one unpredictable process instance. */
export const createServingLoadedAdapterAuthority = ({
  launchInstanceSha256,
  adapters,
  childFds,
}) => {
  const launchInstance = assertLaunchInstance(launchInstanceSha256);
  const expected = expectedEntries(adapters, childFds);
  const owner = Object.freeze({ kind: 'serving-loaded-adapter-authority-v1' });
  authorities.set(owner, Object.freeze({ launchInstance, expected }));
  return owner;
};

/** Publish one live process's opaque mapping as the only request-time adapter authority. */
export const activateServingLoadedAdapterAuthority = (authority) => {
  if (!authorities.has(authority)) {
    throw new Error('loaded adapter authority is invalid');
  }
  activeAuthority = authority;
  return true;
};

/** Invalidate the request-time mapping when its owning process has exited. */
export const releaseServingLoadedAdapterAuthority = (authority) => {
  if (activeAuthority !== authority) return false;
  activeAuthority = null;
  return true;
};

/** Validate a live server probe and return only the path-free digest-to-ID projection. */
export const verifyServingLoadedAdapters = (
  authority,
  launchInstanceSha256,
  observed,
) => {
  const state = authorities.get(authority);
  if (!state || state.launchInstance !== assertLaunchInstance(launchInstanceSha256)) {
    throw new Error('loaded adapter authority does not own this process instance');
  }
  const adapters = observedEntries(observed, state.expected);
  return Object.freeze({
    schemaVersion: 1,
    launchInstanceSha256: state.launchInstance,
    adapters,
    adapterSetSha256: refinementSha256(adapters.map(({ artifactSha256 }) => artifactSha256)),
    loadedAdapterMapSha256: refinementSha256({
      launchInstanceSha256: state.launchInstance,
      adapters,
    }),
  });
};

/** Resolve the active path-free digest-to-server-ID map from one live probe. */
export const projectActiveServingLoadedAdapters = (observed) => {
  const authority = activeAuthority;
  const state = authorities.get(authority);
  if (!state) throw new Error('no supervised loaded adapter authority is active');
  return verifyServingLoadedAdapters(authority, state.launchInstance, observed);
};
