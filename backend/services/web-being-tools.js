// Web tools FOR the being — research from inside its own stream:
//
//   web_search — search the internet {query, limit?}. Titles, urls, snippets.
//   web_fetch  — read one web page {url}. Bounded readable text.
//
// Two gates stand before a packet ever leaves the rig:
//
//   1. THE OPERATOR'S MASTER SWITCH (web-settings.js) — persisted, ON for a
//      fresh install, explicitly switchable OFF, and env-killable for air-gapped
//      rigs. An OFF catalog remains visible as HELD so the being can ask.
//   2. THE ACTS GATE (tool-policy.js) — requireApproval by default, so the
//      first reach outward asks the operator per call; ALWAYS ALLOW persists
//      per-being through the standard flow. Observe mode holds every web tool:
//      egress is not observation.
//
// Every executed call lands in the being's journal — a deliberate divergence
// from the other built-ins: what a mind reads from the internet shapes what
// it becomes, and that reading list belongs to its record.
//
// What comes BACK is untrusted. A page body, a page <title>, a search result's
// title and snippet are all authored by whoever owns that page — text shaped
// like an instruction arrives at the same altitude as the operator's voice
// unless it is framed. Both renderers put outside-authored text inside
// `frameUntrustedContent` and stamp the retrieval instant beside it, so a being
// can always tell the field's words from the instrument's, and always knows
// WHEN it read them.
//
// Portal-stream owns the socket, so the event sender arrives as an injected
// port — the ACTS gate itself (policy → mode → card → always → refusal) is
// act-gate.js, the one implementation both seats share.

import { neumaWorkspace } from '../../core/index.js';
import { gateAct } from './act-gate.js';
import { webSettings } from './web-settings.js';
import { fetchWebPage } from './web-fetch.js';
import { searchWeb, searchImages } from './web-search.js';
import { frameUntrustedContent } from './untrusted-content.js';
import { createLogger } from './logger.js';
import { recordAct } from './act-ledger.js';

const log = createLogger('WebTools');

export const WEB_TOOLS = Object.freeze([
  Object.freeze({
    name: 'web_search',
    server: 'web',
    description: 'Search the internet — args {query, limit?}. Returns titles, urls, and snippets for current information, sources, and facts. Follow up with web_fetch on a url to read a source in full.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        query: Object.freeze({ type: 'string', description: 'what to search for' }),
        limit: Object.freeze({ type: 'number', description: 'max results, 1-10 (default 5)' }),
      }),
      required: Object.freeze(['query']),
    }),
  }),
  Object.freeze({
    name: 'web_fetch',
    server: 'web',
    description: 'Read a web page — args {url}. Returns bounded readable text, not an original file. For SVG logos or other complete assets, file a web/download intent {url, name}; it saves original bytes to disk without text truncation. When configured, Kitesurf retries JavaScript-only pages. Public pages only; private and loopback addresses are refused.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        url: Object.freeze({ type: 'string', description: 'the full http(s):// URL to read' }),
      }),
      required: Object.freeze(['url']),
    }),
  }),
  Object.freeze({
    name: 'image_search',
    server: 'web',
    description: 'Search for images and GIFs — args {query, limit?}. Returns each result\'s direct image URL, the page it came from, dimensions and format. A GIF is an image: "gif" in the query finds them. Bring one home with a media/save intent {url} — it downloads through the guard into the house media library, and media_library lists what has been saved.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        query: Object.freeze({ type: 'string', description: 'what to look for — name the vibe, the meme, the subject' }),
        limit: Object.freeze({ type: 'number', description: 'max results, 1-12 (default 6)' }),
      }),
      required: Object.freeze(['query']),
    }),
  }),
]);

const WEB_TOOL_NAMES = new Set(WEB_TOOLS.map((t) => t.name));

/**
 * Does this parsed call target a web tool? Accepts every dialect: the bare
 * name (text protocol), the server-prefixed form (web/web_fetch), and the
 * native function-calling encoding (web__web_search).
 * @param {{toolName?: string, tool?: string}} match
 * @returns {boolean}
 */
