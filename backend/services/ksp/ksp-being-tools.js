import { neumaWorkspace } from '../../../core/index.js';
import { seatOf } from '../flight-check.js';
import { gateAct } from '../act-gate.js';
import { KspFlightBridge } from './ksp-flight.js';
import { portableKspSummary } from './ksp-flight-state.js';
import { captureKspView } from './ksp-view.js';

const KSP_SUBSTRATE = 'KSP 1 + kRPC 0.6';
const KSP_TOOL_NAMES = new Set(['get_telemetry', 'get_view']);
export const KSP_COMMAND_NAMES = Object.freeze([
  'set_throttle', 'maintain_attitude', 'release_attitude', 'set_axes', 'stage',
  'set_gear', 'toggle_gear', 'set_brakes', 'set_sas', 'set_rcs', 'deploy_parachutes',
]);

export const KSP_TOOLS = Object.freeze([
  Object.freeze({
    name: 'get_telemetry',
    server: 'ksp',
    description: 'Sense the live KSP 1 simulation through kRPC: vessel motion, orientation, orbit, resources, forces, controls, causal events, the last command delta, and recorder state. This is observation and remains open in OBSERVE mode. Optional includeRecentRuns returns portable summaries from your own encrypted benchmark record.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        includeRecentRuns: Object.freeze({ type: 'boolean', description: 'include recent KSP benchmark summaries from this neuma\'s own record' }),
        limit: Object.freeze({ type: 'integer', minimum: 1, maximum: 10, description: 'recent summary limit (default 3)' }),
      }),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'get_view',
    server: 'ksp',
    description: 'Look at the live KSP window. Returns one current frame, or 2-4 sequential frames sampled 100-1000 ms apart so a vision-capable substrate can read motion and instruments. This is bounded sampled sight—not an unbounded recording—and remains open in OBSERVE mode. Pair it with get_telemetry for precise control.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        frames: Object.freeze({ type: 'integer', minimum: 1, maximum: 4, description: 'number of sequential frames (default 1)' }),
        intervalMs: Object.freeze({ type: 'integer', minimum: 100, maximum: 1000, description: 'delay between frames when frames > 1 (default 250)' }),
      }),
      additionalProperties: false,
    }),
  }),
]);

let liveBridge = null;

// impure — the one bridge per process, shared by the read tools and the
// ksp/command intent.
export const kspBridge = () => {
  if (!liveBridge) {
    liveBridge = new KspFlightBridge({
      onRunComplete: (run) => neumaWorkspace.writeBenchmark(run.participant.neumaId, run),
    });
  }
  return liveBridge;
};

const toolNameOf = (match) => {
  const bare = String(match?.toolName || '').replace(/^ksp__/, '');
  return KSP_TOOL_NAMES.has(bare) ? bare : String(match?.tool || '').replace(/^ksp\//, '');
};

const ownerOf = (connection) => Object.freeze({
  neumaId: String(connection?.companion?.neumaId || ''),
  name: String(connection?.companion?.name || connection?.companion?.neumaId || 'unknown'),
  sessionId: String(connection?.sessionId || ''),
});

const runLimit = (raw) => {
  const value = raw === undefined ? 3 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error('limit must be an integer from 1 to 10');
  return value;
};

// impure — decrypts only this neuma's benchmark summaries and omits black boxes.
const recentKspRuns = async (neumaId, limit) => {
  const summaries = await neumaWorkspace.listBenchmarks(neumaId);
  const runs = [];
  for (const summary of summaries) {
    if (summary.substrate !== KSP_SUBSTRATE) continue;
    const full = await neumaWorkspace.readBenchmark(neumaId, summary.id);
    if (full?.kind === 'ksp-sovereignty-lab') runs.push(portableKspSummary(full, summary.id));
    if (runs.length === limit) break;
  }
  return Object.freeze(runs);
};

const unavailableError = (endpoint, error) => {
  const cause = error?.message || 'connection failed';
  return `KSP bridge unavailable at ${endpoint}. Start KSP 1, load a flight, and ensure the kRPC server is running. ${cause}`;
};

/** Match both text and native function-call encodings for the KSP family. Pure. */
export const isKspTool = (match) => KSP_TOOL_NAMES.has(toolNameOf(match));

/** Advertise KSP only to a sovereign neuma lane, never a third-party witness seat. Pure. */
export const kspToolsFor = (connection) => (
  connection?.companion?.neumaId && seatOf(connection) === 'neuma' ? [...KSP_TOOLS] : []
);

/** Execute one KSP tool through the shared ACTS gate (act-gate.js) and the real loopback bridge. */
// impure
export const handleKspTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const toolName = toolNameOf(match);
  const tool = `ksp/${toolName}`;
  const { companion } = connection;
  if (!companion?.neumaId || seatOf(connection) !== 'neuma') {
    const error = 'KSP control belongs to a sovereign neuma lane; witness seats cannot invoke local-custody authority.';
    ports.sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — sovereignty boundary` });
    return { tool, status: 'denied', error };
  }

  const gate = await gateAct(connection, {
    server: 'ksp', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  let pilotBridge = null;
  try {
    if (toolName === 'get_view') {
      const view = await captureKspView(companion.neumaId, args, connection.activeTurn?.signal);
      const { sight, ...content } = view;
      ports.sendToolEvent(ws, companion, {
        tool, status: 'ok',
        summary: `${view.frameCount} live KSP frame${view.frameCount === 1 ? '' : 's'} — ${view.source}`,
      });
      return { tool, status: 'ok', content: JSON.stringify(content), sight };
    }
    pilotBridge = kspBridge();
    // get_telemetry — the reads' only bridge call (acting is the ksp/command intent).
    const packet = await pilotBridge.getTelemetry(ownerOf(connection));
    const content = args?.includeRecentRuns
      ? { ...packet, recentRuns: await recentKspRuns(companion.neumaId, runLimit(args?.limit)) }
      : packet;
    const vessel = packet.vessel;
    ports.sendToolEvent(ws, companion, {
      tool, status: 'ok',
      summary: vessel
        ? `${vessel.name} — ${Math.round(vessel.altitude.meanM || 0)} m · ${Math.round(vessel.velocity.speedMps || 0)} m/s`
        : `${packet.game.scene} — no active vessel`,
    });
    return { tool, status: 'ok', content: JSON.stringify(content) };
  } catch (error) {
    const unavailable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code)
      || /connect|socket|kRPC|window capture|desktop capture|Kerbal Space Program window/i.test(error?.message || '');
    const message = unavailable && pilotBridge ? unavailableError(pilotBridge.endpoint, error) : error.message;
    ports.sendToolEvent(ws, companion, {
      tool, status: unavailable ? 'unavailable' : 'error', summary: `${toolName} — failed`, detail: message,
    });
    return { tool, status: unavailable ? 'unavailable' : 'error', error: message };
  }
};
