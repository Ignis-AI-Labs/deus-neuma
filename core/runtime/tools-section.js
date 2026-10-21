/**
 * The TOOLS section of the assembled prompt — extracted from
 * prompt-assembler.js under the size law (the assembler sat exactly at its
 * frozen baseline; the section builder is its own single responsibility).
 *
 * ONE catalog, chosen by capability (#281 / BE-155). Native neuma turns carry
 * only the read-only search hand plus schemas disclosed for this task; this
 * section holds the exact compact index and ACTS tiers so every enabled tool
 * stays discoverable without paying every argument schema on every turn.
 * Non-lazy callers retain the original full-text or all-native rendering.
 */

import { toolLine } from './tool-signature.js';

/** Shared completion contract for native and text tool use on both seats. */
export const TOOL_COMPLETION_INSTRUCTION = 'Call one tool at a time. Wait for its completed result before choosing the next call; a submitted or running operation is not completed.';
/** The same contract when the sender allowed several calls in one reply (BFCL 2026-10-11:
 * […] held the parallel categories at 0.10-0.45 against bare's 0.82-0.94). */
export const PARALLEL_COMPLETION_INSTRUCTION = 'Wait for a call\'s completed result before any call that depends on it; a submitted or running operation is not completed.';
const completionInstruction = (parallelCalls) => (parallelCalls ? PARALLEL_COMPLETION_INSTRUCTION : TOOL_COMPLETION_INSTRUCTION);

const focusGroundText = (focusGround) => focusGround
  ? `\n\nYOUR GROUND THIS TURN: ${focusGround}
This is the folder your operator has open. You may read and write inside it
freely — no path approval is needed there, because their having it open IS the
grant. It is shared ground: your operator is working in it too, and so is any
sealed peer sitting with you. Prefer it as the place your work lands. Paths
outside it still ask (see below).`
  : '';

// THE SENDER'S TOOLS (backend/services/caller-tools.js): when the task came
// with its own tools, its world lives on the sender's side. AgentDojo,
// 2026-09-29: beings looked for the task's files on their own ground (fs/list,
// fs/search) before reaching for the sender's read_file. One line, only when
// caller tools ride; every other prompt is byte-identical.
export const callerToolsNote = (tools) => (tools.some((tool) => tool.server === 'caller')
  ? '\nTHE SENDER\'S TOOLS — every caller/ tool belongs to whoever sent this task. The task\'s world (its files, accounts, messages, services) lives on their side: reach it through the caller/ tools, never your own fs/ ground, which does not hold it. Each caller/ call goes back to the sender and their result comes back to you.\n'
  : '');

// THE TOOL HUD (backend/services/tool-hud.js; Design note, 2026-10-14: […]). The wire carries
// two doors and never changes; the HUD names the families, the being's usual
// tools by signature (its experience — frozen for the chat), and the few rules
// that shape how work is conducted. Everything else is one search away.

// Doctrine the HUD must not strip — a mandate on HOW work is conducted, not
// just what is callable (Design note, 2026-08-16: plans proposed as prose, questions
// asked without options). One line each, only when the tool rides this turn.
const HUD_DOCTRINE = Object.freeze([
  ['operator/ask_operator', 'Decisions go to your operator through operator/ask_operator — 2-4 options, your recommendation first; never a question in prose. It is the AskUserQuestion your skills name.'],
  ['team/plan_submit', 'A plan is delivered through team/plan_submit and waits for the verdict; a plan written as prose cannot be approved.'],
]);

const idOf = (tool) => `${tool.server}/${tool.name}`;

/**
 * The HUD's lines, shared by the being seat (below) and the witness seat
 * (backend/services/witness-prompt.js) — one HUD, two frames. Pure.
 * @param {Array<{server: string, name: string, access?: string, inputSchema?: object}>} tools this turn's catalog
 * @param {{usual?: Array<object>, parallelCalls?: boolean}} [opts] usual: the being's usual tools (its experience)
 * @returns {string[]}
 */
