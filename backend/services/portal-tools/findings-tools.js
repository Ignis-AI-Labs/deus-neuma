/**
 * FINDINGS — a being hands its operator a list it gathered, formatted so a
 * person can review it.
 *
 * Design note, 2026-08-30: […]
 *
 * NOT `sources`, AND THE DIFFERENCE IS THE POINT. A tool chip already carries
 * the research record — every url the being pulled — collapsed behind a `+`.
 * That is EVIDENCE: what it looked at, gathered automatically, there to be
 * audited. This is the opposite act: what the being CHOSE to hand over, in an
 * order it meant, open on arrival because it is the answer rather than the
 * receipt.
 *
 * IT RIDES THE TOOL-ACTION RECORD, which is why there is no new store here.
 * `sources` already travels event → `collectToolAction` → the persisted turn →
 * the rebuilt segment on resume. Findings take the same road, so a list the
 * operator was handed on Tuesday is still on the card when he reopens the chat
 * on Friday, in the position the act actually occupied. A second store would
 * have had to reinvent all of that and could then disagree with it.
 *
 * NO EGRESS, NO SIDE EFFECT. This tool reaches nothing outside the
 * conversation — it cannot fetch, write, or spend. It is allowed by default
 * for that reason: asking the operator to approve being shown a list would be
 * the wrong shape, exactly as it was for the platform's own numbers.
 */
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';
import {
  FINDINGS_LIMITS, findingsRefusals, normalizeFindings, findingsSummary,
} from '../findings-list.js';

const _isFindingsTool = (match) =>
  match.toolName === 'share_findings' || match.tool === 'house/share_findings';

const SHARE_FINDINGS_TOOL = Object.freeze({
  name: 'share_findings',
  server: 'house',
  description: `Hand your operator a LIST you gathered — args {title, note?, items[]}. Use it whenever the answer is a set of candidates to choose between rather than a paragraph: fonts, colour palettes, tools, references, competitors. The list renders as a card in the chat, open, with working links, and it stays there. title says what the list IS (e.g. DISPLAY FACES, max ${FINDINGS_LIMITS.title}). Each item is {label, detail?, url?, meta?, swatches?}: label is the thing's name, detail is one line on why it fits, url is where to see it, meta is a short right-hand tag such as a licence, and swatches is up to ${FINDINGS_LIMITS.swatches} hex colours drawn as real colour chips — use it for palettes. Up to ${FINDINGS_LIMITS.items} items; anything past a field's cap is refused with the count so you can shorten it. Say what you think in your own words too — the card is the list, not your judgement of it.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      title: Object.freeze({ type: 'string', description: `What this list is, e.g. DISPLAY FACES (max ${FINDINGS_LIMITS.title} characters)` }),
      note: Object.freeze({ type: 'string', description: `Optional one line framing the list, e.g. "for the brand cards" (max ${FINDINGS_LIMITS.note})` }),
      items: Object.freeze({
        type: 'array',
        description: `What you found, in the order you would have the operator read it (max ${FINDINGS_LIMITS.items})`,
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            label: Object.freeze({ type: 'string', description: `The thing's name (max ${FINDINGS_LIMITS.label})` }),
            detail: Object.freeze({ type: 'string', description: `One line on what it is or why it fits (max ${FINDINGS_LIMITS.detail})` }),
            url: Object.freeze({ type: 'string', description: 'http(s) link where the operator can see it' }),
            meta: Object.freeze({ type: 'string', description: `Short right-hand tag — a licence, a price, a source (max ${FINDINGS_LIMITS.meta})` }),
            swatches: Object.freeze({
              type: 'array',
              description: `Up to ${FINDINGS_LIMITS.swatches} hex colours (#4f8bff) drawn as colour chips — for palettes`,
              items: Object.freeze({ type: 'string' }),
            }),
          }),
          required: Object.freeze(['label']),
        }),
      }),
    }),
    required: Object.freeze(['title', 'items']),
  }),
});

/**
 * File one findings list. impure — emits to the socket only.
 *
 * THE REFUSAL GOES BACK TO THE BEING, BY NAME AND NUMBER, and no card is
 * drawn. A findings list that half-renders is worse than one that did not:
 * the operator would scan it as complete.
 */
const _handleFindings = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = 'share_findings';
  const tool = `house/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    server: 'house', tool: toolName,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const refusals = findingsRefusals(args);
  if (refusals.length) {
    const error = `this list cannot be drawn: ${refusals.join('; ')}`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — refused`, detail: error });
    return { tool, status: 'error', error };
  }

  const findings = normalizeFindings(args);
  const summary = findingsSummary(findings);
  // `findings` rides beside the event exactly as `sources` does — the record
  // collects it, the reducer reads it, the card draws it, and a resumed chat
  // rebuilds it without re-running anything.
  _sendToolEvent(ws, companion, { tool, status: 'ok', summary, findings });

  // What the BEING gets back is a plain confirmation, not the list echoed. It
  // just wrote the list; handing it straight back would spend context on text
  // it already holds, and invite it to read the card aloud in its reply.
  return {
    tool,
    status: 'ok',
    content: `Filed for your operator: "${findings.title}" — ${findings.count} item${findings.count === 1 ? '' : 's'}. It is on the card in the chat; say what you make of it in your own words.`,
  };
};

/** Always available: every being can hand its operator a list. */
const _findingsToolsFor = () => [SHARE_FINDINGS_TOOL];

export {
  SHARE_FINDINGS_TOOL,
  _isFindingsTool as isFindingsTool,
  _handleFindings as handleFindings,
  _findingsToolsFor as findingsToolsFor,
};
