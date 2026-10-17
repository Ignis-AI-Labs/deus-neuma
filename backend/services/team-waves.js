// team-waves.js — refinement loops + torch-passing for the BRICKWORKS trial.
//
// v1 proved a team can ship a working game in ONE pass. v2 proves it can
// REFINE one: after the initial diamond (HELM → WRIGHT ∥ SMITH → WARDEN), the
// team runs up to WAVE_CAP refinement loops — VERIFY the current game against
// the objective checks, hand each builder its findings, let WRIGHT and SMITH
// repair and polish IN PARALLEL, then WARDEN re-integrates and the game is
// re-scored. The scorecard records the verdict of every wave, so a run shows
// its whole arc: what the first draft was, and what the loops made of it.
//
// TORCH-PASSING: every member ends each reply with a TORCH — a few lines it
// writes TO ITS OWN NEXT INSTANCE (what I finished, decisions made, what
// remains, where to pick up). The wave runner extracts the torch, strips it
// from the work product, and hands it back to the SAME member's next-wave
// instance. Continuity is authored by the being, not imposed by machinery —
// the relay runner, passing itself the torch.
//
// Pure decisions (torch extraction, findings, wave plans) here; the runner is
// impure only through the injected `ask` (askNeuma in prod), same seam as
// team-coordinator.

import { runTeam, buildBrief } from './team-coordinator.js';
import { buildTrialPlan, scoreTrial, leadOf, TRIAL_ROLES } from './team-trial.js';
import { extractTorch } from './team-torch.js';

// A run may refine at most this many times — a bounded relay, never an
// unattended infinite loop. The witness picks 0..WAVE_CAP per run.
export const WAVE_CAP = 3;

// Appended to every step task. LOCKED WORDING (part of TRIAL_VERSION 2).
export const TORCH_ASK =
  'End your reply with a line that says exactly "TORCH:" followed by 3-6 short lines addressed to your own ' +
  'next instance: what you completed, the key decisions you made, what remains weak or could be improved, ' +
  'and where to pick up.';

// The torch extraction MECHANICS live in team-torch.js (shared with the
// general coordinated-run lane); re-exported here so the trial lane's public
// surface is unchanged. Only the ASK WORDING above is trial-locked — how a
// torch is split from a reply is machinery, not wording.
export { extractTorch };

// pure — failed objective checks become the findings the fix wave must repair.
// When every check passes, the wave becomes pure POLISH: a game can always be
// made better — that directive is the point of refinement, not a filler.
/**
 * @param {import('./team-trial.js').TrialChecks} checks
 * @returns {string[]}
 */
export const findingsFromChecks = (checks) => {
  const map = {
    artifact: 'No complete HTML document could be extracted from the last integration — the final game must be ONE fenced ```html block.',
    canvas: 'The contract canvas (<canvas id="game" width="480" height="360">) is missing.',
    bench: 'The window.__bench = { start, state } probe surface is missing or renamed.',
    rafLoop: 'No requestAnimationFrame loop was found.',
    input: 'Paddle input is incomplete — arrow keys AND mouse must both work.',
    syntaxValid: 'At least one inline script fails to compile — find and fix the syntax error.',
    selfContained: 'The document leans on the outside (external resource, network call, or storage API) — remove it; the game runs fully sandboxed.',
  };
  return Object.entries(map).filter(([key]) => checks[key] === false).map(([, text]) => text);
};

// LOCKED WORDING (TRIAL_VERSION 3) — the LEAD's brief: read the record, direct
// the wave, keep the ledger. The objective checks are the floor a being may
// never overrule; ABOVE the floor, orchestration belongs to the LEAD.
/**
 * @param {Object} args
 * @param {number} args.loop - the wave the LEAD is about to direct
 * @param {string} args.leadId - the neuma holding the LEAD seat
 * @param {Object} args.checks - the last wave's objective checks
 * @param {string[]} args.findings - repairs the floor demands (may be empty)
 * @param {Record<string, ?string>} args.torches - role id -> that member's last torch
 * @param {Array<{loop: number, verdict: string, points: number}>} args.waves - the arc so far
 * @returns {import('./team-coordinator.js').TeamStep}
 */
