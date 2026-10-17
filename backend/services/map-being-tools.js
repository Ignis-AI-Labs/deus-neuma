/**
 * map-being-tools — the repository map, as a tool a resident can call.
 *
 * Design note, 2026-07-27: […]
 *
 * That sentence is the whole design constraint, and it rules out the obvious
 * implementation. Handing back the raw graph — 197 findings, 360 routes, 158
 * channels — would recreate the exact problem it is supposed to solve: a pile of
 * data the model has to sift. So this tool never returns the map. It returns the
 * ANSWER: the shape in a few lines, then only what is wrong, grouped, worst
 * first, and hard-capped.
 *
 * Two questions, because those are the two a resident actually has:
 *   read_architecture()             what IS this repo, and what is wrong with it
 *   read_architecture({path})       what is THIS file wired to, and is it healthy
 *
 * Standing laws it inherits rather than reinvents:
 *   GROUND      it maps the focus ground and nothing else, resolved through
 *               focusGroundRoots — the same reach the being's file tools have.
 *               No ground, no map (the honest refusal, never a silent empty).
 *   READ-ONLY   it reads source and returns text. It writes no baseline, no
 *               config, no HTML — so it stays out of the write-approval tier.
 *   ACTS        it is advertised like any other tool and crosses the same gate.
 */
import path from 'path';
import { readStandardTool } from './coding-standards/tool.js';
import { focusGroundRoots } from './focus-ground.js';
// Off the event loop — a scan is seconds of CPU that froze every portal (scan-offthread.js).
import { scanArchitectureOffThread as scanArchitecture } from './mapview/scan-offthread.js';
import { gateGroundHistory } from './ground-git-consent.js';
import { gitFailure, redactGitText } from './ground-git-exec.js';
import {
  formatGroundGit, readGroundCommit, readGroundDiff, readGroundGit, readGroundLog,
} from './ground-git.js';

/** Findings shown per kind. Past this a model is sifting again, which is the thing we are removing. */
const PER_KIND_CAP = 5;
/** Kinds worth a resident's attention, worst first. Ordering IS the sifting. */
const KIND_ORDER = Object.freeze([
  'layer-violation', 'duplicate-route', 'router-unmounted', 'import-cycle',
  'hoist-candidate', 'module-unreachable', 'root-contamination',
  'channel-no-consumer', 'channel-no-producer', 'dead-export',
]);

export const MAP_TOOLS = Object.freeze([
  Object.freeze({
    name: 'read_architecture',
    server: 'map',
    description: 'Read the architecture map of the folder you are working in — args {path?}. '
      + 'Use {standard:"NAME"} alone to read a packaged Ignis coding standard from the prompt routing table. '
      + 'With no path: the shape of the repo (entry points, routes, channels, layers) and what is '
      + 'structurally WRONG with it — duplicate routes, import cycles, unreachable modules, '
      + 'duplicated code that should be one shared helper, and any signed layer rule being broken. '
      + 'With a path: what that specific file imports, what imports it, whether anything reaches it '
      + 'at all, and the findings against it. Use this BEFORE adding a module, a route, or a helper '
      + 'so you extend what exists instead of duplicating it.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        standard: Object.freeze({ type: 'string', description: 'Packaged standard name, e.g. OPERATIONS or DATA; use alone.' }),
        path: Object.freeze({
          type: 'string',
          description: 'optional repo-relative file to focus on, e.g. backend/services/foo.js',
        }),
      }),
      required: Object.freeze([]),
    }),
  }),
  Object.freeze({
    name: 'read_history',
    server: 'map',
    description: 'Read the git history of the folder you are working in — args {ref?, path?, limit?}. '
      + 'With nothing: the live branch state, the recent commits newest first, and what is changed '
      + 'but not yet committed. With a path: only the commits that touched that file. With a ref '
      + '(a short id from the log): that one commit — its full message and which files it touched. '
      + 'Use this to review what actually changed and when — the repository speaks for itself, read '
      + 'safely for you. Requires Git-specific approval even in AUTO unless explicitly granted; raw .git internals stay sealed.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        ref: Object.freeze({
          type: 'string',
          description: 'optional commit id from the log, e.g. 3e055b0e1',
        }),
        path: Object.freeze({
          type: 'string',
          description: 'optional repo-relative file — history narrows to commits touching it',
        }),
        limit: Object.freeze({
          type: 'integer', minimum: 1, maximum: 50,
          description: 'commits to list (default 20)',
        }),
      }),
      required: Object.freeze([]),
    }),
  }),
]);

const MAP_TOOL_NAMES = new Set(MAP_TOOLS.map((t) => t.name));

/**
 * Does this parsed call target a map tool? Accepts every dialect the other
 * platform handlers accept: bare name, server-prefixed (`map/read_architecture`),
 * and the native function-calling encoding (`map__read_architecture`). Pure.
 */