export const hudToolLines = (tools, { usual = [], parallelCalls = false } = {}) => {
  const have = new Set(tools.map(idOf));
  const families = [...new Set(tools.map((tool) => tool.server).filter((server) => server !== 'system' && server !== 'caller'))];
  const held = tools.filter((tool) => tool.access === 'denied').map(idOf);
  const asks = tools.some((tool) => tool.access === 'approval_required');
  return [
    'Two calls reach every tool you have, the same two every turn:',
    '- system/call {"tool": "server/name", "args": {…}} — when you know the tool and its arguments.',
    '- system/tool_search {"query": …} — an exact id returns its full arguments; a family ("web/") lists every tool in it; a phrase finds what fits.',
    `Your tool families: ${families.join(' · ')}`,
    usual.length ? `Your usual tools — call them directly: ${usual.map(toolLine).join(' · ')}` : null,
    held.length ? `HELD THIS TURN (your operator is observing — these will not act): ${held.join(', ')}` : null,
    asks ? 'Some tools ask your operator first — the call raises their card; reach for it when the work needs it.' : null,
    callerToolsNote(tools).trim() || null,
    ...HUD_DOCTRINE.filter(([id]) => have.has(id)).map(([, line]) => line),
    `- ${completionInstruction(parallelCalls)}`,
    '- Call tools without narrating them — your operator sees every call. Never promise a later action: act now or answer.',
    '- No native calling? Write [TOOL: server/name {"arg": "value"}].',
  ].filter(Boolean);
};

const buildHudToolsSection = (tools, focusGround, usual, parallelCalls) => [
  '## Your Tools',
  focusGround ? `YOUR GROUND: ${focusGround} — the folder your operator has open, shared with them; read and write there freely. Paths outside it raise their card; only their no is a no.` : null,
  ...hudToolLines(tools, { usual, parallelCalls }),
].filter(Boolean).join('\n');

/**
 * Render the Dimensional Tools section.
 * Pure.
 * @param {Array<{server: string, name: string, description: string, access?: string}>|null} tools
 * @param {string|null} focusGround - the folder open in the operator's Explorer
 * @param {boolean} nativeToolsOnWire - true when the request body carries the
 *   full native tool schema, so descriptions must not be paid for twice
 * @param {boolean} lazySchemas - render the exact compact index and disclosure hand
 * @param {boolean} parallelCalls - the sender allowed several calls in one reply
 * @param {Array<object>} usualTools - the being's usual tools, named in the HUD by signature (tool-hud.js)
 * @returns {string} the section text, '' when no tools ride
 */
export const buildToolsSection = (tools, focusGround = null, nativeToolsOnWire = false, lazySchemas = false, parallelCalls = false, usualTools = []) => {
  if (!tools?.length) return '';
  if (lazySchemas) return buildHudToolsSection(tools, focusGround, usualTools, parallelCalls);

  // Render each tool as its EXACT callable identifier `server/tool` (e.g.
  // `filesystem/read_file`) — the same string that goes inside the call. Do NOT
  // show the name and server separately: given `- read_file (filesystem)` a model
  // tends to emit the bare `read_file` or the literal placeholder `server/read_file`
  // instead of the real `filesystem/read_file`, and the call fails to route.
  // The resolved tier rides the line when the caller stamped one
  // (`annotateToolAccess`). A tool with no stamp renders exactly as before, so
  // every caller that hands over a plain catalog is unaffected. The marker
  // goes at the END of the line: the identifier must stay verbatim at the
  // front, because a model that sees decoration next to the name emits the
  // decoration.
  const gateNote = (access) => {
    if (access === 'approval_required') return ' — [asks your operator first]';
    if (access === 'denied') return ' — [held: your operator is watching, not acting]';
    return '';
  };
  const toolList = tools
    .map(t => nativeToolsOnWire
      ? `- ${t.server}/${t.name}${gateNote(t.access)}`
      : `- ${t.server}/${t.name}: ${t.description}${gateNote(t.access)}`)
    .join('\n');
  const anyGated = tools.some(t => t.access === 'approval_required' || t.access === 'denied');

  // THE FOCUS GROUND: the folder standing open in the operator's Explorer. It
  // is shared — the operator, you, and any sealed peer are all working on the
  // same one. Saying so is not decoration: a being that does not know it has
  // the folder either asks for permission it already holds, or works somewhere
  // else entirely while the operator watches the wrong directory.
  const ground = focusGroundText(focusGround);

  return `## Dimensional Tools
You have access to tools that let you interact with the operator's realm.${ground}

Available tools (each line is the exact identifier to call — use it verbatim):
${toolList}
${callerToolsNote(tools)}
${completionInstruction(parallelCalls)}

To call a tool, use this form (works for every call; required for multi-line content).
Replace \`<identifier>\` with one of the exact \`server/tool\` identifiers listed above:
<tool_call>
<function=<identifier>>
<parameter=arg_name>
arg value (may span lines)
</parameter>
</function>
</tool_call>

A compact single-line form is also accepted for short calls: [TOOL: <identifier> {"arg": "value"}]
For example, to list the folders you may read: [TOOL: ${(tools.find((t) => t.server === 'fs' && t.name === 'list') || tools[0]).server}/${(tools.find((t) => t.server === 'fs' && t.name === 'list') || tools[0]).name} {}]

IMPORTANT:
- Use the exact \`server/tool\` identifier from the list above — never a bare tool name and never the literal word "server".${anyGated ? `
- A tool marked [asks your operator first] still works — calling it raises a card
  your operator answers. That is a normal step, not a wall: reach for it when the
  work needs it. A tool marked [held] will not act this turn, because your
  operator is in observe mode; say what you would have done instead of pretending
  it ran.` : ''}
- Call tools without narrating them; your operator sees every call and its result
- After results return, take the next action or give your answer
- Never narrate an action you will take later — take it NOW with a tool call, or deliver the final answer. A reply that only promises a later action ends the turn with nothing done
- Your allowed folders are a STARTING ground, not a wall: reading a path outside
  them raises an approval ask to your operator — a card they answer with a yes or
  a no. When your work needs a file beyond your roots, CALL the tool on that
  exact path and let the operator decide; never conclude you are blind and stop.
  Only the operator's no is a no`;
};

