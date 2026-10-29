// The CLO office's READS — open to every bound being (a being building a
// voice feature may read what the Praetor found about voice law). The ACTS
// (scan / assess / file) are intents (intents/legal-acts.js), the CLO seat
// verified at validate time. Every read is the connection's OWN house's
// office (its operator's wallet) — never another house's.

import { gateAct } from '../act-gate.js';
import { matterLedgerFor, matterCounts, mattersDueForReview, MATTER_STATUSES, MATTER_AREAS } from './matter-ledger.js';
import { cloDesignation } from './clo-designation.js';
import { readLegalWatchState } from './legal-scheduler.js';
import { sourcesText, SOURCE_KINDS, SOURCE_JURISDICTIONS } from './legal-sources.js';
import { LEGAL_APIS, callLegalApi } from './legal-research-api.js';

const tool = (name, description, properties = {}, required = []) => Object.freeze({
  name,
  server: 'legal',
  description,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    ...(required.length ? { required: Object.freeze(required) } : {}),
  }),
});

export const LEGAL_TOOLS = Object.freeze([
  tool('legal_posture', 'Read the house\'s legal posture — no args. Matter counts by status and area, what is due for review, the last legal watch run (shipped packages by licence class, new commits read), and who holds the CLO seat. Open to every bound being; settling matters is the CLO office.'),
  tool('legal_matters_list', `List the legal matters ledger. Optional {status, area, repo, limit}; status is ${MATTER_STATUSES.join(' | ')}; area is ${MATTER_AREAS.join(' | ')}.`, {
    status: { type: 'string' }, area: { type: 'string' }, repo: { type: 'string' }, limit: { type: 'number' },
  }),
  tool('legal_sources', `Where to read the law, before you search: the official free sources (statutes, regulations, bills, cases, guidance, licences), the route that answers your web tools, the reading order for the question, and how to check a citation. Optional {kind: ${SOURCE_KINDS.join(' | ')}, jurisdiction: ${SOURCE_JURISDICTIONS.join(' | ')}}.`, {
    kind: { type: 'string' }, jurisdiction: { type: 'string' },
  }),
  tool('legal_matter_get', 'Read one legal matter whole — its evidence, the law it points to, and every verdict in its history — by full or unambiguous prefix id.', {
    id: { type: 'string', description: 'Matter id or unambiguous prefix' },
  }, ['id']),
]);
// The keyed official APIs — the SEATED CLO's alone: it spends the house's quota.
// The key is added server-side and scrubbed from the answer; the office never holds it.
const RESEARCH_TOOL = tool('legal_research_api', `The official legal databases that take a key, with the house's saved key added for you (you never see it): ${Object.entries(LEGAL_APIS).map(([id, a]) => `${id} — ${a.what}`).join('; ')}. Args {api, path, query?, text?}: path is a path on that API only (starting with /).`, {
  api: { type: 'string', enum: Object.keys(LEGAL_APIS) }, path: { type: 'string' }, query: { type: 'object' }, text: { type: 'string' },
}, ['api']);
const TOOL_NAMES = new Set([...LEGAL_TOOLS, RESEARCH_TOOL].map((t) => t.name));

