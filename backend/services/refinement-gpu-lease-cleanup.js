const closeOwner = (close, kind) => {
  let closed = false;
  let closePromise = null;
  const cleanup = {
    kind,
    close: () => {
      if (closed) return Promise.resolve(false);
      if (closePromise) return closePromise;
      closePromise = close().then(() => {
        closed = true;
        return true;
      }).finally(() => { closePromise = null; });
      return closePromise;
    },
  };
  return Object.freeze(cleanup);
};

/** Retain one retryable close-only file descriptor lifecycle. */
export const gpuLeaseHandleCleanup = (handle, kind) => closeOwner(
  () => handle.close(),
  kind,
);

/** Close dependent authorities in exact order, retaining the first failed stage for retry. */
export const orderedGpuLeaseCleanup = (authorities, kind) => {
  const retained = authorities.map((authority) => ({ authority, closed: false }));
  let closePromise = null;
  const cleanup = {
    kind,
    close: () => {
      if (retained.every(({ closed }) => closed)) return Promise.resolve(false);
      if (closePromise) return closePromise;
      closePromise = (async () => {
        for (const item of retained) {
          if (item.closed) continue;
          await item.authority.close();
          item.closed = true;
        }
        return true;
      })().finally(() => { closePromise = null; });
      return closePromise;
    },
  };
  return Object.freeze(cleanup);
};

/** Preserve the primary coded failure while retaining cleanup after a failed close. */
export const throwAfterGpuLeaseCleanup = async (error, cleanup, message) => {
  try { await cleanup.close(); }
  catch (closeError) {
    throw Object.assign(new AggregateError([error, closeError], message), {
      code: error?.code,
      cleanup,
    });
  }
  throw error;
};