export const isMapTool = (match) =>
  MAP_TOOL_NAMES.has(String(match?.toolName || '').replace(/^map__/, ''))
  || MAP_TOOL_NAMES.has(String(match?.tool || '').replace(/^map\//, ''));

/**
 * The map catalog for this turn: offered only when the resident actually stands
 * somewhere. A tool that can only answer […] is noise in the
 * prompt, so it is simply absent until there is a ground to read. Pure.
 */
export const mapToolsFor = (connection) =>
  (focusGroundRoots(connection).length ? [...MAP_TOOLS] : []);

/** Group findings by kind, in KIND_ORDER, with unknown kinds last. Pure. */
const byKind = (anomalies) => {
  const groups = new Map();
  for (const a of anomalies) {
    if (!groups.has(a.kind)) groups.set(a.kind, []);
    groups.get(a.kind).push(a);
  }
  const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
};

/**
 * The plain-language tallies, in the words a person actually uses about a repo.
 *
 * Founder: […]
 *
 * So the headline is a SCOREBOARD, not a taxonomy. `channel-no-consumer` is a
 * kind; "disconnected" is what it means. Each bucket names the finding kinds it
 * counts, so the number can always be traced back to specifics. Pure.
 */
export const scoreboard = (anomalies = []) => {
  const of = (...kinds) => anomalies.filter((a) => kinds.includes(a.kind)).length;
  return [
    { label: 'disconnected', n: of('module-unreachable', 'router-unmounted', 'channel-no-consumer', 'channel-no-producer') },
    { label: 'duplicated', n: of('hoist-candidate', 'duplicate-route') },
    { label: 'unused exports', n: of('dead-export') },
    { label: 'import cycles', n: of('import-cycle') },
    { label: 'layer breaks', n: of('layer-violation') },
    { label: 'foreign at root', n: of('root-contamination') },
  ].filter((b) => b.n > 0);
};

/**
 * The whole-repo answer: the scoreboard first, so it is readable at a glance and
 * quotable in a sentence; then the specifics behind it, worst kind first. Capped
 * per kind, and the cap is STATED — a silent truncation would read as […], the one lie a sifter must never tell. Pure.
 */
export const renderOverview = (graph) => {
  const m = graph.meta;
  const anomalies = graph.anomalies || [];
  const board = scoreboard(anomalies);

  const lines = [`ARCHITECTURE — ${m.root}`];
  lines.push(board.length
    ? board.map((b) => `${b.n} ${b.label}`).join(' · ')
    : 'Nothing structurally wrong was found.');
  lines.push(`(${m.scannedFiles} source files · ${m.entryPointCount} entry points · `
    + `${m.routeCount} routes · ${m.channelCount} channels)`);
  if (!board.length) return lines.join('\n');

  for (const [kind, list] of byKind(anomalies)) {
    lines.push('', `${kind} — ${list.length}`);
    for (const a of list.slice(0, PER_KIND_CAP)) lines.push(`  · ${a.label}`);
    if (list.length > PER_KIND_CAP) {
      lines.push(`  … and ${list.length - PER_KIND_CAP} more of this kind (not shown — `
        + `ask for a specific path to see its own findings)`);
    }
  }
  lines.push('', 'These are STATIC signals, not confirmed bugs — a dynamically dispatched '
    + 'call can read as dead. Verify against the real code before acting on one.');
  return lines.join('\n');
};

/**
 * The single-file answer: what it reaches, what reaches it, and whether anything
 * runs it. "Nothing imports this" is the most useful sentence this tool can say
 * to a resident about to add another one like it. Pure.
 */
export const renderForPath = (graph, rel) => {
  const imports = (graph.modules || []).filter((e) => e.from === rel).map((e) => e.to).sort();
  const importedBy = (graph.modules || []).filter((e) => e.to === rel).map((e) => e.from).sort();
  const defs = (graph.functions || []).filter((f) => f.file === rel);
  const known = new Set((graph.functions || []).map((f) => f.file));
  for (const e of graph.modules || []) { known.add(e.from); known.add(e.to); }
  if (!known.has(rel)) {
    return `${rel} is not in the map. Either the path is wrong, it is not source `
      + `(only .js/.jsx/.mjs/.cjs/.ts/.tsx are scanned), or it is a test file — `
      + `tests are excluded from the architecture surface by design.`;
  }

  const findings = (graph.anomalies || []).filter((a) => (a.files || []).includes(rel));
  const routes = (graph.routes || []).filter((r) => r.file === rel);
  const channels = (graph.channels || []).filter(
    (c) => c.producers.includes(rel) || c.consumers.includes(rel),
  );
  const cap = (list, n) => (list.length > n
    ? [...list.slice(0, n), `… and ${list.length - n} more`] : list);

  const lines = [
    `${rel}`,
    `${defs.length} definitions${routes.length ? ` · ${routes.length} routes` : ''}`
      + `${channels.length ? ` · ${channels.length} channels` : ''}`,
    '',
    `IMPORTS (${imports.length})`,
    ...(imports.length ? cap(imports, 12).map((f) => `  → ${f}`) : ['  nothing']),
    '',
    `IMPORTED BY (${importedBy.length})`,
    ...(importedBy.length
      ? cap(importedBy, 12).map((f) => `  ← ${f}`)
      : ['  NOTHING — no module imports this file. It is either an entry point, '
         + 'reached dynamically, or dead surface.']),
  ];
  if (findings.length) {
    lines.push('', `FINDINGS AGAINST THIS FILE (${findings.length})`);
    for (const f of findings.slice(0, PER_KIND_CAP * 2)) lines.push(`  · ${f.kind}: ${f.detail}`);
  }
  return lines.join('\n');
};

/**
 * Execute a map tool. Mirrors the platform handler contract used by
 * web-being-tools: returns `{ tool, status, content|error }` and emits the same
 * tool-event chip so the operator sees the call.
 *
 * impure — reads the filesystem through scanArchitecture.
 */
export const handleMapTool = async (ws, connection, match, args, ports) => {
  const bare = String(match?.toolName || '').replace(/^map__/, '');
  const toolName = MAP_TOOL_NAMES.has(bare) ? bare : String(match?.tool || '').replace(/^map\//, '');
  const tool = `map/${toolName}`;
  const { companion } = connection;
  const emit = (event) => ports?.sendToolEvent?.(ws, companion, { tool, ...event });

  if (toolName === 'read_architecture' && args && Object.hasOwn(args, 'standard')) {
    return readStandardTool(args, emit);
  }

  const roots = focusGroundRoots(connection);
  if (!roots.length) {
    const error = 'You have no ground open — ask your operator to open a folder in the Explorer, '
      + 'then read the architecture of it.';
    emit({ status: 'unavailable', summary: `${toolName} — no ground` });
    return { tool, status: 'unavailable', error };
  }
  const root = roots[0];

  // A path is a LABEL, never a filesystem read — resolved inside the ground or
  // refused. Shared by both tools so neither can be walked outside.
  const relOf = (wanted) => {
    const rel = path.relative(root, path.resolve(root, wanted));
    return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
  };

  if (toolName === 'read_history') {
    const granted = await gateGroundHistory(connection, args, emit);
    if (!granted.ok) return granted.result;
    try {
      const state = await readGroundGit(root, { signal: granted.signal });
      granted.assertCurrent();
      if (!state.isRepository) {
        emit({ status: 'ok', summary: 'read_history — not a git repository' });
        return { tool, status: 'ok', content: redactGitText(`${root} is not a git repository — there is no history to read.`) };
      }
      const ref = typeof args?.ref === 'string' ? args.ref.trim() : '';
      if (ref) {
        const commit = await readGroundCommit(root, ref, { signal: granted.signal });
        granted.assertCurrent();
        if (commit === null) {
          emit({ status: 'error', summary: 'read_history unknown ref' });
          return { tool, status: 'error', error: 'Unknown commit; take a short id from the log.' };
        }
        emit({ status: 'ok', summary: 'read_history commit read' });
        return { tool, status: 'ok', content: commit };
      }
      const wanted = typeof args?.path === 'string' ? args.path.trim() : '';
      const rel = wanted ? relOf(wanted) : null;
      if (wanted && rel === null) {
        emit({ status: 'error', summary: 'read_history — outside your ground' });
        return { tool, status: 'error', error: 'The requested path is outside the focused folder.' };
      }
      const log = await readGroundLog(root, { limit: args?.limit, path: rel, signal: granted.signal });
      const lines = [formatGroundGit(state), '', rel ? `COMMITS TOUCHING ${rel}` : 'RECENT COMMITS (newest first)',
        log || '(no commits yet)'];
      if (!rel && (state.staged || state.modified)) {
        const diff = await readGroundDiff(root, { signal: granted.signal });
        if (diff) lines.push('', 'CHANGED BUT NOT COMMITTED (vs HEAD)', diff);
      }
      granted.assertCurrent();
      emit({ status: 'ok', summary: 'read_history branch read' });
      return { tool, status: 'ok', content: redactGitText(lines.join('\n')) };
    } catch (err) {
      const error = gitFailure(err.code, err.category).message;
      emit({ status: 'error', summary: 'read_history failed', detail: error });
      return { tool, status: 'error', error };
    } finally { granted.close(); }
  }

  try {
    const graph = await scanArchitecture(root);
    const wanted = typeof args?.path === 'string' ? args.path.trim() : '';
    if (!wanted) {
      emit({ status: 'ok', summary: `${path.basename(root)} — ${graph.meta.anomalyCount} findings` });
      return { tool, status: 'ok', content: renderOverview(graph) };
    }
    const rel = relOf(wanted);
    if (rel === null) {
      const error = `${wanted} is outside the folder you are working in.`;
      emit({ status: 'error', summary: 'read_architecture — outside your ground' });
      return { tool, status: 'error', error };
    }
    emit({ status: 'ok', summary: `${rel} — wiring` });
    return { tool, status: 'ok', content: renderForPath(graph, rel) };
  } catch (err) {
    emit({ status: 'error', summary: 'read_architecture — failed', detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};