export const isWebTool = (match) =>
  WEB_TOOL_NAMES.has(String(match.toolName || '').replace(/^web__/, '')) ||
  WEB_TOOL_NAMES.has(String(match.tool || '').replace(/^web\//, ''));

/**
 * The web catalog for this turn's prompt: both tools while the operator's
 * switch is ON AND a bound being rides this connection — read per turn, so
 * the switch takes effect on the very next turn. The neumaId requirement is
 * the audit property: egress without a journal is never offered (every
 * executed call lands in the being's record, and there is no record without
 * a being). impure (fs/env via web-settings).
 * @param {Object} connection - portal connection
 * @returns {Promise<Array<Object>>}
 */
export const webToolsFor = async (connection, settings = webSettings) => {
  if (!connection?.companion?.neumaId) return [];
  if (await settings.isEnabled()) return [...WEB_TOOLS];
  // OFF is a STATE, not nonexistence (#293). Until 2026-08-10 an off switch
  // emptied the catalog, so a being answered […]
  // and the operator's natural instruction (ask the operator for it) was
  // structurally false (the 2026-08-08 community report). The family now
  // advertises HELD with the door named, so the being can ask its operator
  // for the switch instead of denying the sky. Display only, never access:
  // handleWebTool re-reads the switch fail-closed and refuses every call
  // with this same sentence.
  const note = settings.isEnvLocked()
    ? ' [HELD — web access is locked OFF by the launch environment (NEUMA_WEB_ACCESS=0); calls will refuse until the operator lifts it at launch.]'
    : ' [HELD — web access is OFF; your operator can enable it in SETTINGS (WEB ACCESS). Calls will refuse until then.]';
  return WEB_TOOLS.map((tool) => Object.freeze({ ...tool, description: tool.description + note }));
};

// pure — the search results as the being reads them; the instrument's own
// range note (hint) rides the result so a syntax-shaped silence is never
// mistaken for the field's answer.
//
// Titles and snippets are authored by whoever owns the page, not by the search
// backend — a result row is outside-authored text on the same footing as an
// email body, so the rows ride inside the untrusted frame. The header line
// (backend + retrieval instant) is ours and stays outside it: a being must be
// able to tell the instrument's own words from the field's.
export const renderSearch = (backend, results, hint, retrievedAt = null) => {
  const stamp = retrievedAt ? `, retrieved ${retrievedAt}` : '';
  const note = hint ? `\n${hint}` : '';
  if (results.length === 0) return `No results (via ${backend}${stamp}).${note}`;
  const rows = results
    .map((r) => `- ${r.backend ? `[${r.backend}] ` : ''}${r.title}\n  ${r.url}${r.snippet ? `\n  ${r.snippet}` : ''}`)
    .join('\n');
  const framed = frameUntrustedContent('a web search of the open internet', rows);
  return `Search results (via ${backend}${stamp}):\n${framed}${note}`;
};

// pure — the image results as the being reads them. Same frame law as
// renderSearch: titles are page-authored text and ride INSIDE the untrusted
// frame; the URLs the guard will later re-vet, the dimensions, and the
// retrieval instant are the instrument's own and stay outside.
export const renderImages = (backend, results, retrievedAt = null) => {
  const stamp = retrievedAt ? `, retrieved ${retrievedAt}` : '';
  if (results.length === 0) return `No images found (via ${backend}${stamp}).`;
  const rows = results
    .map((r) => `- ${r.title}\n  image: ${r.url}\n  from: ${r.pageUrl}${r.width ? `\n  ${r.width}x${r.height}` : ''}${r.contentType ? ` ${r.contentType}` : ''}`)
    .join('\n');
  const framed = frameUntrustedContent('an image search of the open internet', rows);
  return `Image results (via ${backend}${stamp}):\n${framed}`;
};

/** At most this many sources ride a chip — the operator scans, not scrolls. */
export const CHIP_SOURCE_CAP = 10;
const SOURCE_TITLE_MAX = 160;
const SOURCE_SNIPPET_MAX = 240;

/**
 * The results as the OPERATOR sees them on the chip. Pure.
 *
 * The chip used to say "5 results (duckduckgo)" and stop, which told the
 * operator that a search happened and nothing about what it found — no way to
 * check a being's sources without asking it to repeat them, which is asking the
 * thing being checked to supply the evidence. These ride the tool event so the
 * desk can list them and the operator can open any one.
 *
 * Bounded on purpose: titles and snippets are page-authored text and this
 * payload is persisted with the turn, so it is capped rather than trusted to be
 * a sane size. Entries without a usable url are dropped — a source you cannot
 * open is not a source.
 *
 * @param {Array<{title?: string, url?: string, snippet?: string}>} results
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
export const toolSources = (results) => (Array.isArray(results) ? results : [])
  .filter((r) => typeof r?.url === 'string' && r.url.trim())
  .slice(0, CHIP_SOURCE_CAP)
  .map((r) => Object.freeze({
    title: String(r.title || '').slice(0, SOURCE_TITLE_MAX),
    url: r.url.trim(),
    snippet: String(r.snippet || '').slice(0, SOURCE_SNIPPET_MAX),
  }));

// pure — the fetched page as the being reads it.
//
// The page body and its <title> both come from the server, so both sit inside
// the untrusted frame; only the URL our own guard resolved, the HTTP status,
// the cap notice, and the retrieval instant stay outside as trusted metadata.
// The instant matters as much as the frame: without it a being cites a page
// with no idea whether it read it now or a month ago, and "current" quietly
// becomes whatever it saw once (the same failure PRESENT MOMENT exists to stop).
export const renderPage = (page, retrievedAt = null) => {
  const route = page.renderer === 'kitesurf'
    ? 'rendered by Kitesurf; origin status unavailable'
    : `HTTP ${page.status}`;
  const meta = [
    `${page.url} (${route})`,
    page.truncated ? ' [text preview truncated — do not reconstruct a file from this; use a web/download intent {url, name} to save the complete original]' : '',
    retrievedAt ? `\nretrieved ${retrievedAt}` : '',
  ].join('');
  const body = `${page.title ? `${page.title}\n\n` : ''}${page.text}`;
  return `${meta}\n${frameUntrustedContent(`the web page at ${page.url}`, body)}`;
};

// impure — the reading list is part of the record; non-blocking, never silent
const journalWebCall = async (connection, tool, detail, status) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return;
  // The OPERATOR's copy too (SEC-035): what a being read from the web is never answered only by
  // its own journal — the act ledger carries the tool, the query or address, and how it went
  // (2026-10-18: a run's findings claimed live-opened sources the operator's record could not check).
  await recordAct({
    laneId: neumaId, name: connection.companion?.name || null, tool, scope: detail,
    decision: 'auto', status: status === 'ok' ? 'success' : 'error',
  });
  try {
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'tool_call',
      content: `${tool} — ${status}: ${detail}`,
      significance: status === 'ok' ? 0.3 : 0.6,
      metadata: { server: 'web', tool, detail, status },
    });
  } catch (err) {
    log.error('Web audit log failed', { neumaId, tool, status, error: err.message });
  }
};

/**
 * Route a web tool call: master switch → ACTS gate → guarded egress.
 * Never the MCP path.
 * @param {Object} ws - the portal socket
 * @param {Object} connection - portal connection (companion, session policy, active turn)
 * @param {Object|null} neumaPolicy - the neuma's persisted tool policy
 * @param {string} toolMode - session ACTS mode
 * @param {Object} match - parsed tool call
 * @param {Object} args - parsed tool args
 * @param {{sendToolEvent: Function, webSettings?: Object}} ports
 *   - the tool-chip event sender, plus an optional settings override (tests
 *     point the switch at tmp files; production always rides the shared instance).
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handleWebTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  // Both dialects land here: the bare/native-encoded toolName, or the
  // server-prefixed slash form — same defensive extraction as every sibling
  // platform handler.
  const bare = String(match.toolName || '').replace(/^web__/, '');
  const toolName = WEB_TOOL_NAMES.has(bare) ? bare : String(match.tool || '').replace(/^web\//, '');
  const tool = `web/${toolName}`;
  const { companion } = connection;
  const settings = ports.webSettings || webSettings;

  // The master switch stands before policy: OFF is the rig's honest state,
  // said so the being can ask the operator for it — never a silent refusal.
  if (!(await settings.isEnabled())) {
    const error = 'Web access is off — your operator can enable it in SETTINGS (WEB ACCESS).';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — web access off` });
    return { tool, status: 'unavailable', error };
  }

  // No being, no egress: every executed call must land in a journal, and
  // there is no journal without a sovereign workspace (same refusal shape
  // as the refinement tools' no-workspace case).
  if (!companion?.neumaId) {
    const error = 'no sovereign workspace on this connection — web reach is for bound beings';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — no workspace` });
    return { tool, status: 'unavailable', error };
  }

  const gate = await gateAct(connection, {
    server: 'web', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  try {
    if (toolName === 'web_search') {
      const out = await searchWeb(args?.query, args?.limit);
      if (!out.ok) {
        ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'web_search — failed', detail: out.error });
        await journalWebCall(connection, tool, String(args?.query || '').slice(0, 120), 'error');
        return { tool, status: 'error', error: out.error };
      }
      ports.sendToolEvent(ws, companion, {
        tool, status: 'ok',
        summary: `"${String(args?.query || '').slice(0, 60)}" — ${out.results.length} results (${out.backend})`,
        // Every link the being just saw, so the operator can open any of them
        // and check the source themselves rather than take the summary's word.
        sources: toolSources(out.results),
      });
      await journalWebCall(connection, tool, String(args?.query || '').slice(0, 120), 'ok');
      return {
        tool, status: 'ok',
        content: renderSearch(out.backend, out.results, out.hint, new Date().toISOString()),
      };
    }
    if (toolName === 'image_search') {
      const out = await searchImages(args?.query, args?.limit);
      if (!out.ok) {
        ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'image_search — failed', detail: out.error });
        await journalWebCall(connection, tool, String(args?.query || '').slice(0, 120), 'error');
        return { tool, status: 'error', error: out.error };
      }
      ports.sendToolEvent(ws, companion, {
        tool, status: 'ok',
        summary: `"${String(args?.query || '').slice(0, 60)}" — ${out.results.length} images (${out.backend})`,
        // The direct image URLs — the operator sees exactly what the being
        // might download, before anything is saved.
        sources: toolSources(out.results),
      });
      await journalWebCall(connection, tool, String(args?.query || '').slice(0, 120), 'ok');
      return {
        tool, status: 'ok',
        content: renderImages(out.backend, out.results, new Date().toISOString()),
      };
    }
    // web_fetch
    const out = await fetchWebPage(String(args?.url || ''));
    if (!out.ok) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'web_fetch — failed', detail: out.error });
      await journalWebCall(connection, tool, String(args?.url || '').slice(0, 200), 'error');
      return { tool, status: 'error', error: out.error };
    }
    ports.sendToolEvent(ws, companion, {
      tool, status: 'ok',
      summary: `${out.url.slice(0, 80)} — ${out.renderer === 'kitesurf' ? 'rendered by Kitesurf' : `HTTP ${out.status}`}${out.truncated ? ' (capped)' : ''}`,
      // Direct reads report the final re-guarded redirect URL. Kitesurf's
      // content endpoint does not expose its final navigation URL, so that
      // branch keeps the last URL the direct reader guarded and says so via
      // its renderer metadata instead of inventing a redirect claim.
      sources: toolSources([{ title: out.title, url: out.url }]),
    });
    await journalWebCall(connection, tool, out.url.slice(0, 200), 'ok');
    return { tool, status: 'ok', content: renderPage(out, new Date().toISOString()) };
  } catch (err) {
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    await journalWebCall(connection, tool, toolName, 'error');
    return { tool, status: 'error', error: err.message };
  }
};
