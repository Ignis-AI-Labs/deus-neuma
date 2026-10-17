// team-waves.test.js — refinement loops + torch-passing, proven with a
// scripted ask (the same seam the coordinator tests use — no mock of anything
// under test; the pure decisions run for real, the LLM seam is a real
// deterministic function). The live path is proven by the integration tier.

import { describe, it, expect } from 'vitest';
import {
  WAVE_CAP,
  TORCH_ASK,
  extractTorch,
  findingsFromChecks,
  buildRefinementPlan,
  buildLeadStep,
  parseLeadDirectives,
  runTrialWaves,
} from '../../backend/services/team-waves.js';
import { validatePlan } from '../../backend/services/team-coordinator.js';

// The same REAL minimal contract-satisfying game the scorer tests use.
const GOOD_GAME = `<!DOCTYPE html>
<html><head><style>canvas{display:block}</style></head>
<body><canvas id="game" width="480" height="360"></canvas>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let ball = { x: 240, y: 300, vx: 2, vy: -2 };
let paddle = { x: 200 };
let bricks = [{ x: 0, y: 0, alive: true }];
let score = 0;
let running = false;
document.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') paddle.x += 1; });
canvas.addEventListener('mousemove', (e) => { paddle.x = e.offsetX; });
function tick() { ball.x += ball.vx; if (running) requestAnimationFrame(tick); }
window.__bench = {
  start() { running = true; requestAnimationFrame(tick); },
  state() { return { ball: { x: ball.x, y: ball.y }, paddle: { x: paddle.x }, bricks: bricks.filter(b => b.alive).length, score, running }; },
};
</script></body></html>`;

const BROKEN_GAME = GOOD_GAME.replace('function tick() {', 'function tick( {'); // real syntax error

describe('extractTorch (pure)', () => {
  it('splits the work product from the torch', () => {
    const { body, torch } = extractTorch('the engine code here\n\nTORCH:\nDONE: physics\nNEXT: tune speeds');
    expect(body).toBe('the engine code here');
    expect(torch).toBe('DONE: physics\nNEXT: tune speeds');
  });

  it('a reply with no torch has null torch and an untouched body', () => {
    const { body, torch } = extractTorch('just the work');
    expect(body).toBe('just the work');
    expect(torch).toBeNull();
  });

  it('uses the LAST torch marker (code may legitimately contain the word)', () => {
    const { body, torch } = extractTorch('let x = 1\nTORCH: early note\ncode continues\nTORCH:\nreal torch');
    expect(torch).toBe('real torch');
    expect(body).toContain('code continues');
  });

  it('an empty torch section is null, not an empty string dressed as continuity', () => {
    expect(extractTorch('work\nTORCH:').torch).toBeNull();
    expect(extractTorch(undefined)).toEqual({ body: '', torch: null });
  });

  it('a TORCH: line INSIDE fenced game code is work product, never a torch', () => {
    const reply = '```html\n<div>TORCH: light the wall sconce</div>\nTORCH: hud label\n```\n\nTORCH:\nthe real torch';
    const { body, torch } = extractTorch(reply);
    expect(torch).toBe('the real torch');
    expect(body).toContain('TORCH: light the wall sconce'); // the game keeps its own words
    expect(body).toContain('TORCH: hud label');
  });

  it('fenced code with a TORCH: line but NO torch after the fence yields no torch', () => {
    const reply = '```js\n// TORCH: comment in code\nconst x = 1;\n```';
    const { body, torch } = extractTorch(reply);
    expect(torch).toBeNull();
    expect(body).toBe(reply);
  });
});

describe('findingsFromChecks (pure)', () => {
  it('every failed check becomes a repair instruction; passing checks stay silent', () => {
    const findings = findingsFromChecks({
      completed: true, artifact: true, canvas: false, bench: true,
      rafLoop: true, input: false, syntaxValid: false, selfContained: true,
    });
    expect(findings).toHaveLength(3);
    expect(findings.join(' ')).toMatch(/canvas/i);
    expect(findings.join(' ')).toMatch(/arrow keys/i);
    expect(findings.join(' ')).toMatch(/syntax error/i);
  });

  it('all-green checks yield no findings (the wave becomes polish)', () => {
    expect(findingsFromChecks({
      completed: true, artifact: true, canvas: true, bench: true,
      rafLoop: true, input: true, syntaxValid: true, selfContained: true,
    })).toEqual([]);
  });
});