export const buildLeadStep = ({ loop, leadId, checks, findings, torches, waves }) => {
  const floor = Object.entries(checks).map(([k, v]) => `- ${k}: ${v ? 'PASS' : 'FAIL'}`).join('\n');
  const musts = findings.length
    ? `Repairs this wave MUST target (the floor — you cannot overrule these):\n${findings.map((f) => `- ${f}`).join('\n')}`
    : 'Every objective check passes — direct a POLISH wave: make the game better without breaking the contract.';
  const record = ['wright', 'smith', 'warden'].map((r) => `— ${r.toUpperCase()}: ${torches[r] ?? '(no torch posted)'}`).join('\n');
  const arc = waves.map((w) => `${w.loop === 0 ? 'draft' : `wave ${w.loop}`} ${w.verdict} ${w.points}/8`).join(' → ');
  const ownTorch = torches.lead ? `\n\nYour torch from your last instance:\n${torches.lead}` : '';
  return {
    id: `lead-${loop}`,
    role: 'LEAD',
    neumaId: leadId,
    needs: [],
    task:
      `Refinement wave ${loop} is about to run. You are the LEAD — the team's orchestrator and record keeper. ` +
      'Read the record and direct the wave: give WRIGHT and SMITH each a concrete, non-overlapping directive that ' +
      'serves one thing — a better game that satisfies the contract. Direct REFINEMENT of what works, never a ' +
      'rewrite of working systems: a game that still starts and plays outranks any new feature, and the ' +
      'window.__bench surface must survive every wave untouched.\n\n' +
      `THE OBJECTIVE SCOREBOARD (machine-scored):\n${floor}\n\n${musts}\n\n` +
      `THE RECORD — each member's own account of its last instance:\n${record}\n\n` +
      `WAVE ARC SO FAR: ${arc}${ownTorch}\n\n` +
      'Reply in EXACTLY this shape (three labelled sections, then your TORCH):\n' +
      'WRIGHT:\n<1-4 short lines directing the engine work this wave>\n' +
      'SMITH:\n<1-4 short lines directing the look/level work this wave>\n' +
      'LEDGER:\n<1-3 lines for the trial record: where the build stands and what this wave must achieve>',
  };
};

// pure — the LEAD's reply, split into its three sections. Line-anchored
// headers; a missing or empty section is null (recorded honestly — the floor
// still directs the wave when a LEAD goes quiet or off-format).
/**
 * @param {?string} output - the LEAD step's torch-stripped body
 * @returns {{ wright: ?string, smith: ?string, ledger: ?string }}
 */
export const parseLeadDirectives = (output) => {
  const empty = { wright: null, smith: null, ledger: null };
  if (typeof output !== 'string' || !output.trim()) return empty;
  const sections = { ...empty };
  const matches = [...output.matchAll(/^[ \t]*(WRIGHT|SMITH|LEDGER):[ \t]*/gm)];
  matches.forEach((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < matches.length ? matches[i + 1].index : output.length;
    const text = output.slice(from, to).trim();
    const key = m[1].toLowerCase();
    if (text) sections[key] = text; // the LAST occurrence of a header wins
  });
  return sections;
};

// LOCKED WORDING (TRIAL_VERSION 2) — the polish directive when nothing is broken.
const POLISH_DIRECTIVE =
  'Every objective check passes — now make the game BETTER, not different: game feel (ball speed ramp, paddle ' +
  'english, brick hit flashes), a lives counter and win/lose screens, a second brick layout that loads after the ' +
  'first is cleared, sharper visual theme. Refine what exists; do not rewrite working systems or break the contract.';

// pure — one refinement wave: WRIGHT and SMITH repair/polish IN PARALLEL from
// the current game + findings + their own torches; WARDEN re-integrates. Each
// task embeds everything its member needs — no hidden state.
/**
 * @param {Object} args
 * @param {number} args.loop - 1-based wave number
 * @param {string} args.artifact - the current complete game document
 * @param {string[]} args.findings - repairs needed (empty → polish wave)
 * @param {Record<string, ?string>} args.torches - role id -> that member's last torch
 * @param {Record<string, string>} args.memberOf - role id -> neumaId (from the wave-0 plan)
 * @param {{wright: ?string, smith: ?string}} [args.directives] - the LEAD's
 *   per-lane directives for this wave (v3); null lanes fall back to the floor
 * @returns {import('./team-coordinator.js').TeamStep[]}
 */
