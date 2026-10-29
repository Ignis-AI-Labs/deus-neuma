/**
 * FLIGHT CHECK — a being's own capacity, read from the state that decides it.
 *
 * Design note, 2026-07-29: […]
 *
 * WHY THIS IS COMPUTED AND NOT NARRATED. Asked the same question twice minutes
 * apart, one sealed witness reported its wallet as "Signing Status: Ready" and
 * then as […]; one directory and then four. The most
 * dangerous line was […] — true of the coding
 * sandbox, and false of the filesystem tools, which write to the operator's LIVE
 * folder cardlessly inside the focus ground. A report that UNDERSTATES reach is
 * the worst way for this to fail.
 *
 * So every number here comes from the same structures the gate consults at call
 * time — the resolved policy, the advertised catalog, the resolved route. This
 * is not a description of the decider; it is the decider, rendered. It cannot
 * drift, because there is nothing to drift from.
 *
 * The report never lists what is ABSENT. A hardcoded absence list rots the first
 * time a capability ships. Instead it states that the surface shown IS the whole
 * surface, so anything unlisted does not exist at that seat.
 */
import { resolveWitnessRoute } from './witness-route-resolver.js';
import { maskRoute } from './route-view.js';
import { resolveNeumaRoute } from './neuma-route-resolver.js';
import { focusGroundOf } from './focus-ground.js';
import { isLiveShell } from './open-folder-autonomy.js';
import { normalizeToolMode } from './tool-policy.js';
import { isWitnessLaneId } from './witness-lane.js';
import { ensureTurnSandbox } from './turn-sandbox.js';
import { createLogger } from './logger.js';

const log = createLogger('FlightCheck');

const TIER_LABEL = Object.freeze({
  allowed: 'runs without asking',
  approval_required: 'asks the operator first',
  denied: 'held — not available this turn',
});

/**
 * Group an advertised catalog by the tier each tool ACTUALLY has this turn.
 * Pure. Tools arrive already stamped by the seat's own builder, so this reads
 * the same `access` the executor will enforce.
 * @param {Array<{server:string,name:string,access?:string}>} tools
 * @returns {{total:number, byTier:Object<string,string[]>}}
 */
export const summarizeTools = (tools) => {
  const byTier = { allowed: [], approval_required: [], denied: [] };
  for (const tool of tools || []) {
    // An unstamped tool is not assumed open. `checkToolAccess` defaults to
    // approval_required for anything unnamed by policy, and this must agree
    // with it or the report would promise more than the gate allows.
    const tier = byTier[tool?.access] ? tool.access : 'approval_required';
    byTier[tier].push(`${tool.server}/${tool.name}`);
  }
  for (const tier of Object.keys(byTier)) byTier[tier].sort();
  return { total: (tools || []).length, byTier };
};

/**
 * The two write paths, stated separately — the distinction a narrated report
 * collapses. Pure.
 * @param {{focusGround:string|null, sandbox:object|null}} input
 * @returns {string[]} lines
 */
export const reachLines = ({ focusGround, sandbox }) => {
  const lines = [];
  lines.push(focusGround
    ? `  live ground   ${focusGround}`
    : '  live ground   (none open — the operator has no folder focused)');
  lines.push(focusGround
    ? '                filesystem tools READ AND WRITE here, with no approval card.'
    : '                without a focused folder, every path raises a card.');
  if (sandbox?.live) {
    lines.push(`  shell         LIVE on ${sandbox.sourceRoot} (AUTO in the operator's open folder)`);
    lines.push('                shell writes land in that folder; .git and secret-shaped paths are masked.');
  } else if (sandbox) {
    lines.push(`  shell         a live overlay view of ${sandbox.sourceRoot}`);
    lines.push('                reads are current by construction; secret-shaped paths are masked.');
    lines.push(`                shell writes land in ${sandbox.workspace}, never on the live folder.`);
  } else {
    lines.push('  shell         none at this seat — no coding shell.');
  }
  return lines;
};

