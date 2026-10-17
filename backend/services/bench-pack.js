/**
 * bench-pack — the one-shot team benchmark pack as a shared primitive.
 *
 * ONE source of truth for: which benches exist
 * (`brickworks/prompts/*.txt` in the connected benchmarks REPOSITORY,
 * byte-verbatim public prompts — the comparability law; benchmarks live there,
 * never in this repo, Design note, 2026-10-15, each bench's artifact law (what lands,
 * how it is proven), and the TEAM INVOCATION composed around the verbatim task.
 * An arena is written under the data root, never into the sovereign repository.
 * The desk TRIALS surface consumes THIS (the old sitting driver, team-bench-sitting.mjs,
 * is archived with the retired in-repo copy) — essential functions are core components,
 * never per-caller copies (uniform-architecture law, 2026-07-15).
 *
 * The invocation is OURS to add (assemble → plan+QA → approval → run →
 * refinement → EXECUTED proof); the task text is never touched.
 */

import fs from 'fs';
import path from 'path';
import { harnessRoot } from './bench/bench-paths.js';
import { getDataRoot } from './data-root.js';

// read at call time, so a re-pointed repository (NEUMA_BENCH_HARNESS_PATH) is honoured
const promptsDir = () => path.join(harnessRoot(), 'brickworks', 'prompts');
const runsDir = () => path.join(getDataRoot(), 'benchmarks', 'brickworks');

/** Per-bench artifact law: what the arena must hold and how it is proven. */
export const BENCH_LAWS = Object.freeze({
  'hexagon-bouncing-ball': Object.freeze({ ext: '.py', verify: 'py', title: 'Spinning Hexagon Ball', source: 'github.com/aligeramy/ai-benchmark' }),
  'heptagon-20-balls': Object.freeze({ ext: '.py', verify: 'py', title: '20 Balls in a Spinning Heptagon', source: 'KCORES/kcores-llm-arena' }),
  'pelican-bicycle-svg': Object.freeze({ ext: '.svg', verify: 'svg', title: 'Pelican Riding a Bicycle (SVG)', source: 'simonw/pelican-bicycle' }),
  'fly-pieter-3d-flying-game': Object.freeze({ ext: '.html', verify: 'html', title: '3D Flying Game (fly.pieter origin)', source: '@levelsio on X' }),
  'terraria-clone': Object.freeze({ ext: '.html', verify: 'html', title: 'Terraria-Style Sandbox (showdown class)', source: 'July 2026 showdowns — our fixed wording' }),
});
const DEFAULT_LAW = Object.freeze({ ext: '.py', verify: 'py', title: null, source: null });

/** The law for one bench id (unknown ids get the default .py law). Pure. */
export const benchLaw = (bench) => BENCH_LAWS[bench] || DEFAULT_LAW;

/**
 * Every bench on this rig: id, title, source, artifact law, and the verbatim
 * task text. impure (reads the benchmarks repository's brickworks/prompts).
 * @returns {Array<{id: string, title: string, source: string|null, ext: string, task: string}>}
 */
export const listBenches = () => {
  let files;
  try {
    files = fs.readdirSync(promptsDir()).filter((f) => f.endsWith('.txt')).sort();
  } catch {
    return []; // no pack on this rig — an empty trials shelf, not an error
  }
  return files.map((f) => {
    const id = f.replace(/\.txt$/, '');
    const law = benchLaw(id);
    return {
      id,
      title: law.title || id,
      source: law.source,
      ext: law.ext,
      task: fs.readFileSync(path.join(promptsDir(), f), 'utf8').trim(),
    };
  });
};

/** Read one bench's verbatim task, or null. impure. */
export const readBenchTask = (bench) => {
  const dir = promptsDir();
  const file = path.join(dir, `${bench}.txt`);
  // The id comes from untrusted input — it must name a file INSIDE the pack.
  if (path.dirname(path.resolve(file)) !== path.resolve(dir)) return null;
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
};

/** Where a fresh arena for a bench run lives. Pure given the stamp. */
export const benchArenaPath = (bench, stamp) =>
  path.join(runsDir(), `${bench}-${stamp}`);

/**
 * The team invocation — the ONLY thing added around the verbatim task.
 * Assemble the house, plan with assembly+QA positions, confined workspace,
 * operator approval, team run, refinement from QA's fixes, and (for runnable
 * artifacts) the EXECUTED proof: a ≥1000-frame self-test via the
 * team/workspace-run intent, fixed and re-run until it passes. Pure.
 *
 * qa (default TRUE — the quality-over-speed law) plans a QA position whose
 * fixes the team applies before the deliverable lands. Turning it off is the
 * operator's deliberate act; the executed proof for runnables stays either
 * way — proving the artifact runs is honesty, not refinement.
 * @param {{task: string, teammates: string[], arena: string, ext: string, verify: string, qa?: boolean}} p
 * @returns {string}
 */
export const composeInvocation = ({ task, teammates, arena, ext, verify, qa = true }) => [
  'Assemble your team on a one-shot benchmark. Follow this EXACT order — nothing writes before the plan is approved:',
  '',
  `1. FIRST, submit the team plan with plan_submit — no other tool before it. Your team is the OTHER BEINGS OF YOUR HOUSE: name each teammate (${teammates.join(', ')}) as the member of their own step, each owning a SEPARATE position of the work (you may keep one position, as LEAD, for yourself). The plan MUST include: an ASSEMBLY step that integrates the parts into the complete deliverable${qa
    ? ', and after it a QA step — one teammate whose step needs the assembly step, reviews the ASSEMBLED deliverable against THE TASK below, and returns either APPROVED or the EXACT fixes required'
    : ' (the operator turned the QA pass OFF for this run — no QA step)'}. The plan MUST carry the assigned workspace: { "root": "${arena}" }.`,
  '2. WAIT for my approval — it arrives as the plan_submit result.',
  '3. THEN run the approved plan by filing the team/run intent.',
  `4. ONLY AFTER the team's parts return: ${qa
    ? 'apply every fix the QA position named (this refinement pass is part of the work, never skipped), then write'
    : 'write'} the final deliverable to ONE ${ext} file inside the workspace (fs/write works there once the plan is approved — never before).`,
  ...(verify === 'py' ? [
    '5. THEN EXECUTE what you wrote by filing the team/workspace-run intent ({"type": "team/workspace-run", "file": "<your file>"}). The run must PROVE the requirement, not merely start: give the program a headless self-test mode (run when no display is available) that simulates AT LEAST 1000 frames and raises an error the moment the requirement breaks (for example: the ball ever leaves the shape). Keep the full visual program intact — the self-test is in addition, never instead. If the run CRASHES or the self-test fails, fix the file and file again — done RIGHT, not just done. Finish only on a passing run.',
  ] : []),
  '',
  'One shot — no questions back to me; the task below is complete as written.',
  '',
  'THE TASK (verbatim):',
  task,
].join('\n');
