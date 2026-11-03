/**
 * Portal tool events — the being seat's tool-chip formatting and event sink.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 1 / #278): the result
 * formatters, the verb table + one-line action summary, the tool:usage
 * event sender, and the capped chip detail pane. Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { collectToolAction } from '../tool-action-record.js';

// --- Tool formatting ---

export const toolFormatters = Object.freeze({
  list: (content) => {
    const lines = content.split('\n').filter(line => line.trim());
    const items = lines.map(line => {
      if (line.includes('[DIR]')) return `📁 ${line.replace('[DIR]', '').trim()}/`;
      if (line.includes('[FILE]')) return `📄 ${line.replace('[FILE]', '').trim()}`;
      return line;
    });
    return `I can see ${lines.length} items in that folder:\n\n${items.join('\n')}`;
  },
  read: (content) => `Here's what's in the file:\n\n\`\`\`\n${content}\n\`\`\`\n`,
  write: () => '✓ File written successfully\n',
  // fs/edit has NO formatter on purpose: it falls through to `default` so the platform hand's own text reaches the chip. The canned '✓ File edited successfully' that stood here hid WHERE the edit landed, on the one tool measured to land in the wrong place 3.07% of the time (#299).
  create_memory: (content) => `💭 Memory created: ${content}\n`,
  retrieve_memory: (content) => `💭 Retrieved memory: ${content}\n`,
  search_memory: (content) => {
    try {
      const results = JSON.parse(content);
      if (Array.isArray(results) && results.length > 0) {
        return `💭 Found ${results.length} memories:\n${results.map(r => `• ${r}`).join('\n')}\n`;
      }
      return '💭 No memories found matching your search.\n';
    } catch {
      return `💭 Memory search results: ${content}\n`;
    }
  },
  default: (content) => content
});

/** Expanded-view detail is capped — the chip's detail pane is a window,
 *  not an archive; the full result lives in the session record. */
export const TOOL_DETAIL_MAX_CHARS = 2000;

// Past-tense verbs for the one-line action summary the operator reads
const TOOL_VERBS = Object.freeze({
  write_file: 'wrote', write: 'wrote', read_file: 'read', read_text_file: 'read', read: 'read',
  edit_file: 'edited', edit: 'edited', create_directory: 'created',
  list_directory: 'listed', list: 'listed', list_directory_with_sizes: 'listed',
  search_files: 'searched', search_content: 'grepped', search: 'searched',
});

// THE EVENT DESCRIBES ITSELF (ruling, 2026-10-03): […] The chip's line is built from the act's own data: what it
// was given and what came back. The being never spends context narrating it.
const TARGET_KEYS = Object.freeze(['path', 'url', 'query', 'name', 'command', 'cmd', 'code', 'pattern', 'key', 'id', 'recipient', 'to']);
const oneLine = (value, max) => {
  const flat = String(value).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
// pure — what the act was given: its named target, else its first text argument.
const targetOf = (args) => {
  const key = TARGET_KEYS.find((k) => (typeof args?.[k] === 'string' && args[k].trim()) || typeof args?.[k] === 'number');
  if (key) return oneLine(args[key], 80);
  const first = Object.values(args ?? {}).find((v) => typeof v === 'string' && v.trim());
  return first ? oneLine(first, 80) : null;
};
// pure — what came back, as its first non-empty line.
const outcomeOf = (content) => {
  const line = String(content ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  return line ? oneLine(line, 60) : null;
};

const transferSummary = (toolName, args, active = false) => {
  const isTransfer = ['move', 'copy', 'move_file', 'copy_file'].includes(toolName)
    || (toolName === 'edit' && args?.destination);
  if (!isTransfer) return null;
  const source = args?.path || args?.source;
  const destination = args?.destination || args?.to || args?.target;
  if (!source || !destination) return null;
  const copying = toolName === 'copy' || toolName === 'copy_file' || args?.copy === true;
  const verb = active ? (copying ? 'copying' : 'moving') : (copying ? 'copied' : 'moved');
  return `${verb} ${oneLine(source, 80)} → ${oneLine(destination, 80)}`;
};

export const toolActivitySummary = (toolName, args) => transferSummary(toolName, args, true);

// One human line per action: "wrote data/dna-cache/FENNA.md" — an fs/edit sub-op names its real act (a delete never wears an edit's word).
// Any other tool reads […]: the act and its result, both from the event.
export const toolSummary = (toolName, args, content) => {
  const transfer = transferSummary(toolName, args);
  if (transfer) return transfer;
  const target = args?.path || args?.url || args?.query || args?.name || targetOf(args);
  const subOp = toolName === 'edit' && args?.delete === true ? 'deleted' : null;
  const verb = subOp || TOOL_VERBS[toolName];
  if (verb && target) return `${verb} ${target}`;
  const base = target ? `${toolName} ${target}` : toolName;
  const outcome = content === undefined ? null : outcomeOf(content);
  return outcome ? `${base} → ${outcome}` : base;
};

/** pure — a failed act's line: what it was, and the reason, from the error itself. */
export const toolFailureSummary = (toolName, args, error) => `${toolSummary(toolName, args)} — failed: ${oneLine(error?.message ?? error ?? 'unknown error', 120)}`;

// Structured action events drive the frontend's tool chips. Display
// channel only — session records keep the full response text untouched.
export const sendToolEvent = (ws, companion, event) => {
  ws.send(JSON.stringify({
    type: 'tool:usage',
    companion: companion?.name || 'unknown',
    // Which being acted — additive, so desk surfaces (e.g. TASKS) can react
    // to one being's work without guessing from the display name.
    neumaId: companion?.neumaId ?? null,
    ...event,
  }));
  collectToolAction(ws, event);
};

// --- Tool-action history: the chips must survive a chat restart ---
//
// Every result event also lands in the turn's tool-action record, persisted on
// the assistant record by _persistExchange. A resumed chat rebuilds its settled
// tool segments from that (never re-executed), in the positions the acts
// actually occupied — see tool-action-record.js for the law both seats keep.

// Operator-chip detail pane (FR-7): capped at TOOL_DETAIL_MAX_CHARS. When the
// full result was persisted this session, the truncation marker names the ref
// — the "session record" claim made true. No ref keeps the honest old form.
// pure
export const chipDetail = (formatted, ref) => {
  if (formatted.length <= TOOL_DETAIL_MAX_CHARS) return formatted;
  const marker = ref
    ? `[truncated — full result retrievable this session: ${ref}]`
    : '[truncated — full result in session record]';
  return `${formatted.slice(0, TOOL_DETAIL_MAX_CHARS)}\n${marker}`;
};