describe('buildRefinementPlan (pure)', () => {
  const args = {
    loop: 2,
    artifact: '<html>game</html>',
    findings: ['fix the canvas'],
    torches: { wright: 'I tuned the physics', smith: null, warden: 'watch the names' },
    memberOf: { helm: 'a', wright: 'b', smith: 'c', warden: 'a' },
  };

  it('is a valid 3-step wave: builders parallel, warden converges', () => {
    const plan = buildRefinementPlan(args);
    expect(() => validatePlan(plan)).not.toThrow();
    expect(plan.map((s) => [s.id, s.neumaId])).toEqual([
      ['wright-fix-2', 'b'], ['smith-fix-2', 'c'], ['warden-fix-2', 'a'],
    ]);
    expect(plan[0].needs).toEqual([]);
    expect(plan[1].needs).toEqual([]); // genuinely parallel — nothing load-bearing between builders
    expect(plan[2].needs).toEqual(['wright-fix-2', 'smith-fix-2']);
  });

  it('each builder receives the game, the findings, and ITS OWN torch only', () => {
    const [wright, smith, warden] = buildRefinementPlan(args);
    // The parallel builders work FROM the current game; the warden integrates
    // from their fresh outputs (via needs), not from the stale document.
    for (const s of [wright, smith]) expect(s.task).toContain('<html>game</html>');
    expect(wright.task).toContain('fix the canvas');
    expect(wright.task).toContain('I tuned the physics');
    expect(wright.task).not.toContain('watch the names'); // warden's torch is not wright's
    expect(smith.task).not.toContain('torch from your last instance'); // smith had none
    expect(warden.task).toContain('watch the names');
    expect(warden.task).toContain('Trace one full frame'); // the runtime-typo lesson, baked in
  });

  it('no findings → the polish directive drives the wave', () => {
    const [wright] = buildRefinementPlan({ ...args, findings: [] });
    expect(wright.task).toMatch(/make the game BETTER/);
  });

  it("v3: the LEAD's directive enters a lane AFTER the floor, and only its own lane", () => {
    const directives = { wright: 'ramp ball speed after each brick', smith: 'add a second brick layout' };
    const [wright, smith, warden] = buildRefinementPlan({ ...args, directives });
    expect(wright.task).toContain('Your LEAD directs this wave:\nramp ball speed after each brick');
    expect(wright.task.indexOf('fix the canvas')).toBeLessThan(wright.task.indexOf('Your LEAD directs'));
    expect(wright.task).not.toContain('second brick layout');
    expect(smith.task).toContain('Your LEAD directs this wave:\nadd a second brick layout');
    expect(warden.task).not.toContain('Your LEAD directs'); // the integrator answers to the contract
  });

  it('v3: a quiet or off-format LEAD leaves the floor in charge (no invented directive)', () => {
    const [wright] = buildRefinementPlan({ ...args, directives: { wright: null, smith: null, ledger: null } });
    expect(wright.task).not.toContain('Your LEAD directs');
  });
});

