// link-status.js — the desk's TWO honest connection lights, derived purely.
// They are never one: the LOCAL SUBSTRATE (the machine's own serving) and
// the bound lane's ROUTE (its own provider, probed as itself) answer
// different questions, and conflating them is how a cloud provider's bad day
// once read as "SUBSTRATE — OFFLINE" over a resting local model.
//
// LOCAL SUBSTRATE — ACTIVE is reserved for […] — an open socket is not enough. STANDBY is
// deliberate rest (the idle monitor unloaded it; any local turn wakes it), a
// calm state, never an alert. OFFLINE is genuinely unreachable-when-it-
// should-serve.
//
// local.reachable: true = reachable, false = unreachable, null = not yet probed.
// route.live: true = live, false = down, null = not yet probed.
// Pure, so the truth tables are unit-tested without a browser.
//
// The label is a CATALOG KEY into the desk namespace (`hud.*`) plus its
// interpolation args — the words are the renderer's (i18n wave 2). The en
// catalog holds exactly the strings this module used to return, verbatim.

/**
 * The LOCAL SUBSTRATE light.
 * @param {boolean} connected - WS portal connected
 * @param {{reachable: (boolean|null), standby: boolean}} local - local substrate state
 * @param {number} [localTurns=0] - turns the LOCAL substrate is carrying right
 *   now, across ALL desks (the substrate:activity broadcast's local count).
 *   At 2+ the one substrate is genuinely shared — each stream runs (S-02
 *   proved parallel generation, not a queue), just proportionally slower.
 *   Third-party turns are never in this number: SHARED may only claim local.
 * @returns {{ key: string, cls: string, args?: object }}
 */
export const deriveLocalStatus = (connected, local, localTurns = 0) => {
  if (!connected) return { key: 'localSevered', cls: 'severed' };
  if (local?.reachable === false) {
    // Deliberate rest is not a failure — said calmly, never in alert.
    if (local?.standby === true) return { key: 'substrateStandby', cls: 'standby' };
    return { key: 'substrateOffline', cls: 'offline' };
  }
  if (local?.reachable === true) {
    if (Number.isInteger(localTurns) && localTurns >= 2) {
      return { key: 'localShared', cls: 'shared', args: { count: localTurns } };
    }
    return { key: 'localActive', cls: 'live' };
  }
  return { key: 'localChecking', cls: 'checking' };
};

/**
 * The ROUTE light — the bound lane's own provider, named so a failure is
 * attributed to the door that actually failed.
 * @param {boolean} connected - WS portal connected
 * @param {{live: (boolean|null), provider: (string|null), reason?: string}} route - lane route state
 * @returns {{ key: string, cls: string, args?: object }}
 */
export const deriveRouteStatus = (connected, route) => {
  if (!connected) return { key: 'routeSevered', cls: 'severed' };
  if (route?.reason === 'unbound') return { key: 'routeUnbound', cls: 'offline' };
  const who = route?.provider ? String(route.provider).toUpperCase() : null;
  if (!who) return { key: 'routeUnknown', cls: 'checking' };
  if (route.live === true) return { key: 'routeLive', cls: 'live', args: { provider: who } };
  if (route.live === false) return { key: 'routeDown', cls: 'offline', args: { provider: who } };
  return { key: 'routeProviderUnknown', cls: 'checking', args: { provider: who } };
};