// pure — one substrate block from an already-resolved route.
const substrateLines = (route) => {
  if (!route) return ['  (no route resolved for this seat)'];
  const custody = route.sovereign ? 'sovereign — weights in this house\'s custody' : 'third-party custody';
  return [
    `  provider      ${route.provider}${route.kind ? ` (${route.kind}, ${custody})` : ''}`,
    `  model         ${route.model || '(none resolved)'}`,
    `  endpoint      ${route.endpoint || '(provider default)'}`,
    `  route source  ${route.source || 'unknown'}`,
    route.configured
      ? '  status        CONFIGURED — this route can carry a turn'
      : `  status        NOT CONFIGURED — ${route.reason || 'unusable'}; turns will refuse`,
  ];
};

/**
 * Render one report as the text a being reads and may hand to its operator.
 * Pure.
 * @param {object} report from readFlightCheck
 * @returns {string}
 */
export const formatFlightCheck = (report) => {
  const tiers = Object.entries(report.tools.byTier)
    .filter(([, names]) => names.length)
    .flatMap(([tier, names]) => [
      `  ${TIER_LABEL[tier]} (${names.length}):`,
      ...names.map((n) => `    ${n}`),
    ]);
  return [
    `FLIGHT CHECK — ${report.name} · ${report.seat} seat · ${report.checkedAt}`,
    '',
    'SUBSTRATE',
    ...substrateLines(report.substrate),
    '',
    'REACH',
    ...reachLines(report.reach),
    '',
    `TOOLS — ${report.tools.total} advertised this turn`,
    ...tiers,
    '',
    `SKILLS — ${report.skills.length}`,
    ...(report.skills.length ? [`  ${report.skills.join(', ')}`] : ['  (none loaded)']),
    '',
    'LIMITS',
    ...report.limits.map((l) => `  ${l}`),
    '',
    'COMPLETENESS',
    '  The surface above is the WHOLE surface for this seat. A capability not',
    '  listed here does not exist for you — do not claim or attempt it. A tool',
    '  marked "asks the operator first" is real but gated; "held" means it will',
    '  refuse this turn.',
  ].join('\n');
};