/** Does a parsed call target the legal office? Pure. */
export const isLegalTool = (match) => TOOL_NAMES.has(match?.toolName)
  || TOOL_NAMES.has(String(match?.tool || '').replace(/^legal\//, ''));

/** The reads are house-visible — every bound being sees them. */
export const legalToolsFor = async (connection) => {
  if (!connection.companion?.neumaId) return [];
  const seated = await cloDesignation.holds(connection.walletAddress, connection.companion.neumaId).catch(() => false);
  return seated ? [...LEGAL_TOOLS, RESEARCH_TOOL] : [...LEGAL_TOOLS];
};

// pure
const matterLine = (m) => `[${m.id.slice(0, 10)}] ${m.severity} · ${m.status} · ${m.area}${m.repo ? `/${m.repo}` : ''} — ${m.title}`;
const tally = (obj) => Object.entries(obj).map(([k, n]) => `${k}: ${n}`).join(', ') || 'none';

// impure — the house's posture read.
const posture = async (wallet) => {
  const [entries, watch, officer] = await Promise.all([
    matterLedgerFor(wallet).then((ledger) => ledger.load()),
    readLegalWatchState(wallet).catch(() => null),
    cloDesignation.getOfficer(wallet).catch(() => null),
  ]);
  const counts = matterCounts(entries);
  const run = watch?.runs?.[0];
  return {
    summary: `${counts.total} matters on the ledger`,
    content: [
      `CLO seat: ${officer?.laneId || 'EMPTY — no Praetor seated'}`,
      `Matters: ${counts.total} total — ${tally(counts.byStatus)}`,
      `By area: ${tally(counts.byArea)}`,
      `Due for review: ${mattersDueForReview(entries).length}`,
      watch?.lastRunAt ? `Last watch: ${watch.lastRunAt}` : 'Last watch: never run on this install',
      ...(run?.repos || []).map((r) => `- ${r.repo}: ${r.shipped} shipped packages (${tally(r.byClass || {})}); ${r.commits} commits read since ${String(r.since).slice(0, 10)}${r.error ? ` — ERROR: ${r.error}` : ''}`),
    ].join('\n'),
  };
};

/** Execute a legal READ through the one act gate and the real stores. impure. */
export const handleLegalTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports = {}) => {
  const toolName = TOOL_NAMES.has(match?.toolName) ? match.toolName : String(match?.tool || '').replace(/^legal\//, '');
  const toolId = `legal/${toolName}`;
  const send = (event) => ports.sendToolEvent?.(ws, connection.companion, event);

  const gate = await gateAct(connection, {
    server: 'legal', tool: toolName, args, lanePolicy: neumaPolicy, mode: toolMode, emit: send,
  });
  if (!gate.ok) return gate.result;

  try {
    if (toolName === 'legal_posture') {
      const { summary, content } = await posture(connection.walletAddress);
      send({ tool: toolId, status: 'ok', summary });
      return { tool: toolId, status: 'ok', content };
    }
    if (toolName === 'legal_matters_list') {
      let entries = await (await matterLedgerFor(connection.walletAddress)).load();
      const total = entries.length;
      if (args?.status) entries = entries.filter((m) => m.status === args.status);
      if (args?.area) entries = entries.filter((m) => m.area === args.area);
      if (args?.repo) entries = entries.filter((m) => m.repo === args.repo);
      const limit = Math.min(Math.max(Number(args?.limit) || 40, 1), 200);
      const shown = entries.slice(-limit);
      send({ tool: toolId, status: 'ok', summary: `${shown.length} of ${total} matters` });
      return { tool: toolId, status: 'ok', content: shown.length ? shown.map(matterLine).join('\n') : 'No matters match — the ledger holds nothing under those filters.' };
    }
    if (toolName === 'legal_sources') {
      const content = sourcesText({ kind: args?.kind ?? null, jurisdiction: args?.jurisdiction ?? null });
      send({ tool: toolId, status: 'ok', summary: `sources${args?.kind ? ` for ${args.kind}` : ''}${args?.jurisdiction ? ` in ${args.jurisdiction}` : ''}` });
      return { tool: toolId, status: 'ok', content };
    }
    if (toolName === 'legal_research_api') {
      if (!(await cloDesignation.holds(connection.walletAddress, connection.companion?.neumaId).catch(() => false))) {
        throw new Error('legal_research_api is the seated CLO\'s — it spends the house\'s own API keys');
      }
      const out = await callLegalApi({ api: args?.api, path: args?.path ?? '/', query: args?.query ?? {}, text: args?.text ?? null });
      if (!out.ok) throw new Error(out.error);
      send({ tool: toolId, status: 'ok', summary: `${args?.api} ${String(args?.path ?? '').slice(0, 60)}` });
      return { tool: toolId, status: 'ok', content: out.text };
    }
    if (toolName === 'legal_matter_get') {
      const matter = await (await matterLedgerFor(connection.walletAddress)).get(String(args?.id || ''));
      if (!matter) throw new Error('no such matter (or the id is ambiguous)');
      send({ tool: toolId, status: 'ok', summary: matter.title.slice(0, 80) });
      return { tool: toolId, status: 'ok', content: JSON.stringify(matter, null, 2) };
    }
  } catch (error) {
    send({ tool: toolId, status: 'error', summary: `${toolName} — failed` });
    return { tool: toolId, status: 'error', error: error.message };
  }
  return { tool: toolId, status: 'error', error: `unknown legal tool ${toolName}` };
};
