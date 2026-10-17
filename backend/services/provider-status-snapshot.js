/** One five-second status reading per active provider configuration. */
import { getConfig, testConnection, getActiveModel } from './llm-provider.js';

const STATUS_SNAPSHOT_TTL_MS = 5000;
let snapshot = null;
let inFlight = null;

// Pure — include every config field, including credentials, without logging it.
const configKey = (config) => JSON.stringify(config);

/** impure — share probes, discarding results from superseded configurations. */
export const providerStatusSnapshot = async () => {
  const config = getConfig();
  const key = configKey(config);
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
    if (configKey(getConfig()) !== key) return providerStatusSnapshot();
    if (inFlight === pending) snapshot = { key, at: Date.now(), value };
    return value;
  } finally {
    if (inFlight === pending) inFlight = null;
  }
};
