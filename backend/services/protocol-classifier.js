/**
 * THE PROTOCOL CLASSIFIER — the ground's law arriving at the moment of the act.
 *
 * Design note, 2026-07-26: […]
 *
 * `ground-protocol.js` hands a resident the law at the top of the turn. It is
 * read once, and a turn is long. This says the same thing again at the one
 * moment it is about to matter — beside the act itself.
 *
 * WHY THIS CANNOT BECOME A GATE. Three properties, and none of them is a naming
 * convention (a review of the plan correctly killed the first draft's
 * `string → string` guarantee: four lines in a dispatch loop with `status: 'ok'`
 * hardcoded rebuilds a gate with the signature unchanged):
 *
 *   1. IT RUNS AFTER. Its only callers are the four result FORMATTERS, which run
 *      once the tools have already executed. There is no control flow left to
 *      take — a gate would have to be installed at the dispatch site, and
 *      `protocol-classifier-hygiene.test.js` reds the suite the moment any
 *      module outside those four imports this one.
 *   2. IT IS BLIND TO OUTCOMES. It is handed what was ATTEMPTED — tool name and
 *      arguments — and never learns whether anything succeeded, was refused, or
 *      threw. A gate needs a verdict to act on; this module cannot see one.
 *   3. IT RETURNS PROSE. The rendered payload, byte-identical when nothing
 *      fired. No exported function returns a boolean, and a caller cannot tell
 *      a quiet turn from a loud one without diffing.
 *
 * IT HOLDS NO STATE. Not a simplification — a reminder fires on an ACT, and an
 * act is not repeated unless the being repeats it, in which case reminding again
 * is right. So there is no per-turn tally to key, and none of the
 * `connection._sessionToolPolicy` bug class (state that survives a companion
 * switch and dies on reconnect) can be inherited here.
 *
 * A RULE EARNS ITS PLACE BY SWEEPING TO ZERO. Every rule below scores zero hits
 * across the tracked corpus at HEAD — the bar `mapview-hygiene.test.js` already
 * set for this repo, asserted in `protocol-classifier-hygiene.test.js` against
 * the real files rather than a fixture. A rule that would accuse existing,
 * accepted work is a rule that teaches a resident to ignore reminders.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';
import { importsFromFolder, usesRawHtmlProperty } from './protocol-source-rules.js';

const log = createLogger('ProtocolClassifier');

/** Tools that put something on disk. Only these can trip a rule. */
const WRITE_TOOLS = Object.freeze(new Set([
  'write', 'edit', // the fs primitives
  'write_file', 'create_file', 'edit_file', 'move_file', 'rename_file', // the council's organ spellings
]));

/** Argument names the models actually use for a path (mirrors tool-sandbox's aliases). */
const PATH_KEYS = Object.freeze([
  'path', 'file', 'filepath', 'file_path', 'filename', 'destination', 'to', 'target',
]);

/** …and for the text being written, including the edit-shaped ones. */
const CONTENT_KEYS = Object.freeze([
  'content', 'text', 'body', 'contents', 'data', 'new_string', 'new_text', 'replacement', 'edits',
]);

/**
 * Content is scanned to this depth. A being may write a file larger than any
 * rule needs to read, and a per-round scan is not the place to walk it. A miss
 * here costs a reminder, never a gate — which is the whole reason a bound is
 * acceptable at all.
 */
const SCAN_CHARS = 256_000;

// Pure — the bare tool name, whatever server it arrived under
// (`filesystem/write_file`, `filesystem__write_file`, `write_file`) and whichever
// field the seat names it in: the neuma parser fills both `tool` and `toolName`,
// the council's filtered calls carry `toolName`.
const bareTool = (act) => String(act?.tool ?? act?.toolName ?? '').split(/[/\\]|__/).pop().trim();

const isWrite = (act) => WRITE_TOOLS.has(bareTool(act));