describe('buildLeadStep + parseLeadDirectives (pure) — the v3 orchestrator', () => {
  it('the LEAD brief carries the scoreboard floor, the record, and the arc', () => {
    const step = buildLeadStep({
      loop: 2,
      leadId: 'n-lead',
      checks: { completed: true, artifact: true, canvas: false, bench: true, rafLoop: true, input: true, syntaxValid: true, selfContained: true },
      findings: ['The contract canvas is missing.'],
      torches: { wright: 'tuned physics', smith: null, warden: 'watch names', lead: 'wave 1 targeted syntax' },
      waves: [{ loop: 0, verdict: 'PARTIAL', points: 6 }, { loop: 1, verdict: 'PARTIAL', points: 7 }],
    });
    expect(step).toMatchObject({ id: 'lead-2', role: 'LEAD', neumaId: 'n-lead', needs: [] });
    expect(step.task).toContain('- canvas: FAIL');
    expect(step.task).toContain('you cannot overrule');
    expect(step.task).toContain('— WRIGHT: tuned physics');
    expect(step.task).toContain('— SMITH: (no torch posted)');
    expect(step.task).toContain('draft PARTIAL 6/8 → wave 1 PARTIAL 7/8');
    expect(step.task).toContain('Your torch from your last instance:\nwave 1 targeted syntax');
  });

  it('all-green scoreboard → the LEAD directs a polish wave', () => {
    const step = buildLeadStep({
      loop: 1, leadId: 'n', findings: [],
      checks: { completed: true, artifact: true, canvas: true, bench: true, rafLoop: true, input: true, syntaxValid: true, selfContained: true },
      torches: {}, waves: [{ loop: 0, verdict: 'PASS', points: 8 }],
    });
    expect(step.task).toContain('direct a POLISH wave');
  });

  it('parses the three sections; missing or empty ones are null', () => {
    const parsed = parseLeadDirectives('WRIGHT:\nramp the ball\nkeep __bench intact\nSMITH:\nnew layout\nLEDGER:\nbuild is sound');
    expect(parsed).toEqual({ wright: 'ramp the ball\nkeep __bench intact', smith: 'new layout', ledger: 'build is sound' });
    expect(parseLeadDirectives('no sections at all')).toEqual({ wright: null, smith: null, ledger: null });
    expect(parseLeadDirectives(null)).toEqual({ wright: null, smith: null, ledger: null });
    expect(parseLeadDirectives('WRIGHT:\n\nSMITH:\nx')).toMatchObject({ wright: null, smith: 'x' });
  });

  it('sections may arrive out of order, and a repeated header: the LAST one wins', () => {
    const parsed = parseLeadDirectives('LEDGER:\nearly note\nSMITH:\npolish HUD\nWRIGHT:\nfirst try\nWRIGHT:\nfinal directive');
    expect(parsed).toEqual({ wright: 'final directive', smith: 'polish HUD', ledger: 'early note' });
  });

  it('a TORCH trailer is never mistaken for a section (the relay strips it first anyway)', () => {
    const parsed = parseLeadDirectives('WRIGHT:\nfix collision\nSMITH:\nnew theme\nLEDGER:\nwave two\nTORCH:\nmy own continuity');
    expect(parsed.ledger).toBe('wave two\nTORCH:\nmy own continuity'); // an unstripped trailer rides the last section…
    expect(parsed.wright).toBe('fix collision'); // …and never leaks into another lane
  });
});

