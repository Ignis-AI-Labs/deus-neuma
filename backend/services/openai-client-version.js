import { createLogger } from './logger.js';

const log = createLogger('OpenAIClientVersion');
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RELEASE_URL = 'https://registry.npmjs.org/@openai/codex/latest';
let version = '0.153.0';
let checkedAt = 0;
let pending = null;

/** Pure — accept only stable numeric releases and never downgrade compatibility. */
export const newerClientVersion = (current, candidate) => {
  if (typeof candidate !== 'string' || !/^\d+\.\d+\.\d+$/.test(candidate)) return current;
  const before = current.split('.').map(Number);
  const after = candidate.split('.').map(Number);
  const difference = after.findIndex((part, index) => part !== before[index]);
  return difference >= 0 && after[difference] > before[difference] ? candidate : current;
};

/** impure — an explicit operator override remains authoritative. */
export const currentOpenAIClientVersion = () =>
  process.env.NEUMA_OPENAI_CLIENT_VERSION?.trim() || version;

/** impure — release metadata only, no credential headers or downloaded code. */
export const refreshOpenAIClientVersion = async () => {
  if (process.env.NEUMA_OPENAI_CLIENT_VERSION?.trim()) return currentOpenAIClientVersion();
  if (pending) return pending;
  if (Date.now() - checkedAt < REFRESH_MS) return version;
  pending = (async () => {
    try {
      const response = await fetch(RELEASE_URL, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) throw new Error(`release metadata HTTP ${response.status}`);
      const release = await response.json();
      if (release.name !== '@openai/codex' || !/^\d+\.\d+\.\d+$/.test(release.version)) {
        throw new Error('invalid stable release metadata');
      }
      version = newerClientVersion(version, release.version);
    } catch (error) {
      log.warn('Client release refresh unavailable; retaining known compatibility version', { version, error: error.message });
    } finally {
      checkedAt = Date.now();
      pending = null;
    }
    return currentOpenAIClientVersion();
  })();
  return pending;
};