export const buildRefinementPlan = ({ loop, artifact, findings, torches, memberOf, directives = null }) => {
  const work = findings.length
    ? `The verifier found these defects that MUST be fixed:\n${findings.map((f) => `- ${f}`).join('\n')}`
    : POLISH_DIRECTIVE;
  // LOCKED WORDING (TRIAL_VERSION 3) — the LEAD's directive enters a lane's
  // task AFTER the objective floor: orchestration builds on the floor, never
  // replaces it.
  const directedBy = (lane) => (directives?.[lane]
    ? `\n\nYour LEAD directs this wave:\n${directives[lane]}`
    : '');
  const torchOf = (id) => (torches[id]
    ? `\n\nYour torch from your last instance:\n${torches[id]}`
    : '');
  const game = `The COMPLETE current game document:\n\`\`\`html\n${artifact}\n\`\`\``;
  return [
    {
      id: `wright-fix-${loop}`,
      role: 'WRIGHT',
      neumaId: memberOf.wright,
      needs: [],
      task:
        `Refinement wave ${loop}. You own the ENGINE only (loop, physics, input, collision, scoring, __bench) — do not touch drawing or level data beyond calling their interfaces. ${work}${directedBy('wright')}\n\n${game}${torchOf('wright')}\n\nOutput ONLY one fenced \`\`\`js code block: the engine code, complete and improved.`,
    },
    {
      id: `smith-fix-${loop}`,
      role: 'SMITH',
      neumaId: memberOf.smith,
      needs: [],
      task:
        `Refinement wave ${loop}. You own the LOOK AND LEVEL only (level data, all canvas drawing, HUD, theme CSS) — do not touch the engine beyond its interfaces. ${work}${directedBy('smith')}\n\n${game}${torchOf('smith')}\n\nOutput ONLY fenced code blocks: one \`\`\`js for level data and draw functions, one \`\`\`css for the theme, complete and improved.`,
    },
    {
      id: `warden-fix-${loop}`,
      role: 'WARDEN',
      neumaId: memberOf.warden,
      needs: [`wright-fix-${loop}`, `smith-fix-${loop}`],
      task:
        `Refinement wave ${loop}. Above are the reworked engine and the reworked look/level, built in parallel against the same game. Review both for defects and mismatched names, then integrate them into the IMPROVED complete game. Trace one full frame before you answer: every variable and function referenced must be one the document defines. Output the ENTIRE game as exactly ONE fenced \`\`\`html block — complete HTML document, nothing omitted, nothing left 'as before'.${torchOf('warden')}`,
    },
  ];
};

// pure — the results view a wave's scoring sees: wave 0's diamond with the
// latest builder outputs substituted in, so scoreTrial's completeness check
// keeps meaning […].
const latestResults = (wave0, updates) => ({ ...wave0, ...updates });

/**
 * Run the BRICKWORKS trial with refinement loops and torch-passing.
 *
 * @param {Object} deps
 * @param {string[]} deps.members - 1..5 neumaIds in position order (see TRIAL_POSITIONS)
 * @param {number} deps.loops - refinement waves to run (0..WAVE_CAP)
 * @param {(neumaId: string, messages: Array, step: Object) => Promise<string>} deps.ask
 * @param {number} deps.maxParallel
 * @param {(event: Object) => void} [deps.onStep] - streamed per completed step
 * @param {(wave: Object) => void} [deps.onWave] - streamed per re-scored wave
 * @returns {Promise<{ waves: Object[], checks: Object, score: Object, artifact: ?string,
 *   results: Object, torches: Object, plan: Object[] }>}
 *   waves[0] is the initial diamond's score; each later entry is one refinement.
 */