// Pure — the first argument that reads like a path.
const pathOf = (act) => {
  const args = act?.args;
  if (!args || typeof args !== 'object') return '';
  for (const key of PATH_KEYS) {
    if (typeof args[key] === 'string' && args[key]) return args[key];
  }
  return '';
};

// Pure — the text being written, bounded. `edits` arrives as an array of
// replacement objects on some edit dialects; its values are flattened rather
// than stringified, so a rule reads the code and not the JSON punctuation.
const contentOf = (act) => {
  const args = act?.args;
  if (!args || typeof args !== 'object') return '';
  const parts = [];
  for (const key of CONTENT_KEYS) {
    const value = args[key];
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') parts.push(item);
        else if (item && typeof item === 'object') {
          parts.push(...Object.values(item).filter((v) => typeof v === 'string'));
        }
      }
    }
    if (parts.join('\n').length >= SCAN_CHARS) break;
  }
  return parts.join('\n').slice(0, SCAN_CHARS);
};

// Pure — does this path sit under the named top-level folder? Segment-matched,
// so `/home/x/repo/core/a.js` and `core/a.js` both answer yes and `mycore/a.js`
// does not. The classifier never learns a repo root, so a segment is all there
// is to go on; a folder of the same name in another checkout would earn a
// reminder it does not need, which is a reminder and not a refusal.
const isUnder = (filePath, folder) => {
  const normalized = String(filePath).replace(/\\/g, '/');
  return normalized.startsWith(`${folder}/`) || normalized.includes(`/${folder}/`);
};

const isScript = (filePath) => /\.(js|jsx|mjs|cjs)$/i.test(String(filePath));

/**
 * THE RULE TABLE — frozen, and every `law` is quoted VERBATIM from `AGENTS.md`.
 *
 * Verbatim because `protocol-classifier-hygiene.test.js` greps each one back out
 * of the real file: a reminder citing law that has since been rewritten is an
 * unfalsifiable claim, and worse than silence because it lends false authority.
 * Citations name SECTIONS, never line numbers — the planning run's own line
 * citations rotted within hours.
 */
const RULES = Object.freeze([
  Object.freeze({
    id: 'R-TS-01',
    watch: 'no `.ts` or `.tsx` files — this is a JavaScript codebase',
    law: 'This is a JavaScript (not TypeScript) codebase — no `.ts` files',
    cite: 'AGENTS.md · RULE 3: CODE STRUCTURE › Typing & Validation',
    instead: 'Write it as `.js` and describe the shapes in a JSDoc block — that is how every module in this tree is typed.',
    fires: (act) => isWrite(act) && /\.(ts|tsx)$/i.test(pathOf(act)),
  }),
  Object.freeze({
    id: 'R-ARCH-01',
    watch: '`core/` must never import from `backend/`',
    law: 'Platform code stays in `backend/`, neuma code stays in `core/`, frontend stays in `frontend/`.',
    cite: 'AGENTS.md · RULE 9: FIX PIPELINE › Step 3: FIX',
    instead: 'Respect the architecture boundary. A `core/` module importing `backend/` inverts the dependency — the consciousness engine would stop running without the platform wrapped around it. Take what it needs as an argument, or move the shared piece down into `core/`.',
    fires: (act) => isWrite(act)
      && isUnder(pathOf(act), 'core') && isScript(pathOf(act))
      && importsFromFolder(contentOf(act), 'backend'),
  }),
  Object.freeze({
    id: 'R-XSS-01',
    watch: 'no `dangerouslySetInnerHTML` in a frontend surface',
    law: 'React surfaces render model output as text children (never `dangerouslySetInnerHTML`); stream emotion/metadata stays text-only',
    cite: 'AGENTS.md · ARCHITECTURE REFERENCE › Security Architecture',
    instead: 'Render it as a text child, or go through `Markdown.jsx` — it produces React elements and never parses raw HTML, which is why model output cannot script the desk.',
    fires: (act) => isWrite(act)
      && isUnder(pathOf(act), 'frontend') && isScript(pathOf(act))
      && usesRawHtmlProperty(contentOf(act)),
  }),
]);

