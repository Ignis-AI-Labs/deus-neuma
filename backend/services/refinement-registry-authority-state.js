import { assertRefinementProcessOperation } from './refinement-process-operation.js';

const states = new WeakMap();

/** Internal friend storage; registry authority objects never expose custody operations. */
export const retainCurrentRefinementRegistryState = (authority, state) => {
  if (!authority || typeof authority !== 'object' || !state || typeof state !== 'object') {
    throw new Error('current refinement registry state is invalid');
  }
  states.set(authority, Object.freeze(state));
  return authority;
};

export const resolveCurrentRefinementRegistryState = (authority, operation) => {
  const state = states.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperation(operation)) {
    throw Object.assign(new Error('current registry authority is invalid'), {
      code: 'REFINEMENT_REGISTRY_INVALID_AUTHORITY',
    });
  }
  state.operation.assertActive();
  return state;
};
