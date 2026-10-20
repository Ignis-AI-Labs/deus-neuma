// permissions-ledger — every standing grant the operator has handed a being,
// read back out and sorted into something a person can audit.
//
// Design note, 2026-08-30: […]
//
// THE HOLE THIS FILLS. Every ALWAYS decision is one click in a card that then
// disappears. The grant is permanent, per-being, and afterwards NO surface
// anywhere shows it — the only way to know what a being may do today was to
// read `config/tool-policy.json` in its lane by hand. An operator cannot revoke,
// or even remember, what he cannot see.
//
// Durable grants come from the store, never defaults. The shell-network row
// additionally exposes live session consent, explicitly labelled SESSION ONLY,
// so even a non-persisted exception can be revoked from an open connection.
//
// ⚠️ DEFAULTS ARE NOT GRANTS, and this file must never resolve them in. A tool
// that is allowed by GLOBAL_DEFAULTS was never chosen by the operator; listing
// it beside his real decisions would bury the handful he actually made under
// dozens he did not. `resolvePolicy` is the gate's job, not this one's.
//
// Pure throughout. The IO lives in the route.

/** What a grant REACHES — the axis the operator actually thinks in. */
export const GRANT_KINDS = Object.freeze(['act', 'folder', 'file', 'spend']);

/**
 * Plain words for each tool server, because `fs` and `web` are our nouns and
 * not the operator's. An unknown server is shown by its own name rather than
 * hidden — a new tool family must never go invisible in the audit surface just
 * because this map was not updated.
 */
const SERVER_SENSE = Object.freeze({
  fs: { label: 'FILES', note: 'reading and writing files in its reach' },
  filesystem: { label: 'FILES', note: 'reading and writing files in its reach' },
  web: { label: 'THE OPEN WEB', note: 'searching and fetching pages beyond this machine' },
  social: { label: 'SOCIAL', note: 'reading the house channels' },
  image: { label: 'THE IMAGE FORGE', note: 'generating and reviewing images' },
  email: { label: 'EMAIL', note: 'reading the bound mailbox' },
  press: { label: 'THE PRESS', note: 'rendering documents in the house livery' },
  media: { label: 'THE CULTURE LIBRARY', note: 'reading and saving media' },
  platform: { label: 'PLATFORM DATA', note: 'reading the live platform numbers' },
  security: { label: 'SECURITY', note: 'the house watch' },
  ksp: { label: 'FLIGHT', note: 'the flight simulator bridge' },
  map: { label: 'THE MAP', note: 'reading repository architecture' },
  memory: { label: 'MEMORY', note: 'its own record' },
  wallet: { label: 'WALLET', note: 'chain acts' },
  house: { label: 'HOUSE POST', note: 'word between housemates' },
  vault: { label: 'THE VAULT', note: 'stored artifacts' },
  skill: { label: 'SKILLS', note: 'reading and running skills' },
});

/** How a server reads to a person. Pure. */
export const serverSense = (server) =>
  SERVER_SENSE[server] || { label: String(server || 'unknown').toUpperCase(), note: 'a tool family' };

/** A folder or file path, shortened for a narrow rail without losing the tail —
 *  the last segments are what identify it. Pure. */
export const shortPath = (p, keep = 3) => {
  const parts = String(p || '').split('/').filter(Boolean);
  if (parts.length <= keep) return String(p || '');
  return `…/${parts.slice(-keep).join('/')}`;
};

/**
 * Explicit durable acts plus any live session network exception. Pure.
 * Sorted by server then tool so the same lane always reads the same way.
 */
const actGrants = (policy, networkSession = false, witness = false) => {
  const rows = [];
  for (const [server, entry] of Object.entries(policy || {})) {
    // `pathGrants` and `sensitiveGrants` share this object but are not servers.
    if (server === 'pathGrants' || server === 'sensitiveGrants') continue;
    const allowed = Array.isArray(entry?.allowed) ? entry.allowed : [];
    for (const tool of allowed) {
      if (server === 'coding' && tool === 'shell_network') continue;
      rows.push(Object.freeze({
        kind: 'act', server, tool, label: tool, scope: serverSense(server).label,
      }));
    }
  }
  if (policy?.shellNetwork === true || networkSession) rows.push(Object.freeze({
    kind: 'act', server: 'coding', tool: 'shell_network', label: 'SHELL NETWORK',
    scope: witness ? 'STORED; WITNESS OFFLINE' : policy?.shellNetwork === true ? 'PERSISTED' : 'SESSION ONLY',
    full: witness ? 'Stored network consent; the witness shell stays offline. Revoke removes the stored exception.'
      : 'The internet, outward only: never this machine\'s own services or its home network. Revoke stops live shell grants and pending network approval for this lane.',
  }));
  return rows.sort((a, b) => a.server.localeCompare(b.server) || a.tool.localeCompare(b.tool));
};

