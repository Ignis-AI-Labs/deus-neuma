// Save-restore around a process.env mutation, for tests that need to
// verify env-dependent behavior without leaking state to sibling tests.
//
// Must be async + await fn() so that when fn returns a Promise (the
// common case — every async test), the env is restored AFTER the
// async work completes, not after the promise is constructed. The
// earlier sync `return fn()` pattern was accidentally-correct only
// when the env was read synchronously before fn's first await; that
// is a RULE-0-validity footgun in a helper whose entire purpose is
// env save/restore.

export const withEnv = async (key, value, fn) => {
  const prev = process.env[key];
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
};
