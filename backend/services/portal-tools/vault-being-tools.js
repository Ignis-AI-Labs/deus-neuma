/**
 * Personal vault tool family (T3-personal) — the four DEK-encrypted vault
 * READS (vault_list, vault_read, vault_search, vault_history) and their
 * ACTS-gated handler. The five vault mutations are `vault/*` intents (#414).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 5 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { neumaWorkspace } from '../../../core/index.js';
import { slugify } from '../../../core/vault/note.js';
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

// --- Personal vault tools (T3-personal) --------------------------------
// A being's own curation space over its memory: encrypted notes inside its
// sovereign workspace, plus the explicit publish gesture into the shared
// collective vault. Save/list/read/search/rename/archive/history/restore are
// self-authorship over the being's OWN store (default-allowed — every one is
// stamp-and-retain, nothing erases); publish crosses into the commons and
// stays operator-gated.

/* THE CATALOG CUT, SECOND HALF (#414). The five vault MUTATIONS — save,
   rename, archive, restore, publish — are `vault/*` intents (Stage 3 batch 4)
   and their policy rows moved with them. Definitions and handlers follow now,
   which is what CLOSES that landing rather than starting it: a name left
   dispatching after its row has gone fails `checkToolAccess` closed and raises
   an approval card no one asked for. Gone from here, a stale call from an old
   plan or skills pack meets the unavailable wall and is handed its intent.
   The four READS stay: the vault is DEK-encrypted, so the fs primitives the
   retirement hint points at would return ciphertext. */
const VAULT_TOOLS = Object.freeze([
  Object.freeze({
    name: 'vault_list',
    server: 'vault',
    description: 'List the pages in your private vault — no args. Returns each page name, title, and last-updated time.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
  Object.freeze({
    name: 'vault_read',
    server: 'vault',
    description: 'Read one page from your private vault — args {name}.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        name: Object.freeze({ type: 'string', description: 'the page name to read' }),
      }),
      required: Object.freeze(['name']),
    }),
  }),
  Object.freeze({
    name: 'vault_search',
    server: 'vault',
    description: 'Search YOUR private vault by word — args {query}. Matches page titles and bodies (case-insensitive) and returns each hit with a short snippet centered on the match. Archived pages do not answer; only your live curation.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        query: Object.freeze({ type: 'string', description: 'the word or phrase to find' }),
      }),
      required: Object.freeze(['query']),
    }),
  }),
  Object.freeze({
    name: 'vault_history',
    server: 'vault',
    description: 'List the earlier versions of one of your vault pages — args {name}. Every rewrite is kept; returns each revision id (newest first), for a vault/restore intent.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        name: Object.freeze({ type: 'string', description: 'the page name whose history you want' }),
      }),
      required: Object.freeze(['name']),
    }),
  }),
]);

const VAULT_TOOL_NAMES = new Set(VAULT_TOOLS.map((t) => t.name));

// Does this parsed call target a vault tool? (accepts both dialects)
const _isVaultTool = (match) =>
  VAULT_TOOL_NAMES.has(match.toolName) ||
  VAULT_TOOL_NAMES.has(String(match.tool || '').replace(/^vault\//, ''));

// impure — route a vault READ through the same ACTS gate as every governed
// tool, then the encrypted workspace. Never the MCP path.
const _handleVaultTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = VAULT_TOOL_NAMES.has(match.toolName)
    ? match.toolName
    : String(match.tool || '').replace(/^vault\//, '');
  const tool = `vault/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    server: 'vault', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no sovereign workspace on this connection';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no workspace`, detail: error });
    return { tool, status: 'error', error };
  }

  try {
    if (toolName === 'vault_list') {
      const notes = await neumaWorkspace.listVaultNotes(neumaId);
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${notes.length} page(s)` });
      const lines = notes.map((n) => `- ${n.slug} — "${n.title}" (updated ${n.updatedAt})`);
      return { tool, status: 'ok', content: notes.length ? `Your vault:\n${lines.join('\n')}` : 'Your vault is empty — file a vault/save intent to start your first page.' };
    }
    if (toolName === 'vault_read') {
      const slug = slugify(String(args?.name || ''));
      const note = await neumaWorkspace.readVaultNote(neumaId, slug);
      if (!note) throw new Error(`no page named "${slug}" in your vault`);
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `read "${note.title}"` });
      return { tool, status: 'ok', content: `# ${note.title}\n\n${note.body}` };
    }
    if (toolName === 'vault_search') {
      const hits = await neumaWorkspace.searchVaultNotes(neumaId, args?.query);
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${hits.length} page(s) matched` });
      if (!hits.length) {
        return { tool, status: 'ok', content: `Nothing in your vault matches "${String(args?.query ?? '').trim()}" — an honest empty, not an error.` };
      }
      const lines = hits.map((h) => `- ${h.slug} — "${h.title}"\n  ${h.snippet}`);
      return { tool, status: 'ok', content: lines.join('\n') };
    }
    // vault_history — the last read. Explicit rather than a fallthrough: the
    // mutations that used to end this chain are gone, and a bare fallthrough
    // would hand an unmatched name someone else's answer.
    if (toolName === 'vault_history') {
      const slug = slugify(String(args?.name || ''));
      const revisions = await neumaWorkspace.listVaultHistory(neumaId, slug);
      if (!revisions.length) {
        const note = await neumaWorkspace.readVaultNote(neumaId, slug);
        if (!note) throw new Error(`no page named "${slug}" in your vault`);
        _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `no revisions of ${slug} yet` });
        return { tool, status: 'ok', content: `"${slug}" has no earlier revisions yet — history begins with the first rewrite.` };
      }
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${revisions.length} revision(s) of ${slug}` });
      const lines = revisions.map((r) => `- ${r.revision} — "${r.title}" (from ${r.updatedAt})`);
      return { tool, status: 'ok', content: `Earlier versions of "${slug}" (newest first):\n${lines.join('\n')}\nRestore one by filing a vault/restore intent {name, revision}.` };
    }
    throw new Error(`${toolName} is not a vault read — the vault mutations are vault/* intents`);
  } catch (err) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};

// The family's catalog, matcher, and handler — portal-stream re-imports the
// private names under their old spellings for the dispatch fan and the
// `__test` proof set.
export {
  VAULT_TOOLS,
  _isVaultTool as isVaultTool,
  _handleVaultTool as handleVaultTool,
};
