// capacity-view.js — pure helpers: say what the SUBSTRATE AS CONFIGURED can
// do, never what the rig might do in the abstract.
//
// The capacity ceiling is a property of rig + model + settings. A scan taken
// on one model says nothing about another, so the banner compares the scan's
// recorded model against the model loaded RIGHT NOW (GET /capacity `current`)
// and refuses to present a stale number as if it still applied. Mirrors the
// backend's resolveTeamCapacity staleness rule the way trial-view mirrors the
// round-robin — the server stays the authority at run time.

// pure — a loaded context length for humans: 131072 → "128K CTX".
export const fmtCtx = (n) => {
  if (!Number.isInteger(n) || n <= 0) return null;
  return n >= 1024 ? `${Math.round(n / 1024)}K CTX` : `${n} CTX`;
};

/**
 * The TEAMS header banner line, from GET /capacity's response.
 * @param {?{latest: ?Object, current: ?Object, measurable?: boolean}} capacity
 * @returns {{ line: string, stale: boolean }}
 */
// pure
export const capacityBanner = (capacity) => {
  if (!capacity) {
    return { line: 'CAPACITY UNKNOWN — THE PLATFORM DID NOT ANSWER', stale: false };
  }
  const { latest, current, measurable } = capacity;
  const model = current?.model ? String(current.model).toUpperCase() : null;
  const ctx = fmtCtx(current?.contextWindow);
  const head = model ? `${model}${ctx ? ` · ${ctx}` : ''}` : null;

  if (measurable === false) {
    return { line: `${head ? `${head} — ` : ''}REMOTE PROVIDER · CAPACITY NOT MEASURABLE`, stale: false };
  }

  const ceiling = Number.isInteger(latest?.ceiling) && latest.ceiling >= 1 ? latest.ceiling : null;
  if (!ceiling) {
    return {
      line: head
        ? `${head} — CAPACITY NOT MEASURED · RUN A SCAN IN RECORD`
        : 'CAPACITY NOT MEASURED — RUN A SCAN IN RECORD',
      stale: false,
    };
  }

  const scanned = latest?.substrate?.model ? String(latest.substrate.model).toUpperCase() : null;
  if (model && scanned && scanned !== model) {
    return {
      line: `${head} — CEILING ${ceiling} WAS MEASURED ON ${scanned} · RE-SCAN IN RECORD`,
      stale: true,
    };
  }

  // No loaded-model identity to compare (provider quiet, or a pre-model scan):
  // the number is presented, but tied to the model that earned it when known.
  if (!model) {
    return {
      line: scanned
        ? `${scanned} — RUNS UP TO ${ceiling} IN PARALLEL (MEASURED)`
        : `THIS RIG RUNS UP TO ${ceiling} IN PARALLEL`,
      stale: false,
    };
  }
  return { line: `${head} — RUNS UP TO ${ceiling} IN PARALLEL (MEASURED)`, stale: false };
};