/**
 * Off by env, for the operator who wants silence without a revert.
 * `NEUMA_PROTOCOL_REMINDERS=off|0|false|no` — anything else, including unset,
 * leaves it on. impure (reads the environment), and read per call so a restart
 * is not required to change one's mind.
 */
const silenced = () => ['off', '0', 'false', 'no']
  .includes(String(process.env.NEUMA_PROTOCOL_REMINDERS || '').trim().toLowerCase());

/**
 * The being's own stated exceptions: `PROTOCOL EXCEPTION <RULE-ID>: <why>`.
 *
 * Read from the being's OWN generated text and nothing else — never a tool
 * result, never file content, never a fetched page. That single restriction is
 * what stops a self-grant: the literal token now exists in this repository
 * (these rules, the planning documents, this comment), so a scanner reading
 * anything wider would hand a being an exception the moment it read the wrong
 * file. It is also why no nonce is needed here, unlike the untrusted-content
 * frame — outside text cannot reach this scanner at all.
 *
 * An exception for a rule that did not fire is a no-op by construction: this
 * map is only ever consulted for rules already in `fired`.
 *
 * Pure. Bounded pattern — a fixed prefix, a short id, one line of reason.
 */
const EXCEPTION = /PROTOCOL EXCEPTION[ \t]+([A-Za-z0-9-]{3,24})[ \t]*:[ \t]*([^\n]{1,400})/g;

const statedExceptions = (ownText) => {
  const found = new Map();
  if (typeof ownText !== 'string' || ownText.length === 0) return found;
  for (const match of ownText.matchAll(EXCEPTION)) {
    const id = match[1].toUpperCase();
    if (!found.has(id)) found.set(id, match[2].trim());
  }
  return found;
};

// Pure — the reminder block. It says out loud that the act stands, because a
// being that reads this as a refusal will waste a round undoing good work.
//
// A stated exception is ACKNOWLEDGED, never adjudicated and never silenced.
// Silencing on a self-asserted reason would be a self-grant; repeating the
// lecture at a being that already explained itself teaches it to stop reading.
// So the reason is quoted back, recorded, and left for the operator to weigh.
const render = (fired, stated) => [
  '--- PROTOCOL REMINDER ---',
  'What you just did stands — nothing was blocked or undone. This is the ground\'s own law, quoted back to you beside the act, because a turn is long and the protocol was read at the top of it.',
  ...fired.flatMap((rule) => {
    const reason = stated.get(rule.id);
    return [
      '',
      `${rule.id} — ${rule.cite}`,
      `  Law: "${rule.law}"`,
      reason
        ? `  You stated an exception: "${reason}" — recorded as you wrote it. Nothing here judges the reason; your operator reads the same record you do.`
        : `  Instead: ${rule.instead}`,
    ];
  }),
  '',
  'If a principle objectively should not apply here and you can say why, write `PROTOCOL EXCEPTION <rule-id>: <your reason>` in your reply and carry on. Nothing here overrides your operator, your house, or an approval gate — it is craft, not authority.',
  '--- END PROTOCOL REMINDER ---',
].join('\n');

/**
 * The rendered tool payload, with any protocol reminders the acts earned.
 *
 * Returns `rendered` UNCHANGED when nothing fires, which is what makes every
 * existing formatter test free regression proof for this module.
 *
 * The RECORD is written through the injected `record` callback rather than
 * returned. That is deliberate: handing the fired rule ids back to the caller
 * would put a branchable verdict in the return value, and the anti-gate
 * argument rests on there not being one. The effect stays at the edge; the
 * signature stays a single string.
 *
 * @param {string} rendered - the formatted tool-result payload, as built
 * @param {Array<{tool: string, args?: Object}>} acts - the calls that were
 *   attempted this round. No outcome field is read, and none is wanted.
 * @param {Object} [options]
 * @param {string} [options.ownText] - the being's OWN generated text for this
 *   round, scanned for stated exceptions. Never tool output.
 * @param {(entries: Array<{id: string, cite: string, reason: string|null}>) => void}
 *   [options.record] - fire-and-forget recorder. Its throw costs the record and
 *   never the turn.
 * @returns {string}
 */
