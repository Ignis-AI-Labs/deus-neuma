const cleanupStates = new WeakMap();

export const acquiredImmutableStaging = (authority) => Object.freeze({
  ok: true,
  authority,
});

export const failedImmutableStaging = (errorCode, cleanupAuthority = null) => Object.freeze({
  ok: false,
  errorCode,
  ...(cleanupAuthority === null ? {} : { cleanupAuthority }),
});

export const createImmutableStagingCleanupAuthority = (operation, retry) => {
  if (typeof retry !== 'function') {
    throw new Error('immutable staging cleanup retry is invalid');
  }
  const authority = Object.freeze({
    kind: 'refinement-immutable-cleanup-authority-v1',
  });
  cleanupStates.set(authority, {
    operation,
    retry,
    phase: 'cleanup-failed',
    promise: null,
  });
  return authority;
};

export const retryImmutableStagingCleanup = async (cleanupAuthority, operation) => {
  const state = cleanupStates.get(cleanupAuthority);
  if (!state || operation !== state.operation) {
    throw new Error('immutable file-set cleanup authority is invalid');
  }
  if (state.phase === 'closed') return Object.freeze({ ok: true, closed: false });
  if (state.promise) return state.promise;
  state.phase = 'closing';
  state.promise = Promise.resolve().then(state.retry).then(
    () => {
      state.phase = 'closed';
      cleanupStates.delete(cleanupAuthority);
      return Object.freeze({ ok: true, closed: true });
    },
    () => {
      state.phase = 'cleanup-failed';
      return failedImmutableStaging(
        'REFINEMENT_IMMUTABLE_STAGING_CLEANUP_FAILED',
        cleanupAuthority,
      );
    },
  ).finally(() => { state.promise = null; });
  return state.promise;
};
