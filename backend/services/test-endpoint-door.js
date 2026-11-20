// Loopback stand-ins are test fixtures, never production configuration.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A named endpoint override, honored only for a credential-free loopback URL under NODE_ENV=test. Pure. */
export const testEndpoint = (env, name, fallback, protocols = ['http:']) => {
  if (env.NODE_ENV !== 'test' || typeof env[name] !== 'string' || !env[name].trim()) return fallback;
  try {
    const url = new URL(env[name]);
    return protocols.includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password
      ? env[name]
      : fallback;
  } catch {
    return fallback;
  }
};