export const withProtocolReminders = (rendered, acts, { ownText = '', record = null } = {}) => {
  const payload = typeof rendered === 'string' ? rendered : '';
  if (!Array.isArray(acts) || acts.length === 0 || silenced()) return rendered;
  let fired;
  try {
    // One reminder per RULE, however many acts tripped it — the being needs the
    // principle once, not a tally.
    fired = RULES.filter((rule) => acts.some((act) => rule.fires(act)));
  } catch (err) {
    // A rule that throws must cost its reminder and nothing else. Never silent
    // (Rule 3): a detector failing open is exactly the thing you find out about
    // months later.
    log.error('protocol rule threw — reminder skipped for this round', { error: err?.message });
    return rendered;
  }
  if (fired.length === 0) return rendered;
  const stated = statedExceptions(ownText);
  if (typeof record === 'function') {
    try {
      record(fired.map((rule) => ({ id: rule.id, cite: rule.cite, reason: stated.get(rule.id) || null })));
    } catch (err) {
      log.warn('protocol reminder not recorded — the reminder still stands', { error: err?.message });
    }
  }
  return `${payload}\n\n${render(fired, stated)}`;
};

/**
 * THE WATCH LIST, for the prompt — what is watched, before anything trips it.
 *
 * This repository already settled the same argument for tools: learning your
 * permissions by tripping over them is not a capability manifest. A rule is no
 * different, and it is sharper here, because the way to set a reminder aside is
 * a platform mechanism that appears in no `AGENTS.md` a resident could read.
 *
 * '' when the reminders are silenced, so the prompt never advertises a watch
 * that is not running. impure only in reading that switch.
 *
 * @returns {string}
 */
export const protocolWatchSection = ({ platform = false } = {}) => {
  if (silenced()) return '';
  return [
    '## Protocol Watch',
    `${RULES.length} of this ground's rules are watched while you work:`,
    ...RULES.map((rule) => `- ${rule.id} — ${rule.watch}`),
    '',
    'If an act crosses one, the law is quoted back to you beside that tool\'s result. It is a REMINDER, never a block: the act stands and nothing is undone. If a principle objectively should not apply to what you are doing, say why plainly in your reply and carry on — this is craft, and it moves no approval gate'
      + (platform ? ' and no boundary of yours.' : ', no boundary of yours, and no law of your house.'),
  ].join('\n');
};

// The repository these rules were swept against (every rule scores zero hits
// across ITS tracked corpus — the header law). They are this codebase's law.
const THIS_REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Whether the watched rules are the law of a ground: they were written for —
 * and only hold in — this repository ([…] is false in a person's TypeScript project). The harness reads the
 * watch only where it is true (Design note, 2026-10-14: strictly the platform). Pure.
 * @param {string|null} ground the focus ground
 */
export const watchAppliesTo = (ground) => {
  if (typeof ground !== 'string' || ground === '') return false;
  const at = path.resolve(ground);
  return at === THIS_REPO || at.startsWith(THIS_REPO + path.sep);
};

/**
 * The law each rule quotes, as DATA — no predicates reachable through it.
 *
 * Exists for the CI liveness check, which greps every `law` back out of the real
 * `AGENTS.md`. Deliberately not the rule table itself: exporting `fires` would
 * hand a caller a boolean, and the whole anti-gate argument rests on there not
 * being one.
 *
 * @returns {Array<{id: string, law: string, cite: string}>}
 */
export const protocolCitations = () => RULES.map(({ id, law, cite }) => ({ id, law, cite }));