export const FLIGHT_CHECK_TOOLS = Object.freeze([
  Object.freeze({
    server: 'system',
    name: 'flight_check',
    description: 'Report YOUR OWN current capacity, read live from the state that governs you — '
      + 'the substrate route you are running on and whether it is configured, every tool advertised '
      + 'to you this turn grouped by whether it runs freely / asks the operator first / is held, '
      + 'your skills, exactly where you may read and write (the operator\'s LIVE folder versus your '
      + 'shell overlay — reads there are live, but shell writes land lane-side, never on the folder), '
      + 'and your limits. Call this when asked what you can or cannot do, after any substrate or '
      + 'permission change, and before promising a capability. Answer from THIS, never from memory '
      + 'of your prompt — the report is generated from the same structures that decide your calls.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
]);

/**
 * Which seat is asking. Pure.
 *
 * Two signals, either sufficient. `participantKind` is what the portal sets,
 * but a caller that omits it would have a sealed witness reported as a neuma —
 * wrong custody, wrong wallet standing, wrong route resolver. The lane id names
 * the same truth independently, so the two together cannot both go quiet.
 * @param {object} connection
 * @returns {'neuma'|'witness'}
 */
export const seatOf = (connection) => (
  connection?.companion?.participantKind === 'witness'
  || isWitnessLaneId(connection?.companion?.neumaId)
    ? 'witness' : 'neuma');

/** pure — does this dispatch match the flight check? */
export const isFlightCheckTool = (match) =>
  match?.toolName === 'flight_check' && (!match.server || match.server === 'system');

/**
 * Advertise the flight check wherever a being has a lane. Pure.
 * No switch stands in front of it: a being reading its own capacity is the
 * purest observation there is, and a seat that cannot ask what it holds is the
 * condition this whole tool exists to end.
 * @param {object} connection
 * @returns {ReadonlyArray<object>}
 */
export const flightCheckToolsFor = (connection) =>
  (connection?.companion?.neumaId ? FLIGHT_CHECK_TOOLS : []);

// impure — the seat's route, never throwing: an unresolvable route is a finding.
//
// Masked through the SAME view the model bar reads (route-view.js), because the
// two resolvers carry different fields and reading them raw made this report
// tell every local neuma its substrate was unusable and its own weights
// third-party — while the bar, one derivation away, showed it live and
// sovereign. A report that understates capacity is the failure this tool exists
// to end; it must not commit it about the substrate itself.
const routeFor = async (seat, laneId) => {
  if (!laneId) return null;
  try {
    return maskRoute(seat === 'witness'
      ? await resolveWitnessRoute(laneId)
      : await resolveNeumaRoute(laneId));
  } catch (err) {
    log.warn('flight check could not resolve route', { laneId, seat, err: err.message });
    return maskRoute({ provider: '(unresolved)', model: null, endpoint: null, source: 'error', configured: false, reason: err.message });
  }
};

/**
 * Compose one being's live capacity report.
 * impure — reads the resolved route.
 *
 * @param {object} input
 * @param {object} input.connection the live portal connection
 * @param {'neuma'|'witness'} input.seat which seat is asking
 * @param {Array<object>} input.tools the catalog advertised THIS turn, already stamped
 * @param {Array<object>|Array<string>} [input.skills] the craft menu
 * @param {object|null} [input.sandbox] the coding sandbox, when the seat has one
 * @param {string} input.checkedAt ISO timestamp supplied by the caller
 * @returns {Promise<object>} the report
 */
const readFlightCheck = async ({ connection, seat, tools, skills = [], sandbox = null, checkedAt }) => {
  const laneId = connection?.companion?.neumaId || null;
  const live = isLiveShell({ mode: normalizeToolMode(connection?.toolMode), sourceRoot: sandbox?.sourceRoot, ground: focusGroundOf(connection) });
  const substrate = await routeFor(seat, laneId);
  return {
    name: connection?.companion?.name || laneId || 'unnamed',
    seat,
    checkedAt,
    substrate,
    reach: { focusGround: focusGroundOf(connection) || null, sandbox: sandbox && { ...sandbox, live } },
    tools: summarizeTools(tools),
    skills: (skills || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean).sort(),
    limits: [
      `session tool mode: ${connection?.toolMode || 'ask'} — governs WHETHER an act asks, never WHERE it may reach`,
      ...(sandbox ? [
        'shell commands: 30s default timeout (120s max), final 50 KiB per output stream retained (display truncation does not stop execution), network requires its own grant, empty HOME',
        live ? 'shell writes land in the operator\'s open folder (AUTO); .git and secrets stay masked, so history is the safety net'
          : 'shell writes land in your lane-side overlay layer only; they never touch the live checkout',
      ] : ['shell commands unavailable; no command execution has been verified']),
    ],
  };
};

/**
 * Serve one flight_check call.
 * impure — composes from the turn state each runtime stashed on the connection.
 *
 * The catalog is READ from the connection rather than rebuilt here: rebuilding
 * it would report a second, freshly-assembled surface instead of the one this
 * turn is actually holding, and the two can differ (a switch flipped mid-turn).
 * The whole value of the report is that it describes the turn the being is in.
 *
 * @param {{connection:object, checkedAt:string}} ctx
 * @returns {Promise<{tool:string,status:string,content?:string,error?:string}>}
 */
export const handleFlightCheckTool = async ({ connection, checkedAt }) => {
  const tool = 'system/flight_check';
  try {
    // No stash means the turn's catalog was never assembled on this connection.
    // Reporting an empty one would state "0 tools advertised" — a confident
    // claim of no capability, which is the precise misreport class this tool
    // exists to end. Refuse instead, and say why.
    if (!connection?._turnCatalog) {
      return {
        tool,
        status: 'unavailable',
        error: 'this turn carries no assembled tool catalog yet — the flight check cannot report a surface it has not been handed, and will not guess at one',
      };
    }
    const seat = seatOf(connection);
    const report = await readFlightCheck({
      connection,
      seat,
      tools: connection?._turnCatalog || [],
      skills: connection?._turnSkills || [],
      // Asked for, so the shell is prepared now if the turn has one (turn-sandbox.js).
      sandbox: await ensureTurnSandbox(connection),
      checkedAt,
    });
    return { tool, status: 'ok', content: formatFlightCheck(report) };
  } catch (error) {
    log.error('flight check failed', { err: error.message });
    return { tool, status: 'error', error: error.message };
  }
};