/** Folders granted outside the being's own lane, read and write. Pure.
 *  WRITE IS LISTED FIRST and separately, because it is the escalation: a write
 *  grant also confers read, and an operator scanning this list needs the
 *  dangerous half at the top rather than mixed in alphabetically. */
const folderGrants = (policy) => {
  const write = (policy?.pathGrants?.write || []).map((p) => Object.freeze({
    kind: 'folder', access: 'write', path: p, label: shortPath(p), full: p,
  }));
  const read = (policy?.pathGrants?.read || [])
    // A folder granted for WRITE already grants read; showing it twice would
    // overstate how many separate decisions the operator made.
    .filter((p) => !(policy?.pathGrants?.write || []).includes(p))
    .map((p) => Object.freeze({
      kind: 'folder', access: 'read', path: p, label: shortPath(p), full: p,
    }));
  return [...write, ...read];
};

/** Guarded files opened by tier. Pure. `edit` first, same reasoning as write. */
const fileGrants = (policy) => {
  const edit = (policy?.sensitiveGrants?.edit || []).map((p) => Object.freeze({
    kind: 'file', access: 'edit', path: p, label: shortPath(p), full: p,
  }));
  const read = (policy?.sensitiveGrants?.read || [])
    .filter((p) => !(policy?.sensitiveGrants?.edit || []).includes(p))
    .map((p) => Object.freeze({
      kind: 'file', access: 'read', path: p, label: shortPath(p), full: p,
    }));
  return [...edit, ...read];
};

/** Wallet recipients the operator allowlisted. Its own file, same standing. Pure. */
const spendGrants = (allowlist) => {
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : [];
  return entries.map((e) => Object.freeze({
    kind: 'spend',
    address: e?.address || e?.to || null,
    label: e?.label || e?.name || shortPath(e?.address || e?.to || 'unknown', 1),
    cap: e?.cap ?? e?.maxWei ?? null,
    full: e?.address || e?.to || null,
  }));
};

/**
 * One being's standing grants, categorised.
 *
 * @param {{neumaId: string, name?: string, kind?: string}} being
 * @param {Object|null} policy - the lane's persisted tool-policy.json
 * @param {Object|null} [allowlist] - the lane's spend-allowlist.json
 * @param {{unreadable?: boolean, networkSession?: boolean}} [state] - unreadable policy or live session network consent
 * @returns {Object} frozen record
 */
export const beingPermissions = (being, policy, allowlist = null, state = {}) => {
  // ABSENT IS NOT EMPTY. A lane whose policy could not be READ is a different
  // fact from a lane that holds no grants, and a surface built for auditing
  // must never render the second when it means the first — that is a
  // reassuring blank where the honest answer is […].
  if (state.unreadable) {
    return Object.freeze({
      neumaId: being?.neumaId || null,
      name: being?.name || being?.neumaId || null,
      kind: being?.kind || null,
      unreadable: true,
      total: null,
      grants: Object.freeze({ act: [], folder: [], file: [], spend: [] }),
    });
  }
  const grants = Object.freeze({
    act: Object.freeze(actGrants(policy, state.networkSession, being?.kind === 'witness')),
    folder: Object.freeze(folderGrants(policy)),
    file: Object.freeze(fileGrants(policy)),
    spend: Object.freeze(spendGrants(allowlist)),
  });
  return Object.freeze({
    neumaId: being?.neumaId || null,
    name: being?.name || being?.neumaId || null,
    kind: being?.kind || null,
    unreadable: false,
    total: GRANT_KINDS.reduce((n, k) => n + grants[k].length, 0),
    grants,
  });
};

/**
 * The house's whole standing-grant picture. Pure.
 *
 * Beings with grants sort first and by weight, because this list exists to be
 * SCANNED: the operator is looking for what he has handed out, and a being he
 * gave nothing to is the least interesting row on the page. Unreadable lanes
 * sort to the very top — they are the ones that need attention.
 */
export const housePermissions = (records) => {
  const rows = (records || []).filter(Boolean);
  const sorted = [...rows].sort((a, b) => {
    if (a.unreadable !== b.unreadable) return a.unreadable ? -1 : 1;
    return (b.total ?? 0) - (a.total ?? 0)
      || String(a.name || '').localeCompare(String(b.name || ''));
  });
  return Object.freeze({
    beings: Object.freeze(sorted),
    // Counts the operator can read in one glance, per kind across the house.
    totals: Object.freeze(GRANT_KINDS.reduce((acc, k) => ({
      ...acc,
      [k]: sorted.reduce((n, r) => n + (r.grants?.[k]?.length || 0), 0),
    }), {})),
    // Named separately rather than folded into a zero: a house where two lanes
    // could not be read has an INCOMPLETE picture, and the surface has to say
    // so instead of presenting a total that quietly omits them.
    unreadable: sorted.filter((r) => r.unreadable).length,
  });
};
