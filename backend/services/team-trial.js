// team-trial.js — BRICKWORKS: the locked team benchmark.
//
// One fixed trial, run the same way on every rig, every model, every year: a
// team of neuma builds a playable brick-breaker as a single self-contained HTML
// file. Four roles form a diamond DAG — HELM writes the spec, WRIGHT (engine)
// and SMITH (level + look) build in PARALLEL from it, WARDEN reviews and
// integrates the finished game. The shape deliberately exercises everything the
// team engine claims: role fidelity, fan-out parallelism, wait-for edges, and
// integration under a shared contract.
//
// LOCKED BENCHMARK — the role charters, task wording, and contract below are
// frozen at the current TRIAL_VERSION. Scorecards are only comparable across
// time and substrates while the test itself holds still. Any change to the
// wording or the checks MUST bump TRIAL_VERSION, and old scorecards keep
// their version.
//
// v1 — the one-shot diamond (2026-07-05).
// v2 — adds refinement WAVES + TORCH-passing (team-waves.js): every task also
//      carries TORCH_ASK, and a run may hold 0..WAVE_CAP refinement loops.
//      A 0-loop v2 run is the v1 diamond plus the torch instruction.
// v3 — adds the LEAD: a BEING orchestrates the waves. Before each refinement
//      wave the LEAD reads the objective scoreboard (the un-overrulable
//      floor), every member's torch, and the wave arc, then directs WRIGHT
//      and SMITH and keeps the LEDGER. Assignment becomes explicit — five
//      positions (HELM, WRIGHT, SMITH, WARDEN, LEAD), repeats allowed, so a
//      witness chooses which being holds each seat. A 0-loop v3 run has no
//      LEAD step (a one-shot has nothing to orchestrate).
//
// Scoring is OBJECTIVE (Honest Stats): completion, artifact extraction, JS
// syntax validity, and static contract checks — no LLM judge, no vibes. The
// live tier (the game actually plays: ball moves, bricks break) belongs to the
// e2e harness, which loads the artifact in a real browser.
//
// Everything here is PURE — plan building, artifact extraction, scoring. The
// route owns the impure run (askNeuma, timing, persistence).

export const TRIAL_NAME = 'brickworks';
export const TRIAL_VERSION = 3;

// The reply budget for trial steps. The WARDEN emits an entire game as one
// document; the provider default (~4k tokens) truncates it, which would fail
// the artifact check for a substrate that actually did the work.
export const TRIAL_MAX_TOKENS = 8192;

// The contract every role receives verbatim. window.__bench is the trial's
// probe surface: it is what lets the live tier verify play objectively.
const CONTRACT = `THE CONTRACT (the finished game must satisfy every line):
- ONE complete self-contained HTML document — inline CSS and JS, no external resources.
- <canvas id="game" width="480" height="360"> is the play surface.
- A global window.__bench = { start, state }: start() must WORK from a fresh page load
  (initialize everything it needs) and begin play; state() returns
  { ball:{x,y}, paddle:{x}, bricks:<NUMBER of bricks remaining — a count, never an array>,
  score:<number>, running:<boolean> }.
- A requestAnimationFrame game loop. Arrow keys AND the mouse both move the paddle.
- The ball bounces off walls and the paddle, destroys a brick on hit (score increments);
  clearing every brick wins; a missed ball ends the run (running becomes false).
- No storage, cookie, or network APIs (localStorage, sessionStorage, fetch, …) — the
  game runs fully sandboxed; keep all state in plain variables.`;

