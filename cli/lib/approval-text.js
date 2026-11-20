// WHAT AN APPROVAL SHOWS OUTSIDE THE DESK — the terminal and an ACP editor have
// no "show full" control, so the one look they give must be the whole act:
// what it reaches first (path, address, command), what a yes grants (scope),
// then every word the act will run with. The portal's frame carries a
// 600-character preview for the desk card and, past that cut, the full text
// beside it (tool-approval.js); a yes here is never given to words that were
// not shown, so an act too long to show — or one whose full text did not
// arrive — is refused instead of asked.
//
// Pure.

/** Above this the act cannot be read in a terminal or an editor prompt: it is refused, to be approved at the desk. */
export const APPROVAL_SHOW_MAX_CHARS = 100_000;

/** The args that say what an act reaches, in the order they are shown. */
export const APPROVAL_TARGET_KEYS = Object.freeze(['path', 'paths', 'source', 'destination', 'to', 'url', 'command']);

const CUT_MARK = '\n[truncated]';

const parseObject = (text) => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const targetLines = (args) => APPROVAL_TARGET_KEYS
  .filter((key) => args && args[key] !== undefined && args[key] !== null && args[key] !== '')
  .map((key) => `${key}: ${typeof args[key] === 'string' ? args[key] : JSON.stringify(args[key])}`);

/**
 * Read an approval frame (as classifyFrame returns it) into what the operator is shown.
 * @param {{ tool: string, args?: string, fullArgs?: string, scope?: string, label?: string }} frame
 * @returns {{ showable: boolean, why: string, name: string, scope: string, targets: string[], text: string, input: object }}
 *   `text` is every word of the args; `input` is the same parsed (for an editor's raw view);
 *   `showable` false means the act must be refused, with `why` saying so in plain words.
 */
export const readApproval = (frame) => {
  const preview = typeof frame.args === 'string' ? frame.args : '';
  const text = typeof frame.fullArgs === 'string' && frame.fullArgs ? frame.fullArgs : preview;
  const name = frame.label && frame.label !== frame.tool ? `${frame.tool} (${frame.label})` : String(frame.tool);
  const scope = typeof frame.scope === 'string' ? frame.scope : '';
  const base = { name, scope, targets: [], text: '', input: {} };
  if (!frame.fullArgs && preview.endsWith(CUT_MARK)) {
    return { ...base, showable: false, why: 'only a cut preview of this act arrived, not its full text' };
  }
  if (text.length > APPROVAL_SHOW_MAX_CHARS) {
    return { ...base, showable: false, why: `this act is ${text.length} characters, too long to show here — approve it at the desk` };
  }
  const args = parseObject(text);
  return { showable: true, why: '', name, scope, targets: targetLines(args), text, input: args ?? { text } };
};

/**
 * The terminal's words for one approval: the reach first, then the whole act.
 * @param {ReturnType<typeof readApproval>} ask
 * @returns {string}
 */
export const approvalTerminalText = (ask) => [
  `approval requested: ${ask.name}`,
  ...(ask.scope ? [`  a yes grants: ${ask.scope}`] : []),
  ...ask.targets.map((line) => `  ${line}`),
  ...(ask.text ? ['the whole act:', ask.text] : []),
].join('\n');

/**
 * The lines an editor shows above its raw view of the act.
 * @param {ReturnType<typeof readApproval>} ask
 * @returns {string}
 */
export const approvalEditorText = (ask) => [
  ...(ask.scope ? [`A yes grants: ${ask.scope}`] : []),
  ...ask.targets,
].join('\n');
