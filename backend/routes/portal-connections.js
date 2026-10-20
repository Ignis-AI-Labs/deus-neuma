// portal-connections.js — the portal's connection registry and its broadcasts:
// who is connected, what the ONE substrate carries (per-class turn truth), the
// machine's live sittings (tab counts), the storage-warning fan-out, and the
// lane-binding reset. Extracted from portal-routes.js (P8 decomposition,
// SIZE-033 plan) — bodies byte-identical.

import { clearShellNetwork } from '../services/shell-network-grants.js';
import { clearLaneRuntime } from './portal-binding-state.js';
import { isolatePortalForBirth } from '../../core/birth/ceremony-write.js';
// Active connections map
const connections = new Map();

// Substrate-activity truth (B-01a): every portal learns, the moment a turn
// starts or ends anywhere, how many turns the ONE substrate carries — per
// CLASS, never merged: `local` = the shared local substrate (neuma lanes),
// `remote` = third-party doors (witness lanes); a cloud turn never inflates
// the substrate's load. Bare counts only — nothing identity-shaped leaks. A
// WS event, not the health poll: poll latency cannot tell […] from "hung", the confusion the desk must never show.
// externalTurnConnections: turn-carriers OUTSIDE the portal map (the channel
// bridge's synthetic connections, C-01) — counted in the truth, never sent
// frames or heartbeats (their ws is a collector shim, not a desk).
const externalTurnConnections = new Set();

// impure — register an external turn source; returns its deregistration fn.
export const registerExternalTurnConnection = (connection) => {
  externalTurnConnections.add(connection);
  return () => externalTurnConnections.delete(connection);
};

// The live turn truth — one walk answers the desk's two lights AND the
// meditation gates (boundLaneIds: an open portal is a conversation in
// standing even when quiet). impure: walks the live maps, writes nothing.
export const localTurnSnapshot = () => {
  let local = 0;
  let remote = 0;
  const boundLaneIds = new Set();
  for (const c of [...connections.values(), ...externalTurnConnections]) {
    if (c.companion?.neumaId) boundLaneIds.add(c.companion.neumaId);
    if (c.activeTurn) (turnClassOf(c) === 'remote' ? (remote += 1) : (local += 1));
  }
  return { localTurns: local, local, remote, boundLaneIds };
};

// pure — which class a connection's turn rides. An operator participant (or a
// witness-prefixed lane, the shape older bindings carry) is always a
// third-party door; everything else is a house lane on the local substrate.
const turnClassOf = (connection) =>
  (connection.companion?.participantKind === 'witness'
    || connection.companion?.neumaId?.startsWith?.('witness-'))
    ? 'remote'
    : 'local';

// impure — writes the live turn truth to every open socket. `active` stays as
// the total for any reader that predates the local/remote split.
export const broadcastSubstrateActivity = () => {
  const { local, remote } = localTurnSnapshot();
  const frame = JSON.stringify({ type: 'substrate:activity', active: local + remote, local, remote });
  for (const c of connections.values()) {
    if (c.ws && c.ws.readyState === 1 /* OPEN */) {
      try { c.ws.send(frame); } catch { /* a dying socket must not break the loop */ }
    }
  }
};

/**
 * The MACHINE's live sittings, by kind (session tabs).
 *
 * Derived from what is actually BOUND — a connection holding a companion — and
 * never from what a client claims to have open. A desk that miscounts its own
 * tabs, or a second window that does not know about the first, cannot inflate
 * or hide the machine's real load.
 *
 * The kinds are counted apart because they cost different things: a LOCAL
 * sitting takes a slot on this machine's GPU, a WITNESS sitting is a network
 * call. `turnClassOf` above already draws exactly that line for the two lights,
 * so the same classifier answers both questions rather than drifting from it.
 *
 * // impure — walks the live connections map
 * @returns {{local: number, witness: number}}
 */
export const machineTabCounts = () => {
  let local = 0;
  let witness = 0;
  for (const c of connections.values()) {
    if (!c.companion?.neumaId) continue; // an unbound socket is not a sitting
    (turnClassOf(c) === 'remote' ? (witness += 1) : (local += 1));
  }
  return { local, witness };
};

// impure — tells every desk what the MACHINE is holding, so a window can ask
// the tab budget an honest question. Fired wherever a sitting binds or ends;
// same fan-out shape as substrate activity above.
export const broadcastTabCounts = () => {
  const frame = JSON.stringify({ type: 'tabs:counts', ...machineTabCounts() });
  for (const c of connections.values()) {
    if (c.ws && c.ws.readyState === 1 /* OPEN */) {
      try { c.ws.send(frame); } catch { /* a dying socket must not break the loop */ }
    }
  }
};

// impure — pushes a storage:warning frame to every open desk so the operator
// learns of shrinking disk headroom without polling. Fired by the heartbeat
// (injected at startHeartbeat — services must not import routes).
export const broadcastStorageWarning = (assessment) => {
  const frame = JSON.stringify({ type: 'storage:warning', ...assessment });
  for (const c of connections.values()) {
    if (c.ws && c.ws.readyState === 1 /* OPEN */) {
      try { c.ws.send(frame); } catch { /* a dying socket must not break the loop */ }
    }
  }
};

const clearSessionRuntime = (connection) => {
  connection._sessionToolPolicy = null;
  connection._sessionCompaction = null;
  connection.toolResultSeq = 0;
  connection.toolResultBytes = 0;
  connection.compositionToolResults = [];
  connection.sessionMsgCount = 0;
  connection.contextComposition = null;
  // The carried standing measurement belongs to the session that produced it —
  // a new session must never inherit another conversation's context reading.
  connection.lastMeasuredStanding = null;
};

// Exported for the test that proves reach never outlives consent: this is the
// real production reset, called on every rebinding, asserted on directly.
export const clearLaneBinding = (connection) => {
  clearShellNetwork(connection);
  clearLaneRuntime(connection);
  connection.neumaId = null;
  connection.companion = null;
  connection.sessionId = null;
  connection._neumaToolPolicy = null;
  // Path grants belong to the BEING, never to the socket. One connection
  // carries different beings over its life, and these fields survived the
  // switch: a folder granted to one neuma stayed reachable by whoever bound
  // next, and the hydrated flag kept the arriving being's OWN grants from
  // loading — reach outliving consent, cleared here at the one chokepoint
  // every rebinding passes. Held words were addressed to the being that was
  // bound; they never follow the connection to whoever manifests next.
  connection.pendingThoughts = [];
  connection._grantedReadRoots = [];
  connection._grantedWriteRoots = [];
  connection._pathGrantsHydrated = false;
  clearSessionRuntime(connection);
};

// A ceremony opens on a clean socket: the prior being's ALWAYS grants,
// sensitive grants, plan and catalog never reach the newborn's stage calls,
// then the ceremony's own isolation drops its companion and write reach.
export const isolateForBirth = (connection) => {
  clearLaneBinding(connection);
  return isolatePortalForBirth(connection);
};

// Expose connections for portal status endpoint
export const getConnectionCount = () => connections.size;

// Test seam (RULE 0): lets a real-WS integration test read the LIVE connection
// the portal is holding for its socket (keyed by the connectionId the portal
// announced in portal:established) — the only honest way to prove a frame
// changed server-side connection state. Read-only; never used in production.
export const __test = Object.freeze({
  connectionFor: (connectionId) => connections.get(connectionId) || null,
});

// The registry itself, for the modules that route or settle frames on the
// portal's behalf (never re-exported through portal-routes.js).
export const portalConnections = connections;
export { clearSessionRuntime };