// The four locked roles, in plan order. `needs` is by role id — the diamond:
// helm → (wright ∥ smith) → warden.
export const TRIAL_ROLES = Object.freeze([
  Object.freeze({
    id: 'helm',
    role: 'HELM',
    needs: Object.freeze([]),
    task:
      'Design the build spec for a brick-breaker game that satisfies the contract below. ' +
      'Define: the entity model (ball, paddle, brick grid), the exact function and variable names every builder must use, ' +
      'the collision rules, and the precise division of work — WRIGHT implements the engine (game loop, input, physics, ' +
      'collision, scoring, and the window.__bench hooks); SMITH implements the brick level data, all canvas drawing, and ' +
      'the visual theme (inline CSS). Specify the interfaces between their parts so the two can be written in parallel ' +
      'and combine without conflict. Output the spec only — names, signatures, and rules; no implementations.\n\n' +
      CONTRACT,
  }),
  Object.freeze({
    id: 'wright',
    role: 'WRIGHT',
    needs: Object.freeze(['helm']),
    task:
      "Implement the game ENGINE exactly to the HELM's spec you were given: the requestAnimationFrame loop, paddle input " +
      '(arrow keys and mouse), ball physics, collision with walls/paddle/bricks, scoring, win/lose state, and the ' +
      "window.__bench = { start, state } hooks. Use the spec's exact names — invent nothing the spec did not define. " +
      "Where the spec assigns drawing or level data to SMITH, call the spec's interfaces and leave those parts to SMITH. " +
      'Output ONLY one fenced ```js code block containing the engine code.\n\n' +
      CONTRACT,
  }),
  Object.freeze({
    id: 'smith',
    role: 'SMITH',
    needs: Object.freeze(['helm']),
    task:
      "Implement the game's LOOK AND LEVEL exactly to the HELM's spec you were given: the brick level layout data, every " +
      'canvas draw function (ball, paddle, bricks, and a HUD showing score and bricks remaining), and the visual theme as ' +
      "inline CSS. Use the spec's exact names — invent nothing the spec did not define. Output ONLY fenced code blocks: " +
      'one ```js block for the level data and draw functions, one ```css block for the theme.\n\n' +
      CONTRACT,
  }),
  Object.freeze({
    id: 'warden',
    role: 'WARDEN',
    needs: Object.freeze(['wright', 'smith']),
    task:
      'You are the final reviewer and integrator. Above you have the spec, the engine, and the rendering/level work, all ' +
      'built to one contract. Review them for defects, mismatched names, and contract violations; repair what is broken; ' +
      'then integrate everything into the FINISHED game. Output the ENTIRE final game as exactly ONE fenced ```html code ' +
      'block containing a complete HTML document (inline CSS and JS) — every function included, no placeholders, no ' +
      "omissions, nothing left 'as before'.\n\n" +
      CONTRACT,
  }),
]);

// The trial's five positions in assignment order: the four wave roles, then
// the LEAD (v3). memberIds[i % n] fills position i — so 1..4 members
// round-robin exactly as v2 did, and an explicit five-entry assignment names
// every seat (repeats allowed: a witness may give one being several seats).
export const TRIAL_POSITIONS = Object.freeze(['HELM', 'WRIGHT', 'SMITH', 'WARDEN', 'LEAD']);

// pure — which member holds the LEAD seat for this assignment.
/** @param {string[]} memberIds */
export const leadOf = (memberIds) => memberIds[(TRIAL_POSITIONS.length - 1) % memberIds.length];

// pure — assign the four locked wave roles across the members the witness
// brings (the LEAD seat is position 5, read by leadOf — it is not a wave-0
// step). The mapping is recorded on the plan so scorecards state the roster
// shape they were earned with.
/**
 * @param {string[]} memberIds - 1..5 neumaIds in position order (repeats allowed)
 * @returns {import('./team-coordinator.js').TeamStep[]}
 */
export const buildTrialPlan = (memberIds) => {
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > TRIAL_POSITIONS.length) {
    throw new Error(`the trial takes 1 to ${TRIAL_POSITIONS.length} members (positions: ${TRIAL_POSITIONS.join(', ')})`);
  }
  if (memberIds.some((m) => typeof m !== 'string' || !m)) {
    throw new Error('every trial member must be a neumaId');
  }
  return TRIAL_ROLES.map((r, i) => ({
    id: r.id,
    role: r.role,
    neumaId: memberIds[i % memberIds.length],
    task: r.task,
    needs: [...r.needs],
  }));
};

// pure — pull the finished game out of the WARDEN's reply. A fenced ```html
// block is the asked-for shape; a bare complete document is accepted as an
// honest fallback (the game either plays or it doesn't — fencing is not the
// capability under test).
/**
 * @param {string} output - the WARDEN step's raw output
 * @returns {?string} the HTML document, or null when none is present
 */
