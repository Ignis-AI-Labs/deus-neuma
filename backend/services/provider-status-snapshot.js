/** One five-second status reading per active provider configuration and substrate rest state. */
import { getConfig, testConnection, getActiveModel } from './llm-provider.js';
import { deliberateStandby } from './substrate-idle.js';

const STATUS_SNAPSHOT_TTL_MS = 5000;
let snapshot = null;
let inFlight = null;

// impure (reads the idle monitor's state) — every config field, credentials
// included, never logged; and the substrate's deliberate rest: an idle-unload
// or a wake changes what a probe would answer, so a reading taken before it
// is never served after it.
const readingKey = (config) => JSON.stringify([config, deliberateStandby().since]);

/** impure — share probes, discarding results from superseded configurations. */
export const providerStatusSnapshot = async () => {
  const config = getConfig();
  const key = readingKey(config);
  if (snapshot?.key === key && Date.now() - snapshot.at < STATUS_SNAPSHOT_TTL_MS) {
    return snapshot.value;
  }
  if (inFlight?.key !== key) {
    const promise = (async () => {
      const connected = await testConnection();
      const activeModel = connected ? await getActiveModel() : null;
      return { config, connected, activeModel };
    })();
    inFlight = { key, promise };
  }
  const pending = inFlight;
  try {
    const value = await pending.promise;
    if (readingKey(getConfig()) !== key) return providerStatusSnapshot();
    if (inFlight === pending) snapshot = { key, at: Date.now(), value };
    return value;
  } finally {
    if (inFlight === pending) inFlight = null;
  }
};
