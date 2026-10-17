// THE PRESS for the being — branded documents from inside its stream:
//
//   press_document — press markdown you wrote into a branded PDF
//                    {markdown, title?, kit?}
//
// Two laws stand over every call:
//
//   1. THE ACTS GATE (tool-policy.js) — requireApproval by default: the
//      press is local rendering with no egress, but the output carries the
//      house's official livery, so the operator blesses the first pressings
//      (one ALWAYS grant persists per being). Observe mode holds it.
//   2. THE WORKSPACE — the PDF lands only inside the being's own sovereign
//      workspace (tool-results/pressed/), never anywhere else on disk.
//
// Every executed press lands in the being's journal. Portal-stream owns the
// socket, so the event sender arrives as an injected port; the ACTS gate
// itself is act-gate.js, the one implementation both seats share.

import path from 'path';
import { neumaWorkspace } from '../../../core/index.js';
import { gateAct } from '../act-gate.js';
import { pressDocument, listBrandKits } from './index.js';
import { locateChromium } from './chromium-press.js';
import { createLogger } from '../logger.js';

const log = createLogger('PressTools');

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const NEUMA_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const PRESS_TOOLS = Object.freeze([
  Object.freeze({
    name: 'press_document',
    server: 'press',
    description: 'Make a PDF: press markdown into a branded PDF document (the press — the Nimbus system) — args {markdown, title?, kit?}. Pass the FULL markdown (read a file first). kit is a brand-kit id your operator configured, e.g. the company\'s short id; an unknown id answers with the available ones; omit for the neutral look. The PDF is saved into your own workspace and the real saved path is returned — report that path, never a guessed one. Supports chartjs/pagebreak fences, ::: summary|feature|warning|note boxes, and @icon tags from the kit.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        markdown: Object.freeze({ type: 'string', description: 'the full markdown source of the document' }),
        title: Object.freeze({ type: 'string', description: 'document title (used for the filename and running header)' }),
        kit: Object.freeze({ type: 'string', description: 'brand kit id (omit for the neutral built-in kit)' }),
      }),
      required: Object.freeze(['markdown']),
    }),
  }),
]);

const PRESS_TOOL_NAMES = new Set(PRESS_TOOLS.map((t) => t.name));

/**
 * Does this parsed call target a press tool? Accepts every dialect: the
 * bare name, the server-prefixed form (press/press_document), and the
 * native function-calling encoding (press__press_document).
 * @param {{toolName?: string, tool?: string}} match
 * @returns {boolean}
 */
export const isPressTool = (match) =>
  PRESS_TOOL_NAMES.has(String(match.toolName || '').replace(/^press__/, '')) ||
  PRESS_TOOL_NAMES.has(String(match.tool || '').replace(/^press\//, ''));

/**
 * The press catalog for this turn's prompt: advertised only when the being
 * has a sovereign workspace AND a Chromium exists on this machine — a tool
 * that could only refuse is noise in the catalog. Fail closed. impure.
 * @param {string|null} neumaId
 * @returns {Array<Object>}
 */
export const pressToolsFor = (neumaId) => {
  if (!neumaId) return [];
  try {
    locateChromium();
  } catch {
    return [];
  }
  return [...PRESS_TOOLS];
};

// pure — a filesystem-safe filename stem from the title
const slugify = (title) =>
  String(title || 'document')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';

// pure — argument validation; returns { error } or the normalized args
const validatePressArgs = (args) => {
  const markdown = args?.markdown;
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return { error: 'press_document needs {markdown}: the full markdown source to press' };
  }
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
    return { error: `the markdown is too large to press (over ${MAX_MARKDOWN_BYTES / (1024 * 1024)}MB)` };
  }
  const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 120) : 'document';
  const kitId = typeof args?.kit === 'string' && args.kit.trim() ? args.kit.trim() : undefined;
  return { markdown, title, kitId };
};

// impure — the pressing itself belongs to the record; non-blocking, never silent
const journalPress = async (connection, detail, status) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return;
  try {
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'tool_call',
      content: `press/press_document — ${status}: ${detail}`,
      significance: 0.4,
      metadata: { server: 'press', tool: 'press_document', detail, status },
    });
  } catch (err) {
    log.error('Press audit log failed', { neumaId, status, error: err.message });
  }
};

/**
 * Route a press tool call: ACTS gate → real press into the being's own
 * workspace, journaled.
 * @param {Object} ws - the portal socket
 * @param {Object} connection - portal connection (companion, session policy, active turn)
 * @param {Object|null} neumaPolicy - the neuma's persisted tool policy
 * @param {string} toolMode - session ACTS mode
 * @param {Object} match - parsed tool call
 * @param {Object} args - parsed tool args
 * @param {{sendToolEvent: Function}} ports - the tool-chip event sender.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handlePressTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const tool = 'press/press_document';
  const { companion } = connection;

  if (!companion?.neumaId || !NEUMA_ID_PATTERN.test(companion.neumaId)) {
    const error = 'no sovereign workspace on this connection — the press saves into a being\'s own home';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: 'press_document — no workspace' });
    return { tool, status: 'unavailable', error };
  }

  const gate = await gateAct(connection, {
    server: 'press', tool: 'press_document', args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const checked = validatePressArgs(args);
  if (checked.error) {
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'press_document — invalid args', detail: checked.error });
    return { tool, status: 'error', error: checked.error };
  }

  ports.sendToolEvent(ws, companion, { tool, status: 'executing' });
  const outputPath = path.join(
    neumaWorkspace.pathFor(companion.neumaId), 'tool-results', 'pressed',
    `${slugify(checked.title)}-${Date.now()}.pdf`,
  );
  try {
    const result = await pressDocument({
      markdown: checked.markdown,
      title: checked.title,
      kitId: checked.kitId,
      outputPath,
    });
    const content = `Document pressed with the "${result.kitId}" kit: ${result.outputPath} (${(result.pdf.length / 1024).toFixed(0)} KB).`;
    ports.sendToolEvent(ws, companion, {
      tool, status: 'ok',
      summary: `pressed "${checked.title}" — ${(result.pdf.length / 1024).toFixed(0)} KB`,
      detail: content,
    });
    await journalPress(connection, `"${checked.title}" → ${result.outputPath} (kit: ${result.kitId})`, 'ok');
    return { tool, status: 'ok', content };
  } catch (err) {
    // An unknown kit is the likeliest miss — answer with the real choices.
    const kits = await listBrandKits().catch(() => []);
    const kitHint = kits.length > 0 ? ` Available kits: ${kits.map((k) => k.id).join(', ')} (or omit kit for neutral).` : '';
    const error = `The press failed: ${err.message}.${kitHint}`;
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'press_document — failed', detail: error });
    await journalPress(connection, err.message, 'error');
    return { tool, status: 'error', error };
  }
};