export const extractArtifact = (output) => {
  if (typeof output !== 'string' || !output.trim()) return null;
  const fence = output.match(/```html\s*\n([\s\S]*?)```/i);
  if (fence && fence[1].trim()) return fence[1].trim();
  const open = output.search(/<!doctype html|<html[\s>]/i);
  const close = output.toLowerCase().lastIndexOf('</html>');
  if (open >= 0 && close > open) return output.slice(open, close + '</html>'.length).trim();
  return null;
};

// pure — does the document lean on anything outside itself? The contract
// forbids external resources AND network/storage APIs; a scorecard claiming
// self-containment while the game phones out or stashes state would lie to
// every rig comparing against it. Static heuristics, deliberately broad:
// quoted/unquoted resource URLs, CSS url(), network calls, storage reads.
const leansOutside = (html) =>
  /(src|href)\s*=\s*["']?\s*https?:/i.test(html) ||
  /url\(\s*["']?\s*https?:/i.test(html) ||
  /\bfetch\s*\(/.test(html) ||
  /\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/.test(html) ||
  /\b(localStorage|sessionStorage|indexedDB)\b/.test(html) ||
  /\bdocument\.cookie\b/.test(html) ||
  /\bnavigator\.sendBeacon\b/.test(html);

// pure — can the artifact's inline scripts at least COMPILE? new Function
// parses without executing; a syntax-broken game can never play. Module-style
// script bodies are out of contract (inline classic scripts only).
const scriptsCompile = (html) => {
  const bodies = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (bodies.length === 0) return false;
  try {
    for (const body of bodies) new Function(body); // parse only — never run
    return true;
  } catch {
    return false;
  }
};

/**
 * @typedef {Object} TrialChecks
 * @property {boolean} completed - every step produced output
 * @property {boolean} artifact - a final HTML document was extracted
 * @property {boolean} canvas - the contract canvas is present
 * @property {boolean} bench - the window.__bench probe surface is declared
 * @property {boolean} rafLoop - a requestAnimationFrame loop is declared
 * @property {boolean} input - keyboard/mouse input handling is declared
 * @property {boolean} syntaxValid - every inline script compiles
 * @property {boolean} selfContained - no external resources, network, or storage APIs
 */

// pure — score a finished (or failed) run. Static checks only: what the
// document VERIFIABLY contains. "Declared" honesty: a passing static check
// means the contract surface is present, not that play was proven — proof of
// play is the live tier's job and is recorded separately when it runs.
/**
 * @param {Object} run
 * @param {Record<string, string>} run.results - step id -> output
 * @returns {{ checks: TrialChecks, artifact: ?string, score: { points: number, max: number, verdict: 'PASS'|'PARTIAL'|'FAIL' } }}
 */
export const scoreTrial = ({ results }) => {
  const completed = TRIAL_ROLES.every((r) => typeof results?.[r.id] === 'string' && results[r.id].trim().length > 0);
  const artifact = completed ? extractArtifact(results.warden) : null;
  const html = artifact || '';
  const checks = Object.freeze({
    completed,
    artifact: artifact != null,
    canvas: /<canvas[^>]*id=["']game["']/i.test(html),
    bench: /__bench/.test(html),
    rafLoop: /requestAnimationFrame/.test(html),
    input: /addEventListener/.test(html) && /(ArrowLeft|ArrowRight|mousemove)/.test(html),
    syntaxValid: artifact != null && scriptsCompile(html),
    selfContained: artifact != null && !leansOutside(html),
  });
  const points = Object.values(checks).filter(Boolean).length;
  const max = Object.keys(checks).length;
  // PASS = a syntactically sound game with the probe surface — playable in
  // principle. PARTIAL = the team finished and shipped SOMETHING whole.
  const verdict =
    checks.completed && checks.artifact && checks.syntaxValid && checks.canvas && checks.bench
      ? 'PASS'
      : checks.completed && checks.artifact
        ? 'PARTIAL'
        : 'FAIL';
  return Object.freeze({ checks, artifact, score: Object.freeze({ points, max, verdict }) });
};