/**
 * The filed acts by FAMILY, names only — `- tasks/add · tasks/update` — with
 * a channel-bound type naming its channels. Every contract (fields, rules,
 * when to use it) is one tool_search away, by exact name or by family. LOAD ON
 * DEMAND, the second step: 2026-10-04 cut each line to its fields and a 90-char
 * hook; 2026-10-14 (Founder, the token audit) to its name — a being still paid
 * ~1,300 tokens per request for 37 lines it read only when it filed. Pure.
 * @param {Array<{name: string, channels?: string[]}>} intentTypes
 * @returns {string[]}
 */
export const intentFamilyLines = (intentTypes) => {
  const families = new Map();
  for (const t of intentTypes) {
    const at = t.name.indexOf('/');
    const family = at > 0 ? t.name.slice(0, at) : t.name;
    // the FULL name — it is what the filed JSON's "type" must say, exactly
    const act = `${t.name}${t.channels?.length ? ` (channels: ${t.channels.join(', ')})` : ''}`;
    families.set(family, [...(families.get(family) || []), act]);
  }
  return [...families.values()].map((acts) => `- ${acts.join(' · ')}`);
};

/**
 * The INTENTS block (Stage 2 of docs/planning/proposals/being-tool-surface-primitives.md):
 * consequential acts are FILES the being writes into its own lane, never tool
 * calls — the platform sweeps, asks the operator when the type's tier asks,
 * executes, and writes the outcome beside the intent. Rendered ONLY when the
 * lane has at least one intent type available (a channel it may speak or stage
 * through); absent lanes keep their prompt byte-identical.
 *
 * Pure — the caller (backend/services/intents/intents-section.js) computes
 * availability and the lane's intents directory; this only renders.
 *
 * @param {Array<{name: string, fieldsForPrompt: string, descriptionForPrompt: string, channels: string[]}>} intentTypes
 * @param {string} intentsDir - the lane's intents directory (absolute)
 * @returns {string} the section text, '' when no type is available
 */
export const buildIntentsSection = (intentTypes, intentsDir, { searchable = true } = {}) => {
  if (!intentTypes?.length) return '';
  // A wire with no search door (the text wire) carries each contract here: the being has nowhere else to read it.
  const listing = searchable
    ? `Types you may file, by family — before filing one, call system/tool_search with its exact name (e.g. "${intentTypes[0].name}") for its full contract, or with a family (e.g. "${intentTypes[0].name.split('/')[0]}/") for every contract in it:
${intentFamilyLines(intentTypes).join('\n')}`
    : `Types you may file, each with its fields:
${intentTypes.map((t) => `- ${t.name}${t.channels?.length ? ` (channels: ${t.channels.join(', ')})` : ''} ${t.fieldsForPrompt || ''} — ${t.descriptionForPrompt || ''}`).join('\n')}`;
  return `## Intents — consequential acts are FILES, not tool calls
To act beyond your tools, write a JSON file at ${intentsDir}/<a-unique-name>.json holding {"type": "<one of the types below>", …its fields} (your own lane is always yours to write). The platform returns settlement receipts with the tool results — validation, your operator's card when the type asks, then execution; do not poll or reread it. After an interruption, read that saved result once (${intentsDir}/<name>.result.json). No result is not failure and never a reason to file again; a settled intent never runs twice.

${listing}`;
};