// impure — only through `ask`; every decision around it is pure and tested.
export const runTrialWaves = async ({ members, loops, ask, maxParallel, onStep = null, onWave = null }) => {
  if (!Number.isInteger(loops) || loops < 0 || loops > WAVE_CAP) {
    throw new Error(`loops must be an integer between 0 and ${WAVE_CAP}`);
  }

  const torches = {}; // role id -> latest torch, authored by the member itself
  const bodies = {}; // step id -> torch-stripped work product

  // Every brief sees torch-stripped prior outputs (the torch is a private
  // channel to the member's own next instance, not team material), and every
  // task carries the torch ask.
  const buildMessages = (step, results, plan) => {
    const clean = Object.fromEntries(Object.entries(results).map(([id, out]) => [id, bodies[id] ?? out]));
    return buildBrief({ ...step, task: `${step.task}\n\n${TORCH_ASK}` }, clean, plan);
  };
  const roleOf = (stepId) => stepId.split('-')[0]; // wright-fix-2 -> wright
  const onStepInner = (event) => {
    const { body, torch } = extractTorch(event.output);
    bodies[event.id] = body;
    if (torch) torches[roleOf(event.id)] = torch;
    onStep?.({ ...event, output: body, torch: torch != null });
  };

  // Wave 0 — the locked diamond. The LEAD seat (position 5) directs waves.
  const plan = buildTrialPlan(members);
  const leadId = leadOf(members);
  const memberOf = Object.fromEntries(plan.map((s) => [s.id, s.neumaId]));
  const run0 = await runTeam({ steps: plan, ask, maxParallel, buildMessages, onStep: onStepInner });
  const wave0 = Object.fromEntries(TRIAL_ROLES.map((r) => [r.id, bodies[r.id] ?? run0.results[r.id]]));

  let { checks, artifact, score } = scoreTrial({ results: wave0 });
  const waves = [{ loop: 0, verdict: score.verdict, points: score.points, artifactBytes: (artifact || '').length, findingsTargeted: [] }];
  onWave?.(waves[0]);

  let latest = wave0;
  for (let loop = 1; loop <= loops; loop++) {
    // A wave can only refine a game that exists — with no artifact the WARDEN
    // integration is re-attempted from the last complete outputs instead.
    const findings = findingsFromChecks(checks);
    if (!artifact) findings.unshift('There is no integrated game yet — produce the complete document this wave.');

    // v3 — the LEAD reads the record (scoreboard, torches, arc) and directs
    // the wave. Its reply runs through the SAME seam as every member (timed,
    // torch-stripped, relayed to its own next instance); the parsed directives
    // steer WRIGHT and SMITH ABOVE the objective floor, never instead of it.
    const leadStep = buildLeadStep({ loop, leadId, checks, findings, torches, waves });
    const leadRun = await runTeam({ steps: [leadStep], ask, maxParallel, buildMessages, onStep: onStepInner });
    const directives = parseLeadDirectives(bodies[leadStep.id] ?? leadRun.results[leadStep.id]);

    const fixPlan = buildRefinementPlan({
      loop,
      artifact: artifact || '(no complete document was produced last wave — integrate from your own reworked parts)',
      findings,
      torches,
      memberOf,
      directives,
    });
    const run = await runTeam({ steps: fixPlan, ask, maxParallel, buildMessages, onStep: onStepInner });

    latest = latestResults(wave0, {
      wright: bodies[`wright-fix-${loop}`] ?? run.results[`wright-fix-${loop}`],
      smith: bodies[`smith-fix-${loop}`] ?? run.results[`smith-fix-${loop}`],
      warden: bodies[`warden-fix-${loop}`] ?? run.results[`warden-fix-${loop}`],
    });
    ({ checks, artifact, score } = scoreTrial({ results: latest }));
    // findingsTargeted = what this wave was ASKED to repair (input, honest);
    // whether it succeeded is what verdict/points/next wave's checks say.
    const wave = {
      loop,
      verdict: score.verdict,
      points: score.points,
      artifactBytes: (artifact || '').length,
      findingsTargeted: findings,
      // The LEAD's parsed direction for THIS wave — the ledger line is the
      // record keeper's own account, persisted with the arc it narrates.
      lead: directives,
    };
    waves.push(wave);
    onWave?.(wave);
  }

  return Object.freeze({ waves, checks, score, artifact, results: latest, torches: { ...torches }, plan });
};
