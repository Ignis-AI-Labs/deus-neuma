import { modelSuggestionsFor } from './provider-probe.js';

/** Pure — live account choices replace static suggestions for a witness. */
export const witnessModelOptions = (entry, discovered) => {
  const live = discovered.filter((model) => model?._live === true);
  return Object.freeze({
    catalogSource: live.length ? 'live' : 'fallback',
    models: modelSuggestionsFor(live.length ? null : entry, live.length ? live : discovered),
  });
};