describe('runTrialWaves — the relay, proven with a scripted ask', () => {
  // A real deterministic ask: wave 0 produces a BROKEN game; the first fix
  // wave repairs it; later waves polish. Torches accumulate per role.
  const scriptedAsk = (log) => async (neumaId, messages, step) => {
    log.push({ id: step.id, neumaId, brief: messages[0].content });
    const torch = `\n\nTORCH:\n${step.id} done by ${neumaId}`;
    if (step.id === 'helm') return `the spec${torch}`;
    if (step.id === 'wright') return 'the engine' + torch;
    if (step.id === 'smith') return 'the look' + torch;
    if (step.id === 'warden') return '```html\n' + BROKEN_GAME + '\n```' + torch;
    if (step.id.startsWith('warden-fix-')) return '```html\n' + GOOD_GAME + '\n```' + torch;
    return `reworked ${step.id}${torch}`;
  };

  it('wave 0 alone (loops=0) scores the first draft and stops', async () => {
    const log = [];
    const out = await runTrialWaves({ members: ['a', 'b', 'c'], loops: 0, ask: scriptedAsk(log), maxParallel: 4 });
    expect(out.waves).toHaveLength(1);
    expect(out.waves[0]).toMatchObject({ loop: 0, verdict: 'PARTIAL' }); // broken game, honestly scored
    expect(log.map((l) => l.id)).toEqual(['helm', 'wright', 'smith', 'warden']);
  });

  it('a refinement wave repairs the game and the arc is recorded wave by wave', async () => {
    const log = [];
    const wavesSeen = [];
    const out = await runTrialWaves({
      members: ['a', 'b', 'c'], loops: 2, ask: scriptedAsk(log), maxParallel: 4,
      onWave: (w) => wavesSeen.push(w.loop),
    });
    expect(out.waves.map((w) => [w.loop, w.verdict])).toEqual([
      [0, 'PARTIAL'], [1, 'PASS'], [2, 'PASS'],
    ]);
    expect(wavesSeen).toEqual([0, 1, 2]);
    expect(out.score.verdict).toBe('PASS'); // the FINAL game is the scored one
    expect(out.artifact).toContain('__bench');
    // Wave 1 carried the syntax finding; wave 2 (all green) became polish.
    const wright1 = log.find((l) => l.id === 'wright-fix-1');
    expect(wright1.brief).toMatch(/syntax error/);
    const wright2 = log.find((l) => l.id === 'wright-fix-2');
    expect(wright2.brief).toMatch(/make the game BETTER/);
  });

  it('torch-passing is real: a member\'s next instance receives ITS OWN last torch', async () => {
    const log = [];
    await runTrialWaves({ members: ['a', 'b', 'c'], loops: 2, ask: scriptedAsk(log), maxParallel: 4 });
    const wright1 = log.find((l) => l.id === 'wright-fix-1');
    expect(wright1.brief).toContain('wright done by b'); // wave-0 wright's torch
    const wright2 = log.find((l) => l.id === 'wright-fix-2');
    expect(wright2.brief).toContain('wright-fix-1 done by b'); // wave-1's torch replaced it
    expect(wright2.brief).not.toContain('smith-fix-1 done'); // never someone else's torch
  });

  it('torches are STRIPPED from the work product downstream neuma and the scorer see', async () => {
    const log = [];
    const steps = [];
    const out = await runTrialWaves({
      members: ['a', 'b', 'c'], loops: 1, ask: scriptedAsk(log), maxParallel: 4,
      onStep: (e) => steps.push(e),
    });
    // The warden's wave-0 brief carries wright's WORK but not wright's torch
    // CONTENT (the literal "TORCH:" string is present in every brief — it is
    // the instruction itself; the private channel is the content).
    const warden0 = log.find((l) => l.id === 'warden');
    expect(warden0.brief).toContain('the engine');
    expect(warden0.brief).not.toContain('wright done by b'); // wright's torch content stays wright's
    // Streamed outputs and the artifact are torch-free.
    for (const s of steps) expect(s.output).not.toContain('TORCH:');
    expect(out.artifact).not.toContain('TORCH:');
    // And every brief carried the torch ask.
    for (const l of log) expect(l.brief).toContain('End your reply with a line that says exactly "TORCH:"');
  });

  it('every step of every wave carries a role and briefs stay role-framed', async () => {
    const log = [];
    await runTrialWaves({ members: ['solo'], loops: 1, ask: scriptedAsk(log), maxParallel: 2 });
    const w1 = log.find((l) => l.id === 'wright-fix-1');
    expect(w1.brief).toContain('Your role: WRIGHT.');
  });

  it('v3: the LEAD directs each wave — directive in the lane brief, ledger on the record, its own torch relayed', async () => {
    const log = [];
    const leadAsk = async (neumaId, messages, step) => {
      log.push({ id: step.id, neumaId, brief: messages[0].content });
      const torch = `\n\nTORCH:\n${step.id} done by ${neumaId}`;
      if (step.id.startsWith('lead-')) {
        return `WRIGHT:\nramp ball speed (${step.id})\nSMITH:\nsecond layout (${step.id})\nLEDGER:\nrecord of ${step.id}${torch}`;
      }
      if (step.id === 'warden' || step.id.startsWith('warden-fix-')) return '```html\n' + GOOD_GAME + '\n```' + torch;
      return `work ${step.id}${torch}`;
    };
    const out = await runTrialWaves({ members: ['a', 'b', 'c'], loops: 2, ask: leadAsk, maxParallel: 4 });

    // The LEAD ran before each wave, and each lane got ITS directive verbatim.
    expect(log.map((l) => l.id)).toContain('lead-1');
    const wright1 = log.find((l) => l.id === 'wright-fix-1');
    expect(wright1.brief).toContain('Your LEAD directs this wave:\nramp ball speed (lead-1)');
    expect(wright1.brief).not.toContain('second layout'); // never the other lane's directive
    // The ledger is on the wave record, torch-free.
    expect(out.waves[1].lead.ledger).toBe('record of lead-1');
    // The LEAD's own torch relays to its next instance, like every member.
    const lead2 = log.find((l) => l.id === 'lead-2');
    expect(lead2.brief).toContain('lead-1 done by');
    // With 3 members, the LEAD seat wraps round-robin to the first (leadOf).
    expect(log.find((l) => l.id === 'lead-1').neumaId).toBe('b'); // 4 % 3 = position 1
  });

  it('rejects an out-of-cap loop count — the relay is bounded', async () => {
    await expect(runTrialWaves({ members: ['a'], loops: WAVE_CAP + 1, ask: async () => 'x', maxParallel: 1 }))
      .rejects.toThrow(/between 0 and 3/);
    await expect(runTrialWaves({ members: ['a'], loops: -1, ask: async () => 'x', maxParallel: 1 }))
      .rejects.toThrow(/between 0 and 3/);
  });

  it('TORCH_ASK is locked wording (part of TRIAL_VERSION 2)', () => {
    expect(TORCH_ASK).toContain('your own next instance');
    expect(WAVE_CAP).toBe(3);
  });
});
