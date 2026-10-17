// pure — the ceremony's render-progress line. `done` counts only dimensions
// that have REALLY finished; `inFlight` is how many renders are genuinely on
// the conduit right now — shown so a watching witness SEES the parallelism
// instead of inferring it from how fast a completion counter ticks.
export const openingLabel = (opening) => (opening
  ? `RENDERED ${opening.done} OF ${opening.total}${
    opening.inFlight > 0 ? ` · ${opening.inFlight} IN FLIGHT` : ''}`
  : 'THE RENDER IS BEGINNING…');
